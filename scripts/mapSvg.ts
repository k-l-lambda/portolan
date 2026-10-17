// Draws a .rhumb map as SVG in the web view's light theme, as the app draws it: the same ELK
// layout and label placement, every subtree expanded and every edge label shown. Shared by the
// README's still image (example-svg.ts) and its 2D/3D animation (example-anim.ts).

import { derive } from "../src/derive.ts";
import { parse } from "../src/parse.ts";
import { formatDuration, timingOf } from "../src/timing.ts";
import type { EdgeKind, RhumbNode, Status } from "../src/types.ts";
import { layoutElk, type Box, type ElkResult, type Route } from "../web/src/elkLayout.ts";
import { endTab, placeLabels, roundedPath, type LabelRequest } from "../web/src/geometry.ts";
import { claimMarks, kindLetters, plainTitle, shortId } from "../web/src/layout.ts";
import { CLAIM_SHAPES, KIND_SHAPES, shapesToSvg, type Shape } from "../web/src/markShapes.ts";
import { timerState } from "../web/src/timerState.ts";
import { isPresetKind, nodeKind } from "../src/kinds.ts";

// Light theme tokens from web/src/styles.css.
export const C = {
  bg: "#f7f7f5", surface: "#ffffff", surface2: "#f0f0ec", text: "#1d1d1b", muted: "#6b6b66", border: "#d9d9d3",
  star: "#b7791f",
};
export const ST: Record<Status, string> = {
  todo: "#6b6b66", doing: "#b46a00", done: "#2e7d4f", blocked: "#b3261e", idea: "#6a4fb3", dropped: "#8a8a84",
};
/** Status tint of a card over the surface (`--card-bg`). */
const TINT: Record<Status, number> = { todo: 10, doing: 18, done: 16, blocked: 18, idea: 10, dropped: 10 };
export const EDGE: Record<EdgeKind, { color: string; width: number; dash?: string; arrow: boolean }> = {
  needs: { color: "#2f5f8a", width: 1.5, arrow: true },
  blocks: { color: "#b3261e", width: 1.5, arrow: true },
  relates: { color: "#6a4fb3", width: 1, dash: "4 4", arrow: false },
  replaces: { color: "#8a8a84", width: 1, dash: "8 4", arrow: true },
  from: { color: "#2e7d4f", width: 1, dash: "2 4", arrow: true },
};
export const FONT = `system-ui, -apple-system, 'Segoe UI', 'Noto Sans', 'PingFang SC', sans-serif`;
export const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const MARGIN = 24;

/** `color-mix(in srgb, a p%, b)`. */
export function mix(a: string, p: number, b: string): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round((v * p + y[i]! * (100 - p)) / 100).toString(16).padStart(2, "0")).join("")}`;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/**
 * Text width without a DOM: per-glyph advances (em) of a typical UI sans-serif, a little wide so
 * text still fits where the viewer's system font is wider. CJK and other glyphs count as 1em.
 */
const ADV: Record<string, number> = {};
for (const [chars, w] of [
  ["il.,:;'|!", 0.28], ["fjrt()[]-` ", 0.36], ["Iszcxvykg\"/", 0.52], ["abdehnopqu0123456789$#_?", 0.58],
  ["ABEFJKLPRSTVXYZ", 0.64], ["CDGHNOQU&", 0.72], ["mwM", 0.86], ["W", 0.95],
] as const) for (const c of chars) ADV[c] = w;
export const textW = (s: string, size: number) => {
  let em = 0;
  for (const c of s) em += ADV[c] ?? (/[⺀-鿿가-힯＀-￯]/.test(c) ? 1 : 0.6);
  return em * size * 1.18;
};

