// Per-line update times for .rhumb files, from git history.
//
// A line changed in the working tree (or a file that is untracked or outside any repo)
// is dated by the file's modification time; every other line by the commit that last
// touched it (`git blame`). Results are cached per file content, mtime and repo HEAD.

import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Anchor, RhumbDocument, RhumbNode } from "./types.ts";

const ZERO_SHA = "0".repeat(40);

export interface LineTime {
  /** Unix seconds. */
  time: number;
  /** `commit`: from git blame; `local`: uncommitted change, dated by file mtime. */
  source: "commit" | "local";
  sha: string | null;
}

export interface Commit {
  sha: string;
  time: number;
  summary: string;
}

export interface FileHistory {
  /** Repository root, or null when the file is not inside a git work tree. */
  repo: string | null;
  head: string | null;
  tracked: boolean;
  /** File modification time, unix seconds. */
  mtime: number;
  /** Lines that differ from HEAD (1-based). */
  dirtyLines: number;
  /** Most recent commit that touched this file. */
  lastCommit: Commit | null;
  /** Index 0 is line 1. */
  lines: LineTime[];
  commits: Record<string, Commit>;
}

export interface NodeTime {
  line: number;
  /** Unix seconds: the time used for freshness. */
  time: number;
  /**
   * `commit` / `local`: the node line's own time (see LineTime). `link`: the node links to a
   * dated entry (e.g. `diary:2026/1008`) that is earlier than its commit time, so the
   * linked date is a better estimate of when the work happened than when the map was committed.
   * `children`: the node has no links but has child nodes; it takes the newest child's time.
   */
  source: "commit" | "local" | "link" | "children";
  /** Time of the node's own line, kept so the UI can show both. */
  lineTime: LineTime;
  /** The dated link that set `time`, when source is `link`. */
  link: { date: string; target: string } | null;
  /** The child whose time was used, when source is `children`. */
  child: { line: number; id: string | null } | null;
}

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: GIT_ENV, timeout: 10_000, maxBuffer: 32 << 20 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout));
  });
}

/** Parses `git blame --line-porcelain` output. */
export function parseBlame(out: string): { lines: { sha: string; time: number }[]; commits: Record<string, Commit> } {
  const lines: { sha: string; time: number }[] = [];
  const commits: Record<string, Commit> = {};
  let sha = "";
  let time = 0;
  let summary = "";
  for (const row of out.split("\n")) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
    if (header) {
      sha = header[1]!;
      continue;
    }
    if (row.startsWith("committer-time ")) time = Number(row.slice(15));
    else if (row.startsWith("summary ")) summary = row.slice(8);
    else if (row.startsWith("\t")) {
      lines.push({ sha, time });
      if (sha !== ZERO_SHA && !commits[sha]) commits[sha] = { sha, time, summary };
    }
  }
  return { lines, commits };
}

/** Tracks git history for files; one instance per server. */
export class HistoryTracker {
  private repoOf = new Map<string, Promise<string | null>>();
  private heads = new Map<string, string | null>();
  private cache = new Map<string, { key: string; value: FileHistory }>();
  private polling = false;

  /** Repository root containing `dir`, or null. */
  repo(dir: string): Promise<string | null> {
    let p = this.repoOf.get(dir);
    if (!p) {
      p = git(dir, ["rev-parse", "--show-toplevel"]).then((s) => s.trim() || null, () => null);
      this.repoOf.set(dir, p);
    }
    return p;
  }

  private async head(repo: string): Promise<string | null> {
    if (!this.heads.has(repo)) {
      this.heads.set(repo, await git(repo, ["rev-parse", "HEAD"]).then((s) => s.trim(), () => null));
    }
    return this.heads.get(repo)!;
  }

  /** Re-reads HEAD of every known repo; returns the repos whose HEAD changed. */
  async pollHeads(): Promise<string[]> {
    if (this.polling) return [];
    this.polling = true;
    try {
      const changed: string[] = [];
      for (const [repo, old] of this.heads) {
        const now = await git(repo, ["rev-parse", "HEAD"]).then((s) => s.trim(), () => null);
        if (now !== old) {
          this.heads.set(repo, now);
          changed.push(repo);
        }
      }
      return changed;
    } finally {
      this.polling = false;
    }
  }

