// The 3D view's scene furniture (see `depth.ts` for the camera): the floor under the scene with the
// time ruler along its near edge, the drop lines from the panels to the floor, and the time bars
// under the timed cards. Plus the flat title shown for the hovered panel, since a panel seen at 45°
// is foreshortened, and the navigator, which draws the flat map whatever the main view shows.
//
// The furniture is drawn in flow coordinates inside the viewport portal, so it pans and zooms with
// the panels. Its text and marks are scaled against the zoom, so the ruler stays readable at any
// zoom instead of shrinking to specks with the map.

import { Panel as FlowPanel, useReactFlow, useStore, useViewport, ViewportPortal } from "@xyflow/react";
import { memo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { rulerLine, rulerTicks, type Bar, type DepthScene, type Panel, type Point } from "./depth.ts";
import type { Box } from "./elkLayout.ts";

function poly(p: Point[]): string {
  return p.map((q) => `${q.x},${q.y}`).join(" ");
}

function BarTitle({ bar }: { bar: Bar }) {
  return <title>{bar.title}</title>;
}

/** The floor, ruler, outlines, drop lines and bars, at a zoom (for the ruler's tick density and text size). */
/** What the floor needs of an item beyond its geometry: its status and how fresh it is (0..1). */
export interface FloorMark { status: string; fresh: number }

export const DepthFloor = memo(function DepthFloor({ scene, zoom, marks }: { scene: DepthScene; zoom: number; marks: Map<string, FloorMark> }) {
  const { bars, drops, floor, shadows } = scene;
  const ticks = rulerTicks(scene, zoom);
  const line = rulerLine(scene);
  // One screen pixel in flow units: marks and text are sized in it, so they keep their screen size.
  const px = 1 / Math.max(0.05, zoom);
  const pts = [
    ...floor.quad, ...line.older, ...line.newer, ...ticks.flatMap((t) => [t.at, t.far]),
    ...bars.flatMap((b) => b.points), ...drops.flatMap((d) => [d.from, d.to]), ...shadows.flatMap((s) => [s.from, s.to]),
  ];
  const pad = 60 * px;
  const minX = Math.min(...pts.map((p) => p.x)) - pad, maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad, maxY = Math.max(...pts.map((p) => p.y)) + pad;
  const width = maxX - minX, height = maxY - minY;
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  return (
    <ViewportPortal>
      {/* Faded in with the camera's turn, so the move from the flat view starts from the flat view. */}
      <div className="floor-layer" style={{ left: minX, top: minY, width, height, opacity: scene.pose.blend } as CSSProperties} aria-hidden="true">
        <svg className="floor" width={width} height={height} viewBox={`${minX} ${minY} ${width} ${height}`}>
          {/* The floor under the scene, and a line across it at each tick, so a card's moment can be
              read off the ruler by following its drop line down and the grid line forward. */}
          <polygon className="ground" points={poly(floor.quad)} />
          <g className="floor-grid">
            {ticks.map((t) => (
              <line key={t.time} className={t.major ? "major" : undefined} x1={t.at.x} y1={t.at.y} x2={t.far.x} y2={t.far.y} />
            ))}
          </g>
          {/* Each item's projection on the floor, in its status colour: the line its panel stands
              on, with a dot at its left end whose strength is the item's freshness, as the card's
              left edge is. Under them, each timer bar's own projection along the time axis. */}
          <g className="floor-shadows">
            {shadows.map((sh) => {
              const mk = marks.get(sh.key);
              const style = { "--st": `var(--st-${mk?.status ?? "todo"})`, "--fresh": `${Math.round(20 + (mk?.fresh ?? 0) * 80)}%` } as CSSProperties;
              return (
                <g key={sh.key} className="floor-shadow" style={style}>
                  <line x1={sh.from.x} y1={sh.from.y} x2={sh.to.x} y2={sh.to.y} />
                  <circle cx={sh.from.x} cy={sh.from.y} r={2.1 * px} />
                </g>
              );
            })}
          </g>
          <g className="floor-grounds">
            {bars.map((b) => b.ground && (
              <g key={b.key} className={`floor-ground ${b.kind}${b.plan ? " progress" : ""}${b.state ? ` timer-${b.state}` : ""}`}>
                {b.ground.track && <line className="ground-track" x1={b.ground.track[0].x} y1={b.ground.track[0].y} x2={b.ground.track[1].x} y2={b.ground.track[1].y} />}
                {b.ground.fill && <line className="ground-fill" x1={b.ground.fill[0].x} y1={b.ground.fill[0].y} x2={b.ground.fill[1].x} y2={b.ground.fill[1].y} />}
                {b.ground.over && <line className="ground-over" x1={b.ground.over[0].x} y1={b.ground.over[0].y} x2={b.ground.over[1].x} y2={b.ground.over[1].y} />}
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
              <g key={b.key} className={`floor-bar ${b.kind}${b.plan ? " progress" : ""}${b.inferred ? " inferred" : ""}${b.state ? ` timer-${b.state}` : ""}`}>
                <BarTitle bar={b} />
                {/* The planned stretch, an outline; the run, solid over it; any overtime past it. */}
                {b.track && <polygon className="bar-track" points={poly(b.track)} />}
                {b.fill && <polygon className="bar-fill" points={poly(b.fill)} />}
                {b.over && <polygon className="bar-over" points={poly(b.over)} />}
                {b.nowAt && <line className="bar-now" x1={b.nowAt[0].x} y1={b.nowAt[0].y} x2={b.nowAt[1].x} y2={b.nowAt[1].y} />}
                <text className="bar-label" x={b.labelAt.x + 5 * px} y={b.labelAt.y} dominantBaseline="middle" style={{ fontSize: 10 * px }}>{b.label}</text>
              </g>
            ))}
          </g>
          {/* The ruler: solid over the window, dashed over the squeezed tails, where the scale is no
              longer even and a reading would mislead. */}
          <g className="floor-ruler" style={{ strokeWidth: 1.4 * px }}>
            <line className="ruler-line" x1={line.window[0].x} y1={line.window[0].y} x2={line.window[1].x} y2={line.window[1].y} />
            <line className="ruler-tail" x1={line.older[0].x} y1={line.older[0].y} x2={line.older[1].x} y2={line.older[1].y} />
            <line className="ruler-tail" x1={line.newer[0].x} y1={line.newer[0].y} x2={line.newer[1].x} y2={line.newer[1].y} />
            {ticks.map((t) => (
              <g key={t.time} className={`ruler-tick${t.major ? " major" : ""}`}>
                <line x1={t.at.x} y1={t.at.y} x2={t.at.x} y2={t.at.y + 8 * px} />
                <text className="ruler-label" x={t.at.x} y={t.at.y + 21 * px} textAnchor="middle" style={{ fontSize: 11 * px }}>{t.label}</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </ViewportPortal>
  );
});

/**
 * The hovered panel's title, flat and at its natural size, just above the panel. It is drawn in
 * screen space, outside the viewport transform, so it reads the same at any zoom and angle.
 */
export function HoverTitle({ panel, title, sub }: { panel: Panel; title: string; sub: string }) {
  const { x, y, zoom } = useViewport();
  // Above a group's header rather than its whole frame, which can reach far past the title.
  const q = panel.header ?? panel.quad;
  const left = ((q[0]!.x + q[1]!.x) / 2) * zoom + x;
  const top = Math.min(q[0]!.y, q[1]!.y) * zoom + y;
  return (
    <div className="hover-title" style={{ left, top }} role="tooltip">
      <div className="hover-title-text">{title}</div>
      {sub && <div className="hover-title-sub">{sub}</div>}
    </div>
  );
}

/** The navigator's size on screen, as xyflow's own. */
const MINI_W = 200, MINI_H = 150;

/**
 * The navigator: the flat map and the flat view's frame, always — in 3D too. xyflow's own minimap
 * draws the nodes where they are drawn, which in 3D is their projected panels; this one draws the
 * layout's boxes, so the frame keeps meaning one thing: the flat camera whose cards set the 3D pose.
 * Dragging the frame pans that camera and the wheel zooms it, as xyflow's does; `onDrag` reports a
 * drag starting and ending, so the pose can follow once at the end rather than on every step.
 */
export function FlatMiniMap({ boxes, classOf, onDrag }: { boxes: Box[]; classOf: (b: Box) => string; onDrag: (on: boolean) => void }) {
  const flow = useReactFlow();
  const [tx, ty, k] = useStore((st) => st.transform);
  const fw = useStore((st) => st.width), fh = useStore((st) => st.height);
  const view = { x: -tx / k, y: -ty / k, width: fw / k, height: fh / k };
  // Every laid-out box is on the map; a folded group is one box (its `hidden` counts what it holds).
  const shown = boxes;
  const xs = [view.x, ...shown.map((b) => b.x)], ys = [view.y, ...shown.map((b) => b.y)];
  const rs = [view.x + view.width, ...shown.map((b) => b.x + b.width)], bs = [view.y + view.height, ...shown.map((b) => b.y + b.height)];
  const bound = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...rs) - Math.min(...xs), height: Math.max(...bs) - Math.min(...ys) };
  // Fitted as xyflow fits its own: the larger of the two scales, centred, with a margin.
  const scale = Math.max(bound.width / MINI_W, bound.height / MINI_H);
  const vw = scale * MINI_W, vh = scale * MINI_H, off = 5 * scale;
  const vx = bound.x - (vw - bound.width) / 2 - off, vy = bound.y - (vh - bound.height) / 2 - off;
  const W = vw + 2 * off, H = vh + 2 * off;

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; zoom: number; moved: boolean } | null>(null);
  const wheelEnd = useRef(0);
  /** Flow units per screen pixel inside the navigator. */
  const unit = W / MINI_W;
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const v = flow.getViewport();
    drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, zoom: v.zoom, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    onDrag(true);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    // The frame moves with the pointer, so the view moves the other way, in the view's own pixels.
    const dx = (e.clientX - d.x) * unit * d.zoom, dy = (e.clientY - d.y) * unit * d.zoom;
    flow.setViewport({ x: d.vx - dx, y: d.vy - dy, zoom: d.zoom });
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      // A click centres the frame on the point clicked.
      const r = e.currentTarget.getBoundingClientRect();
      const px = vx - off + ((e.clientX - r.x) / r.width) * W, py = vy - off + ((e.clientY - r.y) / r.height) * H;
      flow.setViewport({ x: fw / 2 - px * d.zoom, y: fh / 2 - py * d.zoom, zoom: d.zoom });
    }
    onDrag(false);
  };
  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    const v = flow.getViewport();
    const zoom = Math.min(2, Math.max(0.1, v.zoom * Math.pow(2, -e.deltaY * 0.002)));
    // About the frame's centre, so the region in the frame stays in it.
    const cx = (fw / 2 - v.x) / v.zoom, cy = (fh / 2 - v.y) / v.zoom;
    onDrag(true);
    flow.setViewport({ x: fw / 2 - cx * zoom, y: fh / 2 - cy * zoom, zoom });
    clearTimeout(wheelEnd.current);
    wheelEnd.current = window.setTimeout(() => onDrag(false), 200);
  };

  return (
    <FlowPanel position="bottom-right" className="react-flow__minimap flat-minimap">
      <svg width={MINI_W} height={MINI_H} viewBox={`${vx - off} ${vy - off} ${W} ${H}`} className="react-flow__minimap-svg" role="img"
        aria-label="Navigator: the flat map, and the region the main view frames"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        {[...shown].sort((a, b) => a.depth - b.depth).map((b) => (
          <rect key={b.key} className={`react-flow__minimap-node ${classOf(b)}`} x={b.x} y={b.y} width={b.width} height={b.height} rx={5} ry={5} />
        ))}
        <path className="react-flow__minimap-mask" fillRule="evenodd" pointerEvents="none"
          d={`M${vx - 2 * off},${vy - 2 * off}h${W + 2 * off}v${H + 2 * off}h${-W - 2 * off}z M${view.x},${view.y}h${view.width}v${view.height}h${-view.width}z`} />
      </svg>
    </FlowPanel>
  );
}
