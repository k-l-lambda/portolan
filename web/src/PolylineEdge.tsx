import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { labelPoint, roundedPath } from "./geometry.ts";

export interface PolylineData extends Record<string, unknown> {
  /** Absolute points computed by the ELK layout, source to target. */
  points: { x: number; y: number }[];
  /** Label position chosen to avoid other labels and lines; defaults to the longest segment's middle. */
  labelAt?: { x: number; y: number };
  /** Edge kind class and focus state, repeated on the label because it lives in another layer. */
  labelClass?: string;
  /** Hidden labels stay mounted (faded out), so showing and hiding can be animated. */
  labelShown?: boolean;
}

export type PolylineEdgeType = Edge<PolylineData, "polyline">;

/**
 * Labels go through EdgeLabelRenderer (an HTML layer above every edge path) instead of the
 * edge's own SVG group, so a later edge can never draw its line across an earlier label.
 */
export const PolylineEdge = memo(function PolylineEdge(props: EdgeProps<PolylineEdgeType>) {
  const points = props.data?.points ?? [];
  const at = props.data?.labelAt ?? labelPoint(points);
  return (
    <>
      <BaseEdge id={props.id} path={roundedPath(points)} markerEnd={props.markerEnd} style={props.style}
        interactionWidth={props.interactionWidth} />
      {props.label !== undefined && props.label !== null && (
        <EdgeLabelRenderer>
          <div className={`edge-label ${props.data?.labelClass ?? ""}${props.data?.labelShown === false ? " is-hidden" : ""}`}
            data-edge={props.id} aria-hidden={props.data?.labelShown === false || undefined}

            style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}>
            {props.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
