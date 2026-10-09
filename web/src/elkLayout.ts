// Nested-container layout with ELK's layered algorithm (the approach of Mermaid/D2 subgraphs).
//
// A node with visible children becomes a container that draws its children inside it, so
// the hierarchy needs no tree edges. Only Rhumb relations are edges; ELK lays them out across
// the hierarchy (INCLUDE_CHILDREN), minimizes crossings and routes them orthogonally around
// cards.
//
// The layout runs top to bottom: prerequisites and history above, current work and plans
// below. Among siblings, invisible ordering edges (Mermaid's `~~~` trick) stack finished work
// by day, oldest on top, then doing and blocked work, then todo, then ideas. Dependencies win:
// before adding ordering edges, each sibling's row is pushed below every sibling it depends
// on (directly or through descendants), so ordering edges never contradict a real edge.
// ELK treats every edge as directed, including `relates`, so each edge is handed to ELK
// oriented along one global order (rows from the root down); the drawn route is flipped back
// to the Rhumb direction. With every ELK edge agreeing on that order there are no cycles for
// ELK to break, and the ordering edges hold.

import ELKModule from "elkjs/lib/elk.bundled.js";
import type { Edge, EdgeKind, RhumbNode } from "../../src/types.ts";
import { CARD_H, CARD_W, nodeKey } from "./layout.ts";

/** Space for a container's header (status, title, ID, progress) above its children. */
export const HEADER_H = CARD_H;
const PAD = 12;

export interface Box {
  key: string;
  node: RhumbNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  container: boolean;
  /** Descendants hidden because this node is collapsed. */
  hidden: number;
}

export interface Route {
  key: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string | null;
  /** Rhumb edges drawn as this route: more than 1 when a collapsed subtree folds them together. */
  count: number;
  /** Distinct labels of the folded edges. */
  labels: string[];
  /** Absolute polyline from source to target (the Rhumb direction). */
  points: { x: number; y: number }[];
}

export interface ElkResult {
  boxes: Box[];
  routes: Route[];
  width: number;
  height: number;
}

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  layoutOptions?: Record<string, string>;
  container?: string;
  sections?: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] }[];
}

const ROOT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.spacing.nodeNode": "18",
  "elk.layered.spacing.nodeNodeBetweenLayers": "40",
  "elk.spacing.edgeNode": "14",
  "elk.spacing.edgeEdge": "8",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
};

const CONTAINER_OPTIONS: Record<string, string> = {
  "elk.padding": `[top=${HEADER_H + PAD},left=${PAD},bottom=${PAD},right=${PAD}]`,
  "elk.nodeSize.constraints": "MINIMUM_SIZE",
  "elk.nodeSize.minimum": `(${CARD_W},${HEADER_H + PAD})`,
};

/**
 * Layout direction of an edge: prerequisites and sources of work go above. `a needs b` flows
 * b → a; `a from b` and `a replaces b` flow b → a; `a blocks b` and `relates` flow as written.
 */
function flows(kind: EdgeKind): "forward" | "reverse" {
  return kind === "needs" || kind === "from" || kind === "replaces" ? "reverse" : "forward";
}

/** Real relations must keep their direction; ordering edges give way when they conflict. */
const REAL_EDGE = { "elk.layered.priority.direction": "10" };
const ORDER_EDGE = { "elk.layered.priority.direction": "1" };

/**
 * Vertical band of a sibling: finished work (done, dropped) by local day, then doing and
 * blocked, then todo, then ideas. Within a band, siblings sit left to right oldest first.
 */
export function band(node: RhumbNode, time: number | undefined): number {
  const FUTURE = 1e7;
  switch (node.status) {
    case "done":
    case "dropped":
      return time === undefined ? FUTURE - 1 : Math.floor(time / 86_400);
    case "doing":
    case "blocked":
      return FUTURE;
    case "idea":
      return FUTURE + 2;
    default:
      return FUTURE + 1;
  }
}

interface ElkEngine { layout(graph: unknown): Promise<unknown> }
// elk.bundled is CommonJS: the default import is the constructor in Vite, `.default` under Node typing.
const ELK = ((ELKModule as unknown as { default?: unknown }).default ?? ELKModule) as new () => ElkEngine;
let elk: ElkEngine | null = null;

