import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRhumbServer, parse } from "../src/index.ts";
import { timingOf } from "../src/timing.ts";
import { claimMarks, defaultCollapsed, fitZoom, followToggle, kindLetters, nodeKey, plainTitle, shortId, starredInside, unfoldStarted } from "../web/src/layout.ts";
import {
  applyMatrix, axisTicks, axisU, AZIMUTH, blendPose, depthScene, ease, fitFocus, flatPose, focusNodes, panelAt, PITCH, projectPath, projectPoint,
  innerRun, nodeRibbon, ribbonFor, rulerTicks, SIGHT, targetPose, viewOf, yearLabel,
} from "../web/src/depth.ts";
import { searchNodes } from "../web/src/search.ts";
import { timerState } from "../web/src/timerState.ts";

describe("view helpers", () => {
  it("collapses subtrees without doing work by default", () => {
    const d = parse(`- [/] Root ^root
  - [x] Done branch ^done
    - [x] Leaf ^leaf
  - [ ] Active branch ^active
    - [ ] Mid ^mid
      - [/] Deep doing ^deep
- [ ] Idle root ^idle
  - [ ] Child ^child
`);
    expect([...defaultCollapsed(d.nodes)].sort()).toEqual(["done", "idle"]);
  });

  it("undoes the user's folds above work that started on a reload, and only those", () => {
    const d = parse(`- [/] Root ^root
  - [ ] Group ^group
    - [ ] Sub ^sub
      - [/] Task ^task
  - [x] Done ^done
    - [x] Leaf ^leaf
`);
    const nodes = new Map<string, (typeof d.nodes)[number]>();
    const parents = new Map<string, (typeof d.nodes)[number] | null>();
    const walk = (ns: typeof d.nodes, p: (typeof d.nodes)[number] | null) => ns.forEach((n) => (nodes.set(nodeKey(n), n), parents.set(nodeKey(n), p), walk(n.children, n)));
    walk(d.nodes, null);
    const folds = new Map([["root", true], ["sub", true], ["done", true], ["group", false]]);
    // `task` started since the last load: the folds above it go, the fold on `done` stays.
    expect([...unfoldStarted(folds, new Set(["root"]), nodes, parents)]).toEqual([["done", true], ["group", false]]);
    // Nothing newly doing: the same map comes back, so React sees no change.
    expect(unfoldStarted(folds, new Set(["root", "task"]), nodes, parents)).toBe(folds);
  });

  it("folds starred nodes like any other and counts stars inside", () => {
    const d = parse(`- [x] Archive ^archive
  - [x] Group ^group
    - [x] Key result {star: true} ^key
  - [x] Other ^other
- [x] Plain ^plain
  - [x] Leaf ^leaf
`);
    // A star does not keep its branch open: only doing work does.
    expect([...defaultCollapsed(d.nodes)].sort()).toEqual(["archive", "group", "plain"]);
    const n = starredInside(d.nodes);
    expect([n.get("archive"), n.get("group"), n.get("key"), n.get("plain")]).toEqual([1, 1, 0, 0]);
  });

  it("frames a set of nodes, never zooming past the cap", () => {
    const view = { width: 1000, height: 600 };
    // Two nodes far apart: centred on them, at the zoom the viewport allows for that box.
    expect(fitZoom({ x: 100, y: 50, width: 800, height: 200 }, view)).toEqual({ x: 500, y: 150, zoom: Math.min(800 / 800, 480 / 200) });
    // A single small card would fill the screen, so the zoom stops at the cap.
    expect(fitZoom({ x: 0, y: 0, width: 240, height: 76 }, view)).toEqual({ x: 120, y: 38, zoom: 1 });
    expect(fitZoom({ x: 0, y: 0, width: 240, height: 76 }, view, 0.2, 0.75).zoom).toBe(0.75);
    // No nodes to frame: the cap again, not infinity.
    expect(fitZoom({ x: 10, y: 20, width: 0, height: 0 }, view).zoom).toBe(1);
    // The cap never raises a fit that is already smaller.
    // 4000 wide and 3000 tall in a 1000x600 viewport: the height is the tighter side.
    expect(fitZoom({ x: 0, y: 0, width: 4000, height: 3000 }, view).zoom).toBeCloseTo(480 / 3000, 5);
  });

  it("decides which nodes carry a timer chip", () => {
    const t = (o: Partial<{ estimate: number | null; started: number | null; finished: number | null; elapsed: number | null; closed: boolean; state: "ok" | "near" | "over" | null }>) => ({
      estimate: null, started: null, finished: null, elapsed: null, closed: false, state: null, ...o,
    });
    // Doing compares, finished shows what it took, todo shows the estimate alone.
    expect(timerState(t({ estimate: 7200, started: 0, elapsed: 600, state: "ok" }), "doing")).toBe("live");
    expect(timerState(t({ estimate: 7200, started: 0, finished: 60, elapsed: 6000, closed: true }), "done")).toBe("closed");
    expect(timerState(t({ estimate: 7200 }), "todo")).toBe("estimate");
    // No chip: a todo without an estimate, a todo that also has a start, and non-work statuses.
    expect(timerState(t({}), "todo")).toBeNull();
    expect(timerState(t({ estimate: 7200, started: 0, elapsed: 600 }), "todo")).toBeNull();
    expect(timerState(t({ estimate: 7200 }), "dropped")).toBeNull();
    expect(timerState(t({ estimate: 7200 }), "idea")).toBeNull();
    expect(timerState(null, "doing")).toBeNull();
  });

  it("shortens ids that repeat the parent id", () => {
    expect(shortId("rhumb-parser", "rhumb")).toBe("^…-parser");
    expect(shortId("camelot-loss-a1", "camelot-loss")).toBe("^…-a1");
    expect(shortId("rhumbline", "rhumb")).toBe("^rhumbline");
    expect(shortId("ui", null)).toBe("^ui");
    expect(shortId(null, "x")).toBe("no id");
    // Long IDs keep their end.
    expect(shortId("camelot-next-final-teacher", null)).toBe("^…inal-teacher");
    expect(shortId("camelot-next-final-teacher", "camelot-next")).toBe("^…inal-teacher");
    expect(shortId("rhumb-decisions", "rhumb")).toBe("^…-decisions");
  });

  it("strips link syntax from titles", () => {
    expect(plainTitle("Survey [notes](diary:x#y) and `code` \\^x")).toBe("Survey notes and code ^x");
  });
});

