// The 3D view's geometry (the `3D` toggle in DocView): the map laid on the ground with time as
// height, seen through a real perspective camera.
//
//   * The ground plane is the map's own layout: its x to the right, its y away from the viewer.
//   * Height above the ground is time. The ground is *now*; work that happened rises above it, and
//     a plan that has not started stands below it. Every card therefore floats at its own height,
//     which is what makes the picture read as a space rather than as a map that was nudged.
//   * The eye sits above the ground, in front of the newest time and a little to one side, looking
//     down at the middle of the scene. Its pitch tips the ground into a trapezoid and the
//     perspective divide shrinks and converges the distance — the two things missing before, when
//     this was a plain shear: nothing changed size with depth, and the offset ran parallel to the
//     layout's own time ordering, so it looked like the same flat map.
//
// Because the camera is real, a card's screen size depends on its distance, so each card carries a
// `scale` and the scene is drawn far to near. The projection computes positions itself rather than
// transforming the panes: a CSS 3D transform on the flow's panes would tilt the pan and zoom maths
// with it, so dragging would stop following the pointer and the navigator would frame the wrong
// region.
//
// Everything here is pure — the camera, the window, the ticks and the bars all fall out of the
// times and the layout — so it can be tested without a browser.

import { formatDuration, type Timing } from "../../src/timing.ts";
import { CARD_H, CARD_W } from "./layout.ts";
import { absoluteTime } from "./time.ts";

/**
 * Height the focused time span is given, as a share of the map's own size. Time has to be a real
 * dimension of the scene or the lift reads as a nudge: at a tenth of the map it disappears in the
 * layout, and much above half it dwarfs the map. The scene picks the height from its own extent
 * (see `makeView`), so a small map and a huge one both show time as a comparable axis.
 */
export const ELEV_SHARE = 0.3;
/** Bounds on that height, so a tiny map does not become a tower and a huge one a pancake. */
const ELEV_MIN = 260;
const ELEV_MAX_PX = 900;
/** Opacity the farthest thing in the scene loses against the nearest. */
const FOG = 0.62;
/** Length of a tick mark across the ruler, and how far its label stands off. */
export const TICK_LEN = 9;
/** Screen distance wanted between two ticks, in world pixels at the aim point. */
const TICK_GAP = 34;
/** Seconds in a day and in a Julian year, as the map's duration form does. */
const DAY = 86_400;
const YEAR = 365 * DAY;
/** A Date holds about ±273,000 years around 1970; past that, ticks are placed by arithmetic. */
const DATE_MIN = -8.6e12;
const DATE_MAX = 8.6e12;

/** The time window on show: `to` is the ground (now), `span` reaches up into the past. */
export interface Focus {
  to: number;
  span: number;
}

/** A region of the map, in layout coordinates. */
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

/** A point in the scene: `x` across, `y` away from the viewer, `up` is time. */
export interface Point3 {
  x: number;
  y: number;
  up: number;
}

/** One laid-out card, as the projection takes it. */
export interface DepthBox {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A group's title, for the label on its ground rectangle. */
  label?: string;
}

/** Where a point lands on screen, how big it is drawn, and how faded. */
export interface Projected {
  x: number;
  y: number;
  /** Size against the aim point: 1 there, larger nearer the eye, smaller further away. */
  scale: number;
  /** Opacity against the nearest point in the scene, in [0, 1]. */
  fog: number;
  /** Distance from the eye, for sorting far to near. */
  dist: number;
}

/**
 * The camera. `pitch` tips the ground towards the viewer (0 looks along it edge-on, π/2 straight
 * down); `yaw` swings the eye to one side, so the scene is seen from a corner rather than square on;
 * `dist` is the eye's distance from the aim point and `f` its focal length in world pixels. The aim
 * point renders at a scale of `f / dist`, so `f = dist` puts the aim point at 1:1 and the flat
 * layout's own sizes carry into the 3D view.
 */
export interface Camera {
  pitch: number;
  yaw: number;
  dist: number;
  f: number;
}

/** A camera plus what it is looking at; `projectPoint` needs nothing else. */
export interface View {
  camera: Camera;
  /** The world point the camera looks at. */
  aim: Point3;
  /** Screen position of the aim point, so the scene keeps the layout's own coordinate frame. */
  anchor: Point;
  /** World height given to the whole time window; the scale of the vertical axis. */
  height: number;
}