export async function layoutElk(
  roots: RhumbNode[],
  edges: Edge[],
  collapsed: Set<string>,
  /** Update time of a node, used to order siblings; see `band`. */
  timeOf: (node: RhumbNode) => number | undefined = () => undefined,
): Promise<ElkResult> {
  elk ??= new ELK();
  const shownAs = new Map<string, string>();
  const parentOf = new Map<string, string | null>();
  const info = new Map<string, { node: RhumbNode; depth: number; container: boolean; hidden: number }>();

  const count = (n: RhumbNode): number => n.children.reduce((s, c) => s + 1 + count(c), 0);
  // Visible siblings per parent ("__root" for the top level) in band order, with their band.
  const siblings = new Map<string, { key: string; band: number }[]>();
  const order = (nodes: RhumbNode[], parent: string | null) => {
    const sorted = nodes.map((n, i) => ({ n, i, t: timeOf(n), b: band(n, timeOf(n)) }))
      .sort((a, b) => a.b - b.b || (a.t ?? Infinity) - (b.t ?? Infinity) || a.i - b.i);
    siblings.set(parent ?? "__root", sorted.map((x) => ({ key: nodeKey(x.n), band: x.b })));
    return sorted.map((x) => x.n);
  };

  const build = (n: RhumbNode, depth: number, parent: string | null, rep: string | null): ElkNode | null => {
    const key = nodeKey(n);
    if (rep) {
      shownAs.set(key, rep);
      n.children.forEach((c) => build(c, depth + 1, parent, rep));
      return null;
    }
    shownAs.set(key, key);
    parentOf.set(key, parent);
    const folded = collapsed.has(key) && n.children.length > 0;
    const container = n.children.length > 0 && !folded;
    info.set(key, { node: n, depth, container, hidden: folded ? count(n) : 0 });
    if (folded) n.children.forEach((c) => build(c, depth + 1, key, key));
    if (!container) return { id: key, width: CARD_W, height: CARD_H };
    return {
      id: key,
      layoutOptions: CONTAINER_OPTIONS,
      children: order(n.children, key).map((c) => build(c, depth + 1, key, null)!).filter(Boolean),
    };
  };
  const children = order(roots, null).map((r) => build(r, 0, null, null)!).filter(Boolean);

  const isAncestor = (a: string, b: string) => {
    for (let p = parentOf.get(b) ?? null; p; p = parentOf.get(p) ?? null) if (p === a) return true;
    return false;
  };

  // Relations between visible representatives. Edges that collapse into one card or between
  // a container and its own descendant (containment already says that) are dropped. Edges of
  // one kind that a collapsed subtree folds onto the same pair become one route with a count;
  // edges between two visible nodes keep their own route per label.
  const meta = new Map<string, { e: Edge; source: string; target: string; reverse: boolean; count: number; labels: string[]; elkFrom?: string }>();
  const elkEdges: ElkEdge[] = [];
  for (const e of edges) {
    const source = shownAs.get(e.from);
    const target = shownAs.get(e.to);
    if (!source || !target || source === target || isAncestor(source, target) || isAncestor(target, source)) continue;
    const folded = source !== e.from || target !== e.to;
    const key = folded ? `${e.kind}:${source}->${target}:folded` : `${e.kind}:${source}->${target}${e.label ? `:${e.label}` : ""}`;
    const seen = meta.get(key);
    if (seen) {
      if (folded) {
        seen.count++;
        if (e.label && !seen.labels.includes(e.label)) seen.labels.push(e.label);
      }
      continue;
    }
    const reverse = flows(e.kind) === "reverse";
    meta.set(key, { e, source, target, reverse, count: 1, labels: e.label ? [e.label] : [] });
  }

  // Lift dependency-like edges (layout direction) to the pair of siblings under the
  // endpoints' lowest common ancestor: "child of parent P that contains this endpoint".
  const chain = (k: string) => {
    const out = [k];
    for (let p = parentOf.get(k) ?? null; p; p = parentOf.get(p) ?? null) out.push(p);
    return out; // node, parent, …, root-level ancestor
  };
  const before = new Map<string, Set<string>>(); // sibling → siblings that must be above it
  for (const m of meta.values()) {
    if (m.e.kind === "relates") continue; // relates does not order work
    const [up, down] = m.reverse ? [m.target, m.source] : [m.source, m.target];
    const cu = chain(up), cd = chain(down);
    const common = new Set(cu);
    const lca = cd.find((k, i) => i > 0 && common.has(k)) ?? null;
    const su = lca ? cu[cu.indexOf(lca) - 1]! : cu[cu.length - 1]!;
    const sd = lca ? cd[cd.indexOf(lca) - 1]! : cd[cd.length - 1]!;
    if (su === sd) continue;
    if (!before.has(sd)) before.set(sd, new Set());
    before.get(sd)!.add(su);
  }

  // Row of each sibling: at least its band's rank, and below every sibling it depends on.
  // Longest-path relaxation; dependency cycles among siblings are cut by iteration count.
  let n = 0;
  const rowOf = new Map<string, { row: number; index: number }>();
  for (const list of siblings.values()) {
    if (list.length < 2) {
      list.forEach((x, i) => rowOf.set(x.key, { row: 0, index: i }));
      continue;
    }
    const ranks = [...new Set(list.map((x) => x.band))].sort((a, b) => a - b);
    const row = new Map(list.map((x) => [x.key, ranks.indexOf(x.band)]));
    for (let pass = 0; pass < list.length; pass++) {
      let changed = false;
      for (const { key } of list) {
        for (const dep of before.get(key) ?? []) {
          if (row.has(dep) && row.get(key)! <= row.get(dep)!) (row.set(key, row.get(dep)! + 1), (changed = true));
        }
      }
      if (!changed) break;
    }
    const rows = [...new Set(row.values())].sort((a, b) => a - b).map((r) => list.filter((x) => row.get(x.key) === r));
    rows.forEach((members, r) => members.forEach((x, i) => rowOf.set(x.key, { row: r, index: i })));
    // Ordering edges between consecutive rows; never drawn.
    for (let i = 1; i < rows.length; i++) {
      for (const a of rows[i - 1]!) for (const b of rows[i]!) {
        elkEdges.push({ id: `__order:${n++}`, sources: [a.key], targets: [b.key], layoutOptions: ORDER_EDGE });
      }
    }
  }

  // Global order: compare the (row, index) of the two endpoints' ancestors where their chains
  // split. Real edges go to ELK pointing from the earlier node to the later one.
  const path = (k: string) => chain(k).reverse().map((c) => rowOf.get(c) ?? { row: 0, index: 0 });
  const earlier = (a: string, b: string) => {
    const pa = path(a), pb = path(b);
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      if (pa[i]!.row !== pb[i]!.row) return pa[i]!.row < pb[i]!.row;
      if (pa[i]!.index !== pb[i]!.index) return pa[i]!.index < pb[i]!.index;
    }
    return pa.length <= pb.length;
  };
  for (const [key, m] of meta) {
    const [up, down] = m.reverse ? [m.target, m.source] : [m.source, m.target];
    const [from, to] = earlier(up, down) ? [up, down] : [down, up];
    m.elkFrom = from;
    elkEdges.push({ id: key, sources: [from], targets: [to], layoutOptions: REAL_EDGE });
  }

  const out = (await elk.layout({ id: "__root", layoutOptions: ROOT_OPTIONS, children, edges: elkEdges })) as ElkNode;

  const boxes: Box[] = [];
  const origin = new Map<string, { x: number; y: number }>([["__root", { x: 0, y: 0 }]]);
  const walk = (nodes: ElkNode[] | undefined, ox: number, oy: number) => {
    for (const n of nodes ?? []) {
      const x = ox + (n.x ?? 0);
      const y = oy + (n.y ?? 0);
      origin.set(n.id, { x, y });
      const i = info.get(n.id)!;
      boxes.push({ key: n.id, node: i.node, x, y, width: n.width ?? CARD_W, height: n.height ?? CARD_H,
        depth: i.depth, container: i.container, hidden: i.hidden });
      walk(n.children, x, y);
    }
  };
  walk(out.children, 0, 0);

  const routes: Route[] = [];
  for (const e of out.edges ?? []) {
    const m = meta.get(e.id);
    if (!m) continue; // ordering edge
    const s = e.sections?.[0];
    if (!s) continue;
    const o = origin.get(e.container ?? "__root") ?? { x: 0, y: 0 };
    let points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
    if (m.elkFrom !== m.source) points = points.reverse(); // back to the Rhumb direction
    const label = m.count > 1 ? null : m.e.label;
    routes.push({ key: e.id, source: m.source, target: m.target, kind: m.e.kind, label, count: m.count, labels: m.labels, points });
  }
  return { boxes, routes, width: out.width ?? 0, height: out.height ?? 0 };
}
