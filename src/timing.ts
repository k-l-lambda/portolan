// Timing of work (spec 3.5): an optional estimate of how long a node takes, the moment its current
// run started and, once done, the moment it finished. Tools compare the time since `started`
// with `estimate` while the node is doing, and show the actual time once it has `finished`.

import type { RhumbDocument, RhumbNode } from "./types.ts";

const UNIT = { y: 31_536_000, w: 604_800, d: 86_400, h: 3_600, m: 60, s: 1 } as const;

/**
 * Seconds in a duration such as `45m`, `2h`, `1h30m`, `1.5h`, `3d`, `1w` or `2y`; null when the
 * value is not one. Units are y, w, d, h, m and s, largest first; a day is 24 hours of clock time
 * and a year 365 days.
 */
export function parseDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!/^(\d+(\.\d+)?[ywdhms])+$/.test(v)) return null;
  let total = 0;
  let last = Infinity;
  for (const [, n, u] of v.matchAll(/(\d+(?:\.\d+)?)([ywdhms])/g)) {
    const size = UNIT[u as keyof typeof UNIT];
    if (size >= last) return null; // each unit once, largest first
    last = size;
    total += Number(n) * size;
  }
  return total > 0 ? total : null;
}

/**
 * Unix seconds of a moment (`started`, `finished`): an ISO date-time with or without seconds and
 * offset (`2026-10-15T09:30+08:00`, `2026-10-15 09:30`, `…Z`), or a date. A date alone is the
 * start of that day, or its end with `endOfDay` (a finish written as a date means "during that
 * day"). Without an offset the time is local. Null when the value is not one, or not a real date.
 */
export function parseMoment(value: unknown, endOfDay = false): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0)) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const zone = m[7];
  if (m[4] === undefined && endOfDay) return Math.floor(new Date(year, month - 1, day + 1).getTime() / 1000) - 1;
  if (zone === undefined) return Math.floor(new Date(year, month - 1, day, hour, minute, second).getTime() / 1000);
  const utc = Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
  if (zone === "Z") return utc;
  const z = /([+-])(\d{2}):?(\d{2})/.exec(zone)!;
  return utc - (z[1] === "-" ? -1 : 1) * (Number(z[2]) * 3600 + Number(z[3]) * 60);
}

/** At or above this share of the estimate, a run is nearly due. */
export const NEAR_DUE = 0.8;

export interface Timing {
  /** Estimated seconds, or null without a valid estimate. */
  estimate: number | null;
  /** Unix seconds the current run started, or null without a valid start. */
  started: number | null;
  /** Unix seconds the run finished, or null without a valid finish. */
  finished: number | null;
  /**
   * Seconds the run took (`closed`) or has taken so far (doing); null when neither applies.
   * A start in the future counts as 0.
   */
  elapsed: number | null;
  /** The run is over: not doing, with `finished` at or after `started`; `elapsed` is the actual time. */
  closed: boolean;
  /**
   * Against the estimate, when there are both: `ok` below 80%, `near` from 80% (only while
   * running), `over` past it.
   */
  state: "ok" | "near" | "over" | null;
}

/**
 * A node's timing at `now` (unix seconds); null when it has no timing attribute. While the node
 * is doing, the time since `started` counts (a stale `finished` is ignored); otherwise a node with
 * both `started` and `finished` shows the time between them; anything else is only a record.
 */
export function timingOf(node: Pick<RhumbNode, "attrs" | "status">, now: number): Timing | null {
  const estimate = parseDuration(node.attrs.estimate);
  const started = parseMoment(node.attrs.started);
  const finished = parseMoment(node.attrs.finished, true);
  if (estimate === null && started === null && finished === null) return null;
  const doing = node.status === "doing";
  // A finish before the start (W017) gives no actual time.
  const closed = !doing && started !== null && finished !== null && finished >= started;
  const elapsed = started === null ? null : doing ? Math.max(0, now - started) : closed ? finished! - started : null;
  const state = estimate === null || elapsed === null ? null
    : elapsed > estimate ? "over" : !closed && elapsed >= NEAR_DUE * estimate ? "near" : "ok";
  return { estimate, started, finished, elapsed, closed, state };
}

