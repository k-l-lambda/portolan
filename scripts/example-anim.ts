// Renders the change between the flat view and the time-depth (3D) view of a .rhumb map as one
// animated SVG, for the README. It loops: the flat map, the camera turning into 3D, the 3D view
// with its time axis and timer bars, and back.
//
// The motion is the app's own: poses from web/src/depth.ts (`targetPose`, `flatPose`,
// `blendPose`, `depthScene`), sampled along the same eased move. Cards and frame headers are drawn
// once, at their layout place, and carried onto each sampled panel by a CSS `matrix()`; SVG has no
// perspective transform, so a panel is the affine map of three of its corners, which at this
// camera's mild perspective is within a pixel or two of the fourth. Lines, bars, the floor and the
// ruler are re-projected per sample and animated with SMIL. Both run on the document's own clock
// with the same duration, so they stay together.
//
// Usage: node scripts/example-anim.ts [in.rhumb] [out.svg]

import { readFileSync, writeFileSync } from "node:fs";
import {
  blendPose, depthScene, ease, flatPose, nodeRibbon, projectPoint, rulerLine, rulerTicks, targetPose,
  type DepthBox, type DepthScene, type Point, type Pose,
} from "../web/src/depth.ts";
import { roundedPath } from "../web/src/geometry.ts";
import { freshness } from "../web/src/time.ts";
import { C, EDGE, esc, FONT, MONO, mix, renderMap, ST } from "./mapSvg.ts";

process.env.TZ = "UTC";
/** The moment timers are read at, as in the still image, so the drawing does not drift. */
const NOW = Date.UTC(2026, 9, 17, 18, 0) / 1000;
const [input = "docs/example.rhumb", output = "docs/example-3d.svg"] = process.argv.slice(2);

/** Width the README shows the image at; the ruler's text is sized for that. */
const SHOWN_W = 720;
const MARGIN = 24;
/** The loop, in seconds: flat, the turn into 3D, 3D, the turn back. */
const HOLD_FLAT = 1.6, TURN = 1.8, HOLD_3D = 3.4;
const DUR = 2 * (HOLD_FLAT + TURN) + HOLD_3D - HOLD_FLAT;
/** Samples per turn: enough that linear steps between them follow the eased curve. */
const STEPS = 14;
const WARN = "#9a5b00", ERR = "#b3261e";

const m = await renderMap(readFileSync(input, "utf8"), NOW);
const { layout, boxes } = m;

// The frame: the still image's own bounds, so the 3D view fills what the flat map did.
let minX = 0, minY = 0, maxX = layout.width, maxY = layout.height;
for (const p of m.labels.values()) {
  minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2);
  minY = Math.min(minY, p.y - p.h / 2); maxY = Math.max(maxY, p.y + p.h / 2);
}
const VX = minX - MARGIN, VY = minY - MARGIN;
const W = Math.ceil(maxX - minX + 2 * MARGIN), H = Math.ceil(maxY - minY + 2 * MARGIN);
/** Screen pixels per map unit where the README shows it: the ruler's text keeps a readable size. */
const zoom = SHOWN_W / W;

// The 3D pose for this frame, as the app works it out for a flat view showing all of it.
const byKey = new Map(boxes.map((b) => [b.key, b]));
const dboxes: DepthBox[] = boxes.map((b) => ({ key: b.key, x: b.x, y: b.y, width: b.width, height: b.height }));
const timeOf = (key: string) => m.timeOf(byKey.get(key)!.node);
const ribbonOf = (key: string) => {
  const b = byKey.get(key)!;
  return nodeRibbon(b.node, b.hidden > 0, m.timeOf(b.node), NOW);
};
const isGroup = (key: string) => byKey.get(key)!.container;
const rect = { x: VX, y: VY, width: W, height: H };
const target = targetPose(dboxes, rect, timeOf, ribbonOf, isGroup, zoom);
if (!target) throw new Error("the frame holds no card");
const flat = flatPose(target);

