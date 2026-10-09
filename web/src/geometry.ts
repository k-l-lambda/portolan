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