  async file(abs: string, version: string): Promise<FileHistory> {
    const mtime = Math.floor(statSync(abs).mtimeMs / 1000);
    const repo = await this.repo(dirname(abs));
    const head = repo ? await this.head(repo) : null;
    const key = `${version}:${mtime}:${head}`;
    const hit = this.cache.get(abs);
    if (hit?.key === key) return hit.value;

    const value = await this.compute(abs, repo, head, mtime);
    this.cache.set(abs, { key, value });
    return value;
  }

  private async compute(abs: string, repo: string | null, head: string | null, mtime: number): Promise<FileHistory> {
    const local = (count: number): LineTime[] =>
      Array.from({ length: count }, () => ({ time: mtime, source: "local" as const, sha: null }));
    const base: FileHistory = {
      repo, head, tracked: false, mtime, dirtyLines: 0, lastCommit: null, lines: [], commits: {},
    };
    if (!repo || !head) return base;

    let blame: ReturnType<typeof parseBlame>;
    try {
      blame = parseBlame(await git(dirname(abs), ["blame", "--line-porcelain", "--", basename(abs)]));
    } catch {
      return base; // untracked: every line is local
    }
    const lines = blame.lines.map((l): LineTime =>
      l.sha === ZERO_SHA ? { time: mtime, source: "local", sha: null } : { time: l.time, source: "commit", sha: l.sha });
    const last = await git(dirname(abs), ["log", "-1", "--format=%H%x00%ct%x00%s", "--", basename(abs)])
      .then((s) => s.trim().split("\0"), () => []);
    return {
      ...base,
      tracked: true,
      dirtyLines: lines.filter((l) => l.source === "local").length,
      lastCommit: last.length === 3 ? { sha: last[0]!, time: Number(last[1]), summary: last[2]! } : null,
      lines: lines.length > 0 ? lines : local(0),
      commits: blame.commits,
    };
  }
}

/**
 * Date in a link path: `2026/1008`, `2026-10-08` or `2026/10/08` (a separator after the year
 * is required, so issue numbers like `20251201` are not dates). Returns the date and the end
 * of that local day in unix seconds, or null.
 */
export function linkDate(target: string): { date: string; time: number } | null {
  return dateIn(target.split("#")[0]!);
}

/** Earliest time a JS Date can hold (about 271,800 years before 1970), in unix seconds. */
export const LONG_AGO = -8.64e12;

// Holocene Era: HE year = CE year + 10000, so 12026 HE is 2026 CE and 10000 HE is 1 BCE
// (astronomical year 0); earlier years are negative. `12026 HE`, `12026-10 HE`,
// `12026-10-08 HE`, `-290,000 HE` (grouping and a U+2212 minus allowed).
const HE = /^(?<y>[-−]?\d{1,3}(?:,\d{3})+|[-−]?\d+)(?:-(?<m>\d\d)(?:-(?<d>\d\d))?)?\s*HE(?![A-Za-z])/;

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthDays = (y: number, m: number) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;

/** A Holocene Era date at the start of `text`, dated to the end of its year, month or day. */
function heDate(text: string): { date: string; time: number } | null | undefined {
  const m = HE.exec(text);
  if (!m) return undefined; // not an HE date: the caller tries CE
  const { y: ys, m: ms, d: ds } = m.groups!;
  const year = Number(ys!.replace(/,/g, "").replace("−", "-")) - 10000; // astronomical year
  const month = ms ? Number(ms) : 12;
  if (month < 1 || month > 12) return null;
  const day = ds ? Number(ds) : monthDays(year, month);
  if (day < 1 || day > monthDays(year, month)) return null;
  const date = `${ys}${ms ? `-${ms}` : ""}${ds ? `-${ds}` : ""} HE`;
  // setFullYear keeps years 0..99 as written; beyond what a Date can hold, it is only "long ago".
  const end = new Date(2000, 0, 1, 23, 59, 59);
  end.setFullYear(year, month - 1, day);
  const ms_ = end.getTime();
  if (Number.isNaN(ms_)) return year < 0 ? { date, time: LONG_AGO } : null;
  return { date, time: Math.max(LONG_AGO, Math.floor(ms_ / 1000)) };
}

