// The 3D view's floor (see `depth.ts` for the geometry): the depth ruler and the time footprints
// of the work, drawn in map coordinates inside the flow's viewport, so they pan and zoom with the
// map and need no projection maths of their own.
//
// A footprint is the stretch of time a piece of work occupied, laid flat on the ground beneath its
// card, with a thin drop line joining the card to it. Solid and coloured by outcome for what really
// happened; a dashed outline for a plan (a todo's estimate), which is a guess and should not read
// as a measurement. Every timed card also gets its own track below it, ruled with a dash at each
// tick, so the card's depth can be read off against its neighbours despite the shear.

import { ViewportPortal } from "@xyflow/react";
import { memo } from "react";
import { TICK_LEN, type DepthScene, type FloorSpan, type Point } from "./depth.ts";

/** Share of its opacity a faded floor element keeps, matching the cards' fog. */
const FADE = 0.75;

function points(p: Point[]): string {
  return p.map((q) => `${q.x},${q.y}`).join(" ");
}

function SpanTitle({ s }: { s: FloorSpan }) {
  return <title>{s.title}</title>;
}

/**
 * The ruler, the tracks and the footprints. Rendered through `ViewportPortal`, so it lives in the
 * same transformed space as the cards: it pans, zooms and lines up with them for free.
 *
 * The SVG is drawn at the map's own coordinates: `viewBox` carries the negative offsets, so a
 * track beside a card at x = 0 needs no rebasing, and there is one element for the whole floor.
 */
export const DepthFloor = memo(function DepthFloor({ scene }: { scene: DepthScene }) {
  const { ruler, tracks, spans } = scene;
  const xs = [ruler.from.x, ruler.to.x, ...spans.flatMap((s) => s.points.map((p) => p.x))];
  const ys = [ruler.from.y, ruler.to.y, ...spans.flatMap((s) => s.points.map((p) => p.y))];
  const left = Math.min(...xs, ruler.captionAt.x) - 160;
  const top = Math.min(...ys) - 80;
  const width = Math.max(...xs) + 200 - left;
  const height = Math.max(...ys) + 60 - top;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  return (
    <ViewportPortal>
      <div className="floor-layer" style={{ left, top, width, height }} aria-hidden="true">
        <svg className="floor" width={width} height={height} viewBox={`${left} ${top} ${width} ${height}`}>
          <g className="floor-tracks">
            {tracks.map((t) => (
              <g key={t.key} className="floor-track" style={{ opacity: FADE }}>
                <line className="track-line" x1={t.from.x} y1={t.from.y} x2={t.to.x} y2={t.to.y} />
                {t.dashes.map((d, i) => (
                  <line key={i} className={`track-dash${d.major ? " major" : ""}`}
                    x1={d.at.x} y1={d.at.y} x2={d.at.x - TICK_LEN} y2={d.at.y + TICK_LEN * 0.85} />
                ))}
              </g>
            ))}
          </g>
          <g className="floor-spans">
            {spans.map((s) => (
              <g key={s.key} className={`floor-span ${s.kind}${s.state ? ` timer-${s.state}` : ""}`}>
                <SpanTitle s={s} />
                <line className="drop" x1={s.anchor.x} y1={s.anchor.y} x2={s.points[0]!.x} y2={s.points[0]!.y} />
                <polygon className="span-fill" points={points(s.points)} />
                <polygon className="span-edge" points={points(s.points)} />
                <text className="span-label" x={s.labelAt.x} y={s.labelAt.y}>{s.label}</text>
              </g>
            ))}
          </g>
          <g className="floor-ruler">
            <line className="ruler-line" x1={ruler.from.x} y1={ruler.from.y} x2={ruler.to.x} y2={ruler.to.y} />
            <text className="ruler-caption" x={ruler.captionAt.x} y={ruler.captionAt.y + 20}>{ruler.caption}</text>
            {ruler.ticks.map((t) => (
              <g key={t.time} className={`ruler-tick${t.major ? " major" : ""}`}>
                <line x1={t.at.x} y1={t.at.y} x2={t.at.x - TICK_LEN} y2={t.at.y + TICK_LEN * 0.85} />
                <text className="ruler-label" x={t.labelAt.x} y={t.labelAt.y}>{t.label}</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </ViewportPortal>
  );
});
