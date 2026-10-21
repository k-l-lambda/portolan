import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, type CSSProperties } from "react";
import type { NodeState } from "../../src/derive.ts";
import type { RhumbNode, Status } from "../../src/types.ts";
import { claimMarks, plainTitle, shortId, starred } from "./layout.ts";
import { ClaimIcon, KindMark } from "./KindIcons.tsx";
import { nodeKind } from "../../src/kinds.ts";
import type { Timing } from "../../src/timing.ts";
import { TimerChip } from "./TimerChip.tsx";
import { READ_ONLY } from "./api.ts";
import { ProgressBar } from "./ProgressBar.tsx";
import { StarIcon } from "./StarIcon.tsx";
import type { NodeTime } from "../../src/history.ts";

// Where the cards' star has always been imported from.
export { StarIcon };

export const STATUSES: { value: Status; label: string }[] = [
  { value: "todo", label: "todo" },
  { value: "doing", label: "doing" },
  { value: "done", label: "done" },
  { value: "blocked", label: "blocked" },
  { value: "idea", label: "idea" },
  { value: "dropped", label: "dropped" },
];

export interface CardData extends Record<string, unknown> {
  node: RhumbNode;
  parentId: string | null;
  state: NodeState | undefined;
  /** 0..1, drives the brightness of the left border. */
  fresh: number;
  updated: NodeTime | undefined;
  updatedText: string;
  hidden: number;
  /** Drawn as a frame around its children instead of a card. */
  container: boolean;
  selected: boolean;
  collapsed: boolean;
  /** Starred descendants hidden while this card is collapsed. */
  starsInside: number;
  /** Letters of a custom kind (see `kindLetters`); unused for preset kinds. */
  kindLetters: string | undefined;
  /** Time of a doing item against its estimate, refreshed with the view's clock. */
  timing: Timing | null;
  onStatus: (node: RhumbNode, status: Status) => void;
  onToggle: (node: RhumbNode) => void;
  onStar: (node: RhumbNode) => void;
}

/** "card" is an item or a frame; "fill" is a frame's background layer drawn below the lines. */
export type CardNode = Node<CardData, "card" | "fill">;

export const NodeCard = memo(function NodeCard({ data }: NodeProps<CardNode>) {
  const { node, parentId, state, fresh, updatedText, hidden, container, selected, collapsed, starsInside, kindLetters, timing, onStatus, onToggle, onStar } = data;
  const status = node.status ?? "todo";
  const title = plainTitle(node.title) || "(untitled)";
  const isStar = starred(node);
  // A task is the default kind, so it carries no mark.
  const kind = nodeKind(node);
  const claims = claimMarks(node);
  return (
    <div className={`card status-${status}${container ? " container" : ""}${selected ? " selected" : ""}${isStar ? " starred" : ""}`}
      style={{ "--fresh": `${Math.round(20 + fresh * 80)}%` } as CSSProperties}
      title={updatedText ? `${title}\n${updatedText}` : title}>
      <Handle type="target" position={Position.Left} className="handle" />
      <Handle type="source" position={Position.Right} className="handle" />
      <div className="card-header">
      <div className="card-head">
        <select
          className={`status-select nodrag status-${status}`}
          aria-label={`Status of ${title}`}
          value={status}
          disabled={!node.id || READ_ONLY}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onStatus(node, e.target.value as Status)}
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {kind && kind !== "task" && <KindMark kind={kind} letters={kindLetters} />}
        {/* The title, clamped to two lines; on hover the whole of it, on one line, in a label laid
            over it, which lets the pointer through to the controls under it. */}
        <span className="card-title-box">
          <span className="card-title">{title}</span>
          <span className="card-title-full" aria-hidden="true">{title}</span>
        </span>
        <button
          type="button"
          className={`star-toggle nodrag${isStar ? " on" : ""}`}
          aria-pressed={isStar}
          aria-label={isStar ? `Unstar ${title}` : `Star ${title}`}
          title={READ_ONLY ? (isStar ? "Starred" : "Not starred") : node.id ? (isStar ? "Unstar (s)" : "Star (s)") : "Needs an ID to be starred"}
          disabled={!node.id || READ_ONLY}
          onClick={(e) => (e.stopPropagation(), onStar(node))}
        >
          <StarIcon filled={isStar} />
        </button>
      </div>
      <div className="card-foot">
        <span className="card-id" title={node.id ? `^${node.id}` : undefined}>{shortId(node.id, parentId)}</span>
        {claims.length > 0 && <span className="claim-marks">{claims.map((m) => <ClaimIcon key={m} mark={m} />)}</span>}
        {timing && <TimerChip timing={timing} />}
        {state?.ready && <span className="badge badge-ready">ready</span>}
        {node.anchors.length > 0 && <span className="badge">{node.anchors.length} link{node.anchors.length > 1 ? "s" : ""}</span>}
        {collapsed && starsInside > 0 && (
          <span className="badge badge-star" title={`${starsInside} starred inside`}>
            <StarIcon filled /> {starsInside}
          </span>
        )}
        <ProgressBar progress={node.children.length > 0 ? state?.progress ?? null : null} />
        {node.children.length > 0 && (
          <button
            type="button"
            className="toggle nodrag"
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            onClick={(e) => (e.stopPropagation(), onToggle(node))}
          >
            {collapsed ? `+${hidden}` : "−"}
          </button>
        )}
      </div>
      </div>
    </div>
  );
});

/** A frame's fill, drawn as its own node below the relation lines; the frame itself is transparent. */
export const FrameFill = memo(function FrameFill({ data }: NodeProps<CardNode>) {
  return <div className={`card container frame-fill status-${data.node.status ?? "todo"}`} aria-hidden="true" />;
});
