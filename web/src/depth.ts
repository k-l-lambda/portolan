// The 3D view's geometry (the `3D` toggle in DocView): time is a horizontal axis running through
// the map, and every card is a real panel standing in its own moment.
//
//   * World axes: `t` along time, `d` across (the layout's x) and `h` up (the layout's y, flipped).
//     The flat layout is kept whole inside each moment: a card is the rectangle its layout box
//     covers in the (d, h) plane, set at its own time along `t`. So a panel's face is orthogonal
//     to the time axis, and two cards at the same time share one plane.
//   * The eye stands to the newer side of the scene and a little above it, its line of sight at
//     about 45° to the time axis. Time then runs roughly level across the screen, oldest on the
//     left, newest nearest the eye on the right, and each panel is seen at an angle — foreshortened
//     and converging, not a flat label. A card's title is shown flat on hover (DocView).
//   * The flat view's camera decides everything. The cards inside its frame (what the navigator
//     frames, the focus nodes) give the window: the stretch of time they span. The time axis is
//     then given the length that makes the focus nodes' 3D bounding box the shape of the display,
//     and the scene is scaled and placed so that box fills the frame (see `targetPose`). Times
//     outside the window are not clamped onto its edge but squeezed into short tails.
//   * A `Pose` is everything that places the scene. At `blend` 0 it is the flat view exactly —
//     every card in one plane, seen square on, at 1:1 — so the change between 2D and 3D is a
//     camera move from one pose to the other (`blendPose`), not a cut.
//
// A panel's exact shape is the perspective image of its rectangle, which is a projective map of
// the plane; it is written as a CSS `matrix3d` on the card itself (`Panel.matrix`). The flow's
// panes are never given a 3D transform: that would tilt xyflow's pan and zoom maths with them, so
// dragging would stop following the pointer and the navigator would frame the wrong region.
//
// Everything here is pure — the camera, the window, the ticks and the bars all fall out of the
// times and the layout — so it can be tested without a browser.

import { formatDuration, sharePercent, timingOf, type Timing } from "../../src/timing.ts";
import type { RhumbNode } from "../../src/types.ts";
import { HEADER_H, HEADER_W } from "./layout.ts";
import { absoluteTime } from "./time.ts";

/** Seconds in a day and in a Julian year, as the map's duration form does. */
const DAY = 86_400;
const YEAR = 365 * DAY;
/** A Date holds about ±273,000 years around 1970; past that, ticks are placed by arithmetic. */
const DATE_MIN = -8.6e12;
const DATE_MAX = 8.6e12;
/** Screen distance wanted between two ruler ticks, in screen pixels. */
export const TICK_GAP = 90;
/** Opacity the farthest panel loses against the nearest. */
const FOG = 0.55;

/** The time window on show: `to` is its newest end, `span` how far back it reaches. */
export interface Focus {
  to: number;
  span: number;
}

/** A region of the map, in layout or flow coordinates. */
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

/** A point in the scene: `t` along time, `d` across, `h` up. */
export interface Point3 {
  t: number;
  d: number;
  h: number;
}

