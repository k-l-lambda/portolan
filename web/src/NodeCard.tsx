import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { NodeState } from "../../src/derive.ts";
import type { RhumbNode, Status } from "../../src/types.ts";
import { plainTitle } from "./layout.ts";
import { ProgressBar } from "./ProgressBar.tsx";

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
  state: NodeState | undefined;
  hidden: number;
  selected: boolean;
  collapsed: boolean;
  onStatus: (node: RhumbNode, status: Status) => void;
  onToggle: (node: RhumbNode) => void;
}

export type CardNode = Node<CardData, "card">;

export const NodeCard = memo(function NodeCard({ data }: NodeProps<CardNode>) {
  const { node, state, hidden, selected, collapsed, onStatus, onToggle } = data;
  const status = node.status ?? "todo";
  const title = plainTitle(node.title) || "(untitled)";
  return (
    <div className={`card status-${status}${selected ? " selected" : ""}`} title={title}>
      <Handle type="target" position={Position.Left} id="tree-in" className="handle" />
      <Handle type="source" position={Position.Right} id="tree-out" className="handle" />
      <Handle type="target" position={Position.Top} id="x-in" className="handle" />
      <Handle type="source" position={Position.Bottom} id="x-out" className="handle" />
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
        <span className="card-title">{title}</span>
      </div>
      <div className="card-foot">
        <span className="card-id">{node.id ? `^${node.id}` : "no id"}</span>
        {state?.ready && <span className="badge badge-ready">ready</span>}
        {node.anchors.length > 0 && <span className="badge">{node.anchors.length} link{node.anchors.length > 1 ? "s" : ""}</span>}
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
  );
});