// The samples: time in the loop (0..1) and the blend between the flat pose and the 3D one.
const samples: { at: number; s: number }[] = [];
const add = (t: number, s: number) => samples.push({ at: t / DUR, s });
add(0, 0);
for (let i = 0; i <= STEPS; i++) add(HOLD_FLAT + (TURN * i) / STEPS, ease(i / STEPS));
for (let i = 0; i <= STEPS; i++) add(HOLD_FLAT + TURN + HOLD_3D + (TURN * i) / STEPS, ease(1 - i / STEPS));
add(DUR, 0);
const scenes: DepthScene[] = samples.map(({ s }) => depthScene(dboxes, blendPose(flat, target, s), timeOf, ribbonOf, isGroup));
const poses: Pose[] = scenes.map((sc) => sc.pose);
const at3d = scenes[STEPS + 1]!; // the end of the turn into 3D
const keyTimes = samples.map((x) => +x.at.toFixed(5)).join(";");

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pts = (p: Point[]) => p.map((q) => `${r1(q.x)},${r1(q.y)}`).join(" ");
/** A SMIL animation of one attribute over the loop, from one value per sample. */
const smil = (attr: string, values: (string | number)[]) =>
  `<animate attributeName="${attr}" dur="${DUR}s" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}" values="${values.join(";")}"/>`;

/**
 * The affine map that carries a rectangle at layout (x, y), w × h, onto a panel's screen quad:
 * its top-left, top-right and bottom-left corners land exactly, the fourth within the mild
 * perspective's error.
 */
function affine(x: number, y: number, w: number, h: number, quad: Point[]): string {
  const [tl, tr, , bl] = quad as [Point, Point, Point, Point];
  const a = (tr.x - tl.x) / w, b = (tr.y - tl.y) / w;
  const c = (bl.x - tl.x) / h, d = (bl.y - tl.y) / h;
  const e = tl.x - a * x - c * y, f = tl.y - b * x - d * y;
  return `matrix(${r3(a)},${r3(b)},${r3(c)},${r3(d)},${r1(e - VX)},${r1(f - VY)})`;
}

// One CSS animation per moving layer: its transform at each sample, and its opacity.
const css: string[] = [];
const pct = (i: number) => `${+(samples[i]!.at * 100).toFixed(3)}%`;
function keyframes(name: string, frame: (i: number) => string) {
  css.push(`@keyframes ${name}{${samples.map((_, i) => `${pct(i)}{${frame(i)}}`).join("")}}`);
  css.push(`.${name}{${frame(0)};animation:${name} ${DUR}s linear infinite;transform-box:view-box;transform-origin:0 0}`);
}

// Cards and frame headers, carried by their panels. A frame's header panel is the header's own
// size; the frame's border goes with the frame's whole panel.
const order = at3d.order;
const panels: string[] = [];
boxes.forEach((b, n) => {
  const id = `p${n}`;
  keyframes(id, (i) => {
    const p = scenes[i]!.panels.get(b.key)!;
    return `transform:${affine(b.x, b.y, b.width, b.height, p.quad)};opacity:${r3(p.fog)}`;
  });
});
// The panels' matrices map layout coordinates into a frame whose corner is (0, 0), so what they
// carry is drawn at its layout place; what no matrix carries (the edge labels) is shifted instead.
const shift = `translate(${-VX} ${-VY})`;
// Frame fills, below everything, fading out as the camera turns (an opaque sheet would hide the
// cards behind it in 3D).
const fills = boxes.map((b, n) => (b.container
  ? `<g class="p${n}"><g class="fade">${m.fill(b)}</g></g>` : "")).join("\n");
css.push(`@keyframes fade{${samples.map((_, i) => `${pct(i)}{opacity:${r3(1 - poses[i]!.blend)}}`).join("")}}`);
css.push(`.fade{animation:fade ${DUR}s linear infinite}`);
css.push(`@keyframes show{${samples.map((_, i) => `${pct(i)}{opacity:${r3(poses[i]!.blend)}}`).join("")}}`);
css.push(`.show{opacity:0;animation:show ${DUR}s linear infinite}`);
// Panels far to near, as the 3D view stacks them; in the flat view this is the app's own stacking
// (frames below cards), since a frame's body is transparent and only its header is filled.
const keyIndex = new Map(boxes.map((b, n) => [b.key, n]));
for (const key of order) {
  const n = keyIndex.get(key)!, b = byKey.get(key)!;
  const border = b.container
    ? `<rect x="${b.x + 0.5}" y="${b.y + 0.5}" width="${b.width - 1}" height="${b.height - 1}" rx="8" fill="none" stroke="${C.border}"/>` : "";
  panels.push(`<g class="p${n}">${border}${m.card(b)}</g>`);
}

