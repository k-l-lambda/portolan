import { useStore, useViewport } from "@xyflow/react";
import { exitPoint, measureLabel, placeEnds, type EndRequest, type Rect, type Side } from "./geometry.ts";

/** One end of a highlighted line: the node there and the line, in flow coordinates, source to target. */
export interface LineEnd {
  key: string;
  title: string;
  status: string;
  rect: Rect;
  points: { x: number; y: number }[];
  /** The node is the line's target (else its source). */
  atEnd: boolean;
}

/** Screen pixels kept between a box and the edge of the main view. */
const MARGIN = 6;
/** Widest box, and the room a box takes beside its title (padding, border, arrow). */
const MAX_W = 220, CHROME_W = 34, BOX_H = 24;
/** A card counts as on screen while this much of it, in pixels each way, is in view. */
const SEEN = 8;
const ARROW: Record<Side, string> = { left: "←", right: "→", top: "↑", bottom: "↓" };

/**
 * For the lines a hover highlights: a node at a line's end that is off screen gets a stand-in box at
 * the edge of the view, where the line leaves it, with the node's title. Drawn in screen pixels over
 * the map and following every pan and zoom; it takes no pointer events, so the hover stays put.
 */
export function OffscreenEnds({ ends }: { ends: LineEnd[] }) {
  const { x, y, zoom } = useViewport();
  const fw = useStore((s) => s.width), fh = useStore((s) => s.height);
  if (ends.length === 0 || fw === 0 || fh === 0) return null;
  const view: Rect = { x: MARGIN, y: MARGIN, w: fw - 2 * MARGIN, h: fh - 2 * MARGIN };
  const screen = (p: { x: number; y: number }) => ({ x: p.x * zoom + x, y: p.y * zoom + y });
  // The navigator and the zoom buttons sit over the view; boxes keep off them.
  const pane = document.querySelector(".canvas .react-flow")?.getBoundingClientRect();
  const avoid: Rect[] = pane ? [...document.querySelectorAll(".canvas .react-flow__panel")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x - pane.x - 4, y: r.y - pane.y - 4, w: r.width + 8, h: r.height + 8 };
  }).filter((r) => r.w > 8 && r.h > 8) : [];

  const shown = new Map<string, LineEnd>();
  const requests: EndRequest[] = [];
  for (const end of ends) {
    if (shown.has(end.key)) continue; // one box per node, at the first of its lines to reach it
    const a = screen(end.rect), w = end.rect.w * zoom, h = end.rect.h * zoom;
    const seen = Math.min(a.x + w, view.x + view.w) - Math.max(a.x, view.x) > SEEN
      && Math.min(a.y + h, view.y + view.h) - Math.max(a.y, view.y) > SEEN;
    if (seen) continue;
    const exit = exitPoint(end.points.map(screen), view, end.atEnd);
    if (!exit) continue; // the line is off screen as well
    shown.set(end.key, end);
    requests.push({ id: end.key, at: exit, side: exit.side, w: Math.min(MAX_W, measureLabel(end.title, 12, true) + CHROME_W), h: BOX_H });
  }
  if (requests.length === 0) return null;
  const at = placeEnds(requests, view, avoid);
  return (
    <div className="offscreen-ends" aria-hidden="true">
      {requests.map((r) => {
        const end = shown.get(r.id)!, p = at.get(r.id)!;
        return (
          <div key={r.id} className={`offscreen-end status-${end.status} side-${r.side}`} style={{ left: p.x, top: p.y, width: p.w, height: p.h }}>
            <span className="offscreen-arrow">{ARROW[r.side]}</span>
            <span className="offscreen-title">{end.title}</span>
          </div>
        );
      })}
    </div>
  );
}