/** One laid-out card, as the projection takes it. */
export interface DepthBox {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a point lands on screen, how big it is drawn there, and how far it is from the eye. */
export interface Projected {
  x: number;
  y: number;
  /** Size against the layout's own: 1 at 1:1. */
  scale: number;
  /** Distance from the eye along the line of sight. */
  dist: number;
}

/**
 * The camera. `pitch` is how far the line of sight dips below level, and `azimuth` its angle from
 * the time axis seen from above, so the angle between the line of sight and the time axis is
 * `acos(cos(azimuth)·cos(pitch))` — `SIGHT` by default. `dist` is the eye's distance from the aim
 * point and `f` its focal length in world pixels; `f = dist` keeps the aim point at 1:1.
 */
export interface Camera {
  pitch: number;
  azimuth: number;
  dist: number;
  f: number;
}

/** A camera plus what it looks at, the length the window is given along time, and the fit. */
export interface View {
  camera: Camera;
  aim: Point3;
  /** Screen position of the aim point, in flow coordinates. */
  anchor: Point;
  /** The scale the scene is drawn at after the perspective, so it fills the flat view's frame. */
  sigma: number;
  /** World length of the focus window along `t`. */
  length: number;
  focus: Focus;
}

/** Angle between the line of sight and the time axis, by default: 45°. */
export const SIGHT = Math.PI / 4;
/** The line of sight dips about 3.5° below level. The eye already stands near the floor, so the
 *  floor is seen from above without help; every degree of pitch tilts the time axis by about as
 *  much, so it is kept small for the axis to read as level. */
export const PITCH = 0.06;
/** The azimuth that, with `PITCH`, puts the line of sight at `SIGHT` to the time axis. */
export const AZIMUTH = Math.acos(Math.cos(SIGHT) / Math.cos(PITCH));

/** Gap between the lowest card and the floor, and between the floor's near edge and the ruler. */
const FLOOR_GAP = 70;
const RULER_GAP = 60;
/** Height of the eye above the floor, as a share of the layout's height: enough to see the floor
 *  as a sheet, low enough that the ruler on it stays level. */
const EYE_RISE = 0.12;

/** Share of the axis each tail takes for times outside the window, so they stay in order. */
const TAIL = 0.12;

/**
 * Position of a moment along the time axis: 0 at the window's oldest end, 1 at its newest. Inside
 * the window it is linear; outside, it is squeezed into a tail of at most `TAIL` either side, so a
 * card from the age of the dinosaurs on a map of last week still sits before it rather than miles
 * off the screen or piled onto the window's edge.
 */
export function axisU(time: number, focus: Focus): number {
  const u = (time - (focus.to - focus.span)) / focus.span;
  if (u >= 0 && u <= 1) return u;
  const over = u < 0 ? -u : u - 1;
  const squeezed = TAIL * (1 - 1 / (1 + over / TAIL));
  return u < 0 ? -squeezed : 1 + squeezed;
}

/** The camera's own frame: forward along the line of sight, right and up across the screen. */
function frame(camera: Camera) {
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const ca = Math.cos(camera.azimuth), sa = Math.sin(camera.azimuth);
  // The eye is on the newer side (+t), the small-d side and above, so it looks back along −t,
  // across +d and down. Right is level and, with up, keeps a panel's text reading the right way
  // round: its +d edge to the right, its top edge up. At pitch and azimuth 0 this is the flat
  // view's own frame: right is the layout's x and up its −y.
  return {
    fwd: { t: -ca * cp, d: sa * cp, h: -sp },
    right: { t: sa, d: ca, h: 0 },
    up: { t: -ca * sp, d: sa * sp, h: cp },
  };
}

const dot = (a: Point3, b: Point3) => a.t * b.t + a.d * b.d + a.h * b.h;

/**
 * Perspective projection of a world point, then the fit: scaled by `sigma` about the aim point and
 * placed at `anchor`. A point at or behind the eye is held just in front of it rather than
 * flipping through to the far side, which would throw a card across the screen.
 */
export function projectPoint(view: View, p: Point3): Projected {
  const { camera, aim, anchor, sigma } = view;
  const { fwd, right, up } = frame(camera);
  const o = { t: p.t - aim.t, d: p.d - aim.d, h: p.h - aim.h };
  const eye = Math.max(camera.dist * 0.15, camera.dist + dot(o, fwd));
  const k = (sigma * camera.f) / eye;
  return { x: anchor.x + dot(o, right) * k, y: anchor.y - dot(o, up) * k, scale: k, dist: eye };
}

/** A card drawn as a panel standing in its own moment. */
export interface Panel {
  /** Screen corners: top-left, top-right, bottom-right, bottom-left. */
  quad: Point[];
  /** The quad's bounding box, which is where the card's node sits and how big it is. */
  box: Rect;
  /** The CSS `matrix3d(...)` that carries the card's own rectangle onto `quad`, from `box`'s corner. */
  matrix: string;
  /** Size the card is laid out at before the matrix: its layout box. */
  width: number;
  height: number;
  /** Distance of the panel's centre from the eye. */
  dist: number;
  /** Opacity against the nearest panel, in [0, 1]. */
  fog: number;
  /** The panel's position along time, for leaning relation lines. */
  t: number;
  /** A group's header, the part of its frame that carries its title: where its hover title goes. */
  header?: Point[];
}

/**
 * The panel for a rectangle `width` × `height` whose top-left corner is at layout (x, y), at world
 * position `t` along time. The image of a plane under perspective is a projective map
 * (u, v) ↦ ((a·u + b·v + c) / (g·u + h·v + 1), …), and that is exactly what a CSS `matrix3d` with a
 * perspective row computes, so the card's own DOM — text, buttons, hit area — is drawn on the
 * panel's true shape.
 */
export function panelAt(view: View, x: number, y: number, t: number, width: number, height: number): Omit<Panel, "fog"> {
  const corner = (u: number, v: number) => projectPoint(view, { t, d: x + u, h: -(y + v) });
  const quad = [corner(0, 0), corner(width, 0), corner(width, height), corner(0, height)].map((q) => ({ x: q.x, y: q.y }));
  const xs = quad.map((q) => q.x), ys = quad.map((q) => q.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };

  // Screen position of the card's local point (u, v), before the perspective divide:
  //   X·w = X0 + Xu·u + Xv·v,  Y·w = Y0 + Yu·u + Yv·v,  w = W0 + Wu·u + Wv·v
  // since a point's screen offset is σ·f·(o·right)/(dist + o·fwd) and o is linear in u and v.
  const { camera, aim, anchor, sigma } = view;
  const { fwd, right, up } = frame(camera);
  const o0 = { t: t - aim.t, d: x - aim.d, h: -y - aim.h };
  const ou = { t: 0, d: 1, h: 0 }, ov = { t: 0, d: 0, h: -1 };
  const f = sigma * camera.f;
  const W0 = camera.dist + dot(o0, fwd), Wu = dot(ou, fwd), Wv = dot(ov, fwd);
  // Measured from the box's corner, which is where xyflow places the node.
  const ax = anchor.x - box.x, ay = anchor.y - box.y;
  const X0 = f * dot(o0, right) + ax * W0, Xu = f * dot(ou, right) + ax * Wu, Xv = f * dot(ov, right) + ax * Wv;
  const Y0 = -f * dot(o0, up) + ay * W0, Yu = -f * dot(ou, up) + ay * Wu, Yv = -f * dot(ov, up) + ay * Wv;
  // CSS matrix3d is column-major: columns are the images of x, y, z and the translation. Divided
  // through by W0, so the matrix maps the card's corner with w = 1.
  const n = (v: number) => Number((v / W0).toPrecision(9));
  const m = [n(Xu), n(Yu), 0, n(Wu), n(Xv), n(Yv), 0, n(Wv), 0, 0, 1, 0, n(X0), n(Y0), 0, 1];
  const centre = projectPoint(view, { t, d: x + width / 2, h: -(y + height / 2) });
  return { quad, box, matrix: `matrix3d(${m.join(",")})`, width, height, dist: centre.dist, t };
}

/**
 * Apply a `matrix3d` string to a local point, as the browser does: the check that the matrix and
 * the quad agree, for the tests and for anyone reading a panel's maths.
 */
export function applyMatrix(matrix: string, u: number, v: number): Point {
  const m = matrix.slice(9, -1).split(",").map(Number);
  const w = m[3]! * u + m[7]! * v + m[15]!;
  return { x: (m[0]! * u + m[4]! * v + m[12]!) / w, y: (m[1]! * u + m[5]! * v + m[13]!) / w };
}

/**
 * Everything that places the scene, as numbers that can be blended. `blend` runs from 0, the flat
 * view, to 1, the full 3D view: it turns the camera, lengthens time, and fades the floor in.
 */
export interface Pose {
  blend: number;
  pitch: number;
  azimuth: number;
  /** World length of the window along time. */
  length: number;
  dist: number;
  sigma: number;
  aim: Point3;
  anchor: Point;
  focus: Focus;
  /** The floor's height, the ruler's place across it, and the floor's far edge. */
  floorH: number;
  ruler: number;
  floorFar: number;
  /** Each timer bar's lane under its card (0 nearest), and the height between lanes: bars whose
   *  stretches would cross on screen are stacked, as on a Gantt chart. */
  lanes: Record<string, number>;
  lanePitch: number;
  /** One screen pixel in the scene's own units, as fitted: bars keep a least size on screen in it. */
  px: number;
}

/** The view a pose puts the scene in. */
export function viewOf(pose: Pose): View {
  return {
    camera: { pitch: pose.pitch, azimuth: pose.azimuth, dist: pose.dist, f: pose.dist },
    aim: pose.aim, anchor: pose.anchor, sigma: pose.sigma, length: pose.length, focus: pose.focus,
  };
}

/**
 * The flat view as a pose: square on, time of no length, at 1:1, so every point lands on its own
 * layout position. `like` lends it the window and the floor of the pose it leaves for or comes from,
 * so blending the two changes only what has to change.
 */
export function flatPose(like: Pose): Pose {
  return {
    ...like, blend: 0, pitch: 0, azimuth: 0, length: 0, sigma: 1,
    aim: { t: 0, d: like.aim.d, h: like.aim.h }, anchor: { x: like.aim.d, y: -like.aim.h },
  };
}

const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const glerp = (a: number, b: number, s: number) => (a > 0 && b > 0 ? a * Math.pow(b / a, s) : lerp(a, b, s));

/**
 * A pose between two, at `s` from 0 to 1. Lengths and scales are blended geometrically, so a move
 * between a narrow window and a wide one zooms at an even rate rather than all at one end.
 */
export function blendPose(a: Pose, b: Pose, s: number): Pose {
  const p3 = (p: Point3, q: Point3) => ({ t: lerp(p.t, q.t, s), d: lerp(p.d, q.d, s), h: lerp(p.h, q.h, s) });
  return {
    blend: lerp(a.blend, b.blend, s),
    pitch: lerp(a.pitch, b.pitch, s),
    azimuth: lerp(a.azimuth, b.azimuth, s),
    length: a.length === 0 || b.length === 0 ? lerp(a.length, b.length, s) : glerp(a.length, b.length, s),
    dist: glerp(a.dist, b.dist, s),
    sigma: glerp(a.sigma, b.sigma, s),
    aim: p3(a.aim, b.aim),
    anchor: { x: lerp(a.anchor.x, b.anchor.x, s), y: lerp(a.anchor.y, b.anchor.y, s) },
    focus: { to: lerp(a.focus.to, b.focus.to, s), span: glerp(a.focus.span, b.focus.span, s) },
    floorH: lerp(a.floorH, b.floorH, s),
    ruler: lerp(a.ruler, b.ruler, s),
    floorFar: lerp(a.floorFar, b.floorFar, s),
    // Lanes are whole numbers: they take the destination's at once. The floor layer is faded at
    // the start of a move from the flat view, so the change is not seen there.
    lanes: b.lanes,
    lanePitch: lerp(a.lanePitch, b.lanePitch, s),
    px: glerp(a.px, b.px, s),
  };
}

/** Ease in and out, for camera moves. */
export const ease = (s: number) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2);

