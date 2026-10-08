import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRhumbServer, HistoryTracker, linkDate, nodeTimes, parse, versionOf } from "../src/index.ts";
import { freshness, relativeTime } from "../web/src/time.ts";

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
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
    expect(h.commits[times[1]!.lineTime.sha!]!.summary).toBe("finish b");

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
    expect(byLine[10]!.lineTime.source).toBe("local");
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
