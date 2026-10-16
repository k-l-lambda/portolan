// The 3D view's geometry (the `3D` toggle in DocView): a second axis for time.
//
// The map itself stays exactly the flat plane ELK laid out. The projection lifts each card off
// that plane by its own time and lays the time footprints of the work on the ground beneath it.
// Screen = (x + DX·z, y + DY·z) with z the depth in pixels: older is up and to the right, so the
// depth axis stays clear of the map's own vertical order, which already runs by time bands.
//
// The projection moves points; it does not transform the pane. A CSS 3D transform on the panes
// would tilt the pan and zoom maths with it, so dragging would stop following the pointer and the
// navigator would frame the wrong region. Moving the points leaves xyflow in its flat 2D world:
// pan, zoom, hit testing, the navigator and the relation lines all keep working as they do in 2D.
//
// The shear means a constant time is a whole plane, not a line on screen, so depth cannot be read
// from a position alone. Each timed card therefore carries its own ruler along its own row: a track
// in the depth direction with a dash at every tick. Comparing the card with the dashes on its own
// track reads its depth exactly; the shared ruler at the map's edge supplies the labels.
//
// Everything here is pure — the window, the ticks and the footprints all fall out of the times —
// so it can be tested without a browser.

import { formatDuration, type Timing } from "../../src/timing.ts";
import { absoluteTime } from "./time.ts";

/** Pixels of depth given to the focused time span, at zoom 1. */
export const DEPTH_MAX = 280;
/** Screen direction of one pixel of depth: older is up and to the right. */
export const DEPTH_DX = 0.4;
export const DEPTH_DY = -0.85;
/** Share of its opacity the farthest card loses, so depth reads without shrinking the cards. */
export const DEPTH_FOG = 0.5;
/** Length of a tick mark across the ruler, and the gap between a label and its tick. */
export const TICK_LEN = 8;
/** Screen distance between two ticks, in the depth axis's own pixels. */
const TICK_GAP = 34;
/** Seconds in a day and in a Julian year, as the map's duration form does. */
const DAY = 86_400;
const YEAR = 365 * DAY;
/** A Date holds about ±273,000 years around 1970; past that, ticks are placed by arithmetic. */
const DATE_MIN = -8.6e12;
const DATE_MAX = 8.6e12;

/** The time window the depth axis covers: `to` sits on the front plane, `span` reaches back. */
export interface Focus {
  to: number;
  span: number;
}

