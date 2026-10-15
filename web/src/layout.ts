// Shared view helpers: card size, node keys, default collapse, compact IDs and titles.

import { claimOf, isPresetKind, nodeKind, type ClaimMark } from "../../src/kinds.ts";
import type { RhumbNode } from "../../src/types.ts";

/** The project's home page. */
export const REPO_URL = "https://github.com/k-l-lambda/portolan";

export const CARD_W = 240;
export const CARD_H = 76;

/** Stable key for a node: its ID, or its line when it has none. */
export function nodeKey(node: RhumbNode): string {
  return node.id ?? `line:${node.line}`;
}

/** Same rule as the parser's isStarred: only `star: true` counts. */
export function starred(node: RhumbNode): boolean {
  return node.attrs.star === true;
}

/**
 * Default collapse state: a node with children starts collapsed unless its subtree
 * contains a `doing` node, so the map opens on the work in progress. Stars do not open
 * branches; a folded card shows how many stars it holds, and the star menu reveals them.
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
 * Folds to undo after a reload: the user's folds (`overrides` set to true) on the ancestors of
 * nodes that are doing now but were not before, so newly started work shows even inside a group
 * folded by hand. Returns the new overrides, or `overrides` itself when nothing changes.
 */
export function unfoldStarted(
  overrides: Map<string, boolean>,
  doingBefore: Set<string>,
  nodes: Map<string, RhumbNode>,
  parents: Map<string, RhumbNode | null>,
): Map<string, boolean> {
  let next: Map<string, boolean> | null = null;
  for (const [key, n] of nodes) {
    if (n.status !== "doing" || doingBefore.has(key)) continue;
    for (let p = parents.get(key); p; p = parents.get(nodeKey(p))) {
      if (overrides.get(nodeKey(p)) === true) (next ??= new Map(overrides)).delete(nodeKey(p));
    }
  }
  return next ?? overrides;
}

/** Number of starred descendants of each node (the node itself not counted). */
export function starredInside(roots: RhumbNode[]): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (n: RhumbNode): number => {
    const below = n.children.reduce((s, c) => s + visit(c) + (starred(c) ? 1 : 0), 0);
    out.set(nodeKey(n), below);
    return below;
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

/**
 * Letters for each custom kind among `nodes` (preset kinds have icons): the shortest prefix no
 * other custom kind in the map shares, counted in characters, first letter upper-cased. A kind
 * that is a prefix of another keeps its whole name ("data" next to "dataset" stays "Data").
 */
export function kindLetters(nodes: Iterable<RhumbNode>): Map<string, string> {
  const names = new Set<string>();
  const walk = (ns: Iterable<RhumbNode>) => {
    for (const n of ns) {
      const k = nodeKind(n);
      if (k && !isPresetKind(k)) names.add(k);
      walk(n.children);
    }
  };
  walk(nodes);
  // Sorted by code point, a name shares its longest prefix with one of its neighbours.
  const sorted = [...names].map((n) => [...n]).sort((a, b) => (a.join("") < b.join("") ? -1 : 1));
  const common = (a: string[], b: string[] | undefined) => {
    let i = 0;
    while (b && i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };
  const out = new Map<string, string>();
  sorted.forEach((n, i) => {
    const take = Math.min(n.length, Math.max(common(n, sorted[i - 1]), common(n, sorted[i + 1])) + 1);
    out.set(n.join(""), n[0]!.toUpperCase() + n.slice(1, take).join(""));
  });
  return out;
}

/** Claim icons to show on a card: the verdict (or untested), then the qualifiers. */
export function claimMarks(node: RhumbNode): ClaimMark[] {
  const c = claimOf(node);
  return [...(c.verdict ? [c.verdict] : c.untested ? ["untested" as const] : []), ...c.qualifiers];
}
