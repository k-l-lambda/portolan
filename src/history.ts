// Per-line update times for .rhumb files, from git history.
//
// A line changed in the working tree (or a file that is untracked or outside any repo)
// is dated by the file's modification time; every other line by the commit that last
// touched it (`git blame`). Results are cached per file content, mtime and repo HEAD.

import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { RhumbDocument, RhumbNode } from "./types.ts";

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

export interface NodeTime extends LineTime {
  line: number;
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

/** Update time of each node: the time of the node's own line. */
export function nodeTimes(doc: RhumbDocument, history: FileHistory): NodeTime[] {
  const out: NodeTime[] = [];
  const walk = (nodes: RhumbNode[]) => {
    for (const n of nodes) {
      const lt = history.lines[n.line - 1] ?? { time: history.mtime, source: "local" as const, sha: null };
      out.push({ line: n.line, ...lt });
      walk(n.children);
    }
  };
  walk(doc.nodes);
  return out;
}
