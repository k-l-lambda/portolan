// Mind-map layout: roots on the left, children to the right, leaves stacked vertically and
// parents centered on their children. Pure function so it can be unit-tested without a DOM.

import type { Edge, EdgeKind, RhumbNode } from "../../src/types.ts";

export const CARD_W = 240;
export const CARD_H = 76;
const GAP_X = 80;
const GAP_Y = 14;

export interface LaidOutNode {
  key: string;
  node: RhumbNode;
  x: number;
  y: number;
  depth: number;
  /** Descendants hidden because this node is collapsed. */
  hidden: number;
}

export interface LaidOutEdge {
  key: string;
  source: string;
  target: string;
  /** "tree" for parent→child, otherwise the Rhumb edge kind. */
  kind: "tree" | EdgeKind;
  label: string | null;
}

export interface Layout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

/** Stable key for a node: its ID, or its line when it has none. */
export function nodeKey(node: RhumbNode): string {
  return node.id ?? `line:${node.line}`;
}

export function layoutTree(roots: RhumbNode[], edges: Edge[], collapsed: Set<string>): Layout {
  const nodes: LaidOutNode[] = [];
  const treeEdges: LaidOutEdge[] = [];
  // Every node (visible or not) → the visible node that represents it.
  const shownAs = new Map<string, string>();
  let nextY = 0;

  const count = (n: RhumbNode): number => n.children.reduce((s, c) => s + 1 + count(c), 0);
  const hide = (n: RhumbNode, rep: string) => {
    for (const c of n.children) {
      shownAs.set(nodeKey(c), rep);
      hide(c, rep);
    }
  };

  // Returns the node's y (top of its card).
  const place = (n: RhumbNode, depth: number): number => {
    const key = nodeKey(n);
    shownAs.set(key, key);
    const isCollapsed = collapsed.has(key) && n.children.length > 0;
    let y: number;
    if (n.children.length === 0 || isCollapsed) {
      y = nextY;
      nextY += CARD_H + GAP_Y;
      if (isCollapsed) hide(n, key);
    } else {
      const ys = n.children.map((c) => {
        treeEdges.push({ key: `tree:${key}->${nodeKey(c)}`, source: key, target: nodeKey(c), kind: "tree", label: null });
        return place(c, depth + 1);
      });
      y = (ys[0]! + ys[ys.length - 1]!) / 2;
    }
    nodes.push({ key, node: n, x: depth * (CARD_W + GAP_X), y, depth, hidden: isCollapsed ? count(n) : 0 });
    return y;
  };

  for (const root of roots) {
    place(root, 0);
    nextY += GAP_Y * 2; // extra space between root trees
  }

  // Cross edges between visible representatives; drop ones folded into a single card.
  const crossEdges: LaidOutEdge[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    const source = shownAs.get(e.from);
    const target = shownAs.get(e.to);
    if (!source || !target || source === target) continue;
    const key = `${e.kind}:${source}->${target}${e.label ? `:${e.label}` : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    crossEdges.push({ key, source, target, kind: e.kind, label: e.label });
  }

  return { nodes, edges: [...treeEdges, ...crossEdges] };
}

/**
 * Default collapse state: a node with children starts collapsed unless its subtree
 * contains a `doing` node, so the map opens on the work in progress.
 */
export function defaultCollapsed(roots: RhumbNode[]): Set<string> {
  const out = new Set<string>();
  const visit = (n: RhumbNode): boolean => {
    const active = n.children.map(visit).some(Boolean);
    if (n.children.length > 0 && !active) out.add(nodeKey(n));
    return active || n.status === "doing";
  };
  roots.forEach(visit);
  return out;
}

/**
 * Card label for an ID: when it repeats the parent's ID as a prefix (`rhumb-parser` under
 * `rhumb`), show `^…-parser`. Long IDs are cut from the start so the distinctive end stays
 * visible: at most `max` characters after the `^`.
 */
export function shortId(id: string | null, parentId: string | null, max = 13): string {
  if (!id) return "no id";
  let rest = id;
  let cut = false;
  if (parentId && id.length > parentId.length && id.startsWith(parentId) && /[-_]/.test(id[parentId.length]!)) {
    rest = id.slice(parentId.length);
    cut = true;
  }
  if (rest.length > max) {
    rest = rest.slice(rest.length - (max - 1));
    cut = true;
  }
  return cut ? `^…${rest}` : `^${rest}`;
}

/** Title text without Markdown link syntax, for compact cards. */
export function plainTitle(title: string): string {
  return title
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\([\^{])/g, "$1");
}