describe("following a fold", () => {
  const pane = { width: 1000, height: 600 };
  const onScreen = (b: { x: number; y: number }, v: { x: number; y: number; zoom: number }) => ({ x: b.x * v.zoom + v.x, y: b.y * v.zoom + v.y });

  it("keeps the node where it was on screen when the relayout moves it", () => {
    const view = { x: 100, y: 50, zoom: 0.5 };
    const before = { x: 400, y: 300 }, after = { x: 900, y: -200, width: 240 };
    const next = followToggle(before, after, view, pane);
    expect(onScreen(after, next)).toEqual(onScreen(before, view));
    expect(next.zoom).toBe(0.5);
  });

  it("leaves the view alone when the node did not move", () => {
    const view = { x: 130, y: 20, zoom: 1.2 }; // the node is well inside the pane
    expect(followToggle({ x: 10, y: 10 }, { x: 10, y: 10, width: 240 }, view, pane)).toEqual(view);
  });

  it("brings the node back inside when it was at or past the edge", () => {
    // Clicked with its right half off screen: it is pulled in so its top strip shows.
    const view = { x: 0, y: 0, zoom: 1 };
    const next = followToggle({ x: 900, y: 580 }, { x: 900, y: 580, width: 240 }, view, pane);
    const p = onScreen({ x: 900, y: 580 }, next);
    expect(p.x + 240).toBeLessThanOrEqual(pane.width - 24 + 1e-9);
    expect(p.y + 76).toBeLessThanOrEqual(pane.height - 24 + 1e-9);
    const up = followToggle({ x: -50, y: -50 }, { x: -50, y: -50, width: 240 }, view, pane);
    expect(onScreen({ x: -50, y: -50 }, up)).toEqual({ x: 24, y: 24 });
  });

  it("keeps a group wider than the pane by its title end", () => {
    const next = followToggle({ x: 0, y: 0 }, { x: 0, y: 0, width: 5000 }, { x: -300, y: 0, zoom: 1 }, pane);
    expect(onScreen({ x: 0, y: 0 }, next).x).toBe(24);
  });
});

describe("directory server", () => {
  let dir: string;
  let close: () => Promise<void> = async () => {};
  afterEach(async () => {
    await close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists .rhumb files, serves each by relative path and rejects escapes", async () => {
    dir = mkdtempSync(join(tmpdir(), "portolan-"));
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "a.rhumb"), "---\ntitle: Alpha\n---\n- [x] Done ^d\n- [ ] Todo ^t\n");
    writeFileSync(join(dir, "sub", "b.rhumb"), "- [ ] B ^b\n");
    writeFileSync(join(dir, "node_modules", "skip.rhumb"), "- [ ] X ^x\n");
    writeFileSync(join(dir, "secret.txt"), "nope");
    const webDir = join(dir, "web");
    mkdirSync(webDir);
    writeFileSync(join(webDir, "index.html"), "<!doctype html><title>t</title>");

    const server = createRhumbServer({ root: dir, webDir });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    close = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); });
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    writeFileSync(join(dir, "sub", "b.rhumb"), "- [ ] B {star: true} ^b\n");
    const list = await (await fetch(`${base}/api/files`)).json();
    expect(list.files.map((f: any) => f.file)).toEqual(["a.rhumb", "sub/b.rhumb"]);
    expect(list.files[1].starred).toEqual([{ id: "b", title: "B", status: "todo" }]);
    expect(list.files[0]).toMatchObject({ title: "Alpha", nodes: 2, progress: { done: 1, total: 2 }, errors: 0 });

    const b = await (await fetch(`${base}/api/doc?file=sub%2Fb.rhumb`)).json();
    expect(b.doc.nodes[0].id).toBe("b");
    expect((await fetch(`${base}/api/doc`)).status).toBe(400);
    expect((await fetch(`${base}/api/doc?file=secret.txt`)).status).toBe(400);
    expect((await fetch(`${base}/api/doc?file=..%2F..%2Fetc%2Fx.rhumb`)).status).toBe(400);
    expect((await fetch(`${base}/api/doc?file=missing.rhumb`)).status).toBe(404);

    const ok = await fetch(`${base}/api/edit?file=a.rhumb`, {
      method: "POST", body: JSON.stringify({ version: (await (await fetch(`${base}/api/doc?file=a.rhumb`)).json()).version,
        edit: { op: "set-status", id: "t", status: "done" } }),
    });
    expect(ok.status).toBe(200);

    const page = await fetch(`${base}/`);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    // Static paths cannot escape the web directory.
    const escaped = await new Promise<string>((r) =>
      request({ host: "127.0.0.1", port, path: "/../secret.txt" }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => r(body));
      }).end());
    expect(escaped).not.toContain("nope");
  });
});

