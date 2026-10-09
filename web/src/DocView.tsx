import {
  Background, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Edge as FlowEdge,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { NodeTime } from "../../src/history.ts";
import type { EdgeKind, RhumbNode, Status } from "../../src/types.ts";
import { api, ApiError, onServerEvents, type DocResponse } from "./api.ts";
import { layoutElk, type ElkResult } from "./elkLayout.ts";
import { defaultCollapsed, nodeKey, plainTitle, starred, starredInside } from "./layout.ts";
import { NodeCard, StarIcon, type CardNode } from "./NodeCard.tsx";
import type { EditOp } from "../../src/edit.ts";
import { measureLabel, placeLabels, type LabelRequest } from "./geometry.ts";
import { PolylineEdge } from "./PolylineEdge.tsx";
import { IconButton } from "./IconButton.tsx";
import { EdgeLabelsIcon, ExpandAllIcon, LegendIcon, ResetViewIcon } from "./Icons.tsx";
import { Legend } from "./Legend.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { absoluteTime, freshness, relativeTime } from "./time.ts";

const nodeTypes = { card: NodeCard };
const edgeTypes = { polyline: PolylineEdge };

const EDGE_STYLE: Record<EdgeKind, { className: string; arrow: boolean; dashed?: string }> = {
  needs: { className: "edge-needs", arrow: true },
  blocks: { className: "edge-blocks", arrow: true },
  relates: { className: "edge-relates", arrow: false, dashed: "4 4" },
  replaces: { className: "edge-replaces", arrow: true, dashed: "8 4" },
  from: { className: "edge-from", arrow: true, dashed: "2 4" },
};

/** `focus`: a node ID from the URL (`#/doc/<file>?node=<id>`) to reveal and center once. */
export function DocView({ file, focus }: { file: string; focus?: string | null }) {
  return (
    <ReactFlowProvider>
      <DocViewInner file={file} focus={focus ?? null} />
    </ReactFlowProvider>
  );
}

function DocViewInner({ file, focus }: { file: string; focus: string | null }) {
  const [data, setData] = useState<DocResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // User toggles override the default (collapsed unless the subtree has doing work).
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  // Hovered node or edge; falls back to the selected node so keyboard and touch users get the same focus.
  const [hover, setHover] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [allLabels, setAllLabels] = useState(false);
  // Last placed position of each label, so a label fades out where it was shown.
  const lastLabelAt = useRef(new Map<string, { x: number; y: number }>());
  // Hovering a relation line focuses it. Hovering its label only shows the label's full text (CSS):
  // the label is rendered inside the edge, so its pointer events must not count as edge hover.
  const fromLabel = (e: { target: EventTarget | null }) => (e.target as Element | null)?.closest?.(".edge-label") != null;

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

  // Browser tab title: the map's own title (front matter `title`, else the file name).
  const docTitle = data?.doc.title ?? null;
  useEffect(() => {
    const name = docTitle ?? file;
    document.title = name === "Portolan" ? name : `${name} · Portolan`;
    return () => { document.title = "Portolan"; };
  }, [docTitle, file]);

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

  const runEdit = useCallback(async (op: EditOp) => {
    if (!data) return;
    try {
      await api.edit(file, data.version, op);
      setNotice(null);
    } catch (e) {
      setNotice(e instanceof ApiError && e.status === 409
        ? "The file changed on disk; reloaded the latest version. Try again."
        : `Edit failed: ${(e as Error).message}`);
    }
    load();
  }, [data, file, load]);

  const onStatus = useCallback((node: RhumbNode, status: Status) => {
    if (node.id) runEdit({ op: "set-status", id: node.id, status });
  }, [runEdit]);

  // Starring writes `{star: true}` into the shared map; unstarring removes the key.
  const onStar = useCallback((node: RhumbNode) => {
    if (node.id) runEdit({ op: "set-attr", id: node.id, key: "star", value: starred(node) ? null : true });
  }, [runEdit]);

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

  const stars = useMemo(() => (data ? starredInside(data.doc.nodes) : new Map<string, number>()), [data]);
  const starredList = useMemo(() => [...all.values()].filter(starred), [all]);
  const [highlightStars, setHighlightStars] = useState(false);
  const [starMenu, setStarMenu] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const starWrap = useRef<HTMLDivElement>(null);
  const legendWrap = useRef<HTMLDivElement>(null);
  // Clicking the canvas does not move focus, so blur alone would leave a popover open.
  useOutsidePress(starWrap, starMenu, () => setStarMenu(false));
  useOutsidePress(legendWrap, legendOpen, () => setLegendOpen(false));

  // Reveal, select and center a node once the layout shows it.
  const [pendingCenter, setPendingCenter] = useState<string | null>(null);
  const flow = useReactFlow();
  const goTo = useCallback((key: string) => {
    reveal(key);
    setSelected(key);
    setPendingCenter(key);
  }, [reveal]);

  // ELK runs asynchronously; keep the previous layout on screen until the new one is ready.
  const [layout, setLayout] = useState<ElkResult | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    let live = true;
    const times = new Map(data.freshness.nodes.map((t) => [t.line, t.time]));
    layoutElk(data.doc.nodes, data.doc.edges, collapsed, (n) => times.get(n.line)).then(
      (r) => live && (setLayout(r), setLayoutError(null)),
      (e) => live && setLayoutError(`Layout failed: ${(e as Error).message}`),
    );
    return () => { live = false; };
  }, [data, collapsed]);

  const base = useMemo(() => {
    if (!data || !layout) return { nodes: [] as CardNode[], edges: [] as FlowEdge[] };
    const states = new Map(data.derived.map((s) => [s.line, s]));
    const times = new Map(data.freshness.nodes.map((t) => [t.line, t]));
    // Containers first and deeper boxes later, so children draw on top of their container.
    const boxes = [...layout.boxes].sort((a, b) => a.depth - b.depth);
    const nodes: CardNode[] = boxes.map((b) => ({
      id: b.key,
      type: "card",
      position: { x: b.x, y: b.y },
      width: b.width,
      height: b.height,
      // Stacking: frames at 0..99 by depth, relation lines at 100, cards at 200..299, edge labels at 400.
      // Lines must sit above frames (whose fill would hide them) and below cards (which they route around).
      zIndex: b.container ? b.depth : 200 + b.depth,
      draggable: false,
      data: {
        node: b.node, parentId: parents.get(b.key)?.id ?? null, state: states.get(b.node.line), hidden: b.hidden,
        container: b.container,
        ...cardTime(times.get(b.node.line), now),
        selected: b.key === selected, collapsed: collapsed.has(b.key), starsInside: stars.get(b.key) ?? 0,
        onStatus, onToggle, onStar,
      },
    }));
    const edges: FlowEdge[] = layout.routes.map((e) => {
      const style = EDGE_STYLE[e.kind];
      // A labeled relates is directed (spec 5.1).
      const arrow = style.arrow || (e.kind === "relates" && !!e.label);
      return {
        id: e.key,
        source: e.source,
        target: e.target,
        type: "polyline",
        data: { points: e.points },
        className: style.className,
        style: style.dashed ? { strokeDasharray: style.dashed } : undefined,
        markerEnd: arrow ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
        label: e.count > 1 ? `${e.kind} ×${e.count}`
          : e.kind === "relates" && e.label ? e.label : e.label ? `${e.kind}: ${e.label}` : e.kind,
        selectable: false,
        interactionWidth: 14,
      };
    });
    return { nodes, edges };
  }, [data, layout, collapsed, parents, selected, now, stars, onStatus, onToggle, onStar]);

  useEffect(() => {
    if (!pendingCenter || !layout) return;
    const box = layout.boxes.find((b) => b.key === pendingCenter);
    if (!box) return; // ancestors are still expanding; the next layout will have it
    const header = box.container ? 76 : box.height;
    flow.setCenter(box.x + box.width / 2, box.y + header / 2, { zoom: Math.max(flow.getZoom(), 0.9), duration: 400 });
    setPendingCenter(null);
  }, [pendingCenter, layout, flow]);

  // A node named in the URL is focused once its document has loaded.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || focused.current === focus || !all.has(focus)) return;
    focused.current = focus;
    goTo(focus);
  }, [focus, all, goTo]);

  // `s` stars or unstars the selected node.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "s" || e.ctrlKey || e.metaKey || e.altKey || !selected) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea, [contenteditable]")) return;
      const n = all.get(selected);
      if (n) (e.preventDefault(), onStar(n));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, all, onStar]);

  // Focus: the hovered edge, or every edge of the hovered (else selected) node. Everything else
  // is dimmed, and cross-edge labels are shown only for focused edges unless "All labels" is on.
  const { nodes, edges, focusCss } = useMemo(() => {
    // Focus set: the hovered node, else the selected one, else (with "Highlight starred") every
    // starred node, shown through its nearest visible card when it sits in a collapsed subtree.
    const visibleKeys = new Set(base.nodes.map((n) => n.id));
    const shown = (key: string): string | null => {
      for (let k: string | null = key; k; k = parents.get(k) ? nodeKey(parents.get(k)!) : null) if (visibleKeys.has(k)) return k;
      return null;
    };
    const focusNodes = new Set<string>();
    if (hover?.kind === "node") focusNodes.add(hover.id);
    else if (!hover && selected) focusNodes.add(selected);
    else if (!hover && highlightStars) for (const n of starredList) { const k = shown(nodeKey(n)); if (k) focusNodes.add(k); }
    const focusEdge = hover?.kind === "edge" ? hover.id : null;
    const activeEdges = new Set<string>();
    const activeNodes = new Set<string>(focusNodes);
    for (const e of base.edges) {
      if (e.id === focusEdge || focusNodes.has(e.source) || focusNodes.has(e.target)) {
        activeEdges.add(e.id);
        activeNodes.add(e.source).add(e.target);
      }
    }
    const focused = activeNodes.size > 0;
    // Containers of active cards stay undimmed, otherwise their opacity would fade the cards too.
    for (const key of [...activeNodes]) {
      for (let p = parents.get(key); p; p = parents.get(nodeKey(p))) activeNodes.add(nodeKey(p));
    }
    // One `a needs b, c: label` line becomes several edges with the same label; show it once
    // per source unless that exact edge is hovered.
    const labelSeen = new Set<string>();
    const visible = new Set<string>();
    for (const e of base.edges) {
      const active = activeEdges.has(e.id);
      const labelKey = `${e.source}\0${String(e.label)}`;
      const repeat = e.id !== focusEdge && labelSeen.has(labelKey);
      if (e.label !== undefined && !repeat && (active || (allLabels && !focused))) {
        labelSeen.add(labelKey);
        visible.add(e.id);
      }
    }
    // Spread visible labels along their edges so parallel edges do not stack their text.
    // The hovered edge is placed first and gets the best spot; cards are soft obstacles.
    const requests: LabelRequest[] = base.edges
      .filter((e) => visible.has(e.id))
      .sort((a, b) => Number(b.id === focusEdge) - Number(a.id === focusEdge))
      .map((e) => ({
        id: e.id,
        points: (e.data as { points: { x: number; y: number }[] }).points,
        // Focused labels show their whole text, so they are placed at full width.
        w: measureLabel(String(e.label), 11, activeEdges.has(e.id)) + 14,
        h: 18,
      }));
    const cards = base.nodes.filter((n) => !n.data.container).map((n) => ({ x: n.position.x, y: n.position.y, w: n.width!, h: n.height! }));
    // Lines that are drawn prominently: the focused ones, or all of them when nothing is focused.
    const lines = base.edges
      .filter((e) => !focused || activeEdges.has(e.id))
      .map((e) => ({ id: e.id, points: (e.data as { points: { x: number; y: number }[] }).points }));
    const at = placeLabels(requests, cards, 4, lines);
    const edges = base.edges.map((e) => {
      const active = activeEdges.has(e.id);
      return {
        ...e,
        className: `${e.className}${active ? " is-active" : focused ? " is-dim" : ""}`,
        // Constant: xyflow renders each z-index in its own SVG layer, so changing it on focus would
        // remount the edge and its label, pulling the label out from under the pointer.
        zIndex: 100,
        // Labels stay mounted and fade in/out (CSS), so showing or hiding one can be animated.
        label: e.label,
        data: {
          ...e.data,
          labelAt: rememberAt(lastLabelAt.current, e.id, at.get(e.id)),
          labelShown: visible.has(e.id),
          labelClass: `${e.className}${active ? " is-active" : ""}`,
        },
      };
    });
    // Nodes stay the same objects: giving them a new className makes xyflow re-measure them, and
    // edges briefly unmount meanwhile, which dropped a hovered label from under the pointer.
    // Dimming is a stylesheet keyed by node ID instead (see focusCss).
    return { nodes: base.nodes, edges, focusCss: focused ? cardFocusCss(activeNodes) : "" };
  }, [base, hover, selected, allLabels, parents, highlightStars, starredList]);

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
  if (!data || !layout) {
    return <main className="page"><p className={layoutError ? "error" : "muted"}>{layoutError ?? "Loading…"}</p></main>;
  }

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
        <div className="tool-group" role="group" aria-label="View">
          <IconButton icon={<ExpandAllIcon />} label="Expand all groups"
            onClick={() => setOverrides(new Map([...all.keys()].map((k) => [k, false])))} disabled={collapsed.size === 0} />
          <IconButton icon={<ResetViewIcon />} label="Reset folding to the default"
            onClick={() => setOverrides(new Map())} disabled={overrides.size === 0} />
          <IconButton icon={<EdgeLabelsIcon />} label={allLabels ? "Hide edge labels" : "Show all edge labels"}
            pressed={allLabels} onClick={() => setAllLabels((v) => !v)} />
        </div>
        <div className="star-menu-wrap" ref={starWrap}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setStarMenu(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setStarMenu(false); }}>
          <button type="button" className={`btn star-btn${starredList.length > 0 ? " has" : ""}`}
            aria-haspopup="true" aria-expanded={starMenu} onClick={() => setStarMenu((v) => !v)}>
            <StarIcon filled={starredList.length > 0} /> Starred {starredList.length}
          </button>
          {starMenu && (
            <div className="star-menu" role="group" aria-label="Starred nodes">
              <label className="toggle-label star-menu-row">
                <input type="checkbox" checked={highlightStars} onChange={(e) => setHighlightStars(e.target.checked)} />
                Highlight starred on the map
              </label>
              {starredList.length === 0
                ? <p className="muted star-menu-empty">No starred nodes. Use the star on a card, or select a node and press s.</p>
                : (
                  <ul>
                    {starredList.map((n) => (
                      <li key={nodeKey(n)}>
                        <button type="button" className={`star-menu-item status-${n.status ?? "todo"}`}
                          onClick={() => (goTo(nodeKey(n)), setStarMenu(false))}>
                          <span className="star-menu-status">{n.status ?? "?"}</span>
                          <span className="star-menu-title">{plainTitle(n.title)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          )}
        </div>
        {notice && <span role="status" className="notice">{notice}</span>}
        {layoutError && <span role="status" className="notice">{layoutError}</span>}
        <div className="legend-wrap" ref={legendWrap}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setLegendOpen(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setLegendOpen(false); }}>
          <button type="button" className={`btn legend-btn${legendOpen ? " pressed" : ""}`} aria-haspopup="dialog"
            aria-expanded={legendOpen} aria-controls="map-legend" onClick={() => setLegendOpen((v) => !v)}>
            <LegendIcon /> Legend
          </button>
          {legendOpen && (
            <div id="map-legend" className="popover legend-popover" role="dialog" aria-label="Legend" tabIndex={-1}>
              <Legend />
            </div>
          )}
        </div>
        {reloadedAt && <span className="muted reloaded" aria-live="polite">updated {reloadedAt}</span>}
      </div>
      <div className="doc-body">
        <div className="canvas">
          {focusCss && <style>{focusCss}</style>}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            // Use our z-indexes as given. In "basic" mode xyflow adds a node's z to its edges, so an edge
            // changed layer (and remounted, dropping its label from under the pointer) when focus changed.
            zIndexMode="manual"
            colorMode="system"
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.1}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_e, n) => setSelected(n.id)}
            onNodeMouseEnter={(_e, n) => setHover({ kind: "node", id: n.id })}
            onNodeMouseLeave={() => setHover(null)}
            onEdgeMouseEnter={(e, ed) => { if (!fromLabel(e)) setHover({ kind: "edge", id: ed.id }); }}
            onEdgeMouseLeave={() => setHover(null)}
            onPaneClick={() => setSelected(null)}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeClassName={(n) => {
              const d = n.data as CardNode["data"];
              return `mini status-${d.node.status ?? "todo"}${starred(d.node) ? " mini-star" : ""}`;
            }} />
          </ReactFlow>
        </div>
        <SidePanel
          key={data.version}
          file={file}
          node={node}
          state={node ? data.derived.find((s) => s.line === node.line) : undefined}
          diagnostics={data.doc.diagnostics}
          onStar={onStar}
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

/** Dims every card except the focused ones and their frames, without touching node objects. */
function cardFocusCss(active: Set<string>): string {
  const keep = [...active].map((id) => `.react-flow__node[data-id="${CSS.escape(id)}"]`).join(",");
  return `.canvas .react-flow__node{opacity:.35}${keep ? `${keep}{opacity:1}` : ""}`;
}

/** Calls `close` when the pointer is pressed outside `ref` while `open`. */
function useOutsidePress(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [ref, open, close]);
}

/** Records a label's new position, or returns the last one while it is hidden. */
function rememberAt(last: Map<string, { x: number; y: number }>, id: string, at: { x: number; y: number } | undefined) {
  if (at) last.set(id, at);
  return at ?? last.get(id);
}