/** One laid-out card, as the projection takes it. */
export interface DepthBox {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A region of the map, in map coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Where a point at depth `z` is drawn, and how faded. */
export interface Projected {
  x: number;
  y: number;
  fog: number;
}

/** Depth of a moment, in axis pixels: 0 on the front plane, `DEPTH_MAX` at the back. */
export function depthPx(time: number, focus: Focus): number {
  const back = (focus.to - time) / focus.span;
  return Math.min(1, Math.max(0, back)) * DEPTH_MAX;
}

/** A moment at depth `z`, the inverse of `depthPx`. */
export function timeAt(z: number, focus: Focus): number {
  return focus.to - (z / DEPTH_MAX) * focus.span;
}

/**
 * A point at depth `z` under the projection. Cards keep their size: the projection moves them and
 * fades the far ones but never scales them, so handles stay on a card's outline and the relation
 * lines still meet it exactly.
 */
export function project(x: number, y: number, z: number): Projected {
  return { x: x + DEPTH_DX * z, y: y + DEPTH_DY * z, fog: 1 - DEPTH_FOG * (z / DEPTH_MAX) };
}

/**
 * A polyline with its ends at different depths: each point is offset by the depth interpolated
 * along the path, so a relation between two cards at different times leans with them.
 */
export function projectPath(points: Point[], zFrom: number, zTo: number): Point[] {
  const last = points.length - 1;
  return points.map((p, i) => {
    const z = zFrom + (zTo - zFrom) * (last === 0 ? 0 : i / last);
    return { x: p.x + DEPTH_DX * z, y: p.y + DEPTH_DY * z };
  });
}

/** Round windows the axis steps through, so the projection holds still while panning. */
const SPANS = [
  300, 900, 3_600, 6 * 3_600, 12 * 3_600, DAY, 3 * DAY, 7 * DAY, 30 * DAY, 90 * DAY, YEAR,
  5 * YEAR, 25 * YEAR, 100 * YEAR, 1e3 * YEAR, 1e4 * YEAR, 1e5 * YEAR, 1e6 * YEAR, 1e7 * YEAR, 1e8 * YEAR,
];

/** Smallest round span covering `raw` seconds. */
export function niceSpan(raw: number): number {
  return SPANS.find((s) => s >= raw) ?? SPANS[SPANS.length - 1]!;
}

/** How many ticks fit at a readable spacing. */
export const TICK_COUNT = Math.max(3, Math.floor(DEPTH_MAX / TICK_GAP));

export function sameFocus(a: Focus | null, b: Focus | null): boolean {
  return a === b || (!!a && !!b && a.to === b.to && a.span === b.span);
}

function overlaps(b: DepthBox, r: Rect): boolean {
  return b.x + b.width >= r.x && b.x <= r.x + r.width && b.y + b.height >= r.y && b.y <= r.y + r.height;
}

/**
 * The time window the depth axis should show, taken from the cards the navigator's frame holds —
 * the region of the map on screen, which is what the minimap draws its frame around.
 *
 * The window is quantised twice over: to a round span, and to a whole step for its front edge, so
 * panning slides the axis a step at a time instead of re-laying the whole map every frame. `prev`
 * is the window in force and `prev2` the one before it; a candidate that merely repeats `prev2` is
 * refused, which is what stops the projection and the visible set from chasing each other: the
 * projection moves the cards, the moved cards would suggest another window, and so on.
 *
 * Null when the visible region holds no dated card, so the caller keeps the window it has.
 */
export function nextFocus(
  boxes: DepthBox[],
  timeOf: (key: string) => number | undefined,
  rect: Rect,
  prev: Focus | null,
  prev2: Focus | null,
): Focus | null {
  const times: number[] = [];
  for (const b of boxes) {
    if (!overlaps(b, rect)) continue;
    const t = timeOf(b.key);
    if (t !== undefined) times.push(t);
  }
  if (times.length === 0) return null;
  const newest = Math.max(...times);
  const span = niceSpan(newest - Math.min(...times));
  const step = span / TICK_COUNT;
  const next: Focus = { to: Math.ceil(newest / step) * step, span };
  if (prev && prev.span === next.span && Math.abs(prev.to - next.to) < step) return prev;
  if (sameFocus(next, prev2)) return prev;
  return next;
}

/** What a tick's label counts in; the coarsest unit that still separates its neighbours. */
export type TickUnit = "hour" | "day" | "month" | "year";

export interface Tick {
  time: number;
  /** Depth along the axis, for placing the tick. */
  z: number;
  label: string;
  /** A tick on a coarser boundary (midnight, the first of a month, a January): drawn heavier. */
  major: boolean;
}

/**
 * Candidate steps, smallest first, each paired with the unit its label counts in. Built per unit
 * rather than written out, so the ladder stays dense enough (no gap wider than 3×) that one step
 * always sits near the target tick count — a sparse ladder leaves a long window with two ticks.
 */
const STEPS: [number, TickUnit][] = (() => {
  const out: [number, TickUnit][] = [];
  const HOUR = 3_600, DAY = 86_400, MONTH = 30 * DAY;
  // Seconds and minutes, for a window narrow enough that hours would only put two ticks on it.
  for (const sec of [1, 2, 5, 10, 15, 30]) out.push([sec, "hour"]);
  for (const min of [1, 2, 5, 10, 15, 30]) out.push([min * 60, "hour"]);
  // Within a day: clock time. Then days within a month, months within a year.
  for (const h of [1, 2, 3, 6, 12]) out.push([h * HOUR, "hour"]);
  for (const d of [1, 2, 3, 7, 14, 21]) out.push([d * DAY, "day"]);
  for (const m of [1, 2, 3, 6]) out.push([m * MONTH, "month"]);
  // Years, up to a hundred million: the span a history map of the world can need.
  for (const [mult, pow] of [[1, 0], [2, 0], [3, 0], [5, 0], [1, 1], [2, 1], [3, 1], [5, 1], [1, 2], [2, 2], [3, 2], [5, 2],
    [1, 3], [2, 3], [3, 3], [5, 3], [1, 4], [2, 4], [3, 4], [5, 4], [1, 5], [2, 5], [5, 5], [1, 6], [2, 6], [5, 6],
    [1, 7], [2, 7], [5, 7], [1, 8]]) {
    out.push([mult * Math.pow(10, pow) * YEAR, "year"]);
  }
  return out;
})();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A year on its own: `2026`, `66M BCE`, `101.9k CE`. Past four digits the era is always spelled out,
 * so a compacted year is never mistaken for a number of something else.
 */
export function yearLabel(year: number): string {
  // Astronomical years: 1 BCE is year 0, so a BCE label is `1 - y` (year -30 is 31 BCE). Getting
  // this the wrong way round would put every ancient tick one year out.
  const y = Math.floor(year);
  if (y <= 0) return `${compact(1 - y)} BCE`;
  // A year written out in full stands on its own; a compacted one ("1M", "100k") needs the era, or
  // it would read as a plain year number rather than as a number of years.
  return y > 9999 ? `${compact(y)} CE` : String(y);
}

function compact(n: number): string {
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  if (n >= 1e4) return `${Math.round(n / 1e2) / 10}k`;
  return String(n);
}

const inCalendar = (time: number) => time >= DATE_MIN && time <= DATE_MAX;

/**
 * The boundary of `step` at or before `time`, on the local calendar. Only hours, days and months
 * come through here: year ticks are built from year numbers in `axisTicks`, because a Date cannot
 * hold anything before about 275,000 BCE and because a time stepped in 365-day blocks drifts a
 * whole year over a thousand-year step.
 */
function alignDown(time: number, step: number, unit: Exclude<TickUnit, "year">): number {
  // Out of the calendar's reach (a Date holds about ±273,000 years): an even grid is all that can
  // be said.
  if (!inCalendar(time)) return Math.floor(time / step) * step;
  const d = new Date(time * 1000);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
  if (unit === "hour") return midnight + Math.floor((time - midnight) / step) * step;
  if (unit === "day") {
    const days = Math.max(1, Math.round(step / DAY));
    // Count from the first of the month, so a weekly axis lands on the same weekday throughout.
    return midnight - ((d.getDate() - 1) % days) * DAY;
  }
  // Snap to a month that is a whole multiple of the step, counted from year 0, so a two-month axis
  // ticks Jan, Mar, May and not every month.
  const months = Math.max(1, Math.round(step / (30 * DAY)));
  const total = d.getFullYear() * 12 + d.getMonth();
  const snapped = Math.floor(total / months) * months;
  return new Date(Math.floor(snapped / 12), snapped % 12, 1).getTime() / 1000;
}

/**
 * The start of a named year: the calendar's own New Year's Day where a Date can hold it, and the
 * arithmetic year length outside that range. Year ticks are made from year numbers rather than
 * from a running time, because a Date cannot hold anything before about 275,000 BCE and because a
 * time stepped in blocks of a fixed length would not land on the year boundary it is meant to name.
 */
function yearStart(year: number): number {
  const d = new Date(0);
  d.setFullYear(year, 0, 1);
  // Outside the Date's range `getFullYear` hands back a clamped year instead of the one asked for;
  // there the arithmetic year length is the honest answer.
  return d.getFullYear() === year ? d.getTime() / 1000 : (year - 1970) * YEAR;
}

function labelOf(time: number, unit: Exclude<TickUnit, "year">, step: number): string {
  const d = new Date(time * 1000);
  if (unit === "hour") {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    // Seconds only where the ticks are closer together than a minute; otherwise two of them would
    // carry the same text.
    return step < 60 ? `${hh}:${mm}:${String(d.getSeconds()).padStart(2, "0")}` : `${hh}:${mm}`;
  }
  if (unit === "day") return `${MONTHS[d.getMonth()]!} ${d.getDate()}`;
  // The year rides on the January tick, which `isMajor` draws heavier, so a month name is never
  // read as a date.
  return d.getMonth() === 0 ? yearLabel(d.getFullYear()) : MONTHS[d.getMonth()]!;
}

/**
 * True where a tick falls on a boundary bigger than its own step — midnight on an hour axis, the
 * first of a month on a day axis, a January on a month axis, a round multiple on a year axis.
 * Drawn heavier, so the eye can find the larger divisions while scanning.
 */
function isMajor(time: number, unit: Exclude<TickUnit, "year">, step: number): boolean {
  const d = new Date(time * 1000);
  if (unit === "hour") return d.getHours() === 0;
  if (unit === "day") return d.getDate() === 1;
  return d.getMonth() === 0;
}

export function axisTicks(focus: Focus): Tick[] {
  // The step whose tick count lands nearest the target, in ratio rather than in difference: with a
  // dense ladder this is also the finest that still fits, and it never leaves the axis with two
  // ticks at one end of the range and none at the other.
  const want = focus.span / TICK_COUNT;
  const [step, unit] = STEPS.reduce((best, s) => (Math.abs(Math.log(s[0] / want)) < Math.abs(Math.log(best[0] / want)) ? s : best));
  const oldest = focus.to - focus.span;
  const out: Tick[] = [];
  const add = (time: number, label: string, major: boolean) => {
    // Only ticks inside the window: one beyond it would clamp to the end depth and stack a second
    // label on the last tick.
    if (time > focus.to || time < oldest) return;
    out.push({ time, z: depthPx(time, focus), label, major });
  };
  if (unit === "year") {
    // Walk year numbers, so a tick always names the year it is placed on, in either era.
    const years = Math.max(1, Math.round(step / YEAR));
    // Start on a whole multiple of the step at or before the window's front edge, so a 50-year axis
    // ticks 2000, 1950, 1900 rather than 2026, 1976, 1926, and the heavier every-tenth marks fall
    // on round years.
    let i = 0;
    for (let y = Math.floor((1970 + focus.to / YEAR) / years) * years; out.length < 60; y -= years, i++) {
      const time = yearStart(y);
      if (time < oldest - step) break;
      // Every fifth tick is drawn heavier, so the eye has something to count by — about two heavy
      // marks in view. Keying it to a named boundary instead would make every tick major whenever
      // the step divides that boundary (100-year steps are all multiples of 100), and the
      // distinction would then carry no information at all.
      add(time, yearLabel(y), i % 5 === 0);
    }
  } else {
    for (let t = alignDown(focus.to, step, unit); t >= oldest && out.length < 60; t = alignDown(t - 1, step, unit)) {
      add(t, labelOf(t, unit, step), isMajor(t, unit, step));
    }
  }
  return out;
}

export type RibbonKind = "actual" | "running" | "estimate";

/** A stretch of time laid on the ground under a card: what work took, is taking, or is expected to. */
export interface Ribbon {
  kind: RibbonKind;
  from: number;
  to: number;
  /** Against its estimate, so a running run carries the same colour as the flat view. */
  state: Timing["state"];
  /** The duration written on it (`2h30m`), not a wall-clock pair. */
  label: string;
}

/** `took 2h30m`, `running 40m`, `estimate 5w` — the ribbon's own text. */
export function ribbonLabel(r: Ribbon): string {
  const what = r.kind === "actual" ? "took" : r.kind === "running" ? "running" : "estimate";
  return `${what} ${r.label}`;
}

/**
 * The time footprint of a node:
 *   - `actual`: a finished run, from its start to its finish — what it really took;
 *   - `running`: work in progress, from its start to now, coloured by its estimate;
 *   - `estimate`: a todo with an estimate and no start, occupying `estimate` seconds of the window
 *     from the node's own time forward. A plan is a guess, not a measurement, so it is drawn as an
 *     outline rather than a solid band, and it is pulled back when needed to keep its full length
 *     inside the window — otherwise the front edge would clip it and the length would read wrong.
 * Null when the node has nothing timed to show.
 */
export function ribbonFor(
  timing: Timing | null,
  status: string | null,
  own: number,
  now: number,
  focus: Focus,
): Ribbon | null {
  if (!timing) return null;
  if (status === "doing" && timing.started !== null) {
    return { kind: "running", from: timing.started, to: now, state: timing.state, label: formatDuration(timing.elapsed ?? 0) };
  }
  if (timing.closed) {
    return { kind: "actual", from: timing.started!, to: timing.finished!, state: null, label: formatDuration(timing.elapsed!) };
  }
  if (status === "todo" && timing.estimate !== null && timing.started === null) {
    const oldest = focus.to - focus.span;
    // The plan occupies its estimate from the node's own time forward. Only a plan that would run
    // past the front plane is pulled back, so its length stays readable; one the window cannot hold
    // is trimmed at the old end instead.
    const from = Math.max(oldest, own + timing.estimate > focus.to ? focus.to - timing.estimate : own);
    return { kind: "estimate", from, to: Math.min(from + timing.estimate, focus.to), state: null, label: formatDuration(timing.estimate) };
  }
  return null;
}

/** Half the width of a ribbon across the axis, in floor pixels. */
const RIBBON_W = 13;
/** How far below a card its ribbon is laid, so cards never sit on their own tracks. */
const RIBBON_DROP = 52;
/**
 * How far the ruler stands off the map's left edge and its bottom. The stand-off has to clear the
 * shear as well as the map: at full depth the ruler's far end is drawn `DEPTH_DX * DEPTH_MAX` to the
 * right and `-DEPTH_DY * DEPTH_MAX` above where it was placed, so without that allowance its older
 * end would ride back up into the map instead of staying along the bottom edge.
 */
const RULER_X = DEPTH_DX * DEPTH_MAX + 40;
const RULER_Y = -DEPTH_DY * DEPTH_MAX + RIBBON_DROP + 2 * RIBBON_W + 24;

/** One card's own ruler: a track in the depth direction, with a dash at every tick. */
export interface Track {
  key: string;
  /** The track's two ends, at the window's oldest and newest end. */
  from: Point;
  to: Point;
  /** A dash across the track at each tick time, so the card's depth can be read against them. */
  dashes: { at: Point; major: boolean }[];
}

/** A ribbon laid on the ground: its four corners in the order back-left, back-right, front-right, front-left. */
export interface FloorSpan extends Ribbon {
  key: string;
  points: Point[];
  /** Where the ribbon's text goes. */
  labelAt: Point;
  /** The card's anchor, for the drop line down to the ribbon. */
  anchor: Point;
  title: string;
}

/** The ruler: a line down the depth axis with a labelled tick at each step. */
export interface Ruler {
  from: Point;
  to: Point;
  ticks: (Tick & { at: Point; labelAt: Point })[];
  /** The window as a duration, drawn at the ruler's newest end. */
  caption: string;
  captionAt: Point;
}

/** Everything the 3D view draws beyond the cards and the lines, in map coordinates. */
export interface DepthScene {
  ruler: Ruler;
  tracks: Track[];
  spans: FloorSpan[];
  /** Depth of each card, to project it and to order the cards by. */
  z: Map<string, number>;
}

/** The ruler's stand-off point: left of and below every card, where it cannot cover the map. */
function rulerOrigin(boxes: DepthBox[]): Point {
  if (boxes.length === 0) return { x: 0, y: 0 };
  return {
    x: Math.min(...boxes.map((b) => b.x)) - RULER_X,
    y: Math.max(...boxes.map((b) => b.y + b.height)) + RULER_Y,
  };
}

/**
 * The ruler, the tracks and the floor spans for a window.
 *
 * A ribbon lies on the ground under the front edge of its own card, so a card can be read straight
 * down into the time it occupied. A card with no time is left out of the tracks but still lifted
 * to the front plane, since the axis has nothing to say about when it happened.
 */
export function depthScene(
  boxes: DepthBox[],
  focus: Focus,
  timeOf: (key: string) => number | undefined,
  ribbonOf: (key: string) => Ribbon | null,
): DepthScene {
  const origin = rulerOrigin(boxes);
  const z = new Map<string, number>();
  for (const b of boxes) {
    const t = timeOf(b.key);
    z.set(b.key, t === undefined ? 0 : depthPx(t, focus));
  }
  const ticks = axisTicks(focus);
  const at = (x: number, y: number, zz: number): Point => ({ x: x + DEPTH_DX * zz, y: y + DEPTH_DY * zz });
  const back = ticks[ticks.length - 1]?.z ?? DEPTH_MAX;

  const tracks: Track[] = [];
  const spans: FloorSpan[] = [];
  for (const b of boxes) {
    const r = ribbonOf(b.key);
    const t = timeOf(b.key);
    if (!r && t === undefined) continue;
    const row = b.y + b.height + RIBBON_DROP;
    tracks.push({
      key: b.key,
      from: at(b.x, row, 0),
      to: at(b.x, row, back),
      dashes: ticks.map((k) => ({ at: at(b.x, row, k.z), major: k.major })),
    });
    if (!r) continue;
    const left = b.x, right = b.x + b.width;
    const points = [
      at(left, row, depthPx(r.from, focus)),
      at(right, row, depthPx(r.from, focus)),
      at(right, row + 2 * RIBBON_W, depthPx(r.to, focus)),
      at(left, row + 2 * RIBBON_W, depthPx(r.to, focus)),
    ];
    spans.push({
      ...r, key: b.key, points,
      labelAt: { x: (points[0]!.x + points[2]!.x) / 2, y: (points[0]!.y + points[2]!.y) / 2 + 4 },
      anchor: at(b.x + b.width / 2, b.y + b.height, z.get(b.key) ?? 0),
      title: `${ribbonTitle(r)}\n${durationPair(r.from, r.to)}`,
    });
  }

  const ruler: Ruler = {
    from: at(origin.x, origin.y, DEPTH_MAX),
    to: at(origin.x, origin.y, 0),
    ticks: ticks.map((k) => {
      const p = at(origin.x, origin.y, k.z);
      return { ...k, at: p, labelAt: { x: p.x + TICK_LEN + 4, y: p.y + 4 } };
    }),
    caption: formatDuration(Math.max(0, focus.span)),
    captionAt: at(origin.x, origin.y, 0),
  };
  return { ruler, tracks, spans, z };
}

/** The ribbon's text for a tooltip: what it is, how long, and the wall-clock pair it covers. */
function ribbonTitle(r: Ribbon): string {
  const state = r.state === "over" ? " (over)" : r.state === "near" ? " (nearly due)" : "";
  return `${ribbonLabel(r)}${state}`;
}

/** The wall-clock pair a ribbon covers: `10/15, 09:10 → 10/15, 11:40`. */
function durationPair(from: number, to: number): string {
  return `${absoluteTime(from)} → ${absoluteTime(to)}`;
}