/** Fit text into `max` px, cutting with an ellipsis. */
export function fit(s: string, size: number, max: number): string {
  if (textW(s, size) <= max) return s;
  let t = s;
  while (t.length > 1 && textW(`${t}…`, size) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Up to two lines of a title in `max` px (the card clamps titles to two lines). */
function wrap(s: string, size: number, max: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textW(next, size) <= max || !cur) cur = next;
    else (lines.push(cur), (cur = w));
  }
  if (cur) lines.push(cur);
  return lines.length <= 2 ? lines : [lines[0]!, fit(lines.slice(1).join(" "), size, max)];
}

/** Warning and error colours from web/src/styles.css, for timer states. */
const WARN = "#9a5b00", ERR = "#b3261e";

/**
 * A node's moment, as the 3D view places it. The app takes it from when the item's line was last
 * changed (git); a drawing has no such history, so the attributes stand in for it: a finished run
 * at its finish, one in progress at its start, a group at its newest item, and anything else —
 * an open plan, a question — at `now`, where an item just written would be.
 */
export function momentOf(n: RhumbNode, now: number): number {
  const t = timingOf(n, now);
  if (t?.finished != null) return t.finished;
  if (t?.started != null) return t.started;
  if (n.children.length > 0) return Math.max(...n.children.map((c) => momentOf(c, now)));
  return now;
}

/** The timer chip a card shows, as TimerChip draws it: clock, progress bar while running, time. */
function timerChip(n: RhumbNode, x: number, y: number, now: number): { svg: string; w: number } {
  const t = timingOf(n, now);
  if (!t || !timerState(t, n.status)) return { svg: "", w: 0 };
  const { estimate, elapsed, state, closed } = t;
  const label = closed ? formatDuration(elapsed!)
    : elapsed !== null && estimate !== null ? `${formatDuration(elapsed)}/${formatDuration(estimate)}`
    : elapsed !== null ? formatDuration(elapsed) : `est. ${formatDuration(estimate!)}`;
  const share = !closed && elapsed !== null && estimate !== null ? Math.min(1, elapsed / estimate) : null;
  const color = closed ? C.muted : state === "ok" ? ST.done : state === "near" ? WARN : state === "over" ? ERR : C.muted;
  const out: string[] = [];
  const icon = closed
    ? `<circle cx="8" cy="8" r="6"/><path d="m5.2 8.2 1.9 1.9 3.7-4"/>`
    : `<circle cx="8" cy="9" r="5.6"/><path d="M8 6.2V9l1.9 1.3M6.4 1.8h3.2"/>`;
  out.push(`<g transform="translate(${x} ${y + 3.5}) scale(${11 / 16})" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</g>`);
  let cx = x + 14;
  if (share !== null) {
    out.push(`<rect x="${cx}" y="${y + 6.5}" width="26" height="5" rx="2.5" fill="${mix(color, 18, C.surface2)}"/>`);
    out.push(`<rect x="${cx}" y="${y + 6.5}" width="${(26 * share).toFixed(1)}" height="5" rx="2.5" fill="${color}"/>`);
    cx += 29;
  }
  out.push(`<text x="${cx}" y="${y + 12.5}" font-size="10.5" font-weight="600" font-family="${MONO}" fill="${color}">${esc(label)}</text>`);
  return { svg: out.join(""), w: cx - x + label.length * 10.5 * 0.62 + 5 };
}

export interface MapSvg {
  doc: ReturnType<typeof parse>;
  layout: ElkResult;
  /** Boxes, containers first and deeper ones later, as the app stacks them. */
  boxes: Box[];
  /** A frame's fill, drawn below the lines. */
  fill(b: Box): string;
  /** A card, or a frame's header (its fill comes from `fill`). */
  card(b: Box): string;
  edge(r: Route): string;
  label(r: Route): string;
  labelText(r: Route): string;
  /** Where each label is placed, and how big it is. */
  labels: Map<string, { x: number; y: number; w: number; h: number }>;
  /** Arrowheads and the background pattern, for `<defs>`. */
  defs: string;
  timeOf(n: RhumbNode): number;
}

