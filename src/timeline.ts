// History timeline of a map (the web view's rail next to Diagnostics): one point per commit
// that touched the file, newest first, with an uncommitted-changes point on top when the file
// differs from its last commit. Each point lists the nodes it changed. A map outside git (or not
// committed yet) is dated by its links instead: one point per linked date.

import { unifiedDiff } from "./diff.ts";
import { linkDate, type Revision } from "./history.ts";
import { parse } from "./parse.ts";
import type { Anchor, Edge, RhumbDocument, RhumbNode } from "./types.ts";

export interface TimelinePoint {
  kind: "local" | "commit" | "link";
  /** Unix seconds; for `link`, the end of the linked day. */
  time: number;
  sha: string | null;
  /** Commit subject (`commit` only). */
  summary: string | null;
  /** The linked date, e.g. `2026-10-08` (`link` only). */
  date: string | null;
  /** Keys (ID, else `line:<n>`) of current nodes this point changed or links. */
  nodes: string[];
  /** Nodes it changed that are no longer in the map (deleted or renamed since). */
  gone: number;
}

export interface Timeline {
  source: "git" | "links";
  points: TimelinePoint[];
  /** Older points were left out (see TIMELINE_LIMIT); the view can ask for more. */
  truncated: boolean;
}

/** Points sent at first; the rail asks for more, a page at a time, as it is scrolled to the end. */
export const TIMELINE_LIMIT = 50;
/** The most points one request may ask for. */
export const TIMELINE_MAX = 2000;

/** Same key as the web view uses for a node in the current map. */
const keyOf = (n: RhumbNode) => n.id ?? `line:${n.line}`;
/** Identity across versions: the ID, else the title (line numbers shift between versions). */
const identityOf = (n: RhumbNode) => (n.id ? `#${n.id}` : `title:${n.title}`);

/** What a node "is" in one version: its own line, its notes and the edges it starts. */
function signatures(doc: RhumbDocument): Map<string, string> {
  const out = new Map<string, string>();
  const edges = new Map<string, string[]>();
  for (const e of doc.edges) {
    const list = edges.get(e.from) ?? [];
    list.push(edgeText(e));
    edges.set(e.from, list);
  }
  const walk = (nodes: RhumbNode[]) => {
    for (const n of nodes) {
      const sig = JSON.stringify([n.status, n.title, n.attrs, n.notes.map((x) => x.text), n.id ? (edges.get(n.id) ?? []).sort() : []]);
      out.set(identityOf(n), sig);
      walk(n.children);
    }
  };
  walk(doc.nodes);
  return out;
}
const edgeText = (e: Edge) => `${e.kind} ${e.to}${e.label ? `: ${e.label}` : ""}`;

/** Identities added or changed from `before` to `after`. */
function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after].filter(([id, sig]) => before.get(id) !== sig).map(([id]) => id);
}

function sigsOf(source: string): Map<string, string> {
  try {
    return signatures(parse(source));
  } catch {
    return new Map(); // an old version the current parser cannot read counts as empty
  }
}

/**
 * Each revision's signatures, parsed once per revision. Kept per revision rather than per list,
 * since the rail's lists grow a page at a time and share their revisions: a longer list parses
 * only the revisions the shorter one did not have.
 */
const sigCache = new WeakMap<Revision, Map<string, string>>();
const sigsOfRevision = (r: Revision) => {
  let sigs = sigCache.get(r);
  if (!sigs) sigCache.set(r, (sigs = sigsOf(r.source)));
  return sigs;
};

/**
 * Timeline from `revisions` (newest first, each with its text). The oldest revision is
 * compared with an empty map unless `hasOlder` says a further revision was cut off, in which
 * case the last one only serves as the base and is not shown. `current` is the file as it is
 * now; when it differs from the newest revision, an uncommitted point dated `mtime` comes first.
 */
