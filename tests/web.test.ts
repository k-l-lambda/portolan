import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRhumbServer, parse } from "../src/index.ts";
import { timingOf } from "../src/timing.ts";
import { claimMarks, defaultCollapsed, fitZoom, kindLetters, nodeKey, plainTitle, shortId, starredInside, unfoldStarted } from "../web/src/layout.ts";
import { axisTicks, depthScene, elevationPx, makeView, nextFocus, niceSpan, projectPath, projectPoint, ribbonFor, TICK_COUNT, timeAt, yearLabel } from "../web/src/depth.ts";
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

  describe("height is time", () => {
    const focus = { to: NOW, span: 10 * DAY };
    const H = 400;

    it("stands the newest moment on the ground and lifts older ones", () => {
      expect(elevationPx(NOW, focus, H)).toBe(0);
      expect(elevationPx(NOW - 10 * DAY, focus, H)).toBe(H);
      expect(elevationPx(NOW - 5 * DAY, focus, H)).toBeCloseTo(H / 2, 6);
      // A future time hangs below the ground, so a plan due later shows as a shelf below the map.
      expect(elevationPx(NOW + DAY, focus, H)).toBeLessThan(0);
      // Outside the window, a time is held at the window's own edge rather than shooting away.
      expect(elevationPx(NOW - 99 * DAY, focus, H)).toBe(H);
      expect(elevationPx(NOW + 99 * DAY, focus, H)).toBeGreaterThan(-H);
    });

    it("is the inverse of itself where it is not clamped", () => {
      expect(timeAt(H / 2, focus, H)).toBeCloseTo(NOW - 5 * DAY, 6);
      expect(elevationPx(timeAt(120, focus, H), focus, H)).toBeCloseTo(120, 6);
    });

    it("gives the window a height set from the map's own size", () => {
      const small = makeView([{ key: "a", x: 0, y: 0, width: 200, height: 80 }]);
      const large = makeView([{ key: "a", x: 0, y: 0, width: 4_000, height: 2_000 }]);
      expect(small.height).toBeGreaterThan(0);
      expect(large.height).toBeGreaterThan(small.height);
      // Bounded at both ends, so neither a tiny map nor a huge one gets an absurd axis.
      expect(large.height).toBeLessThanOrEqual(900);
      expect(small.height).toBeGreaterThanOrEqual(260);
    });
  });

  describe("the camera", () => {
    // A short row of cards, so the camera has something to look at.
    const boxes = [
      { key: "near", x: 0, y: 0, width: 240, height: 76 },
      { key: "far", x: 0, y: 900, width: 240, height: 76 },
    ];
    const view = makeView(boxes);
    const focus = { to: NOW, span: 30 * DAY };
    const up = (t: number) => elevationPx(t, focus, view.height);

    it("draws things further from the eye smaller", () => {
      const near = projectPoint(view, { x: 0, y: 0, up: 0 });
      const far = projectPoint(view, { x: 0, y: 1_600, up: 0 });
      expect(far.scale).toBeLessThan(near.scale);
      // Not a token difference: the far end is meaningfully smaller, which is what reads as depth.
      expect(far.scale).toBeLessThan(near.scale * 0.9);
      expect(far.dist).toBeGreaterThan(near.dist);
    });

    it("shows the ground as a plane rather than edge-on, converging with distance", () => {
      // Two points the same distance away but far apart must be closer together on screen than the
      // same pair nearby: that convergence is the perspective.
      const nearPair = [
        projectPoint(view, { x: -600, y: 0, up: 0 }),
        projectPoint(view, { x: 600, y: 0, up: 0 }),
      ];
      const farPair = [
        projectPoint(view, { x: -600, y: 1_600, up: 0 }),
        projectPoint(view, { x: 600, y: 1_600, up: 0 }),
      ];
      const nearWidth = Math.abs(nearPair[0]!.x - nearPair[1]!.x);
      const farWidth = Math.abs(farPair[0]!.x - farPair[1]!.x);
      expect(farWidth).toBeLessThan(nearWidth);
    });

    it("draws a raised point above the ground beneath it", () => {
      const onGround = projectPoint(view, { x: 0, y: 0, up: 0 });
      const raised = projectPoint(view, { x: 0, y: 0, up: view.height });
      // Screen y grows downward, so a raised point has the smaller y.
      expect(raised.y).toBeLessThan(onGround.y);
      // And it is drawn nearer the eye, so it is bigger as well as higher.
      expect(raised.scale).toBeGreaterThan(onGround.scale);
    });

    it("keeps everything finite, even a point behind the eye", () => {
      for (const y of [0, 1_000, 5_000, -5_000]) {
        const p = projectPoint(view, { x: 0, y, up: 0 });
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.scale), `y ${y}`).toBe(true);
        expect(p.scale).toBeGreaterThan(0);
      }
    });

    it("leans a relation between two heights, and leaves a level one alone", () => {
      const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
      expect(projectPath(view, path, 0, 0)).toEqual(projectPath(view, [{ x: 0, y: 0 }, { x: 100, y: 0 }], 0, 0));
      const climbing = projectPath(view, path, 0, view.height);
      expect(climbing[1]!.y).toBeLessThan(climbing[0]!.y);
    });

    it("fades the far end and not the near end", () => {
      const near = projectPoint(view, { x: 0, y: 0, up: 0 });
      const far = projectPoint(view, { x: 0, y: 3_000, up: 0 });
      expect(near.fog).toBeGreaterThan(far.fog);
      expect(far.fog).toBeGreaterThan(0);
      expect(near.fog).toBeLessThanOrEqual(1);
    });
  });

  describe("the window follows the region on screen", () => {
    const boxes = [
      { key: "old", x: 0, y: 0, width: 100, height: 50 },
      { key: "new", x: 400, y: 0, width: 100, height: 50 },
    ];
    const times = new Map([["old", NOW - 20 * DAY], ["new", NOW]]);
    const timeOf = (k: string) => times.get(k);

    it("takes the span from the cards inside the frame", () => {
      expect(nextFocus(boxes, timeOf, { x: 0, y: 0, width: 200, height: 100 }, null, null))
        .toEqual({ to: expect.any(Number), span: 300 });
    });

    it("covers both ends when both are framed, quantised to a round span", () => {
      const f = nextFocus(boxes, timeOf, { x: 0, y: 0, width: 1000, height: 100 }, null, null)!;
      expect(f.span).toBe(30 * DAY);
      const step = f.span / TICK_COUNT;
      expect(f.to % step).toBeCloseTo(0, 6);
      expect(f.to).toBeGreaterThanOrEqual(NOW);
      expect(f.to - NOW).toBeLessThan(step);
    });

    it("keeps the window when the frame moves less than a step, and refuses to oscillate", () => {
      const first = nextFocus(boxes, timeOf, { x: 0, y: 0, width: 1000, height: 100 }, null, null)!;
      expect(nextFocus(boxes, timeOf, { x: -5, y: 0, width: 1000, height: 100 }, first, null)).toBe(first);
      // A window that merely repeats the one from before last is refused: the view moved the cards,
      // and without this the window and the visible set would chase each other.
      const other = { to: first.to - first.span, span: first.span };
      expect(nextFocus(boxes, timeOf, { x: 0, y: 0, width: 1000, height: 100 }, other, first)).toBe(other);
    });

    it("keeps the window it has when no dated card is in the frame", () => {
      expect(nextFocus(boxes, timeOf, { x: 5000, y: 5000, width: 10, height: 10 }, null, null)).toBeNull();
    });
  });

  describe("the ruler", () => {
    const H = 400;
    const hours = () => axisTicks({ to: NOW, span: 12 * HOUR }, H);

    it("labels clock time within a day, days within a month, months within a year", () => {
      expect(hours().length).toBeGreaterThan(3);
      expect(hours().every((t) => /^\d{2}:\d{2}$/.test(t.label))).toBe(true);
      const midnight = axisTicks({ to: at(2026, 10, 16, 12), span: 24 * HOUR }, H).filter((t) => t.major).map((t) => t.label);
      expect(midnight).toEqual(["00:00"]);
      expect(axisTicks({ to: NOW, span: 7 * DAY }, H).map((t) => t.label).slice(0, 3)).toEqual(["Oct 16", "Oct 15", "Oct 14"]);
      const months = axisTicks({ to: NOW, span: YEAR }, H);
      expect(months.every((t) => /^[A-Z][a-z]{2}$|^\d{4}$/.test(t.label))).toBe(true);
      const january = months.filter((t) => t.major);
      expect(january.length).toBeGreaterThan(0);
      expect(january.every((t) => /^\d{4}$/.test(t.label))).toBe(true);
    });

    it("names years, then decades and eras, on a long map", () => {
      expect(axisTicks({ to: at(2026, 10, 16), span: 100 * YEAR }, H).map((t) => t.label).slice(0, 3)).toEqual(["2020", "2010", "2000"]);
      expect(axisTicks({ to: at(2026, 10, 16), span: 25 * YEAR }, H).map((t) => t.label).slice(0, 3)).toEqual(["2025", "2022", "2019"]);
      const long = axisTicks({ to: at(2026, 10, 16), span: 1e4 * YEAR }, H);
      expect(long.map((t) => t.label).slice(0, 3)).toEqual(["2000", "1000", "1 BCE"]);
      expect(new Set(long.map((t) => t.label)).size).toBe(long.length);
      expect(axisTicks({ to: at(2026, 10, 16), span: 500 * YEAR }, H).filter((t) => t.major).length).toBe(2);

      expect(yearLabel(2026)).toBe("2026");
      expect(yearLabel(-66_000_000)).toBe("66M BCE");
      expect(yearLabel(-1)).toBe("2 BCE"); // astronomical year -1 is 2 BCE
      expect(yearLabel(0)).toBe("1 BCE");
      expect(yearLabel(1e6)).toBe("1M CE"); // a compacted year says which era it is in
    });

    it("places every tick inside the window, at its own height, newest first", () => {
      for (const span of [HOUR, 6 * HOUR, DAY, 7 * DAY, 30 * DAY, YEAR, 25 * YEAR, 1e4 * YEAR, 1e8 * YEAR]) {
        const focus = { to: NOW, span };
        const ticks = axisTicks(focus, H);
        expect(ticks.length, `span ${span}`).toBeGreaterThanOrEqual(2);
        expect(ticks.length, `span ${span}`).toBeLessThanOrEqual(14);
        // No two ticks share a height, which is what would stack two labels on each other.
        expect(new Set(ticks.map((t) => t.up.toFixed(3))).size, `span ${span}`).toBe(ticks.length);
        for (const t of ticks) {
          expect(t.time).toBeLessThanOrEqual(focus.to);
          expect(t.time).toBeGreaterThanOrEqual(focus.to - focus.span);
          expect(t.up).toBeCloseTo(elevationPx(t.time, focus, H), 6);
          expect(t.label.length).toBeGreaterThan(0);
        }
        for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.time, `span ${span}`).toBeLessThan(ticks[i - 1]!.time);
      }
    });
  });

  describe("time bars", () => {
    const focus = { to: NOW, span: 30 * DAY };

    it("draws a finished run as the time it really took", () => {
      const r = ribbonFor(timingOf(node({ estimate: "3d", started: "2026-09-20", finished: "2026-09-24" }, "done"), NOW), "done", at(2026, 9, 20), NOW)!;
      expect(r.kind).toBe("actual");
      expect(r.from).toBe(at(2026, 9, 20));
      expect(r.to).toBe(at(2026, 9, 25) - 1); // a date-only finish means during that day
      expect(r.label).toBe("4d23h");
      const exact = ribbonFor(timingOf(node({ started: "2026-09-20T09:00", finished: "2026-09-20T11:30" }, "done"), NOW), "done", at(2026, 9, 20), NOW)!;
      expect(exact.label).toBe("2h30m");
    });

    it("draws a running run from its start to now, coloured by its estimate", () => {
      const r = ribbonFor(timingOf(node({ estimate: "5d", started: "2026-10-10" }, "doing"), NOW), "doing", NOW - 6 * DAY, NOW)!;
      expect(r.kind).toBe("running");
      expect(r.to).toBe(NOW);
      expect(r.state).toBe("over");
      expect(r.label).toBe("6d12h");
    });

    it("draws a todo's estimate from its own time forward, and nothing else", () => {
      const own = NOW - 20 * DAY;
      const r = ribbonFor(timingOf(node({ estimate: "10d" }, "todo"), NOW), "todo", own, NOW)!;
      expect(r.kind).toBe("estimate");
      expect(r.from).toBe(own);
      expect(r.to - r.from).toBe(10 * DAY);
      expect(ribbonFor(null, "todo", NOW, NOW)).toBeNull();
      // A todo that has been started has a run to show instead of a pure estimate.
      expect(ribbonFor(timingOf(node({ estimate: "5d", started: "2026-10-14T09:00" }, "todo"), NOW), "todo", NOW, NOW)).toBeNull();
      expect(ribbonFor(timingOf(node({ estimate: "5d" }, "doing"), NOW), "doing", NOW, NOW)).toBeNull();
    });
  });

  describe("the scene", () => {
    const focus = { to: NOW, span: 30 * DAY };
    const boxes = [
      { key: "a", x: 0, y: 0, width: 240, height: 76, label: "Group A" },
      { key: "b", x: 0, y: 600, width: 240, height: 76 },
      { key: "c", x: 400, y: 0, width: 240, height: 76 },
    ];
    const times = new Map([["a", NOW], ["b", NOW - 15 * DAY]]); // c has no time
    const groups = new Set(["a"]);
    const scene = depthScene(
      boxes, focus,
      (k) => times.get(k),
      (k) => (k === "b" ? { kind: "estimate", from: NOW - 5 * DAY, to: NOW - 3 * DAY, state: null, label: "2d" } : null),
      (k) => groups.has(k),
    );

    it("places every card, dated or not, and gives the undated one the ground", () => {
      expect(scene.at.size).toBe(3);
      for (const p of scene.at.values()) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.scale)).toBe(true);
      }
      // A drop line marks a card that is actually off the ground. `a` is the newest time, which is
      // the ground itself, and `c` has no time, so neither needs one; only `b` is raised.
      expect(scene.drops.map((d) => d.key)).toEqual(["b"]);
      const drop = scene.drops[0]!;
      expect(drop.to.y).toBeGreaterThan(drop.from.y); // the ground is below the card
    });

    it("orders the cards far to near, so a near card is drawn over a far one", () => {
      expect(scene.order.length).toBe(3);
      // Descending distance: the far end is drawn first, so a near card lands on top of it.
      const dists = scene.order.map((k) => scene.at.get(k)!.dist);
      for (let i = 1; i < dists.length; i++) expect(dists[i]!, `order ${scene.order}`).toBeLessThanOrEqual(dists[i - 1]! + 1e-6);
      // `a` is the nearest (newest, so closest to the eye) and `b` the farthest (oldest), which is
      // the whole point of the layout.
      expect(scene.order[0]).toBe("b");
      expect(scene.order[scene.order.length - 1]).toBe("a");
    });

    it("lays a group flat on the ground and floats only its header", () => {
      expect(scene.footprints.map((f) => f.key)).toEqual(["a"]);
      const [fp] = scene.footprints;
      expect(fp!.points.length).toBe(4);
      expect(fp!.label).toBe("Group A");
      // A group's header is smaller than the rectangle it stands on.
      const header = scene.at.get("a")!;
      const flatW = Math.max(...fp!.points.map((p) => p.x)) - Math.min(...fp!.points.map((p) => p.x));
      expect(header.scale * 100).toBeLessThan(flatW);
    });

    it("stands each bar on the ground with its label at its middle", () => {
      expect(scene.bars.length).toBe(1);
      const [bar] = scene.bars;
      expect(bar!.key).toBe("b");
      expect(bar!.upFrom).toBe(0);
      // The bar rises from the ground, and its label sits inside it.
      expect(bar!.upTo).toBeGreaterThan(0);
      const ys = bar!.points.map((p) => p.y);
      expect(bar!.labelAt.y).toBeGreaterThanOrEqual(Math.min(...ys));
      expect(bar!.labelAt.y).toBeLessThanOrEqual(Math.max(...ys));
      expect(bar!.title).toContain("estimate");
    });

    it("stands the ruler off the map with a tick at every step", () => {
      expect(scene.ruler.foot.x).toBeLessThan(0);
      expect(scene.ruler.ticks.length).toBeGreaterThan(3);
      // The ruler's foot is on the ground and its ticks rise from there.
      expect(scene.ruler.captionAt.y).toBeGreaterThan(scene.ruler.ticks[scene.ruler.ticks.length - 1]!.at.y);
      expect(scene.ruler.caption).toMatch(/^\d/);
      for (const t of scene.ruler.ticks) expect(t.up).toBeGreaterThanOrEqual(0);
    });

    it("draws the ground as a four-cornered plane, converging with distance", () => {
      expect(scene.ground.length).toBe(4);
      // The corners run (min-x, min-y), (max-x, min-y), (max-x, max-y), (min-x, max-y). The camera
      // looks along +y, so a smaller y is nearer the eye: the first pair is the near edge and the
      // second the far one. The far edge draws narrower — that convergence is the perspective.
      const nearW = Math.abs(scene.ground[1]!.x - scene.ground[0]!.x);
      const farW = Math.abs(scene.ground[3]!.x - scene.ground[2]!.x);
      expect(farW, `far ${farW.toFixed(0)} vs near ${nearW.toFixed(0)}`).toBeLessThan(nearW);
    });

    it("reports bounds that cover the cards without the whole plane", () => {
      // Every drawn card is inside the reported bounds, so framing them shows all of them.
      for (const [k, p] of scene.at) {
        const box = boxes.find((b) => b.key === k)!;
        const w = groups.has(k) ? 216 : box.width, h = groups.has(k) ? 76 : box.height;
        expect(p.x, k).toBeGreaterThanOrEqual(scene.bounds.x - 1);
        expect(p.y, k).toBeGreaterThanOrEqual(scene.bounds.y - 1);
        expect(p.x + w * p.scale, k).toBeLessThanOrEqual(scene.bounds.x + scene.bounds.width + 1);
        expect(p.y + h * p.scale, k).toBeLessThanOrEqual(scene.bounds.y + scene.bounds.height + 1);
      }
      // And the bounds are tighter than the whole scene: the ground, the ruler and the bars reach
      // further than the cards, and including them would pull the framing zoom out to nothing.
      const everything = [
        ...scene.ground, ...scene.ruler.ticks.map((t) => t.at), scene.ruler.captionAt,
        ...scene.bars.flatMap((b) => b.points),
      ];
      const span = Math.max(...everything.map((p) => p.x)) - Math.min(...everything.map((p) => p.x));
      expect(scene.bounds.width).toBeLessThan(span + 1);
    });
  });
});