describe("recent maps", () => {
  it("moves a file to the front, drops duplicates and caps the list", async () => {
    const { pushRecent } = await import("../web/src/recent.ts");
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent([], "x")).toEqual(["x"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("searchNodes", () => {
  const d = parse(`- [/] History of life ^history-life
  - [x] Homo sapiens appears ^history-life-sapiens
  - [-] Dragon program ^history-life-dragons
- [ ] Untitled-id node
- [?] Life support ^life
`);
  const all = () => {
    const out: (typeof d.nodes)[number][] = [];
    const walk = (ns: typeof d.nodes) => ns.forEach((n) => (out.push(n), walk(n.children)));
    walk(d.nodes);
    return out;
  };

  it("returns only the node whose ID matches exactly, with or without ^", () => {
    expect(searchNodes(all(), "life")).toEqual({ keys: ["life"], ranked: ["life"], exact: true });
    expect(searchNodes(all(), " ^history-life ")).toMatchObject({ keys: ["history-life"], exact: true });
  });

  it("matches titles and IDs by case-insensitive words, in document order", () => {
    expect(searchNodes(all(), "LIFE").keys).toEqual(["history-life", "history-life-sapiens", "history-life-dragons", "life"]);
    expect(searchNodes(all(), "dragon life").keys).toEqual(["history-life-dragons"]);
    expect(searchNodes(all(), "untitled").keys).toEqual(["line:4"]);
  });

  it("ranks whole, prefix and word-start matches first, earlier positions higher", () => {
    const d2 = parse(`- [ ] Field notes ^notes
- [ ] Lifeboat drill ^drill
- [ ] Life ^x1
- [ ] History of life ^x2
- [ ] Support systems for life ^x3
`);
    const r = searchNodes(d2.nodes, "life");
    expect(r.keys).toEqual(["drill", "x1", "x2", "x3"]); // the map keeps document order
    expect(r.ranked).toEqual(["x1", "drill", "x2", "x3"]);
    // Fuzzy: the tighter subsequence wins.
    const d3 = parse("- [ ] alpha-b-c-d-e ^wide\n- [ ] abc-de ^tight\n");
    expect(searchNodes(d3.nodes, "abde").ranked).toEqual(["tight", "wide"]);
  });

  it("falls back to in-order subsequences when no word matches directly", () => {
    expect(searchNodes(all(), "hlsap")).toMatchObject({ keys: ["history-life-sapiens"], exact: false });
    expect(searchNodes(all(), "zzz").keys).toEqual([]);
    expect(searchNodes(all(), "   ").keys).toEqual([]);
  });
});

describe("kinds and claims", () => {
  it("gives custom kinds the shortest prefix no other custom kind shares", () => {
    const d = parse(`- [ ] A {kind: dataset} ^a
- [ ] B {kind: Deploy} ^b
  - [ ] C {kind: data} ^c
- [ ] D {kind: model} ^d
- [ ] E {kind: hypothesis} ^e
- [ ] F {kind: 复盘} ^f
- [ ] G {kind: 复现} ^g
- [ ] H {kind: review} ^h
- [ ] I {kind: retrospective} ^i
`);
    expect(Object.fromEntries(kindLetters(d.nodes))).toEqual({
      data: "Data", dataset: "Datas", deploy: "De", model: "M", 复盘: "复盘", 复现: "复现", retrospective: "Ret", review: "Rev",
    });
    // Alone, one letter is enough; preset kinds take no letters.
    expect(Object.fromEntries(kindLetters(parse("- [ ] A {kind: dataset} ^a\n- [ ] B {kind: event} ^b\n").nodes))).toEqual({ dataset: "D" });
  });

  it("shows one verdict (or untested for a bare hypothesis), then qualifiers", () => {
    const d = parse(`- [x] A {kind: hypothesis, refuted: true, contested: true} ^a
- [ ] B {kind: hypothesis} ^b
- [x] C {kind: hypothesis, supported: true, refuted: true} ^c
- [x] D {kind: finding, replicated: true} ^d
- [ ] E {kind: finding} ^e
`);
    expect(d.nodes.map(claimMarks)).toEqual([["refuted", "contested"], ["untested"], [], ["replicated"], []]);
  });

  it("filters search by kind: and is:", () => {
    const d = parse(`- [x] LR mismatch {kind: hypothesis, refuted: true} ^lr
- [ ] Final teacher {kind: hypothesis} ^teacher
- [x] Row weights help {kind: finding, supported: true} ^rw
- [ ] LR sweep {kind: experiment} ^sweep
`);
    expect(searchNodes(d.nodes, "kind:hypothesis").keys).toEqual(["lr", "teacher"]);
    expect(searchNodes(d.nodes, "is:untested").keys).toEqual(["teacher"]);
    expect(searchNodes(d.nodes, "lr kind:HYPOTHESIS").keys).toEqual(["lr"]);
    expect(searchNodes(d.nodes, "is:refuted is:supported").keys).toEqual([]);
    expect(searchNodes(d.nodes, "kind:nothing").keys).toEqual([]);
  });
});

describe("the 3D time-depth view", () => {
  const HOUR = 3_600;
  const DAY = 86_400;
  const YEAR = 365 * DAY;
  /** 2026-10-16 12:00 local, the reference "now" for these tests. */
  const NOW = Math.floor(new Date(2026, 9, 16, 12, 0, 0).getTime() / 1000);
  const at = (y: number, m: number, d: number, h = 0) => Math.floor(new Date(y, m - 1, d, h).getTime() / 1000);
  const node = (attrs: Record<string, unknown>, status: "todo" | "doing" | "done") => ({ attrs, status });
  const deg = (r: number) => (r * 180) / Math.PI;

  describe("the time axis", () => {
    const focus = { to: NOW, span: 10 * DAY };

    it("runs linearly from the window's oldest end to its newest", () => {
      expect(axisU(NOW - 10 * DAY, focus)).toBeCloseTo(0, 9);
      expect(axisU(NOW, focus)).toBeCloseTo(1, 9);
      expect(axisU(NOW - 5 * DAY, focus)).toBeCloseTo(0.5, 9);
    });

    it("squeezes times outside the window into short tails, still in order", () => {
      const older = [NOW - 11 * DAY, NOW - 30 * DAY, NOW - 1e6 * YEAR].map((t) => axisU(t, focus));
      expect(older[0]).toBeLessThan(0);
      for (let i = 1; i < older.length; i++) expect(older[i]!).toBeLessThan(older[i - 1]!);
      // However far back, a card stays within a short reach of the window rather than off screen.
      expect(older[2]!).toBeGreaterThan(-0.2);
      const newer = [NOW + DAY, NOW + 30 * DAY, NOW + 1e6 * YEAR].map((t) => axisU(t, focus));
      for (let i = 1; i < newer.length; i++) expect(newer[i]!).toBeGreaterThan(newer[i - 1]!);
      expect(newer[2]!).toBeLessThan(1.2);
    });
  });

  // A small map: three rows of cards, each row a day older than the one below it.
  const grid = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, x: (i % 4) * 280, y: Math.floor(i / 4) * 140, width: 240, height: 76 }));
  const gridTime = (k: string) => NOW - Number(k.slice(1)) * 6 * HOUR;
  const none = () => null, noGroup = () => false;
  const frameAll = { x: -40, y: -40, width: 1200, height: 460 };
  const pose = targetPose(grid, frameAll, gridTime, none, noGroup, 1)!;
  const view = viewOf(pose);

  describe("the camera", () => {
    const along = (u: number) => projectPoint(view, { t: u * view.length, d: view.aim.d, h: pose.floorH });

    it("looks at the time axis at about 45°", () => {
      const { pitch, azimuth } = view.camera;
      expect(deg(Math.acos(Math.cos(azimuth) * Math.cos(pitch)))).toBeCloseTo(45, 6);
      expect(deg(SIGHT)).toBeCloseTo(45, 9);
      expect(deg(Math.acos(Math.cos(AZIMUTH) * Math.cos(PITCH)))).toBeCloseTo(45, 6);
    });

    it("draws the time axis roughly level, oldest on the left", () => {
      const a = along(0), b = along(1);
      expect(b.x).toBeGreaterThan(a.x);
      expect(Math.abs(deg(Math.atan2(b.y - a.y, b.x - a.x)))).toBeLessThan(8);
    });

    it("puts the newest end nearest the eye, so newer panels are bigger", () => {
      const a = along(0), b = along(1);
      expect(b.dist).toBeLessThan(a.dist);
      expect(b.scale).toBeGreaterThan(a.scale * 1.15);
    });

    it("keeps a panel's text the right way round: its right edge right, its top edge up", () => {
      const p = panelAt(view, 0, 0, view.length / 2, 240, 76);
      const [tl, tr, br, bl] = p.quad;
      expect(tr!.x).toBeGreaterThan(tl!.x);
      expect(br!.x).toBeGreaterThan(bl!.x);
      expect(bl!.y).toBeGreaterThan(tl!.y);
      expect(br!.y).toBeGreaterThan(tr!.y);
    });

    it("keeps everything finite, even a point behind the eye", () => {
      for (const t of [-1e6, 0, view.length, 1e6]) {
        const p = projectPoint(view, { t, d: 0, h: 0 });
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && p.scale > 0, `t ${t}`).toBe(true);
      }
    });
  });

  describe("panels", () => {
    it("carries the card's own rectangle exactly onto its perspective image", () => {
      for (const t of [0, view.length * 0.3, view.length]) {
        const p = panelAt(view, 120, 80, t, 240, 76);
        const corners: [number, number][] = [[0, 0], [240, 0], [240, 76], [0, 76]];
        corners.forEach(([u, v], i) => {
          const q = applyMatrix(p.matrix, u, v);
          expect(q.x + p.box.x, `t ${t} corner ${i}`).toBeCloseTo(p.quad[i]!.x, 4);
          expect(q.y + p.box.y, `t ${t} corner ${i}`).toBeCloseTo(p.quad[i]!.y, 4);
        });
        // A perspective row: a panel at an angle, not a flat label scaled about its centre.
        expect(Math.abs(Number(p.matrix.slice(9, -1).split(",")[3]))).toBeGreaterThan(0);
      }
    });

    it("is seen at an angle: foreshortened across, its upright edges of different heights", () => {
      const p = panelAt(view, 120, 80, view.length / 2, 240, 76);
      const [tl, tr, br, bl] = p.quad;
      const left = bl!.y - tl!.y, right = br!.y - tr!.y;
      expect(Math.abs(left - right) / Math.max(left, right)).toBeGreaterThan(0.005);
      const centre = projectPoint(view, { t: view.length / 2, d: 240, h: -118 });
      expect(tr!.x - tl!.x).toBeLessThan(240 * centre.scale * 0.85);
    });

    it("stands in the plane of its moment, orthogonal to the time axis", () => {
      const t = view.length * 0.4;
      const p = panelAt(view, 0, 0, t, 240, 76);
      const mid = projectPoint(view, { t, d: 120, h: -38 });
      const viaMatrix = applyMatrix(p.matrix, 120, 38);
      expect(viaMatrix.x + p.box.x).toBeCloseTo(mid.x, 4);
      expect(viaMatrix.y + p.box.y).toBeCloseTo(mid.y, 4);
    });
  });

  describe("the move between the views", () => {
    it("starts from the flat view exactly: every card on its own layout box, at 1:1", () => {
      const flat = depthScene(grid, flatPose(pose), gridTime, none, noGroup);
      for (const b of grid) {
        const p = flat.panels.get(b.key)!;
        expect(p.box.x, b.key).toBeCloseTo(b.x, 6);
        expect(p.box.y, b.key).toBeCloseTo(b.y, 6);
        expect(p.box.width, b.key).toBeCloseTo(b.width, 6);
        expect(p.box.height, b.key).toBeCloseTo(b.height, 6);
        const q = applyMatrix(p.matrix, b.width, b.height);
        expect(q.x).toBeCloseTo(b.width, 6);
        expect(q.y).toBeCloseTo(b.height, 6);
        expect(p.fog).toBe(1);
      }
    });

    it("ends on the 3D pose, and passes smoothly between the two", () => {
      const f = flatPose(pose);
      expect(blendPose(f, pose, 0)).toEqual(f);
      const end = blendPose(f, pose, 1);
      expect(end.length).toBeCloseTo(pose.length, 6);
      expect(end.sigma).toBeCloseTo(pose.sigma, 9);
      expect(end.anchor.x).toBeCloseTo(pose.anchor.x, 6);
      // Halfway, a card is somewhere between where it starts and where it ends, not off the screen.
      const at = (s: number) => depthScene(grid, blendPose(f, pose, s), gridTime, none, noGroup).panels.get("k5")!.box;
      const a = at(0), b = at(0.5), c = at(1);
      expect(b.x).toBeGreaterThan(Math.min(a.x, c.x) - 300);
      expect(b.x).toBeLessThan(Math.max(a.x, c.x) + 300);
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      expect(ease(0.5)).toBeCloseTo(0.5, 9);
    });
  });

  describe("the flat view's frame decides the 3D pose", () => {
    const quads = (scene: ReturnType<typeof depthScene>, keys: string[]) => keys.flatMap((k) => scene.panels.get(k)!.quad);
    const box = (pts: { x: number; y: number }[]) => {
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    };

    it("takes as focus nodes the cards whose centre the frame holds", () => {
      expect(focusNodes(grid, { x: 0, y: 0, width: 380, height: 100 }, noGroup).map((b) => b.key)).toEqual(["k0"]);
      expect(focusNodes(grid, frameAll, noGroup).length).toBe(12);
      // A group by its header, not by the whole frame, which can reach far past its title.
      const big = [{ key: "g", x: 0, y: 0, width: 2000, height: 2000 }];
      expect(focusNodes(big, { x: 1500, y: 1500, width: 100, height: 100 }, () => true)).toEqual([]);
      expect(focusNodes(big, { x: 0, y: 0, width: 300, height: 100 }, () => true).length).toBe(1);
    });

    it("keeps the focus nodes inside the frame, and fits their 3D box to its shape", () => {
      for (const frame of [frameAll, { x: 250, y: 100, width: 600, height: 300 }, { x: -20, y: -20, width: 700, height: 260 }]) {
        const p = targetPose(grid, frame, gridTime, none, noGroup, 1)!;
        const scene = depthScene(grid, p, gridTime, none, noGroup);
        const F = focusNodes(grid, frame, noGroup).map((b) => b.key);
        const b = box(quads(scene, F));
        expect(b.x, `frame ${frame.width}`).toBeGreaterThanOrEqual(frame.x - 1);
        expect(b.y).toBeGreaterThanOrEqual(frame.y - 1);
        expect(b.x + b.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
        expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
        // Fills the frame across or down (whichever binds), with the ruler kept under it.
        expect(Math.max(b.width / frame.width, b.height / frame.height), `frame ${frame.width}`).toBeGreaterThan(0.6);
      }
    });

    it("gives the time axis the length that makes the focus nodes' box the frame's shape", () => {
      const wide = targetPose(grid, { x: -40, y: -40, width: 2400, height: 460 }, gridTime, none, noGroup, 1)!;
      const narrow = targetPose(grid, { x: -40, y: -40, width: 1200, height: 460 }, gridTime, none, noGroup, 1)!;
      expect(wide.length).toBeGreaterThan(narrow.length * 1.3);
    });

    it("takes the window from the focus nodes' moments", () => {
      const all = targetPose(grid, frameAll, gridTime, none, noGroup, 1)!;
      const one = targetPose(grid, { x: 0, y: 0, width: 300, height: 100 }, gridTime, none, noGroup, 1)!;
      expect(one.focus.span).toBeLessThan(all.focus.span);
      // Most of the focus nodes' moments are inside it (an end may fall into a tail, see fitFocus).
      const inside = grid.filter((b) => gridTime(b.key) >= all.focus.to - all.focus.span && gridTime(b.key) <= all.focus.to).length;
      expect(inside).toBeGreaterThanOrEqual(Math.ceil(grid.length * 0.85));
    });

    it("does not blow a lone card up to fill the screen", () => {
      const one = targetPose(grid, { x: -2000, y: -2000, width: 4280, height: 4120 }, gridTime, none, noGroup, 1)!;
      expect(one.sigma).toBeLessThanOrEqual(1.6);
    });

    it("has nothing to say about a frame over empty space", () => {
      expect(targetPose(grid, { x: 5000, y: 5000, width: 100, height: 100 }, gridTime, none, noGroup, 1)).toBeNull();
    });
  });

  describe("the window", () => {
    it("frames the moments it is given, with a small margin", () => {
      const f = fitFocus([NOW - 10 * DAY, NOW - 5 * DAY, NOW])!;
      expect(f.to).toBeGreaterThan(NOW);
      expect(f.to - f.span).toBeLessThan(NOW - 10 * DAY);
      expect(f.span).toBeLessThan(10 * DAY * 1.2);
      expect(fitFocus([])).toBeNull();
      expect(fitFocus([NOW])!.span).toBeGreaterThan(0);
    });

    it("is not spent on the gap to one outlier", () => {
      const recent = Array.from({ length: 20 }, (_, i) => NOW - i * DAY);
      const f = fitFocus([...recent, NOW - 1e5 * YEAR])!;
      expect(f.span).toBeLessThan(30 * DAY);
      expect(f.to - f.span).toBeLessThanOrEqual(NOW - 15 * DAY);
    });
  });

  describe("the ruler", () => {
    const N = 11;
    const hours = () => axisTicks({ to: NOW, span: 12 * HOUR }, N);

    it("labels clock time within a day, days within a month, months within a year", () => {
      expect(hours().length).toBeGreaterThan(3);
      expect(hours().every((t) => /^\d{2}:\d{2}$/.test(t.label))).toBe(true);
      const midnight = axisTicks({ to: at(2026, 10, 16, 12), span: 24 * HOUR }, N).filter((t) => t.major).map((t) => t.label);
      expect(midnight).toEqual(["00:00"]);
      expect(axisTicks({ to: NOW, span: 7 * DAY }, N).map((t) => t.label).slice(0, 3)).toEqual(["Oct 16", "Oct 15", "Oct 14"]);
      const months = axisTicks({ to: NOW, span: YEAR }, N);
      expect(months.every((t) => /^[A-Z][a-z]{2}$|^\d{4}$/.test(t.label))).toBe(true);
      const january = months.filter((t) => t.major);
      expect(january.length).toBeGreaterThan(0);
      expect(january.every((t) => /^\d{4}$/.test(t.label))).toBe(true);
    });

    it("names years, then decades and eras, on a long map", () => {
      expect(axisTicks({ to: at(2026, 10, 16), span: 100 * YEAR }, N).map((t) => t.label).slice(0, 3)).toEqual(["2020", "2010", "2000"]);
      expect(axisTicks({ to: at(2026, 10, 16), span: 25 * YEAR }, N).map((t) => t.label).slice(0, 3)).toEqual(["2025", "2022", "2019"]);
      const long = axisTicks({ to: at(2026, 10, 16), span: 1e4 * YEAR }, N);
      expect(long.map((t) => t.label).slice(0, 3)).toEqual(["2000", "1000", "1 BCE"]);
      expect(new Set(long.map((t) => t.label)).size).toBe(long.length);
      expect(axisTicks({ to: at(2026, 10, 16), span: 500 * YEAR }, N).filter((t) => t.major).length).toBe(2);

      expect(yearLabel(2026)).toBe("2026");
      expect(yearLabel(-66_000_000)).toBe("66M BCE");
      expect(yearLabel(-1)).toBe("2 BCE"); // astronomical year -1 is 2 BCE
      expect(yearLabel(0)).toBe("1 BCE");
      expect(yearLabel(1e6)).toBe("1M CE"); // a compacted year says which era it is in
    });

    it("places every tick inside the window, at its own place on the axis, newest first", () => {
      for (const span of [HOUR, 6 * HOUR, DAY, 7 * DAY, 30 * DAY, YEAR, 25 * YEAR, 1e4 * YEAR, 1e8 * YEAR]) {
        const focus = { to: NOW, span };
        const ticks = axisTicks(focus, N);
        expect(ticks.length, `span ${span}`).toBeGreaterThanOrEqual(2);
        expect(ticks.length, `span ${span}`).toBeLessThanOrEqual(2 * N);
        expect(new Set(ticks.map((t) => t.u.toFixed(4))).size, `span ${span}`).toBe(ticks.length);
        for (const t of ticks) {
          expect(t.time).toBeLessThanOrEqual(focus.to);
          expect(t.time).toBeGreaterThanOrEqual(focus.to - focus.span);
          expect(t.u).toBeCloseTo(axisU(t.time, focus), 9);
          expect(t.label.length).toBeGreaterThan(0);
        }
        for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.time, `span ${span}`).toBeLessThan(ticks[i - 1]!.time);
      }
    });

    it("refines with the zoom: more room on screen, more ticks", () => {
      const scene = depthScene(grid, pose, gridTime, none, noGroup);
      expect(rulerTicks(scene, 2).length).toBeGreaterThan(rulerTicks(scene, 0.5).length);
    });
  });

  describe("timer bars", () => {
    it("draws a done node by its real start and finish", () => {
      const r = ribbonFor(timingOf(node({ estimate: "3d", started: "2026-09-20", finished: "2026-09-24" }, "done"), NOW), "done", at(2026, 9, 20), NOW)!;
      expect(r.kind).toBe("actual");
      expect(r.from).toBe(at(2026, 9, 20));
      expect(r.to).toBe(at(2026, 9, 25) - 1); // a date-only finish means during that day
      expect(r.label).toBe("4d23h");
      expect(r.detail).toBe("took 4d23h against 3d estimated");
      expect(r.plan).toBeUndefined();
      const exact = ribbonFor(timingOf(node({ started: "2026-09-20T09:00", finished: "2026-09-20T11:30" }, "done"), NOW), "done", at(2026, 9, 20), NOW)!;
      expect(exact.label).toBe("2h30m");
      // Done without both times is not a measurement, and an estimate is not drawn in its place.
      expect(ribbonFor(timingOf(node({ estimate: "3d" }, "done"), NOW), "done", NOW, NOW)).toBeNull();
      expect(ribbonFor(timingOf(node({ estimate: "3d", started: "2026-09-20" }, "done"), NOW), "done", NOW, NOW)).toBeNull();
    });

    it("draws a doing node as a progress bar along its plan", () => {
      const r = ribbonFor(timingOf(node({ estimate: "5d", started: "2026-10-10" }, "doing"), NOW), "doing", NOW - 6 * DAY, NOW)!;
      expect(r.kind).toBe("running");
      expect(r.from).toBe(at(2026, 10, 10));
      expect(r.to).toBe(NOW);
      expect(r.plan).toEqual({ from: at(2026, 10, 10), to: at(2026, 10, 10) + 5 * DAY });
      expect(r.state).toBe("over");
      expect(r.label).toBe("6d12h/5d");
      expect(r.detail).toBe("6d12h of 5d estimated (130%, 1d12h over)");
      // Without an estimate it is the run alone; without a start, the estimate alone.
      const bare = ribbonFor(timingOf(node({ started: "2026-10-16T09:00" }, "doing"), NOW), "doing", NOW, NOW)!;
      expect(bare.plan).toBeUndefined();
      expect(bare.label).toBe("3h");
      const unstarted = ribbonFor(timingOf(node({ estimate: "5d" }, "doing"), NOW), "doing", NOW - DAY, NOW)!;
      expect(unstarted.kind).toBe("estimate");
      expect(unstarted.from).toBe(NOW - DAY);
    });

    it("draws anything else with an estimate as that estimate, from its start if it has one", () => {
      const own = NOW - 20 * DAY;
      const r = ribbonFor(timingOf(node({ estimate: "10d" }, "todo"), NOW), "todo", own, NOW)!;
      expect(r.kind).toBe("estimate");
      expect(r.from).toBe(own);
      expect(r.to - r.from).toBe(10 * DAY);
      expect(r.label).toBe("est. 10d"); // under two weeks, in days
      const started = ribbonFor(timingOf(node({ estimate: "5d", started: "2026-10-14T09:00" }, "todo"), NOW), "todo", NOW, NOW)!;
      expect(started.kind).toBe("estimate");
      expect(started.from).toBe(at(2026, 10, 14, 9));
      expect(ribbonFor(timingOf(node({ estimate: "2h" }, "todo"), NOW), "todo", NOW, NOW)!.kind).toBe("estimate");
      expect(ribbonFor(null, "todo", NOW, NOW)).toBeNull();
      expect(ribbonFor(timingOf(node({ started: "2026-10-14" }, "todo"), NOW), "todo", NOW, NOW)).toBeNull();
    });

    describe("a folded done node without times of its own", () => {
      const map = parse(`---
rhumb: 0.1
---
- [x] Release ^rel
  - [x] Parser {started: 2026-10-08T09:00, finished: 2026-10-09T18:00} ^parser
  - [x] Docs ^docs
    - [x] Guide {started: 2026-10-11T10:00, finished: 2026-10-12T12:00} ^guide
    - [x] Notes ^notes
  - [-] Dropped {started: 2026-10-06T09:00, finished: 2026-10-06T12:00} ^dropped
  - [/] Polish {started: 2026-10-13T09:00} ^polish
- [x] Bare ^bare
  - [x] Untimed child ^untimed
- [x] Half {started: 2026-10-07T09:00} ^half
  - [x] Late child {started: 2026-10-08T09:00, finished: 2026-10-10T18:00} ^late
`);
      const find = (id: string, ns = map.nodes): (typeof map.nodes)[number] | undefined => {
        for (const n of ns) { if (n.id === id) return n; const c = find(id, n.children); if (c) return c; }
      };

      it("spans its work: the earliest start to the latest finish, however deep", () => {
        const inner = innerRun(find("rel")!, NOW)!;
        // The dropped item's run counts (it was closed), the running one does not (it has no finish).
        expect(inner.count).toBe(3);
        expect(inner.from).toBe(at(2026, 10, 6, 9));
        expect(inner.to).toBe(at(2026, 10, 12, 12));
        const r = nodeRibbon(find("rel")!, true, NOW, NOW)!;
        expect(r.kind).toBe("actual");
        expect(r.inferred).toBe(3);
        expect([r.from, r.to]).toEqual([inner.from, inner.to]);
        expect(r.label).toBe("6d3h · 3 inside");
        expect(r.detail).toBe("took 6d3h, read from the 3 timed items inside");
      });

      it("only when folded: unfolded, its children draw their own bars", () => {
        expect(nodeRibbon(find("rel")!, false, NOW, NOW)).toBeNull();
      });

      it("keeps a time of its own and reads only the missing end from inside", () => {
        const r = nodeRibbon(find("half")!, true, NOW, NOW)!;
        expect(r.from).toBe(at(2026, 10, 7, 9));
        expect(r.to).toBe(at(2026, 10, 10, 18));
        expect(r.inferred).toBe(1);
      });

      it("draws nothing when nothing inside has a finished run", () => {
        expect(innerRun(find("bare")!, NOW)).toBeNull();
        expect(nodeRibbon(find("bare")!, true, NOW, NOW)).toBeNull();
      });

      it("leaves a node with a run of its own, and any status but done, as they were", () => {
        const parser = nodeRibbon(find("parser")!, true, NOW, NOW)!;
        expect(parser.inferred).toBeUndefined();
        expect(parser.label).toBe("1d9h");
        const todo = parse("---\nrhumb: 0.1\n---\n- [ ] Plan ^plan\n  - [x] Step {started: 2026-10-08T09:00, finished: 2026-10-09T09:00} ^step\n").nodes[0]!;
        expect(nodeRibbon(todo, true, NOW, NOW)).toBeNull();
      });
    });

    describe("their shape", () => {
      const boxes = [{ key: "k", x: 0, y: 0, width: 240, height: 76 }];
      const focus = { to: NOW + DAY, span: 20 * DAY };
      const scene = (r: ReturnType<typeof ribbonFor>) => {
        const p = targetPose(boxes, { x: -100, y: -100, width: 600, height: 300 }, () => NOW - DAY, () => r, () => false, 1)!;
        return depthScene(boxes, { ...p, focus }, () => NOW - DAY, () => r, () => false).bars[0]!;
      };
      const width = (q: { x: number }[]) => Math.abs(q[1]!.x - q[0]!.x);

      it("fills a done run solid, with no track", () => {
        const b = scene({ kind: "actual", from: NOW - 5 * DAY, to: NOW - 2 * DAY, state: null, label: "3d", detail: "took 3d" });
        expect(b.fill).toBeDefined();
        expect(b.track).toBeUndefined();
        expect(b.nowAt).toBeUndefined();
      });

      it("draws an estimate as a track only", () => {
        const b = scene({ kind: "estimate", from: NOW - 5 * DAY, to: NOW - 2 * DAY, state: null, label: "est. 3d", detail: "estimated 3d" });
        expect(b.track).toBeDefined();
        expect(b.fill).toBeUndefined();
      });

      it("fills a run in progress along its plan up to now", () => {
        const b = scene({ kind: "running", from: NOW - 2 * DAY, to: NOW, plan: { from: NOW - 2 * DAY, to: NOW + 2 * DAY }, state: "ok", label: "2d/4d", detail: "" });
        expect(b.track && b.fill && b.nowAt).toBeTruthy();
        expect(b.over).toBeUndefined();
        // Half the plan has run, so the fill is about half the track, ending at the now mark.
        expect(width(b.fill!) / width(b.track!)).toBeGreaterThan(0.4);
        expect(width(b.fill!) / width(b.track!)).toBeLessThan(0.6);
        // The now mark stands at the fill's end (a hair inside it, so the mark sits on the bar).
        expect(Math.abs(b.fill![1]!.x - b.nowAt![0].x)).toBeLessThan(0.5);
      });

      it("shows the overtime past the end of the plan", () => {
        const b = scene({ kind: "running", from: NOW - 6 * DAY, to: NOW, plan: { from: NOW - 6 * DAY, to: NOW - 3 * DAY }, state: "over", label: "6d/3d", detail: "" });
        expect(b.over).toBeDefined();
        // The fill covers the plan; the overtime runs on from its end to now.
        expect(b.fill![1]!.x).toBeCloseTo(b.track![1]!.x, 6);
        expect(b.over![0]!.x).toBeCloseTo(b.track![1]!.x, 6);
        expect(Math.abs(b.over![1]!.x - b.nowAt![0].x)).toBeLessThan(0.5);
      });
    });
  });

  describe("the scene", () => {
    const boxes = [
      { key: "a", x: 0, y: 0, width: 600, height: 300 },
      { key: "b", x: 20, y: 120, width: 240, height: 76 },
      { key: "c", x: 300, y: 120, width: 240, height: 76 },
    ];
    const times = new Map([["a", NOW - 2 * DAY], ["b", NOW - 25 * DAY]]); // c has no time
    const timeOf = (k: string) => times.get(k);
    const ribbonOf = (k: string) => (k === "b" ? { kind: "actual" as const, from: NOW - 27 * DAY, to: NOW - 25 * DAY, state: null, label: "2d", detail: "took 2d" } : null);
    const isGroup = (k: string) => k === "a";
    const p = targetPose(boxes, { x: -50, y: -50, width: 700, height: 400 }, timeOf, ribbonOf, isGroup, 1)!;
    const scene = depthScene(boxes, p, timeOf, ribbonOf, isGroup);

    it("gives every card a panel at its own moment, and an undated one the window's newest end", () => {
      expect(scene.panels.size).toBe(3);
      expect(scene.panels.get("b")!.t).toBeLessThan(scene.panels.get("a")!.t);
      expect(scene.panels.get("c")!.t).toBeCloseTo(scene.view.length, 6);
      for (const q of scene.panels.values()) {
        expect(q.quad.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true);
        expect(q.fog).toBeGreaterThan(0);
        expect(q.fog).toBeLessThanOrEqual(1);
      }
    });

    it("draws a group as its whole frame at its own moment, and marks its header", () => {
      const g = scene.panels.get("a")!;
      expect(g.width).toBe(600);
      expect(g.height).toBe(300);
      expect(g.header).toBeDefined();
      expect(g.header![0]!.x).toBeCloseTo(g.quad[0]!.x, 6);
      expect(g.header![2]!.y).toBeLessThan(g.quad[2]!.y);
    });

    it("orders the panels far to near, the oldest first, and the flat view's order on ties", () => {
      const dists = scene.order.map((k) => scene.panels.get(k)!.dist);
      for (let i = 1; i < dists.length; i++) expect(dists[i]!).toBeLessThanOrEqual(dists[i - 1]! + 1e-6);
      expect(scene.order[0]).toBe("b");
      // In the flat pose every panel is equally far: frames go first, as in the flat view.
      expect(depthScene(boxes, flatPose(p), timeOf, ribbonOf, isGroup).order[0]).toBe("a");
    });

    it("lays a bar under its card along time, from the run's start to its end", () => {
      expect(scene.bars.map((b) => b.key)).toEqual(["b"]);
      const [bar] = scene.bars;
      expect(bar!.points[1]!.x).toBeGreaterThan(bar!.points[0]!.x);
      const panel = scene.panels.get("b")!;
      expect(Math.min(...bar!.points.map((q) => q.y))).toBeGreaterThan(Math.min(panel.quad[2]!.y, panel.quad[3]!.y) - 1);
      expect(bar!.title).toContain("took 2d");
    });

    it("drops a line from each card above the floor down to it", () => {
      expect(scene.drops.length).toBeGreaterThan(0);
      for (const d of scene.drops) expect(d.to.y, d.key).toBeGreaterThan(d.from.y);
    });

    it("runs a relation line through time between its two panels", () => {
      const path = [{ x: 140, y: 196 }, { x: 420, y: 196 }];
      const tb = scene.panels.get("b")!.t, tc = scene.panels.get("c")!.t;
      const pts = projectPath(scene.view, path, tb, tc);
      const s0 = projectPoint(scene.view, { t: tb, d: 140, h: -196 }), e = projectPoint(scene.view, { t: tc, d: 420, h: -196 });
      expect(pts[0]!.x).toBeCloseTo(s0.x, 6);
      expect(pts[1]!.x).toBeCloseTo(e.x, 6);
    });
  });
});