/** Pitch of the default camera: about 29° above the ground — low enough that height reads clearly
 *  against the ground, high enough to keep the layout legible. */
export const PITCH = 0.5;
/** Yaw of the default camera: about 23° to one side, enough to show the ground as a plane. */
export const YAW = 0.4;

/**
 * Height of a moment above the ground, in world pixels: 0 at the ground, rising into the past, and
 * negative for a time still in the future. A time well outside the window is held at the window's
 * own edge rather than shooting out of the scene.
 */
export function elevationPx(time: number, focus: Focus, height: number = ELEV_MIN): number {
  const up = (focus.to - time) / focus.span;
  return Math.min(1, Math.max(-0.35, up)) * height;
}

/** A moment at a given height, the inverse of `elevationPx` where it is not clamped. */
export function timeAt(up: number, focus: Focus, height: number = ELEV_MIN): number {
  return focus.to - (up / height) * focus.span;
}

/** The camera's own basis: the cosines and sines of its two angles. */
const basis = (camera: Camera) => {
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  return { cp, sp, cy, sy };
};

/**
 * Perspective projection of a world point. Its shape is the point of the view: the two rotations
 * tip and turn the ground, and dividing by the distance from the eye is what makes things further
 * away both smaller and closer to the vanishing point.
 *
 * A point that would reach or pass the eye is held just in front of it rather than being allowed to
 * flip through to the far side, which would throw one card right across the screen.
 */
export function projectPoint(view: View, p: Point3): Projected {
  const { camera, aim, anchor } = view;
  const { cp, sp, cy, sy } = basis(camera);
  const dx = p.x - aim.x, dy = p.y - aim.y, du = p.up - aim.up;
  // The camera's own frame, from its two angles:
  //   forward f = (sy·cp, cy·cp, −sp)   — towards the scene and downward by the pitch
  //   right   r = (cy, −sy, 0)          — across, swung by the yaw
  //   up      u = (sy·sp, cy·sp, cp)    — the screen's own up, tipped with the pitch
  // A point's screen position is its offset from the aim point resolved on r and u, and its depth is
  // the same offset along f. Getting the sign of the pitch term wrong here is what made the far
  // ground draw below the near ground.
  const rx = dx * cy - dy * sy;
  const along = dx * sy + dy * cy;
  const ry = along * sp + du * cp;
  const into = along * cp - du * sp;
  const eye = Math.max(camera.dist * 0.15, camera.dist + into);
  const k = camera.f / eye;
  // Fog rises with distance from the eye, normalised against the scene's own near and far reach, so
  // the far end of the map really does fade and the near end does not.
  const t = Math.min(1, Math.max(0, (eye - camera.dist * 0.55) / (camera.dist * 1.3)));
  return { x: anchor.x + rx * k, y: anchor.y - ry * k, scale: k, fog: 1 - FOG * t, dist: eye };
}

/** The screen centre and scale of a card whose centre sits at `p`. */
export function projectTopLeft(view: View, p: Point3, width: number, height: number): Projected {
  const at = projectPoint(view, p);
  // A card is drawn as a billboard facing the eye, so it is scaled about its own centre.
  return { ...at, x: at.x - (width * at.scale) / 2, y: at.y - (height * at.scale) / 2 };
}

/**
 * A polyline whose ends are at different heights: each point is projected on its own, so a relation
 * between two cards at different times climbs or falls between them.
 */
export function projectPath(view: View, points: Point[], upFrom: number, upTo: number): Point[] {
  const last = points.length - 1;
  return points.map((p, i) => {
    const up = upFrom + (upTo - upFrom) * (last === 0 ? 0 : i / last);
    const at = projectPoint(view, { x: p.x, y: p.y, up });
    return { x: at.x, y: at.y };
  });
}

/** Round windows the axis steps through, so the view holds still while panning. */
const SPANS = [
  300, 900, 3_600, 6 * 3_600, 12 * 3_600, DAY, 3 * DAY, 7 * DAY, 30 * DAY, 90 * DAY, YEAR,
  5 * YEAR, 25 * YEAR, 100 * YEAR, 1e3 * YEAR, 1e4 * YEAR, 1e5 * YEAR, 1e6 * YEAR, 1e7 * YEAR, 1e8 * YEAR,
];

