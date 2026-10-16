// The 3D view's scene furniture (see `depth.ts` for the camera): the ruler standing at the older
// edge of the scene, the ground grid, each raised card's drop line, and the time bars standing on
// the ground under their cards.
//
// All of it is drawn in map coordinates inside the flow's viewport portal, so it pans and zooms
// with the cards and needs no projection maths of its own. A bar is solid and coloured by outcome
// for what really happened, and an outline for a plan (a todo's estimate), which is a guess and
// should not read as a measurement.

import { ViewportPortal } from "@xyflow/react";
import { memo } from "react";
import { TICK_LEN, type Bar, type DepthScene, type Point } from "./depth.ts";

function poly(p: Point[]): string {
  return p.map((q) => `${q.x},${q.y}`).join(" ");
}

function BarTitle({ bar }: { bar: Bar }) {
  return <title>{bar.title}</title>;
}

/**
 * The ruler, the ground grid and the bars. Rendered through `ViewportPortal`, so it lives in the
 * same transformed space as the cards: it pans, zooms and lines up with them for free. The SVG is
 * drawn at the map's own coordinates, so a scene nowhere near the origin needs no rebasing.
 */
export const DepthFloor = memo(function DepthFloor({ scene }: { scene: DepthScene }) {
  const { ruler, bars, drops } = scene;
  const pts = [
    ruler.foot, ...ruler.ticks.map((t) => t.at), ruler.captionAt,
    ...bars.flatMap((b) => b.points), ...drops.flatMap((d) => [d.from, d.to]),
  ];
  const LEFT = 700, TOP = 500;
  const minX = Math.min(...pts.map((p) => p.x)) - LEFT, maxX = Math.max(...pts.map((p) => p.x)) + LEFT;
  const minY = Math.min(...pts.map((p) => p.y)) - TOP, maxY = Math.max(...pts.map((p) => p.y)) + TOP;
  const width = maxX - minX, height = maxY - minY;
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  return (
    <ViewportPortal>
      <div className="floor-layer" style={{ left: minX, top: minY, width, height }} aria-hidden="true">
        <svg className="floor" width={width} height={height} viewBox={`${minX} ${minY} ${width} ${height}`}>
          {/* The ground the map lies on. Cards stand above it and their drop lines fall to it, so the
              plane is what turns a scatter of cards into a scene with a floor. */}
          <polygon className="ground" points={poly(scene.ground)} />
          {/* Each group as its own rectangle on that plane: the map's own shape, which is what the
              time axis rises out of. */}
          <g className="floor-groups">
            {scene.footprints.map((f) => (
              <g key={f.key} className="floor-group">
                <polygon className="group-fill" points={poly(f.points)} />
                <text className="group-label" x={f.labelAt.x} y={f.labelAt.y}>{f.label}</text>
              </g>
            ))}
          </g>
          <g className="floor-drops">
            {drops.map((d) => (
              <line key={d.key} className="drop" x1={d.from.x} y1={d.from.y} x2={d.to.x} y2={d.to.y} />
            ))}
          </g>
          <g className="floor-bars">
            {bars.map((b) => (
              <g key={b.key} className={`floor-bar ${b.kind}${b.state ? ` timer-${b.state}` : ""}`}>
                <BarTitle bar={b} />
                <polygon className="bar-fill" points={poly(b.points)} />
                <polygon className="bar-edge" points={poly(b.points)} />
                <text className="bar-label" x={b.labelAt.x} y={b.labelAt.y}>{b.label}</text>
              </g>
            ))}
          </g>
          <g className="floor-ruler">
            <line className="ruler-line" x1={ruler.foot.x} y1={ruler.foot.y} x2={ruler.captionAt.x} y2={ruler.captionAt.y} />
            <line className="ruler-axis" x1={ruler.foot.x} y1={ruler.foot.y} x2={ruler.captionAt.x} y2={ruler.captionAt.y} />
            {ruler.ticks.map((t) => (
              <g key={t.time} className={`ruler-tick${t.major ? " major" : ""}`}>
                <line x1={t.at.x} y1={t.at.y} x2={t.at.x + TICK_LEN} y2={t.at.y} />
                <text className="ruler-label" x={t.labelAt.x} y={t.labelAt.y} textAnchor="end">{t.label}</text>
              </g>
            ))}
            <text className="ruler-caption" x={ruler.captionAt.x} y={ruler.captionAt.y + 16} textAnchor="middle">{ruler.caption}</text>
          </g>
        </svg>
      </div>
    </ViewportPortal>
  );
});
