// Renders the README's 2D/3D animation (docs/example-3d.svg, from example-anim.ts) as a looping
// animated PNG, for places that show an <img> but do not run an SVG's animations.
//
// Headless Chrome draws the SVG with every animation paused and set to each sample's time, CSS
// (document.getAnimations) and SMIL (setCurrentTime) alike, so a frame is the SVG at that moment
// and not whatever the browser's clock reached. Frames identical to the one before (the holds)
// are merged into one longer frame. ffmpeg maps every frame to one 255-colour palette, and the
// APNG is written here from those, with exact delays and only each frame's changes.
//
// Usage: node scripts/example-png.ts [in.svg] [out.png] [width] [fps]
// Needs google-chrome (or $CHROME) and ffmpeg on the PATH.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

const [input = "docs/example-3d.svg", output = "docs/example-3d.png", widthArg = "720", fpsArg = "20"] = process.argv.slice(2);
const WIDTH = Number(widthArg), FPS = Number(fpsArg);

const svg = readFileSync(input, "utf8");
const size = /<svg[^>]*\swidth="(\d+(?:\.\d+)?)"[^>]*\sheight="(\d+(?:\.\d+)?)"/.exec(svg);
const dur = /\sdur="([\d.]+)s"/.exec(svg);
if (!size || !dur) throw new Error(`${input}: no size or no animation`);
const DUR = Number(dur[1]);
const HEIGHT = Math.round((WIDTH * Number(size[2])) / Number(size[1]));

const work = mkdtempSync(join(tmpdir(), "example-png-"));
// The SVG inline, sized to the output, so script can reach its animations.
writeFileSync(join(work, "page.html"), `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#f7f7f5}svg{display:block;width:${WIDTH}px;height:${HEIGHT}px}</style>
${svg.replace(/^<\?xml[^>]*>\s*/, "")}`);

const chrome = spawn(process.env.CHROME ?? "google-chrome", [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${join(work, "profile")}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

try {
  // Chrome prints its DevTools address once it listens.
  const browserUrl = await new Promise<string>((resolve, reject) => {
    let err = "";
    chrome.stderr!.on("data", (d: Buffer) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) resolve(m[1]!);
    });
    chrome.on("exit", (code) => reject(new Error(`chrome exited (${code}): ${err}`)));
  });
  const port = new URL(browserUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((t) => t.type === "page")!;

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => (ws.onopen = r, ws.onerror = j));
  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const events = new Map<string, () => void>();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    } else if (msg.method && events.has(msg.method)) events.get(msg.method)!();
  };
  const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression: string) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  const loaded = new Promise<void>((r) => events.set("Page.loadEventFired", r));
  await send("Page.navigate", { url: `file://${join(work, "page.html")}` });
  await loaded;
  await evaluate(`document.fonts.ready.then(() => {
    const svg = document.querySelector("svg");
    svg.pauseAnimations();
    for (const a of document.getAnimations()) a.pause();
  })`);

  // Sample the loop evenly; a frame like the last one only lengthens it.
  const n = Math.round(DUR * FPS);
  const frames: { file: string; ticks: number }[] = [];
  let prev: Buffer | null = null;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * DUR;
    await evaluate(`new Promise((resolve) => {
      document.querySelector("svg").setCurrentTime(${t});
      for (const a of document.getAnimations()) a.currentTime = ${t * 1000};
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })`);
    const shot = Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64");
    if (prev && shot.equals(prev)) {
      frames.at(-1)!.ticks++;
      continue;
    }
    const file = join(work, `f${String(frames.length).padStart(4, "0")}.png`);
    writeFileSync(file, shot);
    frames.push({ file, ticks: 1 });
    prev = shot;
  }
  ws.close();

  // One palette for the whole loop, and every frame mapped to it, by ffmpeg; the APNG is written
  // here, so each frame's delay is exact and each frame carries only what changed.
  const pattern = join(work, "f%04d.png"), palette = join(work, "palette.png");
  ffmpeg(["-i", pattern, "-vf", "palettegen=max_colors=255:reserve_transparent=0:stats_mode=full", palette]);
  const raw = ffmpeg(["-i", pattern, "-i", palette, "-lavfi", "paletteuse=dither=none", "-f", "rawvideo", "-pix_fmt", "pal8", "-"]);
  writeFileSync(output, apng(raw, frames.map((f) => f.ticks)));
  const kb = readFileSync(output).length / 1024;
  console.log(`${output}: ${WIDTH}×${HEIGHT}, ${frames.length} frames of ${n} samples at ${FPS} fps, ${DUR}s loop, ${kb.toFixed(0)} KB`);
} finally {
  // Chrome writes its profile as it goes; let it finish before the directory goes.
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  if (chrome.exitCode === null) await exited;
  rmSync(work, { recursive: true, force: true });
}