export function gitTimeline(current: RhumbDocument, currentSource: string, mtime: number, revisions: Revision[], hasOlder = false): Timeline {
  const sigs = revisions.map(sigsOfRevision);
  // Each revision against the one before it; the oldest against an empty map (its first commit).
  const changes = sigs.map((s, i) => changed(sigs[i + 1] ?? new Map(), s));
  const now = new Map<string, string>();
  const walk = (nodes: RhumbNode[]) => nodes.forEach((n) => (now.set(identityOf(n), keyOf(n)), walk(n.children)));
  walk(current.nodes);
  const toPoint = (kind: TimelinePoint["kind"], ids: string[], extra: Partial<TimelinePoint> & { time: number }): TimelinePoint => {
    const nodes = ids.map((id) => now.get(id)).filter((k): k is string => k !== undefined);
    return { kind, sha: null, summary: null, date: null, ...extra, nodes, gone: ids.length - nodes.length };
  };

  const points: TimelinePoint[] = [];
  if (revisions.length > 0 && currentSource !== revisions[0]!.source) {
    points.push(toPoint("local", changed(sigs[0]!, signatures(current)), { time: mtime }));
  }
  const shown = hasOlder ? revisions.length - 1 : revisions.length;
  for (let i = 0; i < shown; i++) {
    const r = revisions[i]!;
    points.push(toPoint("commit", changes[i]!, { time: r.time, sha: r.sha, summary: r.summary }));
  }
  return { source: "git", points, truncated: hasOlder };
}

/** The year of a date label such as `2026-10-08` or `-4,352,814,673 HE`, in CE. */
function writtenYear(date: string): number {
  const m = /^([−-]?[\d,]+)/.exec(date);
  if (!m) return 0;
  const year = Number(m[1]!.replace(/,/g, "").replace("−", "-"));
  return / HE\b/.test(date) ? year - 10000 : year;
}

/**
 * Timeline for a map without commits: one point per date its links name, newest first. A
 * link's date comes from its path (`diary:2026/1008`) or, through `dateOf`, from the dated
 * heading it lands under, as for freshness. At most `limit` dates, the newest.
 */
export function linkTimeline(doc: RhumbDocument, dateOf?: (anchor: Anchor) => { date: string; time: number } | null, limit = TIMELINE_LIMIT): Timeline {
  const byDate = new Map<string, { time: number; nodes: Set<string> }>();
  const walk = (nodes: RhumbNode[]) => {
    for (const n of nodes) {
      for (const a of n.anchors) {
        const d = linkDate(a.kind === "url" ? a.target : a.path ?? a.target) ?? (a.kind === "url" ? null : dateOf?.(a) ?? null);
        if (!d) continue;
        const slot = byDate.get(d.date) ?? { time: d.time, nodes: new Set<string>() };
        slot.nodes.add(keyOf(n));
        byDate.set(d.date, slot);
      }
      walk(n.children);
    }
  };
  walk(doc.nodes);
  // Dates further back than a JS Date can hold are all clamped to one time, so ties are broken
  // by the year as written (a Holocene year is CE + 10000).
  const all = [...byDate].sort((a, b) => b[1].time - a[1].time || writtenYear(b[0]) - writtenYear(a[0]));
  const points = all.slice(0, limit).map(([date, s]): TimelinePoint => ({
    kind: "link", time: s.time, sha: null, summary: null, date, nodes: [...s.nodes], gone: 0,
  }));
  return { source: "links", points, truncated: all.length > limit };
}

/**
 * The diff a git timeline point stands for, in unified format: a commit against the revision
 * before it (nothing before the first one), `local` (uncommitted changes) against the newest
 * commit. Null when the point is not among `revisions`.
 */
export function pointDiff(revisions: Revision[], point: string, current: string): string | null {
  if (revisions.length === 0) return null;
  if (point === "local") return unifiedDiff(revisions[0]!.source, current, revisions[0]!.path);
  const i = revisions.findIndex((r) => r.sha === point);
  if (i < 0) return null;
  const r = revisions[i]!;
  const base = revisions[i + 1] ?? null;
  return unifiedDiff(base?.source ?? null, r.source, r.path);
}
