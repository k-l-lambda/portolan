// Path helpers for polyline edges routed by ELK.

const RADIUS = 8;

/** SVG path through orthogonal points with rounded corners. */
export function roundedPath(points: { x: number; y: number }[], radius = RADIUS): string {
  if (points.length === 0) return "";
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1]!, c = points[i]!, n = points[i + 1]!;
    const r = Math.min(radius, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const a = toward(c, p, r), b = toward(c, n, r);
    d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}

function toward(from: { x: number; y: number }, to: { x: number; y: number }, dist: number) {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / len) * dist, y: from.y + ((to.y - from.y) / len) * dist };
}

/** Middle of the longest segment: the place a label is least likely to sit on a bend. */
export function labelPoint(points: { x: number; y: number }[]): { x: number; y: number } {
  let best = { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 };
  let longest = -1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > longest) (longest = len), (best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return best;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface LabelRequest {
  id: string;
  points: { x: number; y: number }[];
  /** Label box size in flow units. */
  w: number;
  h: number;
}

/** Point at distance `d` along a polyline, with whether that segment is vertical. */
function pointAt(points: { x: number; y: number }[], d: number): { x: number; y: number; vertical: boolean } {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= len || i === points.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, d / len);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, vertical: Math.abs(b.x - a.x) < Math.abs(b.y - a.y) };
    }
    d -= len;
  }
  const p = points[0] ?? { x: 0, y: 0 };
  return { ...p, vertical: false };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Places labels along their edges so they do not cover each other. Parallel edges leaving
 * one card share the same midpoints, so each label slides along its own edge to the
 * candidate closest to its preferred point (middle of the longest segment) that is clear of
 * labels already placed and, where possible, of `obstacles` (cards). When the edge is too
 * short for that, the label moves beside the line (left/right of a vertical segment, above/
 * below a horizontal one). Requests are placed in order, so put the hovered edge first.
 */
export interface Line { id: string; points: { x: number; y: number }[] }

/** True when segment a–b passes through the interior of rect r (orthogonal or diagonal). */
function crosses(a: { x: number; y: number }, b: { x: number; y: number }, r: Rect): boolean {
  // Liang–Barsky clip of the segment against the rect.
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-6;
}

export function placeLabels(
  requests: LabelRequest[],
  obstacles: Rect[] = [],
  gap = 4,
  /** Other drawn lines a label should not sit on; a label's own edge is skipped. */
  lines: Line[] = [],
): Map<string, { x: number; y: number }> {
  const placed: Rect[] = [];
  const out = new Map<string, { x: number; y: number }>();
  for (const r of requests) {
    if (r.points.length < 2) continue;
    const lengths = r.points.slice(1).map((p, i) => Math.hypot(p.x - r.points[i]!.x, p.y - r.points[i]!.y));
    const total = lengths.reduce((s, l) => s + l, 0);
    // Preferred: middle of the longest segment, as distance along the path.
    let longest = 0;
    for (let i = 1; i < lengths.length; i++) if (lengths[i]! > lengths[longest]!) longest = i;
    const preferred = lengths.slice(0, longest).reduce((s, l) => s + l, 0) + lengths[longest]! / 2;
    // Candidates every half label height, ordered by distance from the preferred point,
    // keeping clear of the very ends where arrows and cards are.
    const step = Math.max(4, r.h / 2);
    const margin = Math.min(total / 2, r.h);
    const candidates: number[] = [];
    for (let d = margin; d <= total - margin; d += step) candidates.push(d);
    candidates.push(Math.min(Math.max(preferred, margin), total - margin));
    candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));

    const box = (p: { x: number; y: number }): Rect => ({ x: p.x - r.w / 2 - gap, y: p.y - r.h / 2 - gap, w: r.w + 2 * gap, h: r.h + 2 * gap });
    let best: { p: { x: number; y: number }; cost: number; onLabels: number } | null = null;
    // Lines sharing this edge's exact path (one `a needs b, c` line) count as its own.
    const ownPath = JSON.stringify(r.points);
    const others = lines.filter((l) => l.id !== r.id && JSON.stringify(l.points) !== ownPath);
    const consider = (p: { x: number; y: number }, penalty: number) => {
      const b = box(p);
      const onLabels = placed.reduce((s, q) => s + overlap(b, q), 0);
      const onCards = obstacles.reduce((s, q) => s + overlap(b, q), 0);
      const onLines = others.reduce((s, l) => s + (l.points.slice(1).some((q, i) => crosses(l.points[i]!, q, b)) ? 1 : 0), 0);
      // Never cover a label; avoid sitting on another line; covering a card is a tie-breaker.
      const cost = onLabels * 1000 + onLines * 200 + onCards + penalty;
      if (!best || cost < best.cost) best = { p, cost, onLabels: onLabels + onLines };
      return onLabels === 0 && onLines === 0 && onCards === 0;
    };
    let clear = false;
    for (const d of candidates) {
      if ((clear = consider(pointAt(r.points, d), Math.abs(d - preferred) * 0.01))) break;
    }
    // Still covering a label or sitting on another line: try beside the line, one and two label sizes out.
    if (!clear && best!.onLabels > 0) {
      outer: for (const k of [1, -1, 2, -2]) {
        for (const d of candidates) {
          const p = pointAt(r.points, d);
          const off = p.vertical ? { x: k * (r.w / 2 + gap + 2), y: 0 } : { x: 0, y: k * (r.h + gap) };
          if (consider({ x: p.x + off.x, y: p.y + off.y }, 50 * Math.abs(k) + Math.abs(d - preferred) * 0.01)) break outer;
        }
      }
    }
    out.set(r.id, { x: best!.p.x, y: best!.p.y });
    placed.push(box(best!.p));
  }
  return out;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Longest label in px; the label CSS uses the same max-width and ellipsis. */
export const LABEL_MAX_W = 260;

/** Width of a label in px at the label font, capped at LABEL_MAX_W; CJK-aware estimate without a DOM. */
export function measureLabel(text: string, fontSize = 11): number {
  return Math.min(LABEL_MAX_W, rawWidth(text, fontSize));
}

function rawWidth(text: string, fontSize: number): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (measureCtx) {
    measureCtx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", "Noto Sans", "PingFang SC", sans-serif`;
    return measureCtx.measureText(text).width;
  }
  let w = 0;
  for (const ch of text) w += /[⺀-鿿가-힯＀-￯]/.test(ch) ? fontSize : fontSize * 0.6;
  return w;
}