// Relation lines, re-projected per sample: each point in the plane of a moment between its ends.
const edges = layout.routes.map((r) => {
  const s = EDGE[r.kind];
  const arrow = s.arrow || (r.kind === "relates" && !!r.label);
  const ds = scenes.map((sc) => {
    const ta = sc.panels.get(r.source)?.t ?? 0, tb = sc.panels.get(r.target)?.t ?? 0;
    const last = r.points.length - 1;
    const pp = r.points.map((p, i) => {
      const t = ta + (tb - ta) * (last === 0 ? 0 : i / last);
      const q = projectAt(sc, t, p);
      return { x: r1(q.x - VX), y: r1(q.y - VY) };
    });
    return roundedPath(pp);
  });
  return `<path d="${ds[0]}" fill="none" stroke="${s.color}" stroke-width="${s.width}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}${arrow ? ` marker-end="url(#arrow-${r.kind})"` : ""}>${smil("d", ds)}</path>`;
}).join("\n");
/** A layout point in the plane of moment `t`, as `projectPath` places a line's points. */
function projectAt(sc: DepthScene, t: number, p: Point): Point {
  const q = projectPoint(sc.view, { t, d: p.x, h: -p.y });
  return { x: q.x, y: q.y };
}

// Edge labels: the flat view's, fading as the camera turns (in 3D the lines run through time and
// the labels would float free of them).
const labels = `<g class="fade" transform="${shift}">${layout.routes.map(m.label).join("\n")}</g>`;

// The floor, its grid and the ruler, the drop lines and the timer bars, as DepthFloor draws them.
const shifted = (p: Point) => ({ x: p.x - VX, y: p.y - VY });
const floorPoly = `<polygon fill="${mix("#2f5f8a", 3, C.bg)}" stroke="${C.border}" points="${pts(scenes[0]!.floor.quad.map(shifted))}">${smil("points", scenes.map((sc) => pts(sc.floor.quad.map(shifted))))}</polygon>`;
const ticksAt3d = rulerTicks(at3d, zoom);
const px = 1 / zoom;
const grid: string[] = [], rulerMarks: string[] = [];
for (const t of ticksAt3d) {
  // A tick is placed again at each sample from its own moment, so it slides with the axis.
  const per = scenes.map((sc) => {
    const u = t.u * sc.view.length;
    const a = projectAt(sc, u, { x: sc.pose.ruler, y: -sc.pose.floorH });
    const b = projectAt(sc, u, { x: sc.pose.floorFar, y: -sc.pose.floorH });
    return { a: shifted(a), b: shifted(b) };
  });
  const line = (k: "x1" | "y1" | "x2" | "y2", f: (q: { a: Point; b: Point }) => number) => smil(k, per.map((q) => r1(f(q))));
  grid.push(`<line x1="${r1(per[0]!.a.x)}" y1="${r1(per[0]!.a.y)}" x2="${r1(per[0]!.b.x)}" y2="${r1(per[0]!.b.y)}" stroke="${t.major ? mix(C.muted, 55, C.bg) : mix(C.border, 70, C.bg)}" stroke-width="1">`
    + line("x1", (q) => q.a.x) + line("y1", (q) => q.a.y) + line("x2", (q) => q.b.x) + line("y2", (q) => q.b.y) + `</line>`);
  rulerMarks.push(`<line x1="${r1(per[0]!.a.x)}" y1="${r1(per[0]!.a.y)}" x2="${r1(per[0]!.a.x)}" y2="${r1(per[0]!.a.y + 8 * px)}" stroke="${t.major ? C.text : C.muted}" stroke-width="${t.major ? 2 : 1.2}">`
    + line("x1", (q) => q.a.x) + line("y1", (q) => q.a.y) + line("x2", (q) => q.a.x) + line("y2", (q) => q.a.y + 8 * px) + `</line>`);
  rulerMarks.push(`<text x="${r1(per[0]!.a.x)}" y="${r1(per[0]!.a.y + 21 * px)}" font-size="${r1(11 * px)}" font-family="${MONO}" font-weight="${t.major ? 600 : 500}" text-anchor="middle" fill="${t.major ? C.text : C.muted}">${esc(t.label)}`
    + smil("x", per.map((q) => r1(q.a.x))) + smil("y", per.map((q) => r1(q.a.y + 21 * px))) + `</text>`);
}
const rulerParts = (["window", "older", "newer"] as const).map((part) => {
  const per = scenes.map((sc) => rulerLine(sc)[part].map(shifted) as [Point, Point]);
  const attrs = (k: number, a: "x" | "y") => per.map((q) => r1(q[k]![a]));
  return `<line x1="${attrs(0, "x")[0]}" y1="${attrs(0, "y")[0]}" x2="${attrs(1, "x")[0]}" y2="${attrs(1, "y")[0]}" stroke="${C.muted}" stroke-width="${part === "window" ? 1.6 : 1.2}"${part === "window" ? "" : ` stroke-dasharray="3 4" opacity="0.7"`}>`
    + smil("x1", attrs(0, "x")) + smil("y1", attrs(0, "y")) + smil("x2", attrs(1, "x")) + smil("y2", attrs(1, "y")) + `</line>`;
}).join("\n");

