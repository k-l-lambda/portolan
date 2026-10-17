// Renders a .rhumb map as a static SVG in the web view's light theme, for the README.
// Uses the same ELK layout and label placement as the app; every subtree is expanded and
// every edge label is shown. Usage: node scripts/example-svg.ts [in.rhumb] [out.svg]

import { readFileSync, writeFileSync } from "node:fs";
import { C, esc, FONT, renderMap } from "./mapSvg.ts";

// Timers are read at a fixed moment, so the image does not change from one run to the next.
process.env.TZ = "UTC";
export const EXAMPLE_NOW = Date.UTC(2026, 9, 17, 18, 0) / 1000;

const [input = "docs/example.rhumb", output = "docs/example.svg"] = process.argv.slice(2);
const MARGIN = 24;
const m = await renderMap(readFileSync(input, "utf8"), EXAMPLE_NOW);
const { layout, boxes, doc } = m;

// Bounds of everything drawn, so labels and arrows past the frames are not cut off.
let minX = 0, minY = 0, maxX = layout.width, maxY = layout.height;
for (const p of m.labels.values()) {
  minX = Math.min(minX, p.x - p.w / 2); maxX = Math.max(maxX, p.x + p.w / 2);
  minY = Math.min(minY, p.y - p.h / 2); maxY = Math.max(maxY, p.y + p.h / 2);
}
const W = Math.ceil(maxX - minX + 2 * MARGIN), H = Math.ceil(maxY - minY + 2 * MARGIN);

// Stacking as in the app: frame fills, lines, frame headers, cards, labels.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${minX - MARGIN} ${minY - MARGIN} ${W} ${H}" font-family="${FONT}" role="img" aria-labelledby="t">
<title id="t">${esc(doc.title ?? "Rhumb map")}: ${input.split("/").pop()} in the Portolan web view</title>
<defs>
${m.defs}
</defs>
<rect x="${minX - MARGIN}" y="${minY - MARGIN}" width="${W}" height="${H}" fill="${C.bg}"/>
<rect x="${minX - MARGIN}" y="${minY - MARGIN}" width="${W}" height="${H}" fill="url(#dots)"/>
${boxes.filter((b) => b.container).map(m.fill).join("\n")}
${layout.routes.map(m.edge).join("\n")}
${boxes.filter((b) => b.container).map(m.card).join("\n")}
${boxes.filter((b) => !b.container).map(m.card).join("\n")}
${layout.routes.map(m.label).join("\n")}
</svg>
`;

writeFileSync(output, svg);
console.log(`${output}: ${W}×${H}, ${boxes.length} boxes, ${layout.routes.length} lines`);
