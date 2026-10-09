import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { labelPoint, roundedPath } from "./geometry.ts";

export interface PolylineData extends Record<string, unknown> {
  /** Absolute points computed by the ELK layout, source to target. */
  points: { x: number; y: number }[];
}

export type PolylineEdgeType = Edge<PolylineData, "polyline">;

export const PolylineEdge = memo(function PolylineEdge(props: EdgeProps<PolylineEdgeType>) {
  const points = props.data?.points ?? [];
  const at = labelPoint(points);
  return (
    <BaseEdge
      id={props.id}
      path={roundedPath(points)}
      markerEnd={props.markerEnd}
      style={props.style}
      interactionWidth={props.interactionWidth}
      label={props.label}
      labelX={at.x}
      labelY={at.y}
      labelBgPadding={props.labelBgPadding}
      labelBgBorderRadius={props.labelBgBorderRadius}
    />
  );
});
