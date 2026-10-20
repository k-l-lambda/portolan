import {
  Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, type Edge as FlowEdge, type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { NodeTime } from "../../src/history.ts";
import type { Timeline } from "../../src/timeline.ts";
import type { EdgeKind, RhumbNode, Status } from "../../src/types.ts";
import { api, ApiError, MORE_HISTORY, onServerEvents, READ_ONLY, sourceUrl, type DocResponse } from "./api.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { WarningNotice } from "./WarningNotice.tsx";
import { DepthFloor, FlatMiniMap, HoverTitle, type FloorMark } from "./DepthLayer.tsx";
import { blendPose, DEFAULT_ANGLES, depthScene, ease, flatPose, nodeRibbon, orbitAngles, projectPath, targetPose, type Angles, type Pose } from "./depth.ts";
import { layoutElk, type Box, type ElkResult } from "./elkLayout.ts";
import { defaultCollapsed, fitZoom, followToggle, kindLetters, nodeKey, nodesForLine, plainTitle, shortId, starred, starredInside, unfoldStarted } from "./layout.ts";
import { FrameFill, NodeCard, StarIcon, type CardNode } from "./NodeCard.tsx";
import type { EditOp } from "../../src/edit.ts";
import { measureLabel, placeLabels, type LabelRequest, type Rect as GeoRect } from "./geometry.ts";
import { PolylineEdge } from "./PolylineEdge.tsx";
import { searchNodes } from "./search.ts";
import { TimelineRail } from "./Timeline.tsx";
import { DiffPanel } from "./DiffPanel.tsx";
import { pointKey } from "./timelineLabels.ts";
import { blockedReason } from "../../src/notes.ts";
import type { BlockedItem } from "./SidePanel.tsx";
import { nodeKind } from "../../src/kinds.ts";
import { byUrgency, timingOf } from "../../src/timing.ts";
import type { TimedItem } from "./TimerChip.tsx";
import { timerState } from "./timerState.ts";
import { IconButton } from "./IconButton.tsx";
import { EdgeLabelsIcon, ExpandAllIcon, LegendIcon, ResetViewIcon, SearchIcon, SourceIcon, View3DIcon } from "./Icons.tsx";
import { Legend } from "./Legend.tsx";
import { SidePanel } from "./SidePanel.tsx";
import { absoluteTime, freshness, relativeTime } from "./time.ts";

const nodeTypes = { card: NodeCard, fill: FrameFill };

/** Screen pixels a label keeps from the edge of the main view. */
const SCREEN_MARGIN = 6;
/**
 * The part of the map the main view shows, in flow units, less a margin; and the overlays drawn
 * over it (the navigator, the zoom buttons), where a label would be hidden. Null before the view
 * is mounted.
 */
function screenRegions(v: Viewport): { view: GeoRect; covered: GeoRect[] } | null {
  const pane = document.querySelector(".canvas .react-flow")?.getBoundingClientRect() ?? document.querySelector(".canvas")?.getBoundingClientRect();
  if (!pane || pane.width === 0) return null;
  const toFlow = (x: number, y: number, w: number, h: number): GeoRect => ({ x: (x - v.x) / v.zoom, y: (y - v.y) / v.zoom, w: w / v.zoom, h: h / v.zoom });
  const m = SCREEN_MARGIN;
  const covered = [...document.querySelectorAll(".canvas .react-flow__panel")].map((el) => {
    const r = el.getBoundingClientRect();
    return toFlow(r.x - pane.x, r.y - pane.y, r.width, r.height);
  }).filter((r) => r.w > 0 && r.h > 0);
  return { view: toFlow(m, m, pane.width - 2 * m, pane.height - 2 * m), covered };
}

/** The viewport that shows flow point (x, y) at the main view's centre, at `zoom`, as `setCenter` places it. */
function centerAt(x: number, y: number, zoom: number): Viewport {
  const pane = document.querySelector(".canvas")?.getBoundingClientRect();
  const w = pane?.width ?? 1000, h = pane?.height ?? 600;
  return { x: w / 2 - x * zoom, y: h / 2 - y * zoom, zoom };
}

/** Older history points loaded per page as the rail is scrolled to its end (the server's first page is as long). */
const TIMELINE_PAGE = 50;
/** The closest the view goes when framing a history point: about a card's width on screen. */
const FRAME_MAX_ZOOM = 1.1;

/** Candidates listed under the search box. */
const SEARCH_LIST = 10;

/** ID of the fill layer drawn behind a frame (see the stacking note in `base`). */
export const fillId = (key: string) => `${key}::fill`;
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
  // `floor`: the hover came from the node's projection on the 3D view's floor, so its title shows there.
  const [hover, setHover] = useState<{ kind: "node" | "edge"; id: string; floor?: boolean } | null>(null);
  // An item pointed at in the Diagnostics panel's lists (in progress, blocked): highlighted as if
  // its card were, when the pointer is on no card or line.
  const [listHover, setListHover] = useState<string | null>(null);
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
  // The history rail, kept apart from the map so loading older points does not rebuild the map.
  // `railPoints` is how many points it asked for past the first page (null: the first page only),
  // so a reload keeps the older points it already shows.
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const railPoints = useRef<number | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const moreSeq = useRef(0);

  // Reloads keep the current view (collapse state, selection) and drop out-of-order responses.
  const load = useCallback((live = false) => {
    const mine = ++seq.current;
    const points = railPoints.current;
    api.doc(file, points ?? undefined).then(
      (r) => {
        if (mine !== seq.current) return;
        hasData.current = true;
        // Unless the rail grew since this was asked, which only adds older points to it.
        if (railPoints.current === points) setTimeline(r.timeline ?? null);
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
    railPoints.current = null;
    moreSeq.current++;
    setTimeline(null);
    setMoreLoading(false);
    load();
    return onServerEvents({
      change: (e) => e.file === file && load(true),
      files: () => load(true),
      history: () => load(true),
      reconnect: () => load(true),
    });
  }, [file, load]);

  /** The next page of older history points, when the rail is scrolled to its end. */
  const loadMore = useCallback(() => {
    if (!timeline?.truncated || !MORE_HISTORY || moreLoading) return;
    const points = timeline.points.filter((p) => p.kind !== "local").length + TIMELINE_PAGE;
    const mine = ++moreSeq.current;
    railPoints.current = points;
    setMoreLoading(true);
    api.timeline(file, points).then(
      (r) => {
        if (mine !== moreSeq.current) return;
        setMoreLoading(false);
        // A reload asked for this many since would have set the same rail; a later page wins.
        if (railPoints.current === points) setTimeline(r.timeline);
      },
      (e) => {
        if (mine !== moreSeq.current) return;
        setMoreLoading(false);
        setNotice(`Could not load older history: ${(e as Error).message}`);
      },
    );
  }, [file, timeline, moreLoading]);

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
  // A reload that starts work (a node newly doing, at any depth) undoes the user's folds above it,
  // so the new work shows even inside a group folded by hand earlier; other folds are kept.
  const doingBefore = useRef<Set<string> | null>(null);
  useEffect(() => {
    const doing = new Set([...all].filter(([, n]) => n.status === "doing").map(([k]) => k));
    const before = doingBefore.current;
    doingBefore.current = doing;
    // First load: the defaults already open every doing branch.
    if (before) setOverrides((prev) => unfoldStarted(prev, before, all, parents));
  }, [all, parents]);
  useEffect(() => { doingBefore.current = null; }, [file]);
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

  /** The node just folded or unfolded, so the view can keep it in place once the layout lands. */
  const toggled = useRef<string | null>(null);
  const onToggle = useCallback((node: RhumbNode) => {
    const key = nodeKey(node);
    toggled.current = key;
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
  const letters = useMemo(() => kindLetters(data?.doc.nodes ?? []), [data]);
  // Doing items with timing, for the Diagnostics panel; refreshed with the view's clock.
  const timed = useMemo(() => {
    const out: TimedItem[] = [];
    for (const [key, n] of all) {
      const timing = n.status === "doing" ? timingOf(n, now) : null;
      if (timing) out.push({ key, line: n.line, title: plainTitle(n.title) || "(untitled)", timing });
    }
    return out.sort((a, b) => byUrgency(a.timing, b.timing) || a.line - b.line);
  }, [all, now]);
  // Blocked items with what blocks them, in map order, for the Diagnostics panel.
  const blocked = useMemo(() => {
    const out: BlockedItem[] = [];
    for (const [key, n] of all) {
      if (n.status === "blocked") out.push({ key, line: n.line, title: plainTitle(n.title) || "(untitled)", reason: blockedReason(n) });
    }
    return out.sort((a, b) => a.line - b.line);
  }, [all]);
  // A list row that a reload or a selection took away stops highlighting.
  useEffect(() => setListHover(null), [data, selected]);
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

  // Search: an exact ID is revealed and centered as soon as it is typed. Below the box, the
  // best SEARCH_LIST matches are listed; arrows move through them, Enter or a click goes to one.
  // With the list closed, Enter steps through every match best first (Shift+Enter backwards).
  // Escape closes the list, then clears the query.
  // History rail (shown with Diagnostics): the point under the pointer or keyboard focus.
  const [railActive, setRailActive] = useState<string | null>(null);
  useEffect(() => setRailActive(null), [selected]);
  // The diff panel stays on the last git point hovered or focused until another one or Close;
  // pointing at the panel highlights that point's nodes again.
  const [diffPoint, setDiffPoint] = useState<string | null>(null);
  const [diffHover, setDiffHover] = useState(false);
  const [diffText, setDiffText] = useState<{ key: string; text: string | null; error: string | null } | null>(null);
  const diffCache = useRef(new Map<string, string>());
  const onRailActive = useCallback((key: string | null) => {
    setRailActive(key);
    if (key && timeline?.source === "git") setDiffPoint(key);
  }, [timeline]);
  // Forget a pinned point that a reload removed, or when another map opens.
  useEffect(() => {
    if (diffPoint && timeline && !timeline.points.some((p) => pointKey(p) === diffPoint)) setDiffPoint(null);
  }, [timeline, diffPoint]);
  useEffect(() => { setDiffPoint(null); diffCache.current.clear(); }, [file]);
  useEffect(() => {
    if (!diffPoint || !data) return;
    // Uncommitted changes move with the file; a commit's diff never does.
    const cacheKey = diffPoint === "local" ? `local:${data.version}` : diffPoint;
    const hit = diffCache.current.get(cacheKey);
    if (hit !== undefined) return setDiffText({ key: diffPoint, text: hit, error: null });
    setDiffText({ key: diffPoint, text: null, error: null });
    let live = true;
    // A short wait, so sweeping the pointer down the rail does not fetch every dot on the way.
    const t = setTimeout(() => {
      api.diff(file, diffPoint, railPoints.current ?? undefined).then(
        (text) => { diffCache.current.set(cacheKey, text); if (live) setDiffText({ key: diffPoint, text, error: null }); },
        (e) => live && setDiffText({ key: diffPoint, text: null, error: `Could not load the diff: ${(e as Error).message}` }),
      );
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [diffPoint, data, file]);
  const [query, setQuery] = useState("");
  const search = useMemo(() => searchNodes(all.values(), query), [all, query]);
  const [hit, setHit] = useState(-1);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const searchBox = useRef<HTMLInputElement>(null);
  const searchWrap = useRef<HTMLDivElement>(null);
  useOutsidePress(searchWrap, listOpen, () => setListOpen(false));
  useEffect(() => (setHit(-1), setActive(-1)), [search]);
  useEffect(() => {
    if (!search.exact) return;
    reveal(search.keys[0]!);
    setPendingCenter(search.keys[0]!);
  }, [search, reveal]);
  const candidates = search.ranked.slice(0, SEARCH_LIST);
  const pick = (i: number) => {
    setHit(i);
    setListOpen(false);
    goTo(search.ranked[i]!);
  };
  const step = (back: boolean) => {
    const n = search.ranked.length;
    if (n > 0) pick(hit < 0 ? (back ? n - 1 : 0) : (hit + (back ? n - 1 : 1)) % n);
  };
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const shown = listOpen && candidates.length > 0;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (candidates.length === 0) return;
      e.preventDefault();
      const n = candidates.length;
      if (!shown) return (setListOpen(true), setActive(e.key === "ArrowDown" ? 0 : n - 1));
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i <= 0 ? n - 1 : i - 1)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown && active >= 0) pick(active);
      else step(e.shiftKey);
    } else if (e.key === "Escape") {
      e.preventDefault(); // the browser would also clear a search input
      if (shown) setListOpen(false);
      else (setQuery(""), e.currentTarget.blur());
    }
  };

  // The 3D view stands each card in its own moment along a level time axis (see depth.ts). The
  // flat view's camera is kept throughout: the navigator always shows it, and the cards inside its
  // frame — the focus nodes — decide the 3D pose. In 3D it is kept apart from the 3D view's own
  // pan and zoom, so looking about the 3D scene leaves the frame, and the pose, where they are.
  // Changing between the views moves the camera from one pose to the other, starting from the
  // flat view itself.
  const [threeD, setThreeD] = useState(false);
  /** The pose on screen, null in the flat view; and the move in progress, if any. */
  const [pose, setPose] = useState<Pose | null>(null);
  const move = useRef<{ from: Pose; to: Pose; start: number; ms: number; done?: () => void } | null>(null);
  const raf = useRef(0);
  const [moving, setMoving] = useState(false);
  const [zoom, setZoom] = useState(1);
  /**
   * The flat view's camera while in 3D, which the navigator shows and moves; null in the flat
   * view, where it is the main view's own viewport. The view's own framings (a search, a history
   * point, a fold) move it too, and the pose follows.
   */
  const [camera, setCamera] = useState<Viewport | null>(null);
  const cameraRef = useRef<Viewport | null>(null);
  const setCam = useCallback((v: Viewport | null) => { cameraRef.current = v; setCamera(v); }, []);
  // Read by callbacks that outlive a render (effects with narrow dependencies, the camera's tween).
  const threeDRef = useRef(false);
  /** The camera's turn in 3D, set by dragging with the right button; the default until then.
   *  Kept across refits (the navigator, a search), and back to the default on entering 3D. */
  const angles = useRef<Angles>(DEFAULT_ANGLES);
  /** A right-button drag turning the camera: where it started, and the turn it started from. */
  const orbit = useRef<{ id: number; x: number; y: number; from: Angles } | null>(null);
  const [orbiting, setOrbiting] = useState(false);

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

  // A node's own time, the one the depth axis measures from: the same source the cards use for
  // freshness, so a map dated by links (`dates: links`) is laid out by those dates instead of git.
  const nodeTimes = useMemo(() => new Map((data?.freshness.nodes ?? []).map((t) => [t.line, t.time])), [data]);
  const timeOf = useCallback((key: string) => {
    const box = layout?.boxes.find((b) => b.key === key);
    return box ? nodeTimes.get(box.node.line) : undefined;
  }, [layout, nodeTimes]);

  const isGroup = useCallback((key: string) => layout?.boxes.find((b) => b.key === key)?.container ?? false, [layout]);
  const ribbonOf = useCallback((key: string) => {
    const box = layout?.boxes.find((b) => b.key === key);
    if (!box) return null;
    // `hidden` counts what a folded box holds, so it says the box is folded in this very layout.
    return nodeRibbon(box.node, box.hidden > 0, nodeTimes.get(box.node.line) ?? now, now);
  }, [layout, nodeTimes, now]);

  /**
   * The 3D pose for the flat view's frame `cam`, fitted into the region the 3D view shows, `v`
   * (the same, until the 3D view is panned or zoomed on its own). Null when the frame holds no card.
   */
  const poseFor = useCallback((cam = cameraRef.current ?? flow.getViewport(), v = flow.getViewport()): Pose | null => {
    const pane = document.querySelector(".canvas")?.getBoundingClientRect();
    if (!pane || !layout) return null;
    const region = (q: Viewport) => ({ x: -q.x / q.zoom, y: -q.y / q.zoom, width: pane.width / q.zoom, height: pane.height / q.zoom });
    return targetPose(layout.boxes, region(cam), timeOf, ribbonOf, isGroup, v.zoom, region(v), angles.current);
  }, [flow, layout, timeOf, ribbonOf, isGroup]);
  const poseForRef = useRef(poseFor);
  poseForRef.current = poseFor;
  const poseRef = useRef<Pose | null>(null);
  poseRef.current = pose;

  /** Move the camera from where it is to `to`, eased, then call `done`. */
  const moveTo = useCallback((to: Pose, ms: number, done?: () => void) => {
    const from = poseRef.current ?? flatPose(to);
    cancelAnimationFrame(raf.current);
    move.current = { from, to, start: performance.now(), ms, done };
    setMoving(true);
    const step = () => {
      const m = move.current;
      if (!m) return;
      const s = Math.min(1, (performance.now() - m.start) / m.ms);
      setPose(blendPose(m.from, m.to, ease(s)));
      if (s < 1) raf.current = requestAnimationFrame(step);
      else (move.current = null, setMoving(false), m.done?.());
    };
    raf.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => {
    cancelAnimationFrame(raf.current); move.current = null; setMoving(false); setPose(null);
    setThreeD(false); threeDRef.current = false; setCam(null);
  }, [file, setCam]);

  /** In 3D: move the camera to the pose for the flat view's frame, if it frames any card. */
  const retarget = useCallback(() => {
    if (!threeDRef.current) return;
    const to = poseForRef.current();
    if (to) moveTo(to, 450);
  }, [moveTo]);

  /**
   * Move the flat view's camera: in the flat view, the main view itself; in 3D, the navigator's
   * frame, and the pose follows the cards it now holds while the 3D view stays where it is.
   */
  const moveCamera = useCallback((v: Viewport, ms = 0) => {
    if (!threeDRef.current) return void flow.setViewport(v, ms ? { duration: ms } : undefined);
    setCam(v);
    retarget();
  }, [flow, setCam, retarget]);
  /** The flat view's camera as it is now. */
  const cameraNow = useCallback(() => (threeDRef.current && cameraRef.current) || flow.getViewport(), [flow]);

  const toggle3D = useCallback(() => {
    if (!threeD) {
      const v = flow.getViewport();
      // Stop the main view where it is, should it still be on its way back from a previous 3D visit.
      flow.setViewport(v);
      angles.current = DEFAULT_ANGLES;
      const to = poseFor(v, v);
      if (!to) return;
      threeDRef.current = true;
      setCam(v);
      // From the flat view itself: every card where it is, so the move starts without a jump.
      poseRef.current = flatPose(to);
      setPose(poseRef.current);
      setThreeD(true);
      moveTo(to, 900);
    } else {
      const from = poseRef.current, back = cameraRef.current;
      threeDRef.current = false;
      setThreeD(false);
      // Back to the flat view the navigator has kept all along: the main view returns to its frame
      // while the camera turns flat, so the move ends on the flat cards in that frame.
      if (back) flow.setViewport(back, { duration: 700 });
      const done = () => (setPose(null), setCam(null));
      if (!from) return done();
      moveTo(flatPose(from), 700, done);
    }
  }, [threeD, flow, poseFor, moveTo, setCam]);

  // In 3D, dragging with the right button turns the camera about the point it looks at: across, round
  // the vertical (0° to 90° to the time axis); up and down, by up to 15° either side of the default.
  // The scene keeps its window and its place on screen, so it turns in place rather than being
  // fitted again; the navigator's frame is not touched. Left-button pans and the wheel are xyflow's.
  const onOrbitDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 2 || !threeDRef.current || !poseRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    // A turn takes over from a camera move still running: it starts from where the camera is.
    cancelAnimationFrame(raf.current);
    move.current = null;
    setMoving(false);
    const p = poseRef.current;
    orbit.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: { azimuth: p.azimuth, pitch: p.pitch } };
    e.currentTarget.setPointerCapture(e.pointerId);
    setOrbiting(true);
  }, []);
  const onOrbitMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const o = orbit.current, p = poseRef.current;
    if (!o || o.id !== e.pointerId || !p) return;
    e.stopPropagation();
    const a = orbitAngles(o.from, e.clientX - o.x, e.clientY - o.y);
    angles.current = a;
    poseRef.current = { ...p, ...a };
    setPose(poseRef.current);
  }, []);
  const onOrbitUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const o = orbit.current;
    if (!o || o.id !== e.pointerId) return;
    orbit.current = null;
    setOrbiting(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  // After a fold or unfold, pan by however far the node's box moved, so it stays where it was on
  // screen instead of jumping with the relayout (see `followToggle`); in 3D, the navigator's frame
  // follows it so. Kept out of the way of the other framings: a search, a history point or a node
  // from the URL each centre their own target.
  const prevLayout = useRef<ElkResult | null>(null);
  useEffect(() => {
    const before = prevLayout.current;
    prevLayout.current = layout;
    const key = toggled.current;
    if (!layout || !before || !key) return;
    toggled.current = null;
    const a = before.boxes.find((b) => b.key === key), b = layout.boxes.find((x) => x.key === key);
    const pane = document.querySelector(".canvas")?.getBoundingClientRect();
    if (!a || !b || !pane) return;
    moveCamera(followToggle(a, b, cameraNow(), pane));
  }, [layout, moveCamera, cameraNow]);

  // A new layout (a group opened or closed, the file reloaded) moves the cards; the pose follows.
  useEffect(() => { if (threeD && !move.current) retarget(); }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pointing at a projection on the floor is pointing at its item (and its card lifts with it,
  // since the pointer is not on the card for the plain :hover rule to do it).
  // Its title shows where the pointer met the projection: a group's can be long, and its middle far off.
  const [floorAt, setFloorAt] = useState<{ x: number; y: number } | null>(null);
  const onFloorHover = useCallback((key: string | null, client?: { x: number; y: number }) => {
    setFloorAt(client ? flow.screenToFlowPosition(client) : null);
    setHover(key ? { kind: "node", id: key, floor: true } : null);
  }, [flow]);

  /** Each item's status and freshness, for its projection on the floor. */
  const floorMarks = useMemo(() => {
    const out = new Map<string, FloorMark>();
    for (const b of layout?.boxes ?? []) {
      const t = nodeTimes.get(b.node.line);
      out.set(b.key, { status: b.node.status ?? "todo", fresh: t === undefined ? 0 : freshness(t, now) });
    }
    return out;
  }, [layout, nodeTimes, now]);

  /** The scene in the pose on screen: a panel for each card at its own moment, and the floor. */
  const scene = useMemo(() => (pose && layout
    ? depthScene(layout.boxes, pose, timeOf, ribbonOf, isGroup, now)
    : null), [pose, layout, timeOf, ribbonOf, isGroup, now]);

  // After a pan or zoom of the main view, the ruler's density follows its zoom. In 3D that pans or
  // zooms the 3D view alone: the navigator's frame, and so the pose, stay where they are.
  // A hovered line's label is placed on the part of the line on screen, so it is placed again when
  // a pan or zoom settles.
  const [viewTick, setViewTick] = useState(0);
  const onMoveEnd = useCallback((_e: unknown, v: Viewport) => (setZoom(v.zoom), setViewTick((n) => n + 1)), []);

  // Clicking a point frames the nodes that point changed. Its groups open first, so the boxes are
  // known by the time the layout catches up; a zoom cap keeps a single card from filling the view.
  const [pendingFrame, setPendingFrame] = useState<Set<string> | null>(null);
  const frameNodes = useCallback((nodes: Iterable<string>) => {
    const keys = new Set(nodes);
    if (keys.size === 0) return;
    keys.forEach(reveal);
    setPendingFrame(keys);
  }, [reveal]);
  const framePoint = useCallback((key: string) => {
    const point = timeline?.points.find((p) => pointKey(p) === key);
    if (point) frameNodes(point.nodes);
  }, [timeline, frameNodes]);
  // Clicking a diagnostic frames what it is about in the same way: the node on its line, or both
  // ends of a relation written there, and selects the node so its own panel opens.
  const focusLine = useCallback((line: number) => {
    const keys = nodesForLine(line, all, data?.doc.edges ?? []);
    if (keys.length === 1) setSelected(keys[0]!);
    frameNodes(keys);
  }, [all, data, frameNodes]);
  useEffect(() => {
    if (!pendingFrame || !layout) return;
    const boxes = layout.boxes.filter((b) => pendingFrame.has(b.key));
    // Ancestors may still be expanding: the next layout will have them.
    if (boxes.length === 0 || boxes.length < pendingFrame.size) return;
    const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.width)), bottom = Math.max(...boxes.map((b) => b.y + b.height));
    // `getViewport` gives position and zoom only, so measure the pane for its size.
    const pane = document.querySelector(".canvas")?.getBoundingClientRect();
    const view = { width: pane?.width ?? 1000, height: pane?.height ?? 600 };
    // Cap the zoom so a point that changed one small item does not fill the screen with it; a
    // point that changed a wide area still fits, since that needs a lower zoom anyway.
    const target = fitZoom({ x, y, width: right - x, height: bottom - y }, view, 0.2, FRAME_MAX_ZOOM);
    moveCamera(centerAt(target.x, target.y, target.zoom), 500);
    setPendingFrame(null);
  }, [pendingFrame, layout, moveCamera]);

  const base = useMemo(() => {
    if (!data || !layout) return { nodes: [] as CardNode[], edges: [] as FlowEdge[] };
    const panelOf = (key: string) => scene?.panels.get(key);
    const rank = new Map((scene?.order ?? []).map((k, i) => [k, i]));
    const states = new Map(data.derived.map((s) => [s.line, s]));
    const times = new Map(data.freshness.nodes.map((t) => [t.line, t]));
    // Containers first and deeper boxes later, so children draw on top of their container.
    const boxes = [...layout.boxes].sort((a, b) => a.depth - b.depth);
    const nodes: CardNode[] = boxes.map((b) => ({
      id: b.key,
      type: "card",
      // In 3D the node is the bounding box of the card's panel, and the card inside it is laid out at
      // its own size and carried onto the panel's true shape by the panel's matrix (depth.ts), so its
      // text, buttons and hit area are all drawn in the panel's plane.
      position: panelOf(b.key) ? { x: panelOf(b.key)!.box.x, y: panelOf(b.key)!.box.y } : { x: b.x, y: b.y },
      width: panelOf(b.key)?.box.width ?? b.width,
      height: panelOf(b.key)?.box.height ?? b.height,
      className: panelOf(b.key) ? "panel3d" : undefined,
      style: panelOf(b.key)
        ? ({
          "--m": panelOf(b.key)!.matrix,
          "--w": `${panelOf(b.key)!.width}px`,
          "--h": `${panelOf(b.key)!.height}px`,
          "--fog": `${panelOf(b.key)!.fog}`,
        } as CSSProperties)
        : undefined,
      // Every rebuild (reload, new layout, the freshness tick) creates new node objects. Without
      // `measured`, xyflow drops their handle bounds and hides every edge until the cards are
      // measured again, so lines blinked out for a few frames. The size is known, so pass it.
      measured: { width: panelOf(b.key)?.box.width ?? b.width, height: panelOf(b.key)?.box.height ?? b.height },
      // Stacking, bottom to top:
      //   0..99    frame fills (FrameFill), by depth
      //   100      relation lines
      //   150..199 frames themselves: border, title and controls (body transparent), by depth
      //   200..299 cards (350 while hovered)
      //   360      focused lines, drawn over everything except labels
      //   400      edge labels
      // So lines pass behind every title and control, yet stay visible inside frames.
      // 3D draws panels far to near, so a nearer panel covers a farther one.
      zIndex: scene ? 2000 + (rank.get(b.key) ?? 0) : b.container ? 150 + b.depth : 200 + b.depth,
      draggable: false,
      data: {
        node: b.node, parentId: parents.get(b.key)?.id ?? null, state: states.get(b.node.line), hidden: b.hidden,
        // A group is a transparent frame, in 3D as in the flat view: its children stand at their own
        // moments, in front of or behind its plane, and show through it.
        container: b.container,
        ...cardTime(times.get(b.node.line), now),
        selected: b.key === selected, collapsed: collapsed.has(b.key), starsInside: stars.get(b.key) ?? 0,
        kindLetters: letters.get(nodeKind(b.node) ?? ""),
        // Work in progress shows its running time, a finished run its actual time, and a todo an
        // estimate; anything else keeps the attributes as a record (side panel).
        timing: (() => { const t = timingOf(b.node, now); return timerState(t, b.node.status) ? t : null; })(),
        onStatus, onToggle, onStar,
      },
    }));
    // The flat view's frames are two layers: a fill below the lines and the frame above them. In 3D
    // the fill fades out as the camera turns — an opaque sheet would hide the cards behind it — so
    // the move starts from the flat view exactly and ends with frames that are borders only.
    const fade = scene ? 1 - scene.pose.blend : 1;
    if (fade > 0.001) {
      const fills: CardNode[] = boxes.filter((b) => b.container).map((b) => {
        const frame = nodes.find((n) => n.id === b.key)!;
        const style = frame.style ? ({ ...frame.style, "--fog": `${fade}` } as CSSProperties) : undefined;
        return { ...frame, style, id: fillId(b.key), type: "fill", zIndex: b.depth, selectable: false, focusable: false };
      });
      nodes.unshift(...fills);
    }
    const edges: FlowEdge[] = layout.routes.map((e) => {
      const style = EDGE_STYLE[e.kind];
      // A labeled relates is directed (spec 5.1).
      const arrow = style.arrow || (e.kind === "relates" && !!e.label);
      return {
        id: e.key,
        source: e.source,
        target: e.target,
        type: "polyline",
        // The label written in the Rhumb line, if this route draws one edge; only these repeat.
        data: {
          // A relation between two cards at different moments runs through time between them.
          points: scene ? projectPath(scene.view, e.points, panelOf(e.source)?.t ?? 0, panelOf(e.target)?.t ?? 0) : e.points,
          arrow, written: e.count === 1 ? e.label : null,
        },
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
  }, [data, layout, collapsed, parents, selected, now, stars, letters, onStatus, onToggle, onStar, scene]);

  useEffect(() => {
    if (!pendingCenter || !layout) return;
    const box = layout.boxes.find((b) => b.key === pendingCenter);
    if (!box) return; // ancestors are still expanding; the next layout will have it
    const header = box.container ? 76 : box.height;
    moveCamera(centerAt(box.x + box.width / 2, box.y + header / 2, Math.max(cameraNow().zoom, 0.9)), 400);
    setPendingCenter(null);
  }, [pendingCenter, layout, moveCamera, cameraNow]);

  // A node named in the URL is focused once its document has loaded.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || focused.current === focus || !all.has(focus)) return;
    focused.current = focus;
    goTo(focus);
  }, [focus, all, goTo]);

  // `s` stars or unstars the selected node; `/` focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea, [contenteditable]")) return;
      if (e.key === "/") return (e.preventDefault(), searchBox.current?.focus());
      if (READ_ONLY || e.key !== "s" || !selected) return;
      const n = all.get(selected);
      if (n) (e.preventDefault(), onStar(n));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, all, onStar]);

  // Focus: the hovered edge, or every edge of the hovered (else selected) node. Everything else
  // is dimmed, and cross-edge labels are shown only for focused edges unless "All labels" is on.
  const pointer = hover;
  const { nodes, edges, focusCss, focusSet, shownHover } = useMemo(() => {
    // Focus set: the hovered node, else the nodes a hovered history point changed, else the
    // search matches (for both, only they and the edges between them light up), else the
    // selected node, else (with "Highlight starred") every starred node. A node in a collapsed
    // subtree is shown through its nearest visible card.
    const visibleKeys = new Set(base.nodes.map((n) => n.id));
    const shown = (key: string): string | null => {
      for (let k: string | null = key; k; k = parents.get(k) ? nodeKey(parents.get(k)!) : null) if (visibleKeys.has(k)) return k;
      return null;
    };
    // A row pointed at in the Diagnostics panel's lists stands for its card, or the nearest
    // visible card above it in a folded group; `floor` since the pointer is not on that card.
    const listKey = !pointer && listHover ? shown(listHover) : null;
    const hover = pointer ?? (listKey ? { kind: "node" as const, id: listKey, floor: true } : null);
    const focusNodes = new Set<string>();
    const matches = new Set(search.keys.map(shown).filter((k): k is string => k !== null));
    const railKey = railActive ?? (diffHover ? diffPoint : null);
    const point = !hover && !selected && railKey ? timeline?.points.find((p) => pointKey(p) === railKey) : undefined;
    const railNodes = new Set((point?.nodes ?? []).map(shown).filter((k): k is string => k !== null));
    const searching = !hover && !point && query.trim() !== "";
    // Like a search, a history point lights up only its own nodes and the lines between them.
    const exclusive = searching || !!point;
    if (hover?.kind === "node") focusNodes.add(hover.id);
    else if (point) railNodes.forEach((k) => focusNodes.add(k));
    else if (searching) matches.forEach((k) => focusNodes.add(k));
    else if (!hover && selected) focusNodes.add(selected);
    else if (!hover && highlightStars) for (const n of starredList) { const k = shown(nodeKey(n)); if (k) focusNodes.add(k); }
    const focusEdge = hover?.kind === "edge" ? hover.id : null;
    const activeEdges = new Set<string>();
    const activeNodes = new Set<string>(focusNodes);
    for (const e of base.edges) {
      const touches = exclusive
        ? focusNodes.has(e.source) && focusNodes.has(e.target)
        : focusNodes.has(e.source) || focusNodes.has(e.target);
      if (e.id === focusEdge || touches) {
        activeEdges.add(e.id);
        activeNodes.add(e.source).add(e.target);
      }
    }
    // A search with no match, or a point whose nodes are all gone, still dims the map.
    const focused = activeNodes.size > 0 || exclusive;
    // Containers of active cards stay undimmed, otherwise their opacity would fade the cards too.
    for (const key of [...activeNodes]) {
      for (let p = parents.get(key); p; p = parents.get(nodeKey(p))) activeNodes.add(nodeKey(p));
    }
    // One `a needs b, c: label` line becomes several edges with the same written label; show it
    // once per source unless that exact edge is hovered. Edges without a written label show
    // their kind ("needs", "from ×2"), which is not a repeat, so each of them keeps its label.
    const labelSeen = new Set<string>();
    const visible = new Set<string>();
    for (const e of base.edges) {
      const active = activeEdges.has(e.id);
      const written = (e.data as { written: string | null }).written;
      const labelKey = written === null ? null : `${e.source}\0${written}`;
      const repeat = labelKey !== null && e.id !== focusEdge && labelSeen.has(labelKey);
      if (e.label !== undefined && !repeat && (active || (allLabels && !focused))) {
        if (labelKey !== null) labelSeen.add(labelKey);
        visible.add(e.id);
      }
    }
    // Spread visible labels along their edges so parallel edges do not stack their text.
    // The hovered edge is placed first and gets the best spot; cards are soft obstacles.
    // The hovered line's label is always placed where it can be read: on the part of the line on
    // screen, off the navigator and the zoom buttons, on a horizontal run where there is one.
    const onScreen = focusEdge ? screenRegions(flow.getViewport()) : null;
    const requests: LabelRequest[] = base.edges
      .filter((e) => visible.has(e.id))
      .sort((a, b) => Number(b.id === focusEdge) - Number(a.id === focusEdge))
      .map((e) => ({
        id: e.id,
        points: (e.data as { points: { x: number; y: number }[] }).points,
        // Focused labels show their whole text, so they are placed at full width.
        w: measureLabel(String(e.label), 11, activeEdges.has(e.id)) + 14,
        h: 18,
        ...(e.id === focusEdge && onScreen ? { within: onScreen.view, avoid: onScreen.covered } : {}),
      }));
    const cards = base.nodes.filter((n) => !n.data.container && n.type === "card").map((n) => ({ x: n.position.x, y: n.position.y, w: n.width!, h: n.height! }));
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
        // Focused lines rise above cards and titles. Changing an edge's z-index remounts it in another
        // SVG layer; that is fine for the line, and its label fades in rather than jumping.
        zIndex: active ? 360 : 100,
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
    // While hovering, the cards the highlight reaches lift a little; the hovered card itself lifts
    // more through plain :hover CSS, so it is left out here.
    const near = hover ? new Set([...activeNodes].filter((k) => !(hover.kind === "node" && k === hover.id && !hover.floor)))
      : point ? railNodes : new Set<string>();
    // The floor's projections follow the cards: a focused card's projection lights up, the rest dim.
    return { nodes: base.nodes, edges, focusCss: (focused ? cardFocusCss(activeNodes) : "") + matchCss(matches) + liftCss(near), focusSet: focused ? activeNodes : null, shownHover: hover };
  }, [base, pointer, listHover, selected, allLabels, parents, highlightStars, starredList, search, query, railActive, diffHover, diffPoint, timeline, flow, viewTick]);

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
        {READ_ONLY && <span className="badge" title="A static copy: browse freely; editing needs `portolan serve`">read-only demo</span>}
        {counts.error > 0 && <span className="badge badge-error">{counts.error} errors</span>}
        {counts.warning > 0 && <span className="badge badge-warning">{counts.warning} warnings</span>}
        <div className="tool-group" role="group" aria-label="View">
          <IconButton icon={<ExpandAllIcon />} label="Expand all groups"
            onClick={() => setOverrides(new Map([...all.keys()].map((k) => [k, false])))} disabled={collapsed.size === 0} />
          <IconButton icon={<ResetViewIcon />} label="Reset folding to the default"
            onClick={() => setOverrides(new Map())} disabled={overrides.size === 0} />
          <IconButton icon={<EdgeLabelsIcon />} label={allLabels ? "Hide edge labels" : "Show all edge labels"}
            pressed={allLabels} onClick={() => setAllLabels((v) => !v)} />
          <IconButton icon={<View3DIcon />} pressed={threeD}
            label={threeD ? "Leave the time-depth view" : "Time-depth view: time as a level axis, each card a panel standing at its own moment"}
            onClick={toggle3D}>
            <span className="icon-text">3D</span>
          </IconButton>
        </div>
        <div className="search" role="search" ref={searchWrap}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setListOpen(false); }}>
          <SearchIcon />
          <input ref={searchBox} type="search" className="search-input" value={query} placeholder="Find node (/)"
            role="combobox" aria-autocomplete="list" aria-controls="search-list"
            aria-expanded={listOpen && candidates.length > 0}
            aria-activedescendant={listOpen && active >= 0 ? `search-opt-${active}` : undefined}
            aria-label="Find nodes by ID or title; filter with kind:hypothesis or is:refuted" title="ID or title; filters: kind:<kind>, is:<claim>"
            aria-describedby="search-count" spellCheck={false}
            onChange={(e) => (setQuery(e.target.value), setListOpen(true))}
            onFocus={() => setListOpen(true)}
            onClick={() => setListOpen(true)}
            onKeyDown={onSearchKey} />
          {query.trim() && (
            <span id="search-count" className={`search-count${search.keys.length === 0 ? " none" : ""}`} aria-live="polite">
              {search.exact ? "ID" : search.keys.length === 0 ? "no match"
                : hit >= 0 ? `${hit + 1}/${search.keys.length}` : `${search.keys.length} found`}
            </span>
          )}
          {listOpen && candidates.length > 0 && (
            <ul id="search-list" className="search-list" role="listbox" aria-label="Best matches">
              {candidates.map((key, i) => {
                const n = all.get(key)!;
                const parent = parents.get(key);
                return (
                  <li key={key} id={`search-opt-${i}`} role="option" aria-selected={i === active}
                    className={`search-option status-${n.status ?? "todo"}${i === active ? " active" : ""}`}
                    // Keep focus in the box, so the list stays open until the click lands.
                    onPointerDown={(e) => e.preventDefault()}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => pick(i)}>
                    <span className="star-menu-status">{n.status ?? "?"}</span>
                    <span className="search-option-text">
                      <span className="search-option-title">{plainTitle(n.title)}</span>
                      <span className="search-option-sub muted">
                        {n.id ? `^${n.id}` : `line ${n.line}`}{parent ? ` · ${plainTitle(parent.title)}` : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
              {search.ranked.length > SEARCH_LIST && (
                <li className="search-more muted" role="presentation">
                  {search.ranked.length - SEARCH_LIST} more; Enter steps through all
                </li>
              )}
            </ul>
          )}
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
        <div className="legend-wrap" ref={legendWrap}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setLegendOpen(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setLegendOpen(false); }}>
          <button type="button" className={`btn legend-btn${legendOpen ? " pressed" : ""}`} aria-haspopup="dialog"
            aria-expanded={legendOpen} aria-controls="map-legend" onClick={() => setLegendOpen((v) => !v)}>
            <LegendIcon /> Legend
          </button>
          {legendOpen && (
            <div id="map-legend" className="popover legend-popover" role="dialog" aria-label="Legend" tabIndex={-1}>
              <Legend letters={letters} />
            </div>
          )}
        </div>
        <a className="btn source-link" href={sourceUrl(file)} target="_blank" rel="noopener noreferrer"
          title={`Open ${file} as plain text in a new tab`}>
          <SourceIcon /> Source: <span className="source-file">{file.split("/").pop()}</span>
        </a>
        {/* The map's state, at the bar's right end: any warning (its text in the icon's tooltip), the
            time of the last reload, and the live link to the server. */}
        <span className="live-end">
          <WarningNotice messages={[notice, layoutError].filter((m): m is string => !!m)}
            onDismiss={() => (setNotice(null), setLayoutError(null))} />
          {reloadedAt && <span className="muted reloaded" aria-live="polite">updated {reloadedAt}</span>}
          <ConnectionStatus />
        </span>
      </div>
      <div className="doc-body">
        <div className={`canvas${orbiting ? " orbiting" : ""}`}
          // The right button turns the 3D camera, so the browser's own menu is held back there.
          onPointerDownCapture={onOrbitDown} onPointerMoveCapture={onOrbitMove}
          onPointerUpCapture={onOrbitUp} onPointerCancelCapture={onOrbitUp}
          onContextMenu={threeD ? (e) => e.preventDefault() : undefined}>
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
            // The last settled pan or zoom: the ruler's density, and in 3D a deep zoom refocuses.
            onMoveEnd={onMoveEnd}
            proOptions={{ hideAttribution: false }}
          >
            {scene && <DepthFloor scene={scene} zoom={zoom} marks={floorMarks} focus={focusSet} hovered={shownHover?.kind === "node" ? shownHover.id : null}
              onHover={onFloorHover} />}
            {scene && !moving && scene.pose.blend > 0.99 && shownHover?.kind === "node" && (() => {
              // A panel at 45° is foreshortened, so the hovered one also shows its title flat.
              const hover = shownHover;
              const panel = scene.panels.get(hover.id);
              const box = layout?.boxes.find((b) => b.key === hover.id);
              if (!panel || !box) return null;
              const t = nodeTimes.get(box.node.line);
              const sub = [box.node.id ? shortId(box.node.id, null, 24) : "", t !== undefined ? absoluteTime(t) : ""].filter(Boolean).join(" · ");
              // Pointed at on the floor, the title shows there; pointed at in a list, over the panel.
              return <HoverTitle panel={panel} title={plainTitle(box.node.title)} sub={sub} at={hover.floor && pointer ? floorAt ?? undefined : undefined} />;
            })()}
            <Background gap={24} />
            <Controls showInteractive={false} />
            {/* The navigator always draws the flat map and the flat view's frame, in 3D as well:
                that frame is the camera whose cards decide the 3D pose. */}
            <FlatMiniMap
              boxes={layout?.boxes ?? []}
              classOf={(b) => `mini status-${b.node.status ?? "todo"}${b.container ? " mini-group" : ""}${starred(b.node) ? " mini-star" : ""}`}
              // In 3D the navigator moves its own frame, not the 3D view; the pose follows once a drag ends.
              camera={camera}
              onCamera={threeD ? setCam : undefined}
              onDrag={(on) => { if (!on) retarget(); }}
            />
          </ReactFlow>
        </div>
        <div className="side">
        <div className="side-main">
        <SidePanel
          key={data.version}
          file={file}
          node={node}
          state={node ? data.derived.find((s) => s.line === node.line) : undefined}
          diagnostics={data.doc.diagnostics}
          onStar={onStar}
          timed={timed}
          blocked={blocked}
          onHoverItem={setListHover}
          onGoTo={goTo}
          freshness={data.freshness}
          now={now}
          onSelectLine={selectLine}
          onFocusLine={focusLine}
        />
        {!node && diffPoint && (() => {
          const p = timeline?.points.find((x) => pointKey(x) === diffPoint);
          const d = diffText?.key === diffPoint ? diffText : null;
          return p && <DiffPanel point={p} diff={d?.text ?? null} error={d?.error ?? null} now={now}
            onClose={() => (setDiffPoint(null), setDiffHover(false))} onHover={setDiffHover} />;
        })()}
        </div>
        {!node && timeline && <TimelineRail timeline={timeline} now={now} active={railActive ?? (diffHover ? diffPoint : null)} pinned={diffPoint}
            onActive={onRailActive} onPick={framePoint} onMore={MORE_HISTORY ? loadMore : undefined} loading={moreLoading} />}
        </div>
      </div>
    </div>
  );
}

function cardTime(t: NodeTime | undefined, now: number) {
  if (!t) return { fresh: 0, updated: undefined, updatedText: "" };
  // No line time when the map dates items by links only (`dates: links`).
  const line = !t.lineTime ? null : t.lineTime.source === "local" ? "uncommitted change" : `commit ${t.lineTime.sha!.slice(0, 8)}`;
  const how = t.source === "link" ? `linked entry ${t.link!.date}${line ? `, earlier than ${line}` : ""}`
    : t.source === "children" ? `newest child ${t.child!.id ? `^${t.child!.id}` : `line ${t.child!.line}`}`
    : line;
  return { fresh: freshness(t.time, now), updated: t, updatedText: `Updated ${relativeTime(t.time, now)} (${absoluteTime(t.time)}, ${how})` };
}

/** Dims every card except the focused ones and their frames, without touching node objects. */
function cardFocusCss(active: Set<string>): string {
  // A frame's fill layer dims and brightens with the frame.
  const keep = [...active].flatMap((id) => [id, fillId(id)]).map((id) => `.react-flow__node[data-id="${CSS.escape(id)}"]`).join(",");
  return `.canvas .react-flow__node{opacity:.35}${keep ? `${keep}{opacity:1}` : ""}`;
}

/** A lighter hover lift for the cards a hovered item or line highlights; frames never lift. */
function liftCss(keys: Set<string>): string {
  if (keys.size === 0) return "";
  const sel = [...keys].map((id) => `.react-flow__node[data-id="${CSS.escape(id)}"] .card:not(.container)`).join(",");
  return `${sel}{filter:drop-shadow(var(--lift-near))}`;
}

/** Outlines search matches, whatever else is focused (hover, selection). */
function matchCss(keys: Set<string>): string {
  if (keys.size === 0) return "";
  const sel = [...keys].map((id) => `.react-flow__node[data-id="${CSS.escape(id)}"] .card`).join(",");
  return `${sel}{outline:2px solid var(--match);outline-offset:2px}`;
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
