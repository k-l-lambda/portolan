import {
  Background, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, type Edge as FlowEdge,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RhumbNode, Status } from "../../src/types.ts";
import { api, ApiError, onServerEvents, type DocResponse } from "./api.ts";
import { CARD_H, CARD_W, layoutTree, nodeKey, type LaidOutEdge } from "./layout.ts";
import { NodeCard, type CardNode } from "./NodeCard.tsx";
import { SidePanel } from "./SidePanel.tsx";

const nodeTypes = { card: NodeCard };

const EDGE_STYLE: Record<LaidOutEdge["kind"], { className: string; arrow: boolean; dashed?: string }> = {
  tree: { className: "edge-tree", arrow: false },
  needs: { className: "edge-needs", arrow: true },
  blocks: { className: "edge-blocks", arrow: true },
  relates: { className: "edge-relates", arrow: false, dashed: "4 4" },
  replaces: { className: "edge-replaces", arrow: true, dashed: "8 4" },
  from: { className: "edge-from", arrow: true, dashed: "2 4" },
};

export function DocView({ file }: { file: string }) {
  return (
    <ReactFlowProvider>
      <DocViewInner file={file} />
    </ReactFlowProvider>
  );
}

function DocViewInner({ file }: { file: string }) {
  const [data, setData] = useState<DocResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    api.doc(file).then((r) => (setData(r), setError(null)), (e) => setError(String(e.message)));
  }, [file]);

  useEffect(() => {
    load();
    return onServerEvents({ change: (e) => e.file === file && load() });
  }, [file, load]);

  const all = useMemo(() => {
    const map = new Map<string, RhumbNode>();
    const walk = (ns: RhumbNode[]) => ns.forEach((n) => (map.set(nodeKey(n), n), walk(n.children)));
    if (data) walk(data.doc.nodes);
    return map;
  }, [data]);

  const onStatus = useCallback(async (node: RhumbNode, status: Status) => {
    if (!data || !node.id) return;
    try {
      await api.edit(file, data.version, { op: "set-status", id: node.id, status });
      setNotice(null);
    } catch (e) {
      setNotice(e instanceof ApiError && e.status === 409
        ? "The file changed on disk; reloaded the latest version. Try again."
        : `Edit failed: ${(e as Error).message}`);
    }
    load();
  }, [data, file, load]);

  const onToggle = useCallback((node: RhumbNode) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      const key = nodeKey(node);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as CardNode[], edges: [] as FlowEdge[] };
    const states = new Map(data.derived.map((s) => [s.line, s]));
    const layout = layoutTree(data.doc.nodes, data.doc.edges, collapsed);
    const nodes: CardNode[] = layout.nodes.map((l) => ({
      id: l.key,
      type: "card",
      position: { x: l.x, y: l.y },
      width: CARD_W,
      height: CARD_H,
      draggable: false,
      data: {
        node: l.node, state: states.get(l.node.line), hidden: l.hidden,
        selected: l.key === selected, collapsed: collapsed.has(l.key), onStatus, onToggle,
      },
    }));
    const edges: FlowEdge[] = layout.edges.map((e) => {
      const style = EDGE_STYLE[e.kind];
      const tree = e.kind === "tree";
      return {
        id: e.key,
        source: e.source,
        target: e.target,
        sourceHandle: tree ? "tree-out" : "x-out",
        targetHandle: tree ? "tree-in" : "x-in",
        type: tree ? "smoothstep" : "default",
        className: style.className,
        style: style.dashed ? { strokeDasharray: style.dashed } : undefined,
        markerEnd: style.arrow ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
        label: tree ? undefined : e.label ? `${e.kind}: ${e.label}` : e.kind,
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        selectable: false,
      };
    });
    return { nodes, edges };
  }, [data, collapsed, selected, onStatus, onToggle]);

  const selectLine = useCallback((line: number) => {
    for (const [key, n] of all) {
      if (n.line === line || n.notes.some((x) => x.line === line)) return setSelected(key);
    }
    setSelected(null);
  }, [all]);

  if (error) return <main className="page"><p role="alert" className="error">{error}</p></main>;
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const node = selected ? all.get(selected) ?? null : null;
  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of data.doc.diagnostics) counts[d.level]++;

  return (
    <div className="doc">
      <div className="doc-bar">
        <h1 className="doc-title">{data.doc.title ?? file}</h1>
        <span className="muted">{all.size} nodes · {data.doc.edges.length} edges</span>
        {counts.error > 0 && <span className="badge badge-error">{counts.error} errors</span>}
        {counts.warning > 0 && <span className="badge badge-warning">{counts.warning} warnings</span>}
        <button type="button" className="btn" onClick={() => setCollapsed(new Set())} disabled={collapsed.size === 0}>
          Expand all
        </button>
        {notice && <span role="status" className="notice">{notice}</span>}
      </div>
      <div className="doc-body">
        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            colorMode="system"
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.1}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_e, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeClassName={(n) => `mini status-${(n.data as CardNode["data"]).node.status ?? "todo"}`} />
          </ReactFlow>
        </div>
        <SidePanel
          file={file}
          node={node}
          state={node ? data.derived.find((s) => s.line === node.line) : undefined}
          diagnostics={data.doc.diagnostics}
          onSelectLine={selectLine}
        />
      </div>
    </div>
  );
}