/** Lay out and draw a map. `now` is the moment timers are read at, so the drawing does not drift. */
export async function renderMap(source: string, now: number): Promise<MapSvg> {
  const doc = parse(source);
    const timeOf = (n: RhumbNode) => momentOf(n, now);
  const states = new Map(derive(doc).nodes.map((s) => [s.line, s]));
  const parents = new Map<string, string | null>();
  const index = (nodes: RhumbNode[], parent: string | null) =>
    nodes.forEach((n) => (n.id && parents.set(n.id, parent), index(n.children, n.id)));
  index(doc.nodes, null);

  const letters = kindLetters(doc.nodes);
  // Laid out without times, as the app lays out a map whose lines share one commit: ordering
  // siblings by these stand-in times would stretch the example into a tall diagonal.
  const layout = await layoutElk(doc.nodes, doc.edges, new Set());

  /** A 16-grid icon drawn at 14px, as on the cards. */
  const mark = (shapes: Shape[], x: number, y: number, color: string) =>
    `<g transform="translate(${x} ${y}) scale(${14 / 16})" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">`
    + `${shapesToSvg(shapes).replaceAll("currentColor", color)}</g>`;
  /** A kind before the title: its icon, or a custom kind's letters in a box. Returns the markup and width. */
  function kindMark(n: RhumbNode, x: number, y: number): { svg: string; w: number } {
    const kind = nodeKind(n);
    if (!kind || kind === "task") return { svg: "", w: 0 };
    if (isPresetKind(kind)) return { svg: mark(KIND_SHAPES[kind], x, y, C.muted), w: 14 };
    const text = letters.get(kind) ?? kind.slice(0, 1).toUpperCase();
    const w = Math.max(14, text.length * 8.5 * 0.62 + 5);
    return {
      svg: `<rect x="${x + 0.65}" y="${y + 0.65}" width="${w - 1.3}" height="12.7" rx="3" fill="none" stroke="${C.muted}" stroke-width="1.3"/>`
        + `<text x="${x + w / 2}" y="${y + 10}" font-size="8.5" font-weight="700" font-family="${MONO}" text-anchor="middle" fill="${C.muted}">${esc(text)}</text>`,
      w,
    };
  }
  const boxes = [...layout.boxes].sort((a, b) => a.depth - b.depth);

  /** One card or frame header; frames draw only their header here, their fill comes earlier. */
  function card(b: Box): string {
    const n = b.node;
    const status = n.status ?? "todo";
    const st = ST[status];
    const bg = mix(st, b.container ? 5 : TINT[status], C.surface);
    const star = n.attrs.star === true;
    const x = b.x, y = b.y, w = b.width, h = b.height;
    const out: string[] = [];
    const op = status === "dropped" ? ` opacity="0.6"` : "";
    out.push(`<g${op}>`);
    if (!b.container) {
      const dash = status === "idea" ? ` stroke-dasharray="5 3"` : "";
      if (star) out.push(`<rect x="${x - 1}" y="${y - 1}" width="${w + 2}" height="${h + 2}" rx="9" fill="none" stroke="${mix(C.star, 55, C.bg)}" stroke-width="1"/>`);
      out.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="8" fill="${bg}" stroke="${star ? C.star : C.border}"${dash}/>`);
    } else {
      // Frame header: a 60% backdrop of the frame colour behind the title row.
      out.push(`<rect x="${x + 5}" y="${y + 1}" width="${Math.min(232, w - 6)}" height="76" rx="2" fill="${bg}" fill-opacity="0.6"/>`);
    }
    // Left edge in the full status colour.
    out.push(`<path d="M ${x + 8} ${y} H ${x + 5} V ${y + h} H ${x + 8} A 8 8 0 0 1 ${x} ${y + h - 8} V ${y + 8} A 8 8 0 0 1 ${x + 8} ${y} Z" fill="${st}"/>`);

    // Header row: status pill, title, star.
    const cx = x + 15, cy = y + 9;
    const pillW = Math.ceil(textW(status, 11)) + 10;
    out.push(`<rect x="${cx}" y="${cy}" width="${pillW}" height="17" rx="4" fill="${mix(C.surface, 70, bg)}" stroke="${C.border}"/>`);
    out.push(`<text x="${cx + 5}" y="${cy + 12.5}" font-size="11" fill="${st}">${status}</text>`);
    const km = kindMark(n, cx + pillW + 6, cy + 1.5);
    out.push(km.svg);
    const titleX = cx + pillW + 6 + (km.w ? km.w + 6 : 0);
    const titleMax = x + (b.container ? 230 : w) - 30 - titleX;
    const lines = wrap(plainTitle(n.title) || "(untitled)", 14, titleMax);
    lines.forEach((l, i) => {
      const deco = status === "dropped" ? ` text-decoration="line-through"` : "";
      out.push(`<text x="${titleX}" y="${cy + 13 + i * 17.5}" font-size="14" font-weight="550" fill="${C.text}"${deco}>${esc(l)}</text>`);
    });
    out.push(starIcon(x + (b.container ? 230 : w) - 25, cy + 1, star));

    // Foot row: short ID, ready and link badges, progress, fold toggle.
    const fy = y + 52;
    let fx = cx;
    const id = shortId(n.id, n.id ? parents.get(n.id) ?? null : null);
    out.push(`<text x="${fx}" y="${fy + 12}" font-size="11" font-family="${MONO}" fill="${C.muted}">${esc(id)}</text>`);
    fx += id.length * 11 * 0.62 + 6; // monospace
    // Claim icons after the ID: the verdict (or untested), then qualifiers.
    const claims = claimMarks(n);
    claims.forEach((m, i) => out.push(mark(CLAIM_SHAPES[m], fx + i * 16, fy + 2, m === "untested" ? C.muted : C.text)));
    if (claims.length > 0) fx += claims.length * 16 + 3;
    const chip = timerChip(n, fx, fy, now);
    out.push(chip.svg);
    fx += chip.w;
    const state = states.get(n.line);
    const badges = [
      ...(state?.ready ? [{ text: "ready", color: ST.done }] : []),
      ...(n.anchors.length > 0 ? [{ text: `${n.anchors.length} link${n.anchors.length > 1 ? "s" : ""}`, color: C.muted }] : []),
    ];
    for (const bd of badges) {
      const bw = textW(bd.text, 11) + 12;
      out.push(`<rect x="${fx}" y="${fy}" width="${bw}" height="18" rx="9" fill="${C.surface2}"/>`);
      out.push(`<text x="${fx + 6}" y="${fy + 12.5}" font-size="11" fill="${bd.color}">${bd.text}</text>`);
      fx += bw + 5;
    }
    const right = x + (b.container ? 230 : w) - 10;
    const progress = n.children.length > 0 ? state?.progress ?? null : null;
    const toggleW = n.children.length > 0 ? 20 : 0;
    if (progress) {
      const pw = Math.max(28, right - toggleW - (toggleW ? 5 : 0) - fx);
      const py = fy + 2;
      out.push(`<rect x="${fx}" y="${py}" width="${pw}" height="14" rx="7" fill="${C.surface2}"/>`);
      out.push(`<clipPath id="p-${esc(b.key)}"><rect x="${fx}" y="${py}" width="${pw}" height="14" rx="7"/></clipPath>`);
      out.push(`<rect x="${fx}" y="${py}" width="${(pw * progress.done) / progress.total}" height="14" fill="${mix(ST.done, 35, C.surface2)}" clip-path="url(#p-${esc(b.key)})"/>`);
      out.push(`<text x="${fx + pw / 2}" y="${py + 10.5}" font-size="10" text-anchor="middle" fill="${C.text}">${progress.done}/${progress.total}</text>`);
    }
    if (toggleW) {
      const tx = right - toggleW;
      out.push(`<rect x="${tx}" y="${fy}" width="${toggleW}" height="18" rx="6" fill="${mix(C.surface, 70, bg)}" stroke="${C.border}"/>`);
      out.push(`<text x="${tx + toggleW / 2}" y="${fy + 13}" font-size="12" text-anchor="middle" fill="${C.muted}">−</text>`);
    }
    out.push(`</g>`);
    return out.join("\n");
  }

  function starIcon(x: number, y: number, on: boolean): string {
    const color = on ? C.star : mix(C.muted, 60, C.surface);
    return `<path transform="translate(${x} ${y}) scale(0.62)" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="${on ? color : "none"}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }

  const labelOf = (r: Route) => r.count > 1 ? `${r.kind} ×${r.count}` : r.kind === "relates" && r.label ? r.label : r.label ? `${r.kind}: ${r.label}` : r.kind;

  function edge(r: Route): string {
    const s = EDGE[r.kind];
    const arrow = s.arrow || (r.kind === "relates" && !!r.label);
    const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : "";
    const out = [`<path d="${roundedPath(r.points)}" fill="none" stroke="${s.color}" stroke-width="${s.width}"${dash}${arrow ? ` marker-end="url(#arrow-${r.kind})"` : ""}/>`];
    for (const t of [endTab(r.points, true), arrow ? null : endTab(r.points, false)]) {
      if (t) out.push(`<rect x="${-t.w / 2}" y="${-t.h / 2}" width="${t.w}" height="${t.h}" rx="0.5" fill="${s.color}" transform="translate(${t.x} ${t.y}) rotate(${t.angle})"/>`);
    }
    return out.join("\n");
  }

  // Labels: every route's, placed as the app places them, off cards and other lines.
  const requests: LabelRequest[] = layout.routes.map((r) => ({ id: r.key, points: r.points, w: Math.min(260, textW(labelOf(r), 11)) + 14, h: 18 }));
  const cards = boxes.filter((b) => !b.container).map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height }));
  const at = placeLabels(requests, cards, 4, layout.routes.map((r) => ({ id: r.key, points: r.points })));
  function label(r: Route): string {
    const p = at.get(r.key);
    if (!p) return "";
    const text = fit(labelOf(r), 11, 260);
    const w = textW(text, 11) + 14, h = 18;
    return `<rect x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" rx="4" fill="${C.surface}" stroke="${mix(EDGE[r.kind].color, 55, C.surface)}"/>\n`
      + `<text x="${p.x}" y="${p.y + 4}" font-size="11" font-weight="600" text-anchor="middle" fill="${C.text}">${esc(text)}</text>`;
  }


  const labels = new Map([...at].map(([id, p]) => {
    const r = requests.find((q) => q.id === id)!;
    return [id, { x: p.x, y: p.y, w: r.w, h: r.h }];
  }));
  const markers = (Object.keys(EDGE) as EdgeKind[]).map((k) =>
    `<marker id="arrow-${k}" viewBox="-10 -10 20 20" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse" refX="0" refY="0">`
    + `<polyline points="-5,-4 0,0 -5,4 -5,-4" fill="${EDGE[k].color}" stroke="${EDGE[k].color}" stroke-width="1" stroke-linejoin="round"/></marker>`).join("\n");
  const defs = `<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d4d4cf"/></pattern>\n${markers}`;
  const fill = (b: Box) => `<rect x="${b.x + 0.5}" y="${b.y + 0.5}" width="${b.width - 1}" height="${b.height - 1}" rx="8" fill="${mix(ST[b.node.status ?? "todo"], 5, C.surface)}" stroke="${C.border}"/>`;
  return { doc, layout, boxes, fill, card, edge, label, labelText: labelOf, labels, defs, timeOf };
}