/** What a tick's label counts in; the coarsest unit that still separates its neighbours. */
export type TickUnit = "hour" | "day" | "month" | "year";

export interface Tick {
  time: number;
  /** Position along the time axis, 0 at the window's oldest end and 1 at its newest. */
  u: number;
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

export type RibbonKind = "actual" | "running" | "estimate";

/**
 * A node's timer bar along the time axis, under its card: what the work took, how far it has run
 * against its plan, or what it is expected to take.
 */
export interface Ribbon {
  kind: RibbonKind;
  /** The solid part: the run itself, from its start to its finish or to now. For an estimate, the
   *  planned stretch, drawn as an outline rather than solid. */
  from: number;
  to: number;
  /** For a run in progress with an estimate: the planned stretch, from its start to start plus the
   *  estimate, which the run is a progress bar along. */
  plan?: { from: number; to: number };
  /** Against its estimate, so a run in progress carries the colour the flat view gives it. */
  state: Timing["state"];
  /** The text written on it, in the chip's own short form: `4d23h`, `40m/2h`, `est. 5w`. */
  label: string;
  /** The longer form, for the bar's tooltip: `took 4d23h`, `40m of 2h estimated (33%)`. */
  detail: string;
  /** For a folded done node without its own times: how many timed items inside it the run was
   *  read from. Its bar is then a span of their work, not a measurement of its own. */
  inferred?: number;
}

/** The bar's tooltip text. */
export function ribbonLabel(r: Ribbon): string {
  return r.detail;
}

/**
 * The timer bar for a node, by what it is:
 *   - done (or any closed run): its real start to its real finish, solid — what it really took.
 *     A done node without both times draws nothing: its timing is not a measurement.
 *   - doing: a progress bar. The solid run goes from its start to now, over a track of the planned
 *     stretch (start to start plus the estimate); past the end of the track the run is overtime.
 *     Without an estimate it is the run alone; without a start, the estimate alone.
 *   - anything else with an estimate: an outline of that length, from its start if it has one,
 *     else from the node's own time — a plan, not a measurement.
 * Null when there is nothing timed to show.
 */
export function ribbonFor(timing: Timing | null, status: string | null, own: number, now: number): Ribbon | null {
  if (!timing) return null;
  const { estimate, started } = timing;
  if (status === "doing" && started !== null) {
    const elapsed = timing.elapsed ?? Math.max(0, now - started);
    if (estimate === null) {
      return { kind: "running", from: started, to: now, state: null, label: formatDuration(elapsed), detail: `running ${formatDuration(elapsed)}, no estimate` };
    }
    const pct = sharePercent(elapsed, estimate);
    const over = elapsed > estimate ? `, ${formatDuration(elapsed - estimate)} over` : "";
    return {
      kind: "running", from: started, to: now, plan: { from: started, to: started + estimate }, state: timing.state,
      label: `${formatDuration(elapsed)}/${formatDuration(estimate)}`,
      detail: `${formatDuration(elapsed)} of ${formatDuration(estimate)} estimated (${pct}%${over})`,
    };
  }
  if (timing.closed) {
    const took = formatDuration(timing.elapsed!);
    const vs = estimate !== null ? ` against ${formatDuration(estimate)} estimated` : "";
    return { kind: "actual", from: started!, to: timing.finished!, state: null, label: took, detail: `took ${took}${vs}` };
  }
  if (status === "done") return null;
  if (estimate !== null) {
    const from = started ?? own;
    return { kind: "estimate", from, to: from + estimate, state: null, label: `est. ${formatDuration(estimate)}`, detail: `estimated ${formatDuration(estimate)}` };
  }
  return null;
}

/**
 * The span of finished work inside a node: from the earliest start to the latest finish among its
 * descendants that have both (any status other than doing, as `timingOf` counts a closed run).
 * Every descendant counts, however deep, so a folded group holding folded groups still spans all
 * of its work. Null when nothing inside has a finished run.
 */
export function innerRun(node: Pick<RhumbNode, "children">, now: number): { from: number; to: number; count: number } | null {
  let from = Infinity, to = -Infinity, count = 0;
  const walk = (ns: Pick<RhumbNode, "children" | "attrs" | "status">[]) => {
    for (const n of ns) {
      const t = timingOf(n, now);
      if (t?.closed) (from = Math.min(from, t.started!), to = Math.max(to, t.finished!), count++);
      walk(n.children);
    }
  };
  walk(node.children);
  return count ? { from, to, count } : null;
}

/**
 * A node's timer bar, as `ribbonFor` gives it, with one addition: a done node that is folded and
 * has no times of its own takes its start and finish from the work inside it (`innerRun`). A time
 * it does have is kept, and only the missing end is read from inside. Folded only: an unfolded
 * group's children are drawn with their own bars, and a bar for the group would repeat them.
 */
export function nodeRibbon(node: RhumbNode, folded: boolean, own: number, now: number): Ribbon | null {
  const timing = timingOf(node, now);
  const r = ribbonFor(timing, node.status, own, now);
  if (r || node.status !== "done" || !folded || timing?.closed) return r;
  const inner = innerRun(node, now);
  if (!inner) return null;
  const from = timing?.started ?? inner.from, to = timing?.finished ?? inner.to;
  if (to < from) return null;
  const took = formatDuration(to - from);
  const items = `${inner.count} timed item${inner.count === 1 ? "" : "s"} inside`;
  const vs = timing?.estimate != null ? ` against ${formatDuration(timing.estimate)} estimated` : "";
  return {
    kind: "actual", from, to, state: null, inferred: inner.count,
    label: `${took} · ${inner.count} inside`,
    detail: `took ${took}${vs}, read from the ${items}`,
  };
}

/**
 * Ticks along the time axis, newest first: the boundary crossed, its position, its text, and
 * whether it falls on a boundary bigger than its step. About `count` of them are placed, each on
 * a real calendar boundary, so the labels read as dates rather than as an even division of the window.
 */
export function axisTicks(focus: Focus, count: number): Tick[] {
  // The step whose tick count lands nearest the target, counting both ends. Comparing counts rather
  // than ratios matters: a step that looks nearest in ratio can still put half again as many ticks
  // on the axis as wanted, and they then crowd each other.
  const target = Math.max(2, count);
  const n = (step: number) => focus.span / step + 1;
  const [step, unit] = STEPS.reduce((best, s) => (Math.abs(n(s[0]) - target) < Math.abs(n(best[0]) - target) ? s : best));
  const oldest = focus.to - focus.span;
  const out: Tick[] = [];
  const add = (time: number, label: string, major: boolean) => {
    // Only ticks inside the window: one beyond it would sit in a squeezed tail and crowd the edge.
    if (time > focus.to || time < oldest) return;
    out.push({ time, u: axisU(time, focus), label, major });
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


/** Height of a time bar, and its gap below the card it belongs to, in world pixels. */
const BAR_H = 16;
const BAR_GAP = 8;
/** Narrowest a bar is drawn, so a minute's work on a year's axis is still a mark. */
const BAR_MIN = 6;
/** The least a bar is drawn on screen, in screen pixels, however far out the view is zoomed: a
 *  bar in world units alone shrinks with the map, and on a large map at its fitted zoom a
 *  16-unit bar is two pixels tall and an hour's work on a ten-day axis less than one wide. */
const BAR_MIN_PX = { h: 7, w: 10, gap: 3 };
/** A bar's thickness, least length and gap under its card, for a scene where a pixel is `px`. */
const barSize = (px: number) => ({
  h: Math.max(BAR_H, BAR_MIN_PX.h * px),
  w: Math.max(BAR_MIN, BAR_MIN_PX.w * px),
  gap: Math.max(BAR_GAP, BAR_MIN_PX.gap * px),
});

/** A timer bar along the axis, just under its card: what the work took, is taking, or plans to. */
export interface Bar extends Ribbon {
  key: string;
  /** Screen quads, each older-top, newer-top, newer-bottom, older-bottom:
   *  `track` the planned stretch (an estimate, or a run's plan), drawn as an outline;
   *  `fill` the run itself, solid, up to the end of its plan;
   *  `over` the part of a run past the end of its plan. */
  track?: Point[];
  fill?: Point[];
  over?: Point[];
  /** Every corner, for framing. */
  points: Point[];
  /** Where the run stands now, for a run in progress: a mark across the bar. */
  nowAt?: [Point, Point];
  /** The bar's projection on the floor, part by part: lines along the time axis under the bar,
   *  from the older end to the newer, so a stretch of time can be read against the ruler. */
  ground?: { track?: [Point, Point]; fill?: [Point, Point]; over?: [Point, Point] };
  labelAt: Point;
  title: string;
}

/** The floor's screen corners: oldest-near, newest-near, newest-far, oldest-far. */
export interface Floor {
  quad: Point[];
}

/** Everything the 3D view draws. */
export interface DepthScene {
  /** Each card's panel, by node key. A group's panel is its whole frame. */
  panels: Map<string, Panel>;
  /** Node keys far to near, for the stacking order. */
  order: string[];
  /** A line from each card's foot straight down to the floor, so its moment can be read off it. */
  drops: { key: string; from: Point; to: Point }[];
  /** Each item's projection on the floor: the line its panel stands on, across the item's width at
   *  its own moment, from its left edge (`from`) to its right. Where an item's drop line lands. */
  shadows: { key: string; from: Point; to: Point }[];
  bars: Bar[];
  floor: Floor;
  view: View;
  pose: Pose;
}

/** A card's world position along time: its own moment, or the window's newest end without one. */
const trackOf = (view: View, time: number | undefined) => axisU(time ?? view.focus.to, view.focus) * view.length;

/** Width and height a box is drawn at in the 3D view: a group's frame, but only its header counts
 *  as its card when choosing what is framed. */
const headerOf = (b: DepthBox) => ({ width: Math.min(HEADER_W, b.width), height: Math.min(HEADER_H, b.height) });

/** The bar for a ribbon under a box, at the box's own centre across. */
function barFor(view: View, b: DepthBox, foot: number, r: Ribbon, key: string, lane = 0, pitch = 0, px = 0, floorH?: number): Bar {
  const size = barSize(px);
  const at = (t: number, h: number) => {
    const q = projectPoint(view, { t, d: b.x + b.width / 2, h });
    return { x: q.x, y: q.y };
  };
  const track = (time: number) => axisU(time, view.focus) * view.length;
  /** A stretch along time, widened to the least length so a minute's work on a year's axis is a mark. */
  const span = (from: number, to: number): [number, number] => {
    let t0 = track(from), t1 = track(to);
    if (t1 - t0 < size.w) (t0 = (t0 + t1) / 2 - size.w / 2, t1 = t0 + size.w);
    return [t0, t1];
  };
  const top = foot - size.gap - lane * pitch, bot = top - size.h;
  const quad = ([t0, t1]: [number, number]) => [at(t0, top), at(t1, top), at(t1, bot), at(t0, bot)];
  const out: Pick<Bar, "track" | "fill" | "over" | "nowAt"> = {};
  /** The same stretch on the floor, under the bar, when the floor's height is known. */
  const onFloor = ([t0, t1]: [number, number]): [Point, Point] | undefined => (floorH === undefined ? undefined : [at(t0, floorH), at(t1, floorH)]);
  const ground: NonNullable<Bar["ground"]> = {};
  let whole: [number, number];
  if (r.kind === "estimate") {
    whole = span(r.from, r.to);
    out.track = quad(whole);
    ground.track = onFloor(whole);
  } else if (r.plan) {
    // A progress bar: the track is the plan; the run fills it from its start up to now, and any
    // of the run beyond the plan's end is overtime.
    const plan = span(r.plan.from, r.plan.to);
    const now = track(r.to);
    const filled: [number, number] = [plan[0], Math.max(plan[0] + 1, Math.min(now, plan[1]))];
    out.track = quad(plan);
    out.fill = quad(filled);
    ground.track = onFloor(plan);
    ground.fill = onFloor(filled);
    if (now > plan[1]) (out.over = quad([plan[1], now]), ground.over = onFloor([plan[1], now]));
    out.nowAt = [at(now, top + 3), at(now, bot - 3)];
    whole = [plan[0], Math.max(plan[1], now)];
  } else {
    whole = span(r.from, r.to);
    out.fill = quad(whole);
    ground.fill = onFloor(whole);
    if (r.kind === "running") out.nowAt = [at(whole[1], top + 3), at(whole[1], bot - 3)];
  }
  const state = r.state === "over" ? " — over" : r.state === "near" ? " — nearly due" : "";
  const end = r.kind === "running" ? "now" : absoluteTime(r.to);
  return {
    ...r, key, ...out,
    ...(floorH === undefined ? {} : { ground }),
    points: quad(whole),
    // At the bar's newer end, beside it rather than under it, so stacked lanes do not need room
    // for text between them; DepthFloor sets it off by a few screen pixels.
    labelAt: at(whole[1], (top + bot) / 2),
    title: `${ribbonLabel(r)}${state}\n${absoluteTime(r.plan?.from ?? r.from)} → ${end}`,
  };
}

/** Where a box's own foot is: the bottom of a card, the bottom of a group's header. */
const footOf = (b: DepthBox, group: boolean) => -(b.y + (group ? headerOf(b).height : b.height));

/**
 * The scene in a pose: a panel for every card at its own moment, the bars under the timed ones, a
 * drop line from each card to the floor, and the floor itself.
 *
 * `timeOf` gives a card's moment (its update time); a card without one stands at the window's
 * newest end. A group is drawn as its whole frame at the group's own moment, as in the flat view:
 * its children stand at their own moments, in front of or behind it.
 */
export function depthScene(
  boxes: DepthBox[],
  pose: Pose,
  timeOf: (key: string) => number | undefined,
  ribbonOf: (key: string) => Ribbon | null,
  isGroup: (key: string) => boolean,
): DepthScene {
  const view = viewOf(pose);
  const raw = new Map<string, Omit<Panel, "fog">>();
  for (const b of boxes) {
    const t = trackOf(view, timeOf(b.key));
    const p = panelAt(view, b.x, b.y, t, b.width, b.height);
    if (isGroup(b.key)) {
      const h = headerOf(b);
      p.header = panelAt(view, b.x, b.y, t, h.width, h.height).quad;
    }
    raw.set(b.key, p);
  }

  // Fog by distance, normalised against the scene's own nearest and farthest panel, and faded in
  // with the blend: in the flat pose every panel is at the same distance and none is fogged.
  const dists = [...raw.values()].map((p) => p.dist);
  const near = Math.min(...dists), far = Math.max(...dists);
  const panels = new Map<string, Panel>();
  for (const [k, p] of raw) {
    const fog = far > near ? 1 - FOG * pose.blend * ((p.dist - near) / (far - near)) : 1;
    panels.set(k, { ...p, fog });
  }
  // Far to near. Ties (the flat pose, where every panel is equally far) fall back to the flat
  // view's own order: frames below cards, outer frames below inner ones.
  const index = new Map(boxes.map((b, i) => [b.key, i]));
  const order = [...panels.entries()].sort((a, b) => {
    const d = b[1].dist - a[1].dist;
    if (Math.abs(d) > 1e-6) return d;
    const ga = isGroup(a[0]) ? 0 : 1, gb = isGroup(b[0]) ? 0 : 1;
    return ga - gb || index.get(a[0])! - index.get(b[0])!;
  }).map(([k]) => k);

  const at = (t: number, d: number, h: number) => {
    const q = projectPoint(view, { t, d, h });
    return { x: q.x, y: q.y };
  };
  const drops: DepthScene["drops"] = [];
  const shadows: DepthScene["shadows"] = [];
  const bars: Bar[] = [];
  for (const b of boxes) {
    const group = isGroup(b.key);
    const p = panels.get(b.key)!;
    const w = group ? headerOf(b).width : b.width;
    const box = { ...b, width: w };
    const foot = footOf(b, group);
    const r = ribbonOf(b.key);
    let below = foot;
    if (r) {
      const lane = pose.lanes[b.key] ?? 0;
      const size = barSize(pose.px);
      bars.push(barFor(view, box, foot, r, b.key, lane, pose.lanePitch, pose.px, pose.floorH));
      below = foot - size.gap - lane * pose.lanePitch - size.h;
    }
    // Only a card above the floor drops a line to it; the floor is under the frame's own cards.
    // The line the panel stands on, across its whole width at its moment.
    shadows.push({ key: b.key, from: at(p.t, b.x, pose.floorH), to: at(p.t, b.x + b.width, pose.floorH) });
    if (below > pose.floorH) drops.push({ key: b.key, from: at(p.t, b.x + w / 2, below), to: at(p.t, b.x + w / 2, pose.floorH) });
  }

  const floor: Floor = {
    quad: [at(-TAIL * view.length, pose.ruler, pose.floorH), at((1 + TAIL) * view.length, pose.ruler, pose.floorH),
      at((1 + TAIL) * view.length, pose.floorFar, pose.floorH), at(-TAIL * view.length, pose.floorFar, pose.floorH)],
  };
  return { panels, order, drops, shadows, bars, floor, view, pose };
}

/** Smallest window allowed, so a run of edits in one minute does not become a microscope. */
const MIN_SPAN = 600;
/** Share of the moments the window must hold; the rest may fall into the squeezed tails. */
const KEEP = 0.85;

/**
 * The window that frames these moments: the shortest stretch of time holding `KEEP` of them, with
 * a small margin each side so the outermost cards are not cut by the display's edge. Taking the
 * shortest such stretch rather than oldest-to-newest is what keeps one outlier from ruining the
 * view: a map of this century with one card dated to the Stone Age would otherwise spend the whole
 * axis on the gap between them, and pile every other card onto its newest end. The outliers still
 * stand in order, in the tails. Null for no moments.
 */
export function fitFocus(times: number[]): Focus | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const m = sorted.length <= 4 ? sorted.length : Math.ceil(sorted.length * KEEP);
  let i0 = 0;
  for (let i = 1; i + m - 1 < sorted.length; i++) {
    if (sorted[i + m - 1]! - sorted[i]! < sorted[i0 + m - 1]! - sorted[i0]!) i0 = i;
  }
  const lo = sorted[i0]!, hi = sorted[i0 + m - 1]!;
  const span = Math.max(MIN_SPAN, (hi - lo) * 1.1);
  return { to: (lo + hi) / 2 + span / 2, span };
}

/**
 * The focus nodes: the cards the flat view's frame `rect` holds, as the navigator frames them. A
 * card counts when its centre is inside; a group when its header's is, since a group's frame can
 * reach far outside the region that holds its title.
 */
export function focusNodes(boxes: DepthBox[], rect: Rect, isGroup: (key: string) => boolean): DepthBox[] {
  return boxes.filter((b) => {
    const h = isGroup(b.key) ? headerOf(b) : b;
    const cx = b.x + h.width / 2, cy = b.y + h.height / 2;
    return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height;
  });
}

/** Room kept round the fitted scene, as a share of the frame, and for the ruler's labels below it. */
const FIT_PAD = 0.06;
const LABEL_ROOM = 26;
/** The time axis is never shorter than this share of the focus nodes' own width. */
const MIN_TIME = 0.8;
/** The most the fit enlarges the scene. A frame holding one or two cards would otherwise blow them
 *  up to fill the screen, several times the size the flat view shows them at; capped, they keep
 *  the display's shape and stay centred, a little larger than flat. */
const MAX_SIGMA = 1.6;

/**
 * The 3D pose for a flat view's frame. The focus nodes inside `rect` give the window (the time
 * they span) and so the time axis's offset; the axis's length is then the one that makes the
 * focus nodes' 3D bounding box the shape of the display, and the scene is scaled and placed so that
 * box fills `rect`. `zoom` is the flat view's, so the ruler's labels get their room on screen.
 *
 * Null when the frame holds no card, so the caller keeps the pose it has.
 */
export function targetPose(
  boxes: DepthBox[],
  rect: Rect,
  timeOf: (key: string) => number | undefined,
  ribbonOf: (key: string) => Ribbon | null,
  isGroup: (key: string) => boolean,
  zoom = 1,
): Pose | null {
  const F = focusNodes(boxes, rect, isGroup);
  if (F.length === 0) return null;
  const dated = F.map((b) => timeOf(b.key)).filter((t): t is number => t !== undefined);
  const all = boxes.map((b) => timeOf(b.key)).filter((t): t is number => t !== undefined);
  const focus = fitFocus(dated.length ? dated : all) ?? { to: Date.now() / 1000, span: DAY };

  const size = (b: DepthBox) => (isGroup(b.key) ? headerOf(b) : b);
  const x0 = Math.min(...F.map((b) => b.x)), x1 = Math.max(...F.map((b) => b.x + size(b).width));
  const y0 = Math.min(...F.map((b) => b.y)), y1 = Math.max(...F.map((b) => b.y + size(b).height));
  const W = x1 - x0, H = y1 - y0;
  // The floor sits under the focus nodes by a gap kept in proportion to them, so a frame holding one
  // card does not spend most of its height on the space between the card and the ruler.
  const gap = Math.min(FLOOR_GAP, Math.max(16, H * 0.25));
  const ruler = x0 - Math.min(RULER_GAP, Math.max(16, W * 0.1));

  // The scene at a length, unfitted.
  const poseAt = (length: number, floorH: number, lanes: Record<string, number>, lanePitch: number, px: number): Pose => ({
    blend: 1, pitch: PITCH, azimuth: AZIMUTH, length,
    dist: Math.max(length, W, H, 600) * 3,
    sigma: 1,
    aim: { t: length / 2, d: (x0 + x1) / 2, h: floorH + EYE_RISE * Math.max(H, 200) },
    anchor: { x: 0, y: 0 },
    focus, floorH, ruler, floorFar: x1, lanes, lanePitch, px,
  });
  // The focus nodes' 3D bounding box on screen: their panels and their bars. With `ruler`, its
  // height reaches down to the ruler too, so the ruler stays on screen under the cards it measures.
  const bounds = (pose: Pose, withRuler = false) => {
    const view = viewOf(pose);
    const pts: Point[] = [];
    for (const b of F) {
      const s = size(b), t = trackOf(view, timeOf(b.key));
      pts.push(...panelAt(view, b.x, b.y, t, s.width, s.height).quad);
      const r = ribbonOf(b.key);
      if (r) pts.push(...barFor(view, { ...b, width: s.width }, footOf(b, isGroup(b.key)), r, b.key, pose.lanes[b.key] ?? 0, pose.lanePitch, pose.px).points);
    }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    if (withRuler) {
      for (const u of [0, 1]) ys.push(projectPoint(view, { t: u * pose.length, d: ruler, h: pose.floorH }).y);
    }
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  };

  // The ruler's labels need room below it on screen, which is a fixed number of screen pixels.
  const room = LABEL_ROOM / Math.max(0.02, zoom);
  const target = { width: rect.width * (1 - 2 * FIT_PAD), height: rect.height * (1 - 2 * FIT_PAD) - room };
  const want = target.width / Math.max(1, target.height);
  // The shape of the focus nodes' box grows wider with the length of time; find the length that
  // makes it the display's shape. Searched on a log scale, since the right length can be anything
  // from a fraction of the layout's width to many times it.
  const fitLength = (floorH: number, lanes: Record<string, number>, pitch: number, px: number) => {
    const aspect = (L: number) => {
      const b = bounds(poseAt(L, floorH, lanes, pitch, px));
      return b.width / Math.max(1e-6, b.height);
    };
    let lo = Math.max(100, W * MIN_TIME), hi = Math.max(lo * 4, (W + H) * 6);
    if (aspect(lo) >= want) return lo;
    // A focus whose shape hardly changes with time — one card, or cards all of a moment — takes the
    // shortest axis rather than the longest: lengthening it would only spread the ruler, not the cards.
    if (aspect(hi) <= want) return aspect(hi) - aspect(lo) < 0.1 * want ? lo : hi;
    for (let i = 0; i < 40; i++) {
      const m = Math.sqrt(lo * hi);
      if (aspect(m) < want) lo = m;
      else hi = m;
    }
    return Math.sqrt(lo * hi);
  };
  const fit = (pose: Pose) => {
    const b = bounds(pose, true);
    const sigma = Math.min(MAX_SIGMA, target.width / Math.max(1e-6, b.width), target.height / Math.max(1e-6, b.height));
    const cx = rect.x + rect.width / 2, cy = rect.y + (rect.height - room) / 2;
    return { ...pose, sigma, anchor: { x: cx - sigma * (b.x + b.width / 2), y: cy - sigma * (b.y + b.height / 2) } };
  };

  // First the scene without lanes, to learn its scale on screen; then the lanes, which depend on
  // how wide each bar and its label come out there; then the scene again, with its floor below
  // the lowest lane.
  const floor0 = -(y1 + gap);
  // Before the fit the scale is unknown; the flat view's own zoom is the first guess at a pixel.
  const px0 = 1 / Math.max(1e-6, zoom);
  const first = fit(poseAt(fitLength(floor0, {}, 0, px0), floor0, {}, 0, px0));
  const px = 1 / Math.max(1e-6, first.sigma * zoom);
  const bar = barSize(px);
  const lanePitch = Math.max(bar.h + 4 * px, (LABEL_H + 4) * px);
  const lanes = assignLanes(viewOf(first), boxes, ribbonOf, isGroup, px);
  let lowest = floor0;
  for (const b of boxes) {
    const lane = lanes[b.key];
    if (lane === undefined || !F.includes(b)) continue;
    lowest = Math.min(lowest, footOf(b, isGroup(b.key)) - bar.gap - lane * lanePitch - bar.h - gap);
  }
  return fit(poseAt(fitLength(lowest, lanes, lanePitch, px), lowest, lanes, lanePitch, px));
}

/** Height of a bar's label on screen, and an estimate of its characters' width, in screen pixels. */
const LABEL_H = 12;
const LABEL_CH = 6.4;

/**
 * Lanes for the timer bars: under each row of cards, a bar whose stretch on screen, label
 * included, would cross another's goes into the next lane down. Greedy by left edge, the usual
 * interval partitioning, so bars that do not overlap share a lane. `px` is one screen pixel in the
 * scene's own units, so a label's width is reckoned as it will be drawn.
 */
function assignLanes(
  view: View, boxes: DepthBox[], ribbonOf: (key: string) => Ribbon | null, isGroup: (key: string) => boolean, px: number,
): Record<string, number> {
  const rows = new Map<number, { key: string; x0: number; x1: number }[]>();
  for (const b of boxes) {
    const r = ribbonOf(b.key);
    if (!r) continue;
    const group = isGroup(b.key);
    const w = group ? headerOf(b).width : b.width;
    const foot = footOf(b, group);
    const bar = barFor(view, { ...b, width: w }, foot, r, b.key, 0, 0, px);
    const xs = bar.points.map((p) => p.x);
    // Its label stands beside its newer end.
    const x1 = Math.max(...xs) + (6 + r.label.length * LABEL_CH) * px;
    const row = Math.round(foot);
    (rows.get(row) ?? rows.set(row, []).get(row)!).push({ key: b.key, x0: Math.min(...xs), x1 });
  }
  const out: Record<string, number> = {};
  for (const items of rows.values()) {
    items.sort((a, b) => a.x0 - b.x0);
    const ends: number[] = [];
    for (const it of items) {
      let lane = ends.findIndex((e) => e + 4 * px <= it.x0);
      if (lane < 0) (lane = ends.length, ends.push(0));
      ends[lane] = it.x1;
      out[it.key] = lane;
    }
  }
  return out;
}

/** A tick on the ruler, placed: its mark on the ruler and its grid line across the floor. */
export interface RulerTick extends Tick {
  at: Point;
  far: Point;
}

/**
 * The ruler's ticks at a zoom. Their spacing is set in screen pixels, so a ruler drawn longer on
 * screen carries finer ticks — months into days, days into hours.
 */
export function rulerTicks(scene: DepthScene, zoom: number): RulerTick[] {
  const { view, pose } = scene;
  const a = projectPoint(view, { t: 0, d: pose.ruler, h: pose.floorH });
  const b = projectPoint(view, { t: view.length, d: pose.ruler, h: pose.floorH });
  const px = Math.hypot(b.x - a.x, b.y - a.y) * zoom;
  return axisTicks(view.focus, Math.min(60, Math.round(px / TICK_GAP))).map((tick) => {
    const t = tick.u * view.length;
    const p = projectPoint(view, { t, d: pose.ruler, h: pose.floorH });
    const q = projectPoint(view, { t, d: pose.floorFar, h: pose.floorH });
    return { ...tick, at: { x: p.x, y: p.y }, far: { x: q.x, y: q.y } };
  });
}

/** The ruler's line: the window itself, and the squeezed tails either side of it. */
export function rulerLine(scene: DepthScene): { window: [Point, Point]; older: [Point, Point]; newer: [Point, Point] } {
  const { view, pose } = scene;
  const at = (u: number) => {
    const p = projectPoint(view, { t: u * view.length, d: pose.ruler, h: pose.floorH });
    return { x: p.x, y: p.y };
  };
  return { window: [at(0), at(1)], older: [at(-TAIL), at(0)], newer: [at(1), at(1 + TAIL)] };
}

/**
 * A relation line between two cards at different moments: each point is placed in the plane of a
 * moment between the two, so the line runs through time from one panel to the other.
 */
export function projectPath(view: View, points: Point[], tFrom: number, tTo: number): Point[] {
  const last = points.length - 1;
  return points.map((p, i) => {
    const t = tFrom + (tTo - tFrom) * (last === 0 ? 0 : i / last);
    const at = projectPoint(view, { t, d: p.x, h: -p.y });
    return { x: at.x, y: at.y };
  });
}
