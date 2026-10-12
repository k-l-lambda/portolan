// Geometry of the kind and claim icons (spec 3.4) as plain data, on a 16px grid drawn with
// 1.6px round strokes in currentColor. `KindIcons.tsx` renders it in the app and
// `scripts/example-svg.ts` renders it into the README image, so both stay the same.

import type { ClaimMark, PresetKind } from "../../src/kinds.ts";

/** One SVG element: tag and attributes, written as in SVG markup (`stroke-dasharray`). */
export type Shape = ["path" | "circle" | "rect", Record<string, string | number>];

const dot = (cx: number, cy: number, r: number): Shape => ["circle", { cx, cy, r, fill: "currentColor", stroke: "none" }];

export const KIND_SHAPES: Record<PresetKind, Shape[]> = {
  task: [["rect", { x: 2.6, y: 2.6, width: 10.8, height: 10.8, rx: 2.6 }]],
  milestone: [["path", { d: "M3.6 14.4V1.8" }], ["path", { d: "M3.6 2.6h8.6l-2 3 2 3H3.6" }]],
  experiment: [
    ["path", { d: "M6 1.9h4M6.7 1.9v4.3L3 12.5a1.1 1.1 0 0 0 .95 1.7h8.1a1.1 1.1 0 0 0 .95-1.7L9.3 6.2V1.9" }],
    ["path", { d: "M4.7 9.9h6.6", opacity: 0.55 }],
  ],
  hypothesis: [["circle", { cx: 8, cy: 8, r: 4.5 }], ["path", { d: "M8 1.3v2.4M8 12.3v2.4M1.3 8h2.4M12.3 8h2.4" }], dot(8, 8, 0.9)],
  finding: [["path", { d: "M2 14.2h12" }], ["path", { d: "M4.6 11.6V8.6M8 11.6V4.4M11.4 11.6V6.8" }]],
  question: [
    ["path", { d: "M2.6 3.9a1.6 1.6 0 0 1 1.6-1.6h7.6a1.6 1.6 0 0 1 1.6 1.6v5.3a1.6 1.6 0 0 1-1.6 1.6H7.2l-2.9 2.6v-2.6h-.1a1.6 1.6 0 0 1-1.6-1.6z" }],
    ["path", { d: "M6.7 5.2a1.4 1.4 0 1 1 1.85 1.33c-.4.15-.55.38-.55.75" }],
    dot(8, 8.9, 0.6),
  ],
  decision: [["path", { d: "M8 14.4V9.6L3.8 4M8 9.6 12.2 4" }], ["path", { d: "M3.6 7.2V3.8H7M12.4 7.2V3.8H9" }]],
  risk: [["path", { d: "M8 2.1 1.9 13.1h12.2z" }], ["path", { d: "M8 6.5v3" }], dot(8, 11.3, 0.75)],
  artifact: [["path", { d: "M8 1.9 13.5 4.9v6.2L8 14.1 2.5 11.1V4.9z" }], ["path", { d: "M2.5 4.9 8 7.9l5.5-3M8 7.9v6.2" }]],
  reference: [
    ["path", { d: "M3.2 2.6h7.3A1.5 1.5 0 0 1 12 4.1v9.8H4.7a1.5 1.5 0 0 1-1.5-1.5z" }],
    ["path", { d: "M3.2 12.4a1.5 1.5 0 0 1 1.5-1.5H12" }],
    ["path", { d: "M6.1 5.6h3.4", opacity: 0.6 }],
  ],
  event: [["rect", { x: 2.3, y: 3.2, width: 11.4, height: 10.6, rx: 1.6 }], ["path", { d: "M2.3 6.6h11.4M5.4 1.9v2.5M10.6 1.9v2.5" }], dot(8, 10.2, 1.1)],
};

const ring: Shape = ["circle", { cx: 8, cy: 8, r: 5.6 }];
export const CLAIM_SHAPES: Record<ClaimMark, Shape[]> = {
  untested: [["circle", { cx: 8, cy: 8, r: 5.6, "stroke-dasharray": "2.1 2.3" }]],
  supported: [ring, ["path", { d: "m5.5 8.2 1.8 1.8 3.3-3.6" }]],
  partial: [ring, ["path", { d: "M8 2.4a5.6 5.6 0 0 1 0 11.2z", fill: "currentColor", stroke: "none" }]],
  refuted: [ring, ["path", { d: "m5.9 5.9 4.2 4.2m0-4.2-4.2 4.2" }]],
  inconclusive: [ring, ["path", { d: "M5.2 8.7c.9-1.3 1.9-1.3 2.8 0s1.9 1.3 2.8 0" }]],
  replicated: [
    ["rect", { x: 4.7, y: 4.7, width: 8.9, height: 8.9, rx: 1.6 }],
    ["path", { d: "M2.4 10.6V3.8a1.4 1.4 0 0 1 1.4-1.4h6.8" }],
    ["path", { d: "m6.9 9.3 1.5 1.5 2.9-3.1" }],
  ],
  contested: [["path", { d: "M2 8h12M5 5 2 8l3 3M11 5l3 3-3 3" }]],
  retracted: [["path", { d: "M5.6 3.3 2.5 6.4l3.1 3.1" }], ["path", { d: "M2.7 6.4h6.5a3.8 3.8 0 0 1 0 7.6H6.6" }]],
};

/** The shapes as SVG markup, for renderers without a DOM. */
export function shapesToSvg(shapes: Shape[]): string {
  return shapes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
}
