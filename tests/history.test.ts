import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contextFor, createRhumbServer, dateIn, gitTimeline, headingDate, HistoryTracker, linkDate, linkTimeline, LONG_AGO, nodeTimes, parse, pointDiff, resolveAnchor, unifiedDiff, versionOf } from "../src/index.ts";
import { parseUnified } from "../web/src/diffView.ts";
import { absoluteTime, freshness, isoTime, relativeTime, shortAgo, shortDaysAgo } from "../web/src/time.ts";
import { pointTitle, railLabels } from "../web/src/timelineLabels.ts";

const T1 = 1767225600; // 2026-01-01T00:00:00Z
const T2 = 1769904000; // 2026-02-01T00:00:00Z

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "portolan-git-"));
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  g("init", "-q");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  return dir;
}

function commit(dir: string, message: string, time: number) {
  const env = { ...process.env, GIT_AUTHOR_DATE: `@${time} +0000`, GIT_COMMITTER_DATE: `@${time} +0000` };
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  execFileSync("git", ["commit", "-qm", message], { cwd: dir, env });
}

describe("HistoryTracker", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("dates committed lines by blame and changed lines by file mtime", async () => {
    dir = repo();
    mkdirSync(join(dir, "maps"));
    const file = join(dir, "maps", "plan.rhumb");
    writeFileSync(file, "- [ ] A ^a\n- [ ] B ^b\n- [ ] C ^c\n");
    commit(dir, "first", T1);
    writeFileSync(file, "- [ ] A ^a\n- [x] B ^b\n- [ ] C ^c\n");
    commit(dir, "finish b", T2);
    // Local, uncommitted edit to C, with a known mtime.
    const src = "- [ ] A ^a\n- [x] B ^b\n- [/] C ^c\n";
    writeFileSync(file, src);
    const mtime = T2 + 3600;
    utimesSync(file, mtime, mtime);

    const tracker = new HistoryTracker();
    const h = await tracker.file(file, versionOf(src));
    expect(h.tracked).toBe(true);
    expect(h.dirtyLines).toBe(1);
    expect(h.lastCommit).toMatchObject({ time: T2, summary: "finish b" });
    const times = nodeTimes(parse(src), h);
    expect(times.map((t) => [t.line, t.time, t.source])).toEqual([[1, T1, "commit"], [2, T2, "commit"], [3, mtime, "local"]]);
    expect(h.commits[times[1]!.lineTime!.sha!]!.summary).toBe("finish b");

    // A new commit moves HEAD; the tracker notices and re-blames.
    expect(await tracker.pollHeads()).toEqual([]);
    commit(dir, "start c", T2 + 7200);
    expect(await tracker.pollHeads()).toEqual([expect.stringContaining("portolan-git-")]);
    const after = nodeTimes(parse(src), await tracker.file(file, versionOf(src)));
    expect(after[2]).toMatchObject({ time: T2 + 7200, source: "commit" });
  });

  it("uses an earlier dated link instead of the commit time", async () => {
    dir = repo();
    const file = join(dir, "plan.rhumb");
    const src = `---
links:
  diary: ../diary/{path}.md
---
- [x] Old work recorded late ^old
  - [entry](diary:2025/1201#x)
  - [later entry](diary:2025/1215#y)
- [x] Linked after the commit [x](diary:2026/0301#z) ^future
- [x] No dated link [x](https://example.com/issues/20251201) ^plain
- [/] Local edit [x](diary:2025/1201#x) ^local
`;
    writeFileSync(file, src);
    commit(dir, "record", T2);
    writeFileSync(file, src.replace("[/] Local edit", "[x] Local edit"));
    const edited = src.replace("[/] Local edit", "[x] Local edit");
    const times = nodeTimes(parse(edited), await new HistoryTracker().file(file, versionOf(edited)));
    const byLine = Object.fromEntries(times.map((t) => [t.line, t]));
    // Latest dated link (Dec 15) is earlier than the commit (Feb 1).
    expect(byLine[5]).toMatchObject({ source: "link", time: linkDate("2025/1215")!.time, link: { date: "2025-12-15" } });
    expect(byLine[5]!.lineTime).toMatchObject({ source: "commit", time: T2 });
    // A link dated after the commit does not move the time forward.
    expect(byLine[8]).toMatchObject({ source: "commit", time: T2, link: null });
    // A bare 8-digit number (an issue ID) is not a date.
    expect(byLine[9]).toMatchObject({ source: "commit", link: null });
    // An uncommitted line linking to an earlier day also takes the linked date.
    expect(byLine[10]).toMatchObject({ source: "link", link: { date: "2025-12-01" } });
    expect(byLine[10]!.lineTime!.source).toBe("local");
  });

  it("does not treat a link dated the commit's own day as earlier", async () => {
    dir = repo();
    const file = join(dir, "same.rhumb");
    // Commit at 00:30 local time on 2026-03-10; the link names the same day.
    const commitTime = Math.floor(new Date(2026, 2, 10, 0, 30).getTime() / 1000);
    const src = "- [x] Same day [x](diary:2026/0310#a) ^same\n- [x] Day before [x](diary:2026/0309#a) ^before\n";
    writeFileSync(file, src);
    commit(dir, "same day", commitTime);
    const [same, before] = nodeTimes(parse(src), await new HistoryTracker().file(file, versionOf(src)));
    expect(same).toMatchObject({ source: "commit", time: commitTime });
    expect(before).toMatchObject({ source: "link", link: { date: "2026-03-09" } });
  });

  it("gives a link-less parent the newest child's time", async () => {
    dir = repo();
    const file = join(dir, "tree.rhumb");
    const src = `- [/] Parent without links ^p
  - [x] Old child [x](diary:2025/1201#a) ^old
  - [/] Group without links ^g
    - [x] Newer grandchild [x](diary:2025/1215#a) ^gc
- [/] Parent with a link [x](diary:2025/1101#a) ^pl
  - [x] Child [x](diary:2025/1220#a) ^c
- [ ] Leaf without links ^leaf
`;
    writeFileSync(file, src);
    commit(dir, "tree", T2);
    const times = nodeTimes(parse(src), await new HistoryTracker().file(file, versionOf(src)));
    const by = Object.fromEntries(times.map((t) => [t.lineTime && t.line, t]));
    expect(times.map((t) => t.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // g takes its grandchild's date, p takes the newer of old (Dec 1) and g (Dec 15).
    expect(by[3]).toMatchObject({ source: "children", time: linkDate("2025/1215")!.time, child: { id: "gc" } });
    expect(by[1]).toMatchObject({ source: "children", time: linkDate("2025/1215")!.time, child: { id: "g" } });
    // A parent with its own link keeps the link rule, not its children.
    expect(by[5]).toMatchObject({ source: "link", link: { date: "2025-11-01" } });
    // A leaf without links keeps its line time.
    expect(by[7]).toMatchObject({ source: "commit", time: T2 });
  });

  it("dates a link with no date in its path by the dated heading above its target", async () => {
    dir = repo();
    const file = join(dir, "map.rhumb");
    writeFileSync(join(dir, "changelog.md"), [
      "# Changelog", "", "## 2025-12-01", "", "### Parser", "", "* body", "", "## 2025-12-15", "", "### Layout", "", "* body",
    ].join("\n"));
    const src = `- [x] Parser [x](changelog.md#parser) ^parser
- [x] Layout [x](changelog.md#layout) ^layout
- [x] Both [x](changelog.md#parser) [y](diary:2025/1210#z) ^both
`;
    writeFileSync(file, src);
    commit(dir, "map", T2);
    const doc = parse(src, { fileName: file });
    const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
    const dateOf = (a: (typeof doc.nodes)[number]["anchors"][number]) => headingDate(resolveAnchor(a, contextFor(file, doc, read)), read);
    const [parser, layout, both] = nodeTimes(doc, await new HistoryTracker().file(file, versionOf(src)), dateOf);
    expect(parser).toMatchObject({ source: "link", link: { date: "2025-12-01", target: "changelog.md#parser" } });
    expect(layout).toMatchObject({ source: "link", link: { date: "2025-12-15" } });
    // The latest dated link wins, whichever way it is dated.
    expect(both).toMatchObject({ source: "link", link: { date: "2025-12-10" } });
    // Without a resolver only path dates count, as before.
    const plain = nodeTimes(doc, await new HistoryTracker().file(file, versionOf(src)));
    expect(plain[0]).toMatchObject({ source: "commit" });
  });

  it("reads Holocene Era years (CE + 10000, may be negative) at the start of a heading", () => {
    // End of a local CE day in unix seconds (setFullYear keeps any year as written).
    const ce = (date: string) => {
      const [y, m, d] = date.split("-").map(Number);
      const t = new Date(2000, 0, 1, 23, 59, 59);
      t.setFullYear(y!, m! - 1, d!);
      return t.getTime() / 1000;
    };
    expect(dateIn("11969-07-20 HE", true)).toEqual({ date: "11969-07-20 HE", time: ce("1969-07-20") });
    // A year or a month stands for its last day.
    expect(dateIn("12025 HE", true)!.time).toBe(ce("2025-12-31"));
    expect(dateIn("12000-11 HE", true)!.time).toBe(ce("2000-11-30"));
    // Only the leading date counts; the rest of the heading is text.
    expect(dateIn("11701 HE — 11900 HE（18—19 世纪）", true)).toMatchObject({ date: "11701 HE", time: ce("1701-12-31") });
    // HE 10000 is 1 BCE (astronomical year 0); earlier years go below zero, with optional grouping.
    expect(new Date(dateIn("10000 HE", true)!.time * 1000).getFullYear()).toBe(0);
    const order = ["-250,000 HE", "-100 HE", "0 HE", "9999 HE", "10000 HE"].map((h) => dateIn(h, true)!.time);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Beyond what a JS Date can hold (about 271,800 years before 1970) a date is only "long ago":
    // it keeps its label but takes the earliest time a Date can hold, so such entries tie.
    for (const h of ["-3,450,000,000 HE（距今约 34.5 亿年）", "−290,000 HE"]) expect(dateIn(h, true)!.time).toBe(LONG_AGO);
    expect(dateIn("-290,000 HE", true)!.date).toBe("-290,000 HE");
    expect(dateIn("-250,000 HE", true)!.time).toBeGreaterThan(LONG_AGO);
  });

  it("does not misread other text as a Holocene Era date", () => {
    // An invalid HE date is no date, not a CE date.
    expect(dateIn("12026-13 HE", true)).toBeNull();
    expect(dateIn("11900-02-29 HE", true)).toBeNull(); // 1900 was not a leap year
    expect(dateIn("12000-02-29 HE", true)).not.toBeNull();
    expect(dateIn("2026-10-08 HEAVY rain", true)!.date).toBe("2026-10-08");
    expect(dateIn("2026-10-08 Heat", true)!.date).toBe("2026-10-08");
    expect(dateIn("1964 年", true)).toBeNull();
    expect(dateIn("Release 12026 HE", true)).toBeNull();
    // Link paths keep the CE-only rule.
    expect(linkDate("notes/12026 HE.md")).toBeNull();
  });

  it("shows a time too far back for a Date as long ago", () => {
    const deep = dateIn("-3,450,000,000 HE", true)!.time;
    expect(relativeTime(deep, T1)).toBe("long time ago");
    expect(absoluteTime(deep)).toBe("long time ago");
    expect(absoluteTime(deep - 1)).toBe("long time ago"); // outside the Date range: no RangeError
    expect(isoTime(deep - 1)).toBeUndefined();
    expect(isoTime(T1)).toBe("2026-01-01T00:00:00.000Z");
    expect(freshness(deep, T1)).toBe(0);
    // Before 1 CE the era is named, so 1 BCE does not read as 1 CE.
    expect(absoluteTime(dateIn("0 HE", true)!.time)).toMatch(/BC/);
    expect(absoluteTime(T1)).not.toMatch(/BC|AD/);
    // A date that fits is still shown as years.
    expect(relativeTime(dateIn("-250,000 HE", true)!.time, T1)).toMatch(/^\d+ y ago$/);
  });

  it("dates nodes by Holocene Era headings in a chronicle", async () => {
    dir = repo();
    const file = join(dir, "civ.rhumb");
    writeFileSync(join(dir, "log.md"), ["# Log", "", "## -3,450,000,000 HE（距今约 34.5 亿年）", "", "Life.", "",
      "## 11969-07-20 HE", "", "Moon.", ""].join("\n"));
    const src = "- [x] Early life [x](log.md#-3450000000-he距今约-345-亿年) ^life\n- [x] Moon [x](log.md#11969-07-20-he) ^moon\n";
    writeFileSync(file, src);
    commit(dir, "civ", T2);
    const doc = parse(src, { fileName: file });
    const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
    const [life, moon] = nodeTimes(doc, await new HistoryTracker().file(file, versionOf(src)),
      (a) => headingDate(resolveAnchor(a, contextFor(file, doc, read)), read));
    expect(life).toMatchObject({ source: "link", time: LONG_AGO, link: { date: "-3,450,000,000 HE" } });
    expect(moon).toMatchObject({ source: "link", time: linkDate("1969-07-20")!.time, link: { date: "11969-07-20 HE" } });
    expect(life!.time).toBeLessThan(moon!.time);
  });

  it("recognizes dates in link paths", () => {
    expect(linkDate("2026/1008")?.date).toBe("2026-10-08");
    expect(linkDate("../diary/2026-10-08.md#x")?.date).toBe("2026-10-08");
    expect(linkDate("notes/2026/10/08/day.md")?.date).toBe("2026-10-08");
    expect(linkDate("2026/1340")).toBeNull();
    expect(linkDate("issues/12345")).toBeNull();
    expect(linkDate("issues/20251201")).toBeNull();
    expect(linkDate("../docs/rhumb-spec.md#2026-10-08")).toBeNull();
  });

  it("treats untracked files and files outside a repo as local", async () => {
    dir = repo();
    writeFileSync(join(dir, "seed"), "x");
    commit(dir, "seed", T1);
    const untracked = join(dir, "new.rhumb");
    writeFileSync(untracked, "- [ ] N ^n\n");
    const h = await new HistoryTracker().file(untracked, "v");
    expect(h).toMatchObject({ tracked: false, lastCommit: null });
    expect(nodeTimes(parse("- [ ] N ^n\n"), h)[0]).toMatchObject({ source: "local", time: h.mtime });

    const outside = mkdtempSync(join(tmpdir(), "portolan-nogit-"));
    try {
      writeFileSync(join(outside, "x.rhumb"), "- [ ] X ^x\n");
      const o = await new HistoryTracker().file(join(outside, "x.rhumb"), "v");
      expect(o.repo).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("serves freshness with the document", async () => {
    dir = repo();
    writeFileSync(join(dir, "a.rhumb"), "- [ ] A ^a\n");
    commit(dir, "add a", T1);
    const server = createRhumbServer({ root: dir, webDir: join(dir, "no-web") });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const port = (server.address() as AddressInfo).port;
      const body = await (await fetch(`http://127.0.0.1:${port}/api/doc?file=a.rhumb`)).json();
      expect(body.freshness).toMatchObject({ tracked: true, dirtyLines: 0, lastCommit: { time: T1, summary: "add a" } });
      expect(body.freshness.nodes).toMatchObject([{ line: 1, time: T1, source: "commit" }]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("time helpers", () => {
  it("maps age to freshness on a log scale", () => {
    const now = T2;
    expect(freshness(now - 60, now)).toBe(1);
    expect(freshness(now - 90 * 86_400, now)).toBe(0);
    expect(freshness(now - 400 * 86_400, now)).toBe(0);
    const day = freshness(now - 86_400, now);
    const week = freshness(now - 7 * 86_400, now);
    expect(day).toBeGreaterThan(week);
    expect(week).toBeGreaterThan(0);
  });

  it("formats relative times", () => {
    expect(relativeTime(T2 - 30, T2)).toBe("just now");
    expect(relativeTime(T2 - 5 * 60, T2)).toBe("5 min ago");
    expect(relativeTime(T2 - 3 * 3600, T2)).toBe("3 h ago");
    expect(relativeTime(T2 - 2 * 86_400, T2)).toBe("2 d ago");
  });
});

describe("timeline", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("lists commits newest first with the nodes each changed, local changes on top", async () => {
    dir = repo();
    mkdirSync(join(dir, "old"));
    const first = join(dir, "old", "plan.rhumb");
    writeFileSync(first, "- [ ] A ^a\n- [ ] B ^b\n- [ ] Untitled\n");
    commit(dir, "first", T1);
    // Rename, and finish B in the same commit; following renames keeps the first commit.
    mkdirSync(join(dir, "maps"));
    execFileSync("git", ["mv", "old/plan.rhumb", "maps/plan.rhumb"], { cwd: dir });
    const file = join(dir, "maps", "plan.rhumb");
    writeFileSync(file, "- [ ] A ^a\n- [x] B ^b\n- [ ] Untitled\na needs b\n");
    commit(dir, "finish b, a needs b", T2);
    const src = "- [ ] A ^a\n- [x] B ^b\n- [ ] Untitled\n- [ ] C ^c\na needs b\n";
    writeFileSync(file, src);
    utimesSync(file, T2 + 60, T2 + 60);

    const tracker = new HistoryTracker();
    const revs = await tracker.revisions(file, 50);
    expect(revs.revisions.map((r) => r.summary)).toEqual(["finish b, a needs b", "first"]);
    expect(revs.hasOlder).toBe(false);
    const t = gitTimeline(parse(src), src, T2 + 60, revs.revisions, revs.hasOlder);
    expect(t.source).toBe("git");
    expect(t.points.map((p) => [p.kind, p.time, p.nodes])).toEqual([
      ["local", T2 + 60, ["c"]],
      // B's status and A's new edge both count; the untitled node is matched by its title.
      ["commit", T2, ["a", "b"]],
      ["commit", T1, ["a", "b", "line:3"]],
    ]);
    expect(t.points[1]).toMatchObject({ summary: "finish b, a needs b", sha: expect.stringMatching(/^[0-9a-f]{40}$/) });

    // With a limit, the extra revision is only the base: "first" is cut, and "finish b"
    // still lists only what it changed.
    const one = await tracker.revisions(file, 1);
    expect(one.hasOlder).toBe(true);
    const cut = gitTimeline(parse(src), src, T2 + 60, one.revisions, one.hasOlder);
    expect(cut.truncated).toBe(true);
    expect(cut.points.map((p) => [p.kind, p.nodes])).toEqual([["local", ["c"]], ["commit", ["a", "b"]]]);

    // Clean tree: no local point. A node deleted since a commit counts as gone.
    const clean = "- [ ] A ^a\n- [ ] Untitled\n";
    writeFileSync(file, clean);
    commit(dir, "drop b", T2 + 3600);
    const after = await new HistoryTracker().revisions(file, 50);
    const t2 = gitTimeline(parse(clean), clean, T2 + 3600, after.revisions);
    expect(t2.points.map((p) => p.kind)).toEqual(["commit", "commit", "commit"]);
    expect(t2.points[1]).toMatchObject({ nodes: ["a"], gone: 1 });
  });

  it("dates a map without commits by its links", () => {
    const doc = parse(`---
links:
  diary: ../diary/{path}.md
---
- [x] Early [notes](diary:2026/1008) ^early
- [x] Later [notes](diary:2026/1010), [more](diary:2026/1008#x) ^later
- [ ] Undated ^none
`);
    const t = linkTimeline(doc);
    expect(t.source).toBe("links");
    // Dates beyond the JS range share one clamped time; their written years still order them.
    const deep = linkTimeline(parse(`---
links:
  log: log.md
---
- [x] Older [x](log:#-4,352,814,673-he) ^older
- [x] Newer [x](log:#-6,124,853-he) ^newer
`), (a) => ({ "-4,352,814,673-he": { date: "-4,352,814,673 HE", time: LONG_AGO }, "-6,124,853-he": { date: "-6,124,853 HE", time: LONG_AGO } })[a.fragment!] ?? null);
    expect(deep.points.map((p) => p.date)).toEqual(["-6,124,853 HE", "-4,352,814,673 HE"]);
    expect(t.points.map((p) => [p.kind, p.date, p.nodes])).toEqual([
      ["link", "2026-10-10", ["later"]],
      ["link", "2026-10-08", ["early", "later"]],
    ]);
  });

  it("is part of the doc response", async () => {
    dir = repo();
    const file = join(dir, "plan.rhumb");
    writeFileSync(file, "- [ ] A ^a\n");
    commit(dir, "first", T1);
    const server = createRhumbServer({ root: dir });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const port = (server.address() as AddressInfo).port;
      const body = await (await fetch(`http://127.0.0.1:${port}/api/doc?file=plan.rhumb`)).json() as { timeline: { source: string; points: { kind: string; nodes: string[] }[] } };
      expect(body.timeline.source).toBe("git");
      expect(body.timeline.points).toEqual([expect.objectContaining({ kind: "commit", nodes: ["a"], summary: "first" })]);
    } finally {
      server.close();
    }
  });
});

describe("history rail labels", () => {
  it("formats ages compactly, linked days by whole days", () => {
    expect([30, 5 * 60, 3 * 3600, 2 * 86_400, 90 * 86_400, 800 * 86_400].map((d) => shortAgo(T2 - d, T2))).toEqual(["now", "5m", "3h", "2d", "3mo", "2y"]);
    expect(shortAgo(LONG_AGO, T2)).toBe("long time ago");
    // A link's time is the end of its day: before that it is today, then whole days.
    expect(shortDaysAgo(T2, T2 - 10)).toBe("today");
    expect(shortDaysAgo(T2, T2 + 5)).toBe("1d");
    expect(shortDaysAgo(T2, T2 + 86_400)).toBe("1d");
    expect(shortDaysAgo(T2, T2 + 86_401)).toBe("2d");
    expect(shortDaysAgo(LONG_AGO, T2)).toBe("long time ago");
  });

  it("shows an age only on the first of a run of equal ages", () => {
    const p = (kind: "local" | "commit", ago: number) => ({ kind, time: T2 - ago, sha: "a".repeat(40), summary: "s", date: null, nodes: [], gone: 0 });
    const points = [p("local", 10), p("commit", 20 * 60), p("commit", 25 * 60 + 5), p("commit", 2 * 86_400), p("commit", 2 * 86_400 + 60), p("commit", 9 * 86_400)];
    // 20m and 25m differ; the two 2d commits share one label.
    expect(railLabels(points, T2)).toEqual(["now", "20m", "25m", "2d", null, "9d"]);
  });

  it("puts the absolute time and the commit message in the tooltip", () => {
    const t = pointTitle({ kind: "commit", time: T1, sha: "0123456789abcdef".padEnd(40, "0"), summary: "finish b", date: null, nodes: ["a", "b"], gone: 1 });
    expect(t.split("\n")).toEqual([absoluteTime(T1), "01234567 finish b", "2 items changed, 1 item since removed"]);
    expect(pointTitle({ kind: "link", time: T1, sha: null, summary: null, date: "2026-10-08", nodes: ["x"], gone: 0 })).toBe("2026-10-08\n1 item linked to this date");
  });
});

describe("diffs of history points", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("writes unified diffs with merged hunks", () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join("\n") + "\n";
    const b = a.replace("l3\n", "l3 changed\n").replace("l6\n", "").replace("l18\n", "l18\nnew\n");
    expect(unifiedDiff(a, b, "plan.rhumb", 2)).toBe([
      "--- a/plan.rhumb", "+++ b/plan.rhumb",
      // The changes at 3 and 6 share their context, so they make one hunk.
      "@@ -1,8 +1,7 @@", " l1", " l2", "-l3", "+l3 changed", " l4", " l5", "-l6", " l7", " l8",
      "@@ -17,4 +16,5 @@", " l17", " l18", "+new", " l19", " l20", "",
    ].join("\n"));
    expect(unifiedDiff(a, a, "plan.rhumb")).toBe("");
    // A first commit adds every line; an insertion into an empty file names line 0.
    expect(unifiedDiff(null, "x\ny\n", "new.rhumb")).toBe("--- /dev/null\n+++ b/new.rhumb\n@@ -0,0 +1,2 @@\n+x\n+y\n");
  });

  it("serves the diff of a commit, the first commit and local changes", async () => {
    dir = repo();
    const file = join(dir, "plan.rhumb");
    writeFileSync(file, "- [ ] A ^a\n- [ ] B ^b\n");
    commit(dir, "first", T1);
    writeFileSync(file, "- [ ] A ^a\n- [x] B ^b\n");
    commit(dir, "finish b", T2);
    writeFileSync(file, "- [/] A ^a\n- [x] B ^b\n");
    const { revisions } = await new HistoryTracker().revisions(file, 50);
    expect(pointDiff(revisions, revisions[0]!.sha, "")).toBe("--- a/plan.rhumb\n+++ b/plan.rhumb\n@@ -1,2 +1,2 @@\n - [ ] A ^a\n-- [ ] B ^b\n+- [x] B ^b\n");
    expect(pointDiff(revisions, revisions[1]!.sha, "")!.split("\n").slice(0, 3)).toEqual(["--- /dev/null", "+++ b/plan.rhumb", "@@ -0,0 +1,2 @@"]);
    expect(pointDiff(revisions, "f".repeat(40), "")).toBeNull();

    const server = createRhumbServer({ root: dir });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/diff?file=plan.rhumb`;
      const local = await fetch(`${base}&point=local`);
      expect(local.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(await local.text()).toContain("-- [ ] A ^a\n+- [/] A ^a\n");
      expect((await fetch(`${base}&point=${revisions[0]!.sha}`)).status).toBe(200);
      expect((await fetch(`${base}&point=${"0".repeat(40)}`)).status).toBe(404);
      expect((await fetch(`${base}&point=HEAD`)).status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("numbers diff rows for the panel", () => {
    const { rows, added, removed } = parseUnified("--- a/p\n+++ b/p\n@@ -2,3 +2,3 @@\n x\n-y\n+Y\n z\n@@ -0,0 +1,1 @@\n+top\n");
    expect([added, removed]).toEqual([2, 1]);
    expect(rows.map((r) => [r.kind, r.old, r.new, r.text])).toEqual([
      ["file", null, null, "--- a/p"], ["file", null, null, "+++ b/p"], ["hunk", null, null, "@@ -2,3 +2,3 @@"],
      ["ctx", 2, 2, "x"], ["del", 3, null, "y"], ["add", null, 3, "Y"], ["ctx", 4, 4, "z"],
      ["hunk", null, null, "@@ -0,0 +1,1 @@"], ["add", null, 1, "top"],
    ]);
  });
});

describe("dates: links", () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("dates items by their links only, not by git", () => {
    const doc = parse(`---
dates: links
links:
  diary: ../diary/{path}.md
---
- [/] Group ^group
  - [x] Linked [notes](diary:2026/1008) ^linked
  - [ ] Undated ^undated
- [ ] Alone ^alone
`);
    const times = nodeTimes(doc, null);
    // The group takes its dated child; items with nothing dated have no time at all.
    expect(times.map((t) => [t.line, t.source, t.link?.date ?? t.child?.id, t.lineTime])).toEqual([
      [6, "children", "linked", null],
      [7, "link", "2026-10-08", null],
    ]);
  });

  it("keeps a committed map's times and history off git", async () => {
    dir = repo();
    mkdirSync(join(dir, "diary", "2026"), { recursive: true });
    writeFileSync(join(dir, "diary", "2026", "1008.md"), "# notes\n");
    const file = join(dir, "plan.rhumb");
    writeFileSync(file, "---\ndates: links\nlinks:\n  diary: diary/{path}.md\n---\n- [x] Linked [notes](diary:2026/1008) ^linked\n- [ ] Undated ^undated\n");
    commit(dir, "first", T2);
    const server = createRhumbServer({ root: dir });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const body = await (await fetch(`${base}/api/doc?file=plan.rhumb`)).json() as {
        freshness: { dates: string; repo: string | null; lastCommit: unknown; nodes: { line: number; source: string }[] };
        timeline: { source: string; points: { kind: string; date: string }[] };
      };
      expect(body.freshness).toMatchObject({ dates: "links", repo: null, lastCommit: null });
      expect(body.freshness.nodes.map((t) => [t.line, t.source])).toEqual([[6, "link"]]);
      expect(body.timeline.source).toBe("links");
      expect(body.timeline.points.map((p) => [p.kind, p.date])).toEqual([["link", "2026-10-08"]]);
      expect((await fetch(`${base}/api/diff?file=plan.rhumb&point=local`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