// Each item's projection on the floor, in its status colour, with a freshness dot at its left end,
// and each timer bar's projection along the time axis, as DepthFloor draws them.
const lineAnim = (per: [Point, Point][]) => {
  const v = (k: 0 | 1, a: "x" | "y") => per.map((q) => r1(shifted(q[k])[a]));
  return { x1: v(0, "x"), y1: v(0, "y"), x2: v(1, "x"), y2: v(1, "y") };
};
const animLine = (per: [Point, Point][], attrs: string) => {
  const a = lineAnim(per);
  return `<line x1="${a.x1[0]}" y1="${a.y1[0]}" x2="${a.x2[0]}" y2="${a.y2[0]}" ${attrs}>`
    + smil("x1", a.x1) + smil("y1", a.y1) + smil("x2", a.x2) + smil("y2", a.y2) + `</line>`;
};
const shadows = at3d.shadows.map((sh) => {
  const b = byKey.get(sh.key)!;
  const st = ST[b.node.status ?? "todo"];
  const fresh = Math.round(20 + freshness(m.timeOf(b.node), NOW) * 80);
  const per = scenes.map((sc) => {
    const x = sc.shadows.find((q) => q.key === sh.key)!;
    return [x.from, x.to] as [Point, Point];
  });
  const cx = per.map((q) => r1(shifted(q[0]).x)), cy = per.map((q) => r1(shifted(q[0]).y));
  return animLine(per, `stroke="${mix(st, 55, C.bg)}" stroke-width="2" stroke-linecap="round"`)
    + `<circle cx="${cx[0]}" cy="${cy[0]}" r="${r1(2.1 * px)}" fill="${mix(st, fresh, C.surface)}" stroke="${st}" stroke-width="1">${smil("cx", cx)}${smil("cy", cy)}</circle>`;
}).join("\n");
const grounds = at3d.bars.map((bar) => {
  if (!bar.ground) return "";
  const st = bar.kind === "actual" ? ST.done : bar.kind === "running"
    ? (bar.state === "over" ? ERR : bar.state === "near" ? WARN : ST.done) : C.muted;
  const per = scenes.map((sc) => sc.bars.find((x) => x.key === bar.key)!.ground!);
  // A part a sample lacks (overtime before the axis has any length) is a zero-length line at the
  // end of the fill, so it grows out of it.
  const end = (g: NonNullable<typeof bar.ground>): [Point, Point] => {
    const q = (g.fill ?? g.track)![1];
    return [q, q];
  };
  const part = (k: "track" | "fill" | "over", attrs: string) => (bar.ground![k] ? animLine(per.map((g) => g[k] ?? end(g)), attrs) : "");
  return part("track", bar.kind === "estimate" ? `stroke="${C.muted}" stroke-width="2" stroke-dasharray="4 3"` : `stroke="${mix(st, 45, C.bg)}" stroke-width="2"`)
    + part("fill", `stroke="${mix(st, 80, C.bg)}" stroke-width="3"`)
    + part("over", `stroke="${ERR}" stroke-width="3"`);
}).join("\n");

const drops = at3d.drops.map((d) => {
  const per = scenes.map((sc) => sc.drops.find((x) => x.key === d.key) ?? null);
  const v = (f: (q: { from: Point; to: Point }) => number) => per.map((q) => r1(q ? f({ from: shifted(q.from), to: shifted(q.to) }) : 0));
  const x1 = v((q) => q.from.x), y1 = v((q) => q.from.y), x2 = v((q) => q.to.x), y2 = v((q) => q.to.y);
  return `<line x1="${x1[0]}" y1="${y1[0]}" x2="${x2[0]}" y2="${y2[0]}" stroke="${mix("#2f5f8a", 35, C.bg)}" stroke-width="1" stroke-dasharray="2 4">`
    + smil("x1", x1) + smil("y1", y1) + smil("x2", x2) + smil("y2", y2) + `</line>`;
}).join("\n");