function ffmpeg(args: string[]): Buffer {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return r.stdout;
}

/**
 * An APNG from ffmpeg's raw pal8 frames (each W×H indices, then 256 BGRA palette entries), each
 * shown for `ticks` samples. A frame after the first is the box round what changed, blended over
 * the one before; inside the box, a pixel that did not change is the palette's spare transparent
 * entry, so the box compresses to little more than the changes.
 */
function apng(raw: Buffer, ticks: number[]): Buffer {
  const W = WIDTH, H = HEIGHT, size = W * H, step = size + 1024;
  const count = raw.length / step;
  if (count !== ticks.length) throw new Error(`ffmpeg gave ${count} frames for ${ticks.length}`);
  const pixels = (i: number) => raw.subarray(i * step, i * step + size);
  const pal = raw.subarray(size, size + 1024);
  let used = 0;
  for (let i = 0; i < count; i++) for (const v of pixels(i)) used = Math.max(used, v);
  const clear = used < 255 ? used + 1 : -1;

  const chunks: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(type)), 0);
    chunks.push(head, data, crc);
  };
  const u32 = (...v: number[]) => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeUInt32BE(x, i * 4)); return b; };
  chunk("IHDR", Buffer.concat([u32(W, H), Buffer.from([8, 3, 0, 0, 0])]));
  chunk("acTL", u32(count, 0)); // 0 plays: loop for ever
  const entries = clear >= 0 ? clear + 1 : used + 1;
  const plte = Buffer.alloc(entries * 3);
  for (let i = 0; i <= used; i++) (plte[i * 3] = pal[i * 4 + 2]!, plte[i * 3 + 1] = pal[i * 4 + 1]!, plte[i * 3 + 2] = pal[i * 4]!);
  chunk("PLTE", plte);
  if (clear >= 0) {
    const trns = Buffer.alloc(clear + 1, 255);
    trns[clear] = 0;
    chunk("tRNS", trns);
  }

  /** Rows of a box, each behind PNG's "no filter" byte, deflated. */
  const deflate = (px: Uint8Array, x: number, y: number, w: number, h: number, prev?: Uint8Array) => {
    const out = Buffer.alloc((w + 1) * h);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const k = (y + r) * W + x + c;
        out[r * (w + 1) + 1 + c] = prev && px[k] === prev[k] ? clear : px[k]!;
      }
    }
    return zlib.deflateSync(out, { level: 9, memLevel: 9 });
  };
  let seq = 0;
  for (let i = 0; i < count; i++) {
    const px = pixels(i), prev = i > 0 ? pixels(i - 1) : null;
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (prev) {
      x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let k = 0; k < size; k++) {
        if (px[k] === prev[k]) continue;
        const x = k % W, y = (k - x) / W;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) x0 = y0 = x1 = y1 = 0; // no change (cannot happen after merging, but stay valid)
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    // Over the frame before with the unchanged pixels clear, or the box as it is: whichever is smaller.
    const plain = deflate(px, x0, y0, w, h);
    const over = prev && clear >= 0 ? deflate(px, x0, y0, w, h, prev) : null;
    const blend = over && over.length < plain.length ? 1 : 0;
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0);
    fctl.writeUInt32BE(w, 4); fctl.writeUInt32BE(h, 8); fctl.writeUInt32BE(x0, 12); fctl.writeUInt32BE(y0, 16);
    fctl.writeUInt16BE(ticks[i]!, 20); fctl.writeUInt16BE(FPS, 22);
    fctl[24] = 0; // dispose: keep, the next frame draws over it
    fctl[25] = blend;
    chunk("fcTL", fctl);
    const data = blend ? over! : plain;
    if (i === 0) chunk("IDAT", data);
    else chunk("fdAT", Buffer.concat([u32(seq++), data]));
  }
  chunk("IEND", Buffer.alloc(0));
  return Buffer.concat(chunks);
}