/**
 * Order for a list of running items, most urgent first: over the estimate, then nearly due, then
 * on time (each by share of the estimate used), then running without an estimate (longest
 * first), then estimated but not started.
 */
export function byUrgency(a: Timing, b: Timing): number {
  const rank = (t: Timing) => (t.state === "over" ? 0 : t.state === "near" ? 1 : t.state === "ok" ? 2 : t.elapsed !== null ? 3 : 4);
  const key = (t: Timing) => (t.state ? t.elapsed! / t.estimate! : t.elapsed ?? 0);
  return rank(a) - rank(b) || key(b) - key(a);
}

/** Percent of the estimate used, rounded, but never 100 while still under the estimate. */
export function sharePercent(elapsed: number, estimate: number): number {
  const p = Math.round((elapsed / estimate) * 100);
  return elapsed < estimate ? Math.min(p, 99) : p;
}

/**
 * Compact duration in its two largest units: `0m`, `25m`, `2h30m`, `3d4h`, `5w2d`, `7y2w`. Below
 * two weeks days and hours are shown, from two weeks weeks and days, from a year years and weeks.
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (big: number, bigUnit: string, small: number, smallUnit: string) =>
    small > 0 ? `${big}${bigUnit}${small}${smallUnit}` : `${big}${bigUnit}`;
  if (s >= UNIT.y) return two(Math.floor(s / UNIT.y), "y", Math.floor((s % UNIT.y) / UNIT.w), "w");
  if (s >= 2 * UNIT.w) return two(Math.floor(s / UNIT.w), "w", Math.floor((s % UNIT.w) / UNIT.d), "d");
  if (s >= UNIT.d) return two(Math.floor(s / UNIT.d), "d", Math.floor((s % UNIT.d) / UNIT.h), "h");
  if (s >= UNIT.h) return two(Math.floor(s / UNIT.h), "h", Math.floor((s % UNIT.h) / UNIT.m), "m");
  return `${Math.floor(s / UNIT.m)}m`;
}

const REPORT_STATE = { over: "over", near: "near", ok: "on time" } as const;

/**
 * Lines for `portolan check`: each doing node with timing, most urgent first, as
 * `<file>:<line>: <state> <elapsed> / <estimate> (<share>) ^<id> <title>`, after a summary line.
 * Empty when no doing node has timing.
 */
export function timingReport(doc: RhumbDocument, file: string, now: number): string[] {
  const rows: { line: number; title: string; id: string | null; t: Timing }[] = [];
  const walk = (nodes: RhumbNode[]) => nodes.forEach((n) => {
    const t = n.status === "doing" ? timingOf(n, now) : null;
    if (t) rows.push({ line: n.line, title: n.title, id: n.id, t });
    walk(n.children);
  });
  walk(doc.nodes);
  if (rows.length === 0) return [];
  rows.sort((a, b) => byUrgency(a.t, b.t) || a.line - b.line);
  const count = (s: Timing["state"]) => rows.filter((r) => r.t.state === s).length;
  const flags = [count("over") && `${count("over")} over`, count("near") && `${count("near")} nearly due`].filter(Boolean);
  const cells = rows.map(({ t }) => [
    t.state ? REPORT_STATE[t.state] : t.elapsed !== null ? "running" : "not started",
    t.elapsed !== null && t.estimate !== null ? `${formatDuration(t.elapsed)} / ${formatDuration(t.estimate)}`
      : t.elapsed !== null ? `${formatDuration(t.elapsed)} / no estimate` : `- / ${formatDuration(t.estimate!)}`,
    t.elapsed !== null && t.estimate !== null ? `(${sharePercent(t.elapsed, t.estimate)}%)` : "",
  ]);
  const width = [0, 1, 2].map((i) => Math.max(...cells.map((c) => c[i]!.length)));
  return [
    `timing: ${rows.length} doing${flags.length ? ` (${flags.join(", ")})` : ""}`,
    ...rows.map((r, i) => `${file}:${r.line}: ${cells[i]!.map((c, j) => c.padEnd(width[j]!)).join("  ")}  ${r.id ? `^${r.id} ` : ""}${r.title}`.replace(/ +$/, "")),
  ];
}