/** Smallest round span covering `raw` seconds. */
export function niceSpan(raw: number): number {
  return SPANS.find((s) => s >= raw) ?? SPANS[SPANS.length - 1]!;
}

/** How many ticks fit a run of `height` pixels at a readable spacing. */
export function tickCount(height: number): number {
  return Math.max(3, Math.floor(height / TICK_GAP));
}
/** Ticks at the default height, for callers that only want a rough figure. */
export const TICK_COUNT = tickCount(ELEV_MIN);

export function sameFocus(a: Focus | null, b: Focus | null): boolean {
  return a === b || (!!a && !!b && a.to === b.to && a.span === b.span);
}

function overlaps(b: DepthBox, r: Rect): boolean {
  return b.x + b.width >= r.x && b.x <= r.x + r.width && b.y + b.height >= r.y && b.y <= r.y + r.height;
}

/**
 * The time window to show, from the cards the navigator's frame holds — the region of the map on
 * screen, which is what the minimap draws its frame around.
 *
 * The window is quantised twice: to a round span, and to a whole step for its front edge, so panning
 * slides it a step at a time rather than rebuilding the scene every frame. `prev` is the window in
 * force and `prev2` the one before it; a candidate that merely repeats `prev2` is refused, which is
 * what stops the view and the visible set from chasing each other: the projection moves the cards,
 * and the moved cards would otherwise suggest yet another window.
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
  /** Height above the ground, for placing the tick. */
  up: number;
  label: string;
  /** A tick on a bigger boundary than its own step: drawn heavier, so the eye can count by it. */
  major: boolean;
}

/** Candidate steps, smallest first, each paired with the unit its label counts in. */
const STEPS: [number, TickUnit][] = (() => {
  const out: [number, TickUnit][] = [];
  const HOUR = 3_600, DAY = 86_400, MONTH = 30 * DAY;
  for (const sec of [1, 2, 5, 10, 15, 30]) out.push([sec, "hour"]);
  for (const min of [1, 2, 5, 10, 15, 30]) out.push([min * 60, "hour"]);
  for (const h of [1, 2, 3, 6, 12]) out.push([h * HOUR, "hour"]);
  for (const d of [1, 2, 3, 7, 14, 21]) out.push([d * DAY, "day"]);
  for (const m of [1, 2, 3, 6]) out.push([m * MONTH, "month"]);
  for (const [mult, pow] of [[1, 0], [2, 0], [3, 0], [5, 0], [1, 1], [2, 1], [3, 1], [5, 1], [1, 2], [2, 2], [3, 2], [5, 2],
    [1, 3], [2, 3], [3, 3], [5, 3], [1, 4], [2, 4], [3, 4], [5, 4], [1, 5], [2, 5], [5, 5], [1, 6], [2, 6], [5, 6],
    [1, 7], [2, 7], [5, 7], [1, 8]]) {
    out.push([mult * Math.pow(10, pow) * YEAR, "year"]);
  }
  return out;
})();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A year on its own: `2026`, `66M BCE`, `1M CE`. A year written out in full stands on its own; a
 * compacted one needs its era, or `1M` would read as a plain year number.
 */
