import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRhumbServer, parse } from "../src/index.ts";
import { timingOf } from "../src/timing.ts";
import { claimMarks, defaultCollapsed, fitZoom, kindLetters, nodeKey, plainTitle, shortId, starredInside, unfoldStarted } from "../web/src/layout.ts";
import { axisTicks, depthPx, depthScene, nextFocus, niceSpan, project, projectPath, ribbonFor, TICK_COUNT, yearLabel } from "../web/src/depth.ts";
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
  const HOUR = 3600;
  const DAY = 86_400;
  const YEAR = 365 * DAY;
  /** 2026-10-16 12:00 local, the reference "now" for these tests. */
  const NOW = Math.floor(new Date(2026, 9, 16, 12, 0, 0).getTime() / 1000);
  const at = (y: number, m: number, d: number, h = 0) => Math.floor(new Date(y, m - 1, d, h).getTime() / 1000);

  it("puts the newest moment on the front plane and older ones further back", () => {
    const focus = { to: NOW, span: 10 * DAY };
    expect(depthPx(NOW, focus)).toBe(0);
    expect(depthPx(NOW - 10 * DAY, focus)).toBe(280);
    // Halfway back in time is halfway back in depth.
    expect(depthPx(NOW - 5 * DAY, focus)).toBeCloseTo(140, 6);
    // Outside the window, times clamp to its two ends rather than running off the axis.
    expect(depthPx(NOW + DAY, focus)).toBe(0);
    expect(depthPx(NOW - 99 * DAY, focus)).toBe(280);
  });

  it("lifts a point up and to the right, without shrinking it", () => {
    const near = project(100, 100, 0);
    expect(near).toEqual({ x: 100, y: 100, fog: 1 });
    const far = project(100, 100, 280);
    expect(far.x).toBeGreaterThan(100); // to the right
    expect(far.y).toBeLessThan(100); // and up
    expect(far.fog).toBeCloseTo(0.5, 6);
    // Any point at any depth is only ever translated: the projection has no scale factor.
    for (const z of [0, 70, 140, 280]) {
      const p = project(0, 0, z);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it("leans a relation between two moments, and leaves one within a single moment alone", () => {
    const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(projectPath(path, 0, 0)).toEqual(path);
    const leaning = projectPath(path, 0, 280);
    expect(leaning[0]).toEqual({ x: 0, y: 0 });
    expect(leaning[1]!.x).toBeGreaterThan(100);
    expect(leaning[1]!.y).toBeLessThan(0);
    // Interpolated along the path: the midpoint leans half as far as the end.
    const mid = projectPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], 0, 280)[1]!;
    expect(mid.x).toBeCloseTo(project(0, 0, 140).x, 6);
  });

  it("picks a round window, so the projection holds still while panning", () => {
    expect(niceSpan(10)).toBe(300);
    expect(niceSpan(3 * HOUR)).toBe(6 * HOUR);
    expect(niceSpan(2 * DAY)).toBe(3 * DAY);
    expect(niceSpan(40 * DAY)).toBe(90 * DAY);
    expect(niceSpan(400 * DAY)).toBe(5 * YEAR);
  });

  describe("the window follows the region on screen", () => {
    const boxes = [
      { key: "old", x: 0, y: 0, width: 100, height: 50 },
      { key: "new", x: 400, y: 0, width: 100, height: 50 },
    ];
    const times = new Map([["old", NOW - 20 * DAY], ["new", NOW]]);
    const timeOf = (k: string) => times.get(k);
    const onScreen = { x: 0, y: 0, width: 200, height: 100 };

    it("takes the span from the cards inside the frame", () => {
      // Only the old card is on screen, so the window is a short one with nothing to spread over.
      expect(nextFocus(boxes, timeOf, onScreen, null, null)).toEqual({ to: expect.any(Number), span: 300 });
    });

    it("covers both ends when both are framed, quantised to a round span", () => {
      const f = nextFocus(boxes, timeOf, { x: 0, y: 0, width: 1000, height: 100 }, null, null)!;
      expect(f.span).toBe(30 * DAY); // 20 days of work, rounded up
      // The front edge sits on a whole step at or after the newest card, so panning by less than a
      // step keeps the window, and the front plane is never behind the work it shows.
      const step = f.span / TICK_COUNT;
      expect(f.to % step).toBeCloseTo(0, 6);
      expect(f.to).toBeGreaterThanOrEqual(NOW);
      expect(f.to - NOW).toBeLessThan(step);
    });

    it("keeps the window when the frame moves less than a step, and refuses to oscillate", () => {
      const first = nextFocus(boxes, timeOf, { x: 0, y: 0, width: 1000, height: 100 }, null, null)!;
      const nudged = nextFocus(boxes, timeOf, { x: -5, y: 0, width: 1000, height: 100 }, first, null)!;
      expect(nudged).toBe(first);
      // A window that repeats the one from before last is refused: the projection moved the cards,
      // and without this the window and the visible set would chase each other.
      const other = { to: first.to - first.span, span: first.span };
      expect(nextFocus(boxes, timeOf, { x: 0, y: 0, width: 1000, height: 100 }, other, first)).toBe(other);
    });

    it("keeps the window it has when no dated card is in the frame", () => {
      const nowhere = { x: 5000, y: 5000, width: 10, height: 10 };
      expect(nextFocus(boxes, timeOf, nowhere, null, null)).toBeNull();
    });
  });

  describe("the ruler", () => {
    it("labels clock time within a day, days within a month, months within a year", () => {
      const hours = axisTicks({ to: NOW, span: 12 * HOUR });
      expect(hours.length).toBeGreaterThan(3);
      expect(hours.every((t) => /^\d{2}:\d{2}$/.test(t.label))).toBe(true);
      // Midnight is the boundary a reader scans for, so it is the tick drawn heavier.
      const midnight = axisTicks({ to: at(2026, 10, 16, 12), span: 24 * HOUR }).filter((t) => t.major).map((t) => t.label);
      expect(midnight).toEqual(["00:00"]);

      const days = axisTicks({ to: NOW, span: 7 * DAY });
      expect(days.map((t) => t.label).slice(0, 3)).toEqual(["Oct 16", "Oct 15", "Oct 14"]);

      const months = axisTicks({ to: NOW, span: YEAR });
      // Every tick a month name, and the year riding on the January tick — never "Oct 26", which
      // would read as the 26th of October.
      expect(months.every((t) => /^[A-Z][a-z]{2}$|^\d{4}$/.test(t.label))).toBe(true);
      // A month name is a bare month name and never reads as a date, and the January tick — the
      // one drawn heavier — is the one that carries the year.
      const january = months.filter((t) => t.major);
      expect(january.length).toBeGreaterThan(0);
      expect(january.every((t) => /^\d{4}$/.test(t.label))).toBe(true);
    });

    it("names years, then decades and eras, on a long map", () => {
      // Ticks count back from a whole multiple of the step, so they land on their own boundaries
      // rather than drifting a year per step (which is what stepping in 365-day blocks would do).
      expect(axisTicks({ to: at(2026, 10, 16), span: 100 * YEAR }).map((t) => t.label).slice(0, 3)).toEqual(["2020", "2010", "2000"]);
      // A quarter-century window fills the axis with 3-year steps, the finest that still fits.
      expect(axisTicks({ to: at(2026, 10, 16), span: 25 * YEAR }).map((t) => t.label).slice(0, 3)).toEqual(["2025", "2022", "2019"]);
      // Across the epoch the era changes with the sign, no year is named twice, and the heavier
      // ticks land on the round boundaries a reader scans for.
      const long = axisTicks({ to: at(2026, 10, 16), span: 1e4 * YEAR });
      expect(long.map((t) => t.label).slice(0, 3)).toEqual(["2000", "1000", "1 BCE"]);
      expect(new Set(long.map((t) => t.label)).size).toBe(long.length);
      // The heavier marks are spread out — about two in view — rather than landing on every tick.
      const centuries = axisTicks({ to: at(2026, 10, 16), span: 500 * YEAR });
      expect(centuries.filter((t) => t.major).length).toBe(2);
      expect(centuries.filter((t) => t.major).map((t) => t.label)).toEqual(["2000", "1750"]);
      for (const span of [100 * YEAR, 1e4 * YEAR, 1e6 * YEAR]) {
        const major = axisTicks({ to: at(2026, 10, 16), span }).filter((t) => t.major);
        expect(major.length, `span ${span}`).toBeGreaterThanOrEqual(1);
        expect(major.length, `span ${span}`).toBeLessThanOrEqual(3);
      }

      expect(yearLabel(2026)).toBe("2026");
      expect(yearLabel(-66_000_000)).toBe("66M BCE");
      expect(yearLabel(-1)).toBe("2 BCE"); // astronomical year -1 is 2 BCE
      expect(yearLabel(0)).toBe("1 BCE");
      expect(yearLabel(1e6)).toBe("1M CE"); // a compacted year says which era it is in
    });

    it("places every tick on a real boundary and inside the window", () => {
      for (const span of [HOUR, 6 * HOUR, DAY, 7 * DAY, 30 * DAY, YEAR, 25 * YEAR, 1e4 * YEAR, 1e8 * YEAR]) {
        const focus = { to: NOW, span };
        const ticks = axisTicks(focus);
        expect(ticks.length, `span ${span}`).toBeGreaterThanOrEqual(2);
        for (const t of ticks) {
          expect(t.time).toBeLessThanOrEqual(focus.to);
          expect(t.time).toBeGreaterThanOrEqual(focus.to - focus.span);
          expect(t.z).toBeCloseTo(depthPx(t.time, focus), 6);
          expect(t.label.length).toBeGreaterThan(0);
        }
        // Newest first, and strictly descending.
        for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.time, `span ${span}`).toBeLessThan(ticks[i - 1]!.time);
        // The window is covered: the gap in front of the newest tick and behind the oldest are
        // each smaller than the ticks' own spacing, so no stretch of the axis is left unlabelled.
        const gap = ticks[0]!.time - ticks[1]!.time;
        expect(focus.to - ticks[0]!.time, `span ${span}`).toBeLessThan(gap + 1);
        expect(ticks[ticks.length - 1]!.time - (focus.to - focus.span), `span ${span}`).toBeLessThan(gap + 1);
      }
    });

    it("caps the number of ticks so their labels stay apart", () => {
      for (const span of [HOUR, DAY, YEAR, 1e6 * YEAR]) {
        const ticks = axisTicks({ to: NOW, span });
        expect(ticks.length, `span ${span}`).toBeLessThanOrEqual(14);
        expect(ticks.length, `span ${span}`).toBeGreaterThanOrEqual(2);
        // No two ticks land on the same depth, which is what would stack two labels together.
        expect(new Set(ticks.map((t) => t.z.toFixed(3))).size, `span ${span}`).toBe(ticks.length);
      }
    });
  });

  describe("time footprints", () => {
    const focus = { to: NOW, span: 30 * DAY };
    const node = (attrs: Record<string, unknown>, status: "todo" | "doing" | "done") => ({ attrs, status });

    it("draws a finished run as the time it really took", () => {
      const r = ribbonFor(timingOf(node({ estimate: "3d", started: "2026-09-20", finished: "2026-09-24" }, "done"), NOW), "done", at(2026, 9, 20), NOW, focus)!;
      expect(r.kind).toBe("actual");
      expect(r.from).toBe(at(2026, 9, 20));
      expect(r.to).toBe(at(2026, 9, 25) - 1); // a date-only finish means during that day
      expect(r.label).toBe("4d23h"); // four days and 23 hours 59 minutes, as the duration form reads
      // A finish with a time of day is exact.
      const exact = ribbonFor(timingOf(node({ started: "2026-09-20T09:00", finished: "2026-09-20T11:30" }, "done"), NOW), "done", at(2026, 9, 20), NOW, focus)!;
      expect(exact.label).toBe("2h30m");
    });

    it("draws a running run from its start to now, coloured by its estimate", () => {
      const started = NOW - 6 * DAY;
      const r = ribbonFor(timingOf(node({ estimate: "5d", started: "2026-10-10" }, "doing"), NOW), "doing", started, NOW, focus)!;
      expect(r.kind).toBe("running");
      expect(r.to).toBe(NOW);
      expect(r.state).toBe("over");
      expect(r.label).toBe("6d12h");
    });

    it("draws a todo's estimate as a range at its own time, kept inside the window", () => {
      const own = NOW - 20 * DAY;
      const r = ribbonFor(timingOf(node({ estimate: "10d" }, "todo"), NOW), "todo", own, NOW, focus)!;
      expect(r.kind).toBe("estimate");
      expect(r.from).toBe(own); // plenty of room in front, so it starts where the node sits
      expect(r.to - r.from).toBe(10 * DAY);
      // A plan that would run past the front plane is pulled back, so its length stays readable
      // instead of being cut off by the edge.
      const over = ribbonFor(timingOf(node({ estimate: "10d" }, "todo"), NOW), "todo", NOW - DAY, NOW, focus)!;
      expect(over.to - over.from).toBe(10 * DAY);
      expect(over.to).toBe(NOW);
      // A plan the window cannot hold at all is trimmed at the old end.
      const huge = ribbonFor(timingOf(node({ estimate: "90d" }, "todo"), NOW), "todo", own, NOW, focus)!;
      expect(huge.to).toBe(NOW);
      expect(huge.from).toBe(NOW - 30 * DAY);
    });

    it("shows nothing for a node with no timing, or a todo with no estimate", () => {
      expect(ribbonFor(null, "todo", NOW, NOW, focus)).toBeNull();
      expect(ribbonFor(timingOf(node({ estimate: "5d", started: "2026-10-14T09:00" }, "todo"), NOW), "todo", NOW, NOW, focus)).toBeNull();
      // A doing node whose start is unknown has no run to draw; its card still shows what it did.
      expect(ribbonFor(timingOf(node({ estimate: "5d" }, "doing"), NOW), "doing", NOW, NOW, focus)).toBeNull();
    });
  });

  describe("the scene", () => {
    const focus = { to: NOW, span: 30 * DAY };
    const boxes = [
      { key: "a", x: 0, y: 0, width: 240, height: 76 },
      { key: "b", x: 0, y: 200, width: 240, height: 76 },
      { key: "c", x: 400, y: 0, width: 240, height: 76 },
    ];
    const times = new Map([["a", NOW], ["b", NOW - 15 * DAY]]); // c has no time
    const scene = depthScene(boxes, focus, (k) => times.get(k), (k) => (k === "a" ? { kind: "estimate", from: NOW - DAY, to: NOW - DAY + DAY, state: null, label: "1d" } : null));

    it("lifts every card, dated or not, and gives the undated one the front plane", () => {
      expect(scene.z.size).toBe(3);
      expect(scene.z.get("a")).toBe(0);
      expect(scene.z.get("b")).toBeCloseTo(140, 6);
      expect(scene.z.get("c")).toBe(0);
    });

    it("rules a track for every dated card, dashed at each tick", () => {
      expect(scene.tracks.map((t) => t.key).sort()).toEqual(["a", "b"]);
      const [track] = scene.tracks;
      expect(track!.dashes.length).toBeGreaterThan(3);
      // The track runs in the depth direction: back along the projection, longer than it is tall.
      expect(Math.abs(track!.to.y - track!.from.y)).toBeGreaterThan(Math.abs(track!.to.x - track!.from.x));
    });

    it("lays each ribbon on the ground below its card, with a drop line up to it", () => {
      const [span] = scene.spans;
      expect(scene.spans.length).toBe(1);
      expect(span!.key).toBe("a");
      expect(span!.points.length).toBe(4);
      // Below the card, and anchored to its bottom edge.
      expect(span!.points[0]!.y).toBeGreaterThan(76);
      expect(span!.anchor.y).toBe(76);
      // A quad, not a single point: the ribbon has a length across the axis.
      expect(Math.abs(span!.points[2]!.y - span!.points[0]!.y)).toBeGreaterThan(4);
    });

    it("puts the ruler off the bottom-left corner, outside every card", () => {
      const { ruler } = scene;
      // Both ends stay below every card and left of the map's left edge: the draw is sheared, so
      // the older end rides up and to the right of where it was placed, and the stand-off is what
      // keeps that far end out of the map rather than letting it climb into the cards.
      for (const end of [ruler.from, ruler.to]) {
        expect(end.y).toBeGreaterThan(200 + 76);
        expect(end.x).toBeLessThan(0);
      }
      expect(ruler.ticks.length).toBeGreaterThan(3);
      expect(ruler.caption).toMatch(/^\d/);
      // Nothing outside the map is drawn: the ruler and the spans all sit in positive depth.
      for (const t of ruler.ticks) expect(t.z).toBeGreaterThanOrEqual(0);
      for (const t of ruler.ticks) expect(t.z).toBeLessThanOrEqual(280);
    });
  });
});
