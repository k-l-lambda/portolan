import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, type CSSProperties } from "react";
import type { NodeState } from "../../src/derive.ts";
import type { RhumbNode, Status } from "../../src/types.ts";
import { plainTitle, shortId, starred } from "./layout.ts";
import { ProgressBar } from "./ProgressBar.tsx";
import type { NodeTime } from "../../src/history.ts";

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
  onStatus: (node: RhumbNode, status: Status) => void;
  onToggle: (node: RhumbNode) => void;
  onStar: (node: RhumbNode) => void;
}

export type CardNode = Node<CardData, "card">;

export const NodeCard = memo(function NodeCard({ data }: NodeProps<CardNode>) {
  const { node, parentId, state, fresh, updatedText, hidden, container, selected, collapsed, starsInside, onStatus, onToggle, onStar } = data;
  const status = node.status ?? "todo";
  const title = plainTitle(node.title) || "(untitled)";
  const isStar = starred(node);
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
          disabled={!node.id}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onStatus(node, e.target.value as Status)}
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <span className="card-title"><span className="card-title-text">{title}</span></span>
        <button
          type="button"
          className={`star-toggle nodrag${isStar ? " on" : ""}`}
          aria-pressed={isStar}
          aria-label={isStar ? `Unstar ${title}` : `Star ${title}`}
          title={node.id ? (isStar ? "Unstar (s)" : "Star (s)") : "Needs an ID to be starred"}
          disabled={!node.id}
          onClick={(e) => (e.stopPropagation(), onStar(node))}
        >
          <StarIcon filled={isStar} />
        </button>
      </div>
      <div className="card-foot">
        <span className="card-id" title={node.id ? `^${node.id}` : undefined}>{shortId(node.id, parentId)}</span>
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

export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="star-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
        fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