export function yearLabel(year: number): string {
  const y = Math.floor(year);
  // Astronomical years: 1 BCE is year 0, so a BCE label is `1 - y` (year -30 is 31 BCE). Getting
  // this the wrong way round would put every ancient tick one year out.
  if (y <= 0) return `${compact(1 - y)} BCE`;
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
 * come through here: year ticks are built from year numbers, for the reason given in `axisTicks`.
 */
function alignDown(time: number, step: number, unit: Exclude<TickUnit, "year">): number {
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

function labelOf(time: number, unit: Exclude<TickUnit, "year">, step: number, spanDays: number): string {
  const d = new Date(time * 1000);
  if (unit === "hour") {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    // Seconds only where two ticks would otherwise carry the same text.
    const clock = step < 60 ? `${hh}:${mm}:${String(d.getSeconds()).padStart(2, "0")}` : `${hh}:${mm}`;
    // Over more than a day a bare clock time repeats and says nothing about which day it is, so the
    // date rides along on the midnight tick.
    return spanDays > 1 && d.getHours() === 0 ? `${MONTHS[d.getMonth()]!} ${d.getDate()}` : clock;
  }
  if (unit === "day") return `${MONTHS[d.getMonth()]!} ${d.getDate()}`;
  // The year rides on the January tick, which is drawn heavier, so a month name is never read as a
  // date of that month.
  return d.getMonth() === 0 ? yearLabel(d.getFullYear()) : MONTHS[d.getMonth()]!;
}

/** True on a boundary bigger than the tick's own step: a midnight, a first of the month, a January. */
function isMajor(time: number, unit: Exclude<TickUnit, "year">): boolean {
  const d = new Date(time * 1000);
  if (unit === "hour") return d.getHours() === 0;
  if (unit === "day") return d.getDate() === 1;
  return d.getMonth() === 0;
}

/**
 * The start of a named year: the calendar's New Year's Day where a Date can hold it, and the
 * arithmetic year length outside that range. Year ticks are made from year numbers rather than a
 * running time, because a Date cannot hold anything before about 275,000 BCE and because a time
 * stepped in 365-day blocks drifts a whole year over a thousand-year step.
 */
function yearStart(year: number): number {
  const d = new Date(0);
  d.setFullYear(year, 0, 1);
  return d.getFullYear() === year ? d.getTime() / 1000 : (year - 1970) * YEAR;
}

/**
 * Ticks up the ruler, newest (on the ground) first: the boundary crossed, its height, its text, and
 * whether it falls on a boundary bigger than its step. Steps are chosen so about `TICK_COUNT` of
 * them fit at a readable spacing, and each tick lands on a real calendar boundary, so the labels
 * read as dates rather than as an even division of the window.
 */
export function axisTicks(focus: Focus, height: number = ELEV_MIN): Tick[] {
  // The step whose tick count lands nearest the target, counting both ends. Comparing counts rather
  // than ratios matters: a step that looks nearest in ratio can still put half again as many ticks
  // on the axis as wanted, and they then crowd each other.
  const target = tickCount(height);
  const count = (step: number) => focus.span / step + 1;
  const [step, unit] = STEPS.reduce((best, s) => (Math.abs(count(s[0]) - target) < Math.abs(count(best[0]) - target) ? s : best));
  const oldest = focus.to - focus.span;
  const out: Tick[] = [];
  const add = (time: number, label: string, major: boolean) => {
    // Only ticks inside the window: one beyond it would sit at the window's own edge and stack a
    // second label on the last tick.
    if (time > focus.to || time < oldest) return;
    out.push({ time, up: elevationPx(time, focus, height), label, major });
  };
  if (unit === "year") {
    const years = Math.max(1, Math.round(step / YEAR));
    let i = 0;
    for (let y = Math.floor((1970 + focus.to / YEAR) / years) * years; out.length < 60; y -= years, i++) {
      const time = yearStart(y);
      if (time < oldest - step) break;
      // Every fifth tick drawn heavier. Keying it to a named boundary instead would make every tick
      // major whenever the step divides that boundary, and the mark would then carry no information.
      add(time, yearLabel(y), i % 5 === 0);
    }
  } else {
    for (let t = alignDown(focus.to, step, unit); t >= oldest && out.length < 60; t = alignDown(t - 1, step, unit)) {
      add(t, labelOf(t, unit, step, focus.span / DAY), isMajor(t, unit));
    }
  }
  return out;
}

export type RibbonKind = "actual" | "running" | "estimate";

/** A stretch of time, drawn as a bar standing on the ground: what work took, is taking, or expects to. */
export interface Ribbon {
  kind: RibbonKind;
  from: number;
  to: number;
  /** Against its estimate, so a running run carries the colour the flat view gives it. */
  state: Timing["state"];
  /** The duration written on it (`2h30m`), not a wall-clock pair. */
  label: string;
}

/** `took 2h30m`, `running 40m`, `estimate 5w` — the bar's own text. */
export function ribbonLabel(r: Ribbon): string {
  const what = r.kind === "actual" ? "took" : r.kind === "running" ? "running" : "estimate";
  return `${what} ${r.label}`;
}

/**
 * The time a node occupies, as a span between two moments:
 *   - `actual`: a finished run, from its start to its finish — what it really took;
 *   - `running`: work in progress, from its start to now, coloured by its estimate;
 *   - `estimate`: a todo with an estimate and no start, standing as a bar of that length from the
 *     node's own time forward. A plan is a guess rather than a measurement, so it is an outline.
 * Null when the node has nothing timed to show.
 */
export function ribbonFor(timing: Timing | null, status: string | null, own: number, now: number): Ribbon | null {
  if (!timing) return null;
  if (status === "doing" && timing.started !== null) {
    return { kind: "running", from: timing.started, to: now, state: timing.state, label: formatDuration(timing.elapsed ?? 0) };
  }
  if (timing.closed) {
    return { kind: "actual", from: timing.started!, to: timing.finished!, state: null, label: formatDuration(timing.elapsed!) };
  }
  if (status === "todo" && timing.estimate !== null && timing.started === null) {
    return { kind: "estimate", from: own, to: own + timing.estimate, state: null, label: formatDuration(timing.estimate) };
  }
  return null;
}

/** Width of a time bar across the ground, in world pixels. */
const BAR_W = 26;
/**
 * A bar's height is a share of the window's own height, so its proportions mean something: a bar
 * filling the window is work spanning the whole window. Linear would make a hundred-year job tower
 * over a day's work and push it off the screen, so a bar is drawn to the square root of its share.
 * Lengths stay clearly ordered — twice the time is still taller — while a short job stays visible
 * beside a long one. The label carries the actual figure, so nothing depends on reading the height.
 */
const barHeight = (share: number, height: number) => Math.max(2, Math.sqrt(Math.min(1, Math.max(0, share))) * height);
/** Size of a group's header card, which is all of a group that floats in this view. */
const HEADER_W = CARD_W - 24;
const HEADER_H = CARD_H;

/** A time bar standing above its card's ground point: where it stands, how tall, and what it holds. */
export interface Bar extends Ribbon {
  key: string;
  /** The bar's footprint on the ground. */
  at: Point;
  upFrom: number;
  upTo: number;
  /** Screen quad: bottom-left, bottom-right, top-right, top-left. */
  points: Point[];
  labelAt: Point;
  title: string;
}

/** The ruler standing at the older edge of the scene: ticked, labelled, and read against the bars. */
export interface Ruler {
  /** Foot of the ruler, on the ground. */
  foot: Point;
  ticks: (Tick & { at: Point; labelAt: Point })[];
  /** The window as a duration, written at the foot. */
  caption: string;
  captionAt: Point;
}

/**
 * A group's footprint on the ground: the rectangle the group occupies, laid flat. Groups are a
 * flat affordance — their children float at their own times, so no single box can enclose them —
 * so in this view a group is drawn where it sits on the map rather than floating as a panel.
 */
export interface Footprint {
  key: string;
  points: Point[];
  /** Centre of the rectangle, for the group's label. */
  labelAt: Point;
  label: string;
}

/** Everything the 3D view draws beyond the cards and the lines, all in map coordinates. */
export interface DepthScene {
  /** Where each card is drawn and how big, keyed by node key. */
  at: Map<string, Projected>;
  /** Node keys far to near, for the stacking order. */
  order: string[];
  /** A line from each raised card straight down to the ground, so its height can be read. */
  drops: { key: string; from: Point; to: Point }[];
  bars: Bar[];
  ruler: Ruler;
  /** Group rectangles, laid flat on the ground. */
  footprints: Footprint[];
  /** The ground plane's four screen corners. */
  ground: Point[];
  view: View;
  /** Screen bounds of everything drawn, so the caller can frame the whole scene. */
  bounds: Rect;
}

/**
 * Where the eye sits for a scene of this size, and what it looks at. The distance grows with the
 * scene, so a large map is not swallowed by the perspective and a small one is not flattened by it;
 * `f = dist` puts the aim point at a scale of 1, so cards keep their layout size at the middle.
 */
export function makeView(boxes: DepthBox[]): View {
  const xs = boxes.map((b) => b.x), ys = boxes.map((b) => b.y);
  const right = boxes.map((b) => b.x + b.width), bottom = boxes.map((b) => b.y + b.height);
  const extent = boxes.length
    ? Math.max(Math.max(...bottom) - Math.min(...ys), Math.max(...right) - Math.min(...xs), 900)
    : 900;
  // Time's height is set from the map's own size, so the vertical axis stays comparable to the
  // ground whatever the map's scale, and bounded so neither extreme gets silly.
  const height = Math.min(ELEV_MAX_PX, Math.max(ELEV_MIN, extent * ELEV_SHARE));
  const aim: Point3 = {
    x: boxes.length ? (Math.min(...xs) + Math.max(...right)) / 2 : 0,
    y: boxes.length ? (Math.min(...ys) + Math.max(...bottom)) / 2 : 0,
    up: height / 2,
  };
  // A fairly close eye: the nearer the eye, the stronger the perspective, so near cards grow and the
  // far end shrinks. Too far back and the scene flattens into an angled plan view.
  const dist = extent * 0.95;
  return { camera: { pitch: PITCH, yaw: YAW, dist, f: dist }, aim, anchor: { x: aim.x, y: aim.y }, height };
}

/**
 * The scene for a window: where every card is drawn and how big, the group rectangles on the ground,
 * the time bars standing on it, each raised card's drop line, and the ruler.
 *
 * `timeOf` gives a card's position in time (its update time); a card with no time stands on the
 * ground, since the ruler has nothing to say about when it happened. A group is not floated: its
 * children rise to their own times, so no one panel can hold them, and the group is drawn as a
 * rectangle on the ground instead — which is also what gives the ground a meaning, the map's own
 * shape, with time rising out of it.
 */
export function depthScene(
  boxes: DepthBox[],
  focus: Focus,
  timeOf: (key: string) => number | undefined,
  ribbonOf: (key: string) => Ribbon | null,
  /** True for a group, whose children are drawn instead of it and which lies on the ground. */
  isGroup: (key: string) => boolean,
): DepthScene {
  const view = makeView(boxes);
  const at = new Map<string, Projected>();
  const drops: { key: string; from: Point; to: Point }[] = [];
  const bars: Bar[] = [];
  const footprints: Footprint[] = [];
  const up = new Map<string, number>();
  for (const b of boxes) {
    const t = timeOf(b.key);
    up.set(b.key, t === undefined ? 0 : elevationPx(t, focus, view.height));
  }
  // The ruler stands off the map's older edge, where it cannot cover a card.
  const rulerFoot: Point = boxes.length
    ? { x: Math.min(...boxes.map((b) => b.x)) - 150, y: Math.max(...boxes.map((b) => b.y + b.height)) }
    : { x: 0, y: 0 };
  const ground = (p: Point) => {
    const q = projectPoint(view, { x: p.x, y: p.y, up: 0 });
    return { x: q.x, y: q.y };
  };

  for (const b of boxes) {
    const group = isGroup(b.key);
    // A group lies on the ground as a rectangle; a card floats above it as a billboard.
    if (group) {
      const corners = [ground({ x: b.x, y: b.y }), ground({ x: b.x + b.width, y: b.y }),
        ground({ x: b.x + b.width, y: b.y + b.height }), ground({ x: b.x, y: b.y + b.height })];
      const c = ground({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      footprints.push({ key: b.key, points: corners, labelAt: c, label: b.label ?? "" });
      // Its header rides above the ground at the group's own time, so a group can still be read,
      // clicked and folded where it belongs in time.
      const hc: Point3 = { x: b.x + HEADER_W / 2, y: b.y + HEADER_H / 2, up: up.get(b.key)! + HEADER_H / 2 };
      at.set(b.key, projectTopLeft(view, hc, HEADER_W, HEADER_H));
    } else {
      const centre: Point3 = { x: b.x + b.width / 2, y: b.y + b.height / 2, up: up.get(b.key)! + b.height / 2 };
      at.set(b.key, projectTopLeft(view, centre, b.width, b.height));
    }
    const u = up.get(b.key)!;
    // A line straight down to the ground, so a card's height reads against the ruler; a group's
    // header gets one too, since it is the group's own time.
    if (u > 0) {
      const p = at.get(b.key)!;
      const w = group ? HEADER_W : b.width, h = group ? HEADER_H : b.height;
      const g = ground({ x: group ? b.x + HEADER_W / 2 : b.x + b.width / 2, y: group ? b.y + HEADER_H / 2 : b.y + b.height / 2 });
      drops.push({ key: b.key, from: { x: p.x + (w * p.scale) / 2, y: p.y + (h * p.scale) / 2 }, to: g });
    }
    const r = ribbonOf(b.key);
    if (!r) continue;
    // The bar rises from the ground to the height of its own length, drawn on the square-root scale
    // above. A plan's own start is the ground, so a todo's bar is its estimate alone.
    const span = focus.span;
    const lo = 0;
    const hi = barHeight(Math.abs(r.to - r.from) / span, view.height);
    const half = BAR_W / 2;
    const gx = group ? b.x + HEADER_W / 2 : b.x + b.width / 2;
    const gy = group ? b.y + HEADER_H / 2 : b.y + b.height / 2;
    const corner = (dx: number, h: number) => {
      const q = projectPoint(view, { x: gx + dx, y: gy, up: h });
      return { x: q.x, y: q.y };
    };
    const points = [corner(-half, lo), corner(half, lo), corner(half, hi), corner(-half, hi)];
    const state = r.state === "over" ? " (over)" : r.state === "near" ? " (nearly due)" : "";
    bars.push({
      ...r, key: b.key, at: { x: gx, y: gy }, upFrom: lo, upTo: hi, points,
      labelAt: { x: (points[0]!.x + points[2]!.x) / 2, y: (points[0]!.y + points[2]!.y) / 2 + 4 },
      title: `${ribbonLabel(r)}${state}\n${absoluteTime(r.from)} → ${absoluteTime(r.to)}`,
    });
  }

  // Far to near, so a nearer card is drawn over a farther one.
  const order = [...at.entries()].sort((a, b) => b[1].dist - a[1].dist).map(([k]) => k);

  const ticks = axisTicks(focus, view.height);
  const ruler: Ruler = {
    foot: rulerFoot,
    ticks: ticks.map((t) => {
      const q = projectPoint(view, { x: rulerFoot.x, y: rulerFoot.y, up: t.up });
      return { ...t, at: q, labelAt: { x: q.x - TICK_LEN - 6, y: q.y - 2 } };
    }),
    caption: formatDuration(Math.max(0, focus.span)),
    captionAt: ground(rulerFoot),
  };

  // The visible ground: the layout's own extent, at the window's older end.
  // The ground is margin-ed in from the layout's own extent, not padded out to it: it is a reference
  // plane, and stretching it to the corners of the map only pulls the framing zoom further out.
  const x0 = boxes.length ? Math.min(...boxes.map((b) => b.x)) + 40 : -300;
  const x1 = boxes.length ? Math.max(...boxes.map((b) => b.x + b.width)) - 40 : 300;
  const y0 = boxes.length ? Math.min(...boxes.map((b) => b.y)) + 40 : -300;
  const y1 = boxes.length ? Math.max(...boxes.map((b) => b.y + b.height)) - 40 : 300;
  const groundQuad = [ground({ x: x0, y: y0 }), ground({ x: x1, y: y0 }), ground({ x: x1, y: y1 }), ground({ x: x0, y: y1 })];

  // Bounds for framing the view: the cards and their bars only. The ground and the ruler are made
  // to overflow the frame on purpose — including them would pull the zoom far enough out that a
  // card is a few pixels tall. The boxes are taken in the same header size the cards are drawn at.
  const all = [
    ...[...at.entries()].map(([k, p]) => {
      const box = boxes.find((b) => b.key === k)!;
      const w = isGroup(k) ? HEADER_W : box.width, h = isGroup(k) ? HEADER_H : box.height;
      return [{ x: p.x, y: p.y }, { x: p.x + w * p.scale, y: p.y + h * p.scale }];
    }).flat(),
    ...bars.flatMap((b) => b.points),
  ];
  const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
  return { at, order, drops, bars, ruler, footprints, ground: groundQuad, view, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}