/**
 * The first valid date in `text` (same forms as `linkDate`), or null; with `atStart`, only a
 * date at the very start counts, as in a `## 2026-10-08` heading, and a Holocene Era date
 * (`## 11969-07-20 HE`) is read too. Link paths stay CE-only.
 */
export function dateIn(text: string, atStart = false): { date: string; time: number } | null {
  if (atStart) {
    const he = heDate(text);
    if (he !== undefined) return he;
  }
  const date = String.raw`(?<y>20\d\d|19\d\d)[-/](?<m>\d\d)[-/]?(?<d>\d\d)(?![0-9])`;
  const re = new RegExp(atStart ? `^${date}` : `(?:^|[^0-9])${date}`, "g");
  for (let m; (m = re.exec(text)); ) {
    const { y: ys, m: ms, d: ds } = m.groups!;
    const [y, mo, d] = [Number(ys), Number(ms), Number(ds)];
    const day = new Date(y, mo - 1, d, 23, 59, 59);
    if (day.getFullYear() === y && day.getMonth() === mo - 1 && day.getDate() === d) {
      return { date: `${ys}-${ms}-${ds}`, time: Math.floor(day.getTime() / 1000) };
    }
  }
  return null;
}

/** Start of the local calendar day of a unix time. */
function dayStart(time: number): number {
  const d = new Date(time * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

/**
 * Update time of each node: the time of the node's own line, unless the node links to a
 * dated entry whose day is before the day of the line's own time (its commit, or the file
 * mtime for an uncommitted line); then the latest such linked date wins (end of that day).
 * A link dated the same day does not count as earlier.
 *
 * A link is dated by its path (`diary:2026/1008`). When the path has no date, the optional
 * `dateOf` can date it another way; the server passes `headingDate`, so a link into a
 * changelog with `## 2026-10-08` sections takes the date of the section it lands in.
 */
export function nodeTimes(
  doc: RhumbDocument,
  history: FileHistory,
  dateOf?: (anchor: Anchor) => { date: string; time: number } | null,
): NodeTime[] {
  const out: NodeTime[] = [];
  // Returns the node's time after its children are computed, so parents can use them.
  const visit = (n: RhumbNode): NodeTime => {
    const slot = out.length;
    out.push(null as unknown as NodeTime); // keep pre-order output
    const kids = n.children.map(visit);
    const lineTime = history.lines[n.line - 1] ?? { time: history.mtime, source: "local" as const, sha: null };
    const base = { line: n.line, lineTime, link: null, child: null };

    let t: NodeTime;
    if (n.anchors.length === 0 && kids.length > 0) {
      // No links: the node is as fresh as its newest child.
      const newest = kids.reduce((a, b) => (b.time > a.time ? b : a));
      const child = n.children[kids.indexOf(newest)]!;
      t = { ...base, time: newest.time, source: "children", child: { line: child.line, id: child.id } };
    } else {
      let link: { date: string; time: number; target: string } | null = null;
      for (const a of n.anchors) {
        const d = linkDate(a.kind === "url" ? a.target : a.path ?? a.target) ?? (a.kind === "url" ? null : dateOf?.(a) ?? null);
        if (d && (!link || d.time > link.time)) link = { ...d, target: a.target };
      }
      // A link's time is the end of its day, so "an earlier day" is "ends before this day starts".
      t = link !== null && link.time < dayStart(lineTime.time)
        ? { ...base, time: link.time, source: "link", link: { date: link.date, target: link.target } }
        : { ...base, time: lineTime.time, source: lineTime.source };
    }
    out[slot] = t;
    return t;
  };
  doc.nodes.forEach(visit);
  return out;
}