const bars = at3d.bars.map((bar) => {
  const per = scenes.map((sc) => sc.bars.find((x) => x.key === bar.key)!);
  const st = bar.kind === "actual" ? ST.done : bar.kind === "running"
    ? (bar.state === "over" ? ERR : bar.state === "near" ? WARN : ST.done) : C.muted;
  const poly = (part: "track" | "fill" | "over", fill: string, stroke: string, extra = "") => {
    if (!bar[part]) return "";
    const vals = per.map((b) => pts((b[part] ?? b.points).map(shifted)));
    return `<polygon points="${vals[0]}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"${extra}>${smil("points", vals)}</polygon>`;
  };
  const overdue = bar.kind === "running" && bar.state === "over";
  const out = [
    poly("track", bar.kind === "estimate" ? mix(C.muted, 10, C.bg) : mix(st, 10, C.bg), bar.kind === "estimate" ? C.muted : mix(st, 75, C.muted), bar.kind === "estimate" ? ` stroke-dasharray="4 3"` : ""),
    poly("fill", mix(st, overdue ? 28 : bar.inferred ? 30 : 70, C.bg), st, bar.inferred ? ` stroke-dasharray="5 2"` : ""),
    poly("over", mix(ERR, 85, C.bg), ERR),
  ];
  if (bar.nowAt) {
    const nx = per.map((b) => b.nowAt!.map(shifted));
    out.push(`<line x1="${r1(nx[0]![0]!.x)}" y1="${r1(nx[0]![0]!.y)}" x2="${r1(nx[0]![1]!.x)}" y2="${r1(nx[0]![1]!.y)}" stroke="${C.text}" stroke-width="2">`
      + smil("x1", nx.map((q) => r1(q[0]!.x))) + smil("y1", nx.map((q) => r1(q[0]!.y))) + smil("x2", nx.map((q) => r1(q[1]!.x))) + smil("y2", nx.map((q) => r1(q[1]!.y))) + `</line>`);
  }
  const lx = per.map((b) => r1(b.labelAt.x - VX + 5 * px)), ly = per.map((b) => r1(b.labelAt.y - VY));
  out.push(`<text x="${lx[0]}" y="${ly[0]}" dominant-baseline="middle" font-size="${r1(10 * px)}" font-family="${MONO}" font-weight="${bar.kind === "estimate" ? 500 : 600}" fill="${overdue ? ERR : bar.kind === "estimate" ? C.muted : C.text}">${esc(bar.label)}`
    + smil("x", lx) + smil("y", ly) + `</text>`);
  return `<g>${out.join("")}</g>`;
}).join("\n");

const floor = `<g class="show moving">${floorPoly}\n${grid.join("\n")}\n${shadows}\n${grounds}\n${drops}\n${bars}\n${rulerParts}\n${rulerMarks.join("\n")}</g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-labelledby="t">
<title id="t">${esc(m.doc.title ?? "Rhumb map")}: ${input.split("/").pop()} turning from the flat map into the time-depth view and back</title>
<style>
${css.join("\n")}
.still{display:none}
/* Reduced motion: the flat map, still. CSS animations stop; SMIL ones ignore the query, so the
   layers they move are swapped for still copies. */
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } .moving { display: none; } .still { display: inline; } }
</style>
<defs>
${m.defs}
</defs>
<rect width="${W}" height="${H}" fill="${C.bg}"/>
<rect width="${W}" height="${H}" fill="url(#dots)"/>
${fills}
${floor}
<g class="moving">${edges}</g>
<g class="still" transform="${shift}">${layout.routes.map(m.edge).join("\n")}</g>
${panels.join("\n")}
${labels}
</svg>
`;

writeFileSync(output, svg);
console.log(`${output}: ${W}×${H}, ${boxes.length} panels, ${layout.routes.length} lines, ${at3d.bars.length} bars, ${samples.length} samples, ${(svg.length / 1024).toFixed(0)} KB`);
