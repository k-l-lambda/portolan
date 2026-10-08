import {
  Background, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, type Edge as FlowEdge,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeTime } from "../../src/history.ts";
import type { RhumbNode, Status } from "../../src/types.ts";
import { api, ApiError, onServerEvents, type DocResponse } from "./api.ts";
import { CARD_H, CARD_W, defaultCollapsed, layoutTree, nodeKey, type LaidOutEdge } from "./layout.ts";
import { NodeCard, type CardNode } from "./NodeCard.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { absoluteTime, freshness, relativeTime } from "./time.ts";

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
  // User toggles override the default (collapsed unless the subtree has doing work).
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  // Hovered node or edge; falls back to the selected node so keyboard and touch users get the same focus.
  const [hover, setHover] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [allLabels, setAllLabels] = useState(false);

  const [reloadedAt, setReloadedAt] = useState<string | null>(null);
  // Freshness is relative to now, so re-render periodically even when nothing changes.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);
  const hasData = useRef(false);
  const seq = useRef(0);

  // Reloads keep the current view (collapse state, selection) and drop out-of-order responses.
  const load = useCallback((live = false) => {
    const mine = ++seq.current;
    api.doc(file).then(
      (r) => {
        if (mine !== seq.current) return;
        hasData.current = true;
        // A commit changes blame times without changing content, so compare those too.
        setData((prev) => (prev?.version === r.version && prev.freshness.head === r.freshness.head
          && prev.freshness.mtime === r.freshness.mtime ? prev : r));
        setError(null);
        if (live) setReloadedAt(new Date().toLocaleTimeString());
      },
      (e) => {
        if (mine !== seq.current) return;
        // Keep showing the last good version if the file is briefly missing or unreadable.
        if (hasData.current) setNotice(`Could not reload: ${(e as Error).message}`);
        else setError(String((e as Error).message));
      },
    );
  }, [file]);

  useEffect(() => {
    load();
    return onServerEvents({
      change: (e) => e.file === file && load(true),
      files: () => load(true),
      history: () => load(true),
      reconnect: () => load(true),
    });
  }, [file, load]);

  const { all, parents } = useMemo(() => {
    const all = new Map<string, RhumbNode>();
    const parents = new Map<string, RhumbNode | null>();
    const walk = (ns: RhumbNode[], parent: RhumbNode | null) => ns.forEach((n) => {
      all.set(nodeKey(n), n);
      parents.set(nodeKey(n), parent);
      walk(n.children, n);
    });
    if (data) walk(data.doc.nodes, null);
    return { all, parents };
  }, [data]);

  const defaults = useMemo(() => (data ? defaultCollapsed(data.doc.nodes) : new Set<string>()), [data]);
  const collapsed = useMemo(() => {
    const out = new Set(defaults);
    for (const [key, isCollapsed] of overrides) {
      if (isCollapsed) out.add(key);
      else out.delete(key);
    }
    return out;
  }, [defaults, overrides]);

  const onStatus = useCallback(async (node: RhumbNode, status: Status) => {
    if (!data || !node.id) return;
    try {
      await api.edit(file, data.version, { op: "set-status", id: node.id, status });
      setNotice(null);
      load();
      return;
    } catch (e) {
      setNotice(e instanceof ApiError && e.status === 409
        ? "The file changed on disk; reloaded the latest version. Try again."
        : `Edit failed: ${(e as Error).message}`);
    }
    load();
  }, [data, file, load]);

  const onToggle = useCallback((node: RhumbNode) => {
    const key = nodeKey(node);
    setOverrides((prev) => new Map(prev).set(key, !collapsed.has(key)));
  }, [collapsed]);

  /** Expands every ancestor of a node so it becomes visible. */
  const reveal = useCallback((key: string) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (let p = parents.get(key); p; p = parents.get(nodeKey(p))) next.set(nodeKey(p), false);
      return next;
    });
  }, [parents]);

  const base = useMemo(() => {
    if (!data) return { nodes: [] as CardNode[], edges: [] as FlowEdge[] };
    const states = new Map(data.derived.map((s) => [s.line, s]));
    const times = new Map(data.freshness.nodes.map((t) => [t.line, t]));
    const layout = layoutTree(data.doc.nodes, data.doc.edges, collapsed);
    const nodes: CardNode[] = layout.nodes.map((l) => ({
      id: l.key,
      type: "card",
      position: { x: l.x, y: l.y },
      width: CARD_W,
      height: CARD_H,
      draggable: false,
      data: {
        node: l.node, parentId: parents.get(l.key)?.id ?? null, state: states.get(l.node.line), hidden: l.hidden,
        ...cardTime(times.get(l.node.line), now),
        selected: l.key === selected, collapsed: collapsed.has(l.key), onStatus, onToggle,
      },
    }));
    const edges: FlowEdge[] = layout.edges.map((e) => {
      const style = EDGE_STYLE[e.kind];
      const tree = e.kind === "tree";
      // A labeled relates is directed (spec 5.1).
      const arrow = style.arrow || (e.kind === "relates" && !!e.label);
      return {
        id: e.key,
        source: e.source,
        target: e.target,
        sourceHandle: tree ? "tree-out" : "x-out",
        targetHandle: tree ? "tree-in" : "x-in",
        type: tree ? "smoothstep" : "default",
        className: style.className,
        style: style.dashed ? { strokeDasharray: style.dashed } : undefined,
        markerEnd: arrow ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
        label: tree ? undefined : e.kind === "relates" && e.label ? e.label : e.label ? `${e.kind}: ${e.label}` : e.kind,
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        selectable: false,
        interactionWidth: 14,
      };
    });
    return { nodes, edges };
  }, [data, collapsed, parents, selected, now, onStatus, onToggle]);

  // Focus: the hovered edge, or every edge of the hovered (else selected) node. Everything else
  // is dimmed, and cross-edge labels are shown only for focused edges unless "All labels" is on.
  const { nodes, edges } = useMemo(() => {
    const focusNode = hover?.kind === "node" ? hover.id : hover ? null : selected;
    const focusEdge = hover?.kind === "edge" ? hover.id : null;
    const activeEdges = new Set<string>();
    const activeNodes = new Set<string>();
    for (const e of base.edges) {
      if (e.id === focusEdge || (focusNode && (e.source === focusNode || e.target === focusNode))) {
        activeEdges.add(e.id);
        activeNodes.add(e.source).add(e.target);
      }
    }
    if (focusNode) activeNodes.add(focusNode);
    const focused = activeNodes.size > 0;
    // One `a needs b, c: label` line becomes several edges with the same label; show it once
    // per source unless that exact edge is hovered.
    const shown = new Set<string>();
    const edges = base.edges.map((e) => {
      const active = activeEdges.has(e.id);
      const labelKey = `${e.source}\0${String(e.label)}`;
      const repeat = e.id !== focusEdge && shown.has(labelKey);
      const showLabel = e.label !== undefined && !repeat && (active || (allLabels && !focused));
      if (showLabel) shown.add(labelKey);
      return {
        ...e,
        className: `${e.className}${active ? " is-active" : focused ? " is-dim" : ""}`,
        zIndex: active ? 10 : 0,
        label: showLabel ? e.label : undefined,
      };
    });
    const nodes = focused
      ? base.nodes.map((n) => ({ ...n, className: activeNodes.has(n.id) ? "is-active" : "is-dim" }))
      : base.nodes;
    return { nodes, edges };
  }, [base, hover, selected, allLabels]);

  const selectLine = useCallback((line: number) => {
    for (const [key, n] of all) {
      if (n.line === line || n.notes.some((x) => x.line === line)) {
        reveal(key);
        return setSelected(key);
      }
    }
    setSelected(null);
  }, [all, reveal]);

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
        <button type="button" className="btn" onClick={() => setOverrides(new Map([...all.keys()].map((k) => [k, false])))}
          disabled={collapsed.size === 0}>
          Expand all
        </button>
        <button type="button" className="btn" onClick={() => setOverrides(new Map())} disabled={overrides.size === 0}>
          Reset view
        </button>
        <label className="toggle-label">
          <input type="checkbox" checked={allLabels} onChange={(e) => setAllLabels(e.target.checked)} /> All edge labels
        </label>
        {notice && <span role="status" className="notice">{notice}</span>}
        <span className="fresh-legend muted" title="Left edge brightness shows how recently each node's line changed">
          <span className="fresh-swatch" aria-hidden="true" /> older → newer
        </span>
        {reloadedAt && <span className="muted reloaded" aria-live="polite">updated {reloadedAt}</span>}
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
            onNodeMouseEnter={(_e, n) => setHover({ kind: "node", id: n.id })}
            onNodeMouseLeave={() => setHover(null)}
            onEdgeMouseEnter={(_e, ed) => setHover({ kind: "edge", id: ed.id })}
            onEdgeMouseLeave={() => setHover(null)}
            onPaneClick={() => setSelected(null)}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeClassName={(n) => `mini status-${(n.data as CardNode["data"]).node.status ?? "todo"}`} />
          </ReactFlow>
        </div>
        <SidePanel
          key={data.version}
          file={file}
          node={node}
          state={node ? data.derived.find((s) => s.line === node.line) : undefined}
          diagnostics={data.doc.diagnostics}
          freshness={data.freshness}
          now={now}
          onSelectLine={selectLine}
        />
      </div>
    </div>
  );
}

function cardTime(t: NodeTime | undefined, now: number) {
  if (!t) return { fresh: 0, updated: undefined, updatedText: "" };
  const line = t.lineTime.source === "local" ? "uncommitted change" : `commit ${t.lineTime.sha!.slice(0, 8)}`;
  const how = t.source === "link" ? `linked entry ${t.link!.date}, earlier than ${line}`
    : t.source === "children" ? `newest child ${t.child!.id ? `^${t.child!.id}` : `line ${t.child!.line}`}`
    : line;
  return { fresh: freshness(t.time, now), updated: t, updatedText: `Updated ${relativeTime(t.time, now)} (${absoluteTime(t.time)}, ${how})` };
}
