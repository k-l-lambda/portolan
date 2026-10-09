// Shared view helpers: card size, node keys, default collapse, compact IDs and titles.

import type { RhumbNode } from "../../src/types.ts";

export const CARD_W = 240;
export const CARD_H = 76;

/** Stable key for a node: its ID, or its line when it has none. */
export function nodeKey(node: RhumbNode): string {
  return node.id ?? `line:${node.line}`;
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
