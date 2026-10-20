// Derived semantics (spec section 6): computed from the AST, never written to the file.

import { BLOCKED_BY, blockedReason, MAX_NOTES } from "./notes.ts";
import { diagnostic } from "./parse.ts";
import type { Diagnostic, RhumbDocument, RhumbNode } from "./types.ts";

export interface NodeState {
  line: number;
  id: string | null;
  /** Done leaves / committed leaves in the subtree; null when nothing is committed. */
  progress: { done: number; total: number } | null;
  /** todo, and every dependency is done (or dropped, see W006). */
  ready: boolean;
}

export interface Derived {
  nodes: NodeState[];
  diagnostics: Diagnostic[];
}

const OPEN = new Set(["todo", "doing", "blocked"]);

export function derive(doc: RhumbDocument): Derived {
  const all: RhumbNode[] = [];
  const walk = (nodes: RhumbNode[]) => nodes.forEach((n) => (all.push(n), walk(n.children)));
  walk(doc.nodes);

  const byId = new Map<string, RhumbNode>();
  for (const n of all) if (n.id !== null && !byId.has(n.id)) byId.set(n.id, n);

  // Dependencies as x needs y, with the edge line for diagnostics.
  const needs = new Map<RhumbNode, { target: RhumbNode; line: number }[]>();
  for (const e of doc.edges) {
    if (e.kind !== "needs" && e.kind !== "blocks") continue;
    const [x, y] = e.kind === "needs" ? [byId.get(e.from), byId.get(e.to)] : [byId.get(e.to), byId.get(e.from)];
    if (!x || !y) continue;
    if (!needs.has(x)) needs.set(x, []);
    needs.get(x)!.push({ target: y, line: e.line });
  }

  const diagnostics: Diagnostic[] = [];
  const progress = new Map<RhumbNode, { done: number; total: number }>();
  const count = (n: RhumbNode): { done: number; total: number } => {
    let r: { done: number; total: number };
    if (n.children.length === 0) {
      const committed = n.status !== "dropped" && n.status !== "idea";
      r = { done: committed && n.status === "done" ? 1 : 0, total: committed ? 1 : 0 };
    } else {
      r = n.children.map(count).reduce((a, b) => ({ done: a.done + b.done, total: a.total + b.total }));
    }
    progress.set(n, r);
    return r;
  };
  doc.nodes.forEach(count);

  // Relation endpoints, for the isolated-node check below.
  const linked = new Set<string>();
  for (const e of doc.edges) { linked.add(e.from); linked.add(e.to); }
  const related = (n: RhumbNode): boolean =>
    (n.id !== null && linked.has(n.id)) || n.children.some(related);

  const hasOpenDescendant = (n: RhumbNode): boolean =>
    n.children.some((c) => OPEN.has(c.status ?? "") || hasOpenDescendant(c));

  /** Some node strictly below `n` is doing. */
  const hasDoingDescendant = (n: RhumbNode): boolean =>
    n.children.some((c) => c.status === "doing" || hasDoingDescendant(c));

  // Nodes the isolated check applies to: not a root, and one of several siblings.
  const isolated = new Set<RhumbNode>();
  const mark = (nodes: RhumbNode[], top: boolean) => nodes.forEach((n) => {
    if (!top && nodes.length > 1 && !related(n)) isolated.add(n);
    mark(n.children, false);
  });
  mark(doc.nodes, true);

  const nodes: NodeState[] = all.map((n) => {
    const deps = needs.get(n) ?? [];
    for (const d of deps) {
      if (d.target.status === "dropped") {
        diagnostics.push(diagnostic("W006", d.line, `"${n.id}" depends on dropped node "${d.target.id}"`));
      } else if ((n.status === "doing" || n.status === "done") && d.target.status !== "done") {
        diagnostics.push(diagnostic("W008", n.line, `"${n.id}" is ${n.status} but "${d.target.id}" is not done`));
      }
    }
    // A doing node whose whole subtree has stopped: itself finished in effect, or the wrong node
    // carries the status. Only warned when no descendant is doing either.
    if (n.status === "doing" && n.children.length > 0 && !hasDoingDescendant(n)) {
      diagnostics.push(diagnostic("W018", n.line, "Node is doing but nothing in its subtree is"));
    }
    if (n.status === "done" && hasOpenDescendant(n)) {
      diagnostics.push(diagnostic("W007", n.line, "Node is done but its subtree still has open work"));
    }
    // A node no relation reaches or starts, among siblings that are not all like it, is likely a
    // forgotten item or a missing edge. Top-level nodes and only children are left alone.
    if (isolated.has(n)) {
      diagnostics.push(diagnostic("I006", n.line, n.children.length > 0
        ? `"${n.id ?? n.title}" and nothing below it has a relation to another node`
        : `"${n.id ?? n.title}" has no relation to another node`));
    }
    if (n.status === "todo" && n.children.some((c) => c.status === "doing" || c.status === "done")) {
      diagnostics.push(diagnostic("I003", n.line, "Children have started; consider marking this node doing"));
    }
    // A blocked node says what blocks it, in a note of its own, so the blocked list can say why.
    if (n.status === "blocked" && blockedReason(n) === null) {
      diagnostics.push(diagnostic("W019", n.line, `Blocked node has no "${BLOCKED_BY}" note saying what blocks it`));
    }
    // Notes are a description, not a log: a long run of them is usually states written one after another.
    if (n.notes.length > MAX_NOTES) {
      diagnostics.push(diagnostic("I007", n.line, `${n.notes.length} notes; consider condensing them, and for a history of states keep only the latest`));
    }
    const p = progress.get(n)!;
    return {
      line: n.line,
      id: n.id,
      progress: p.total > 0 ? p : null,
      ready: n.status === "todo" && deps.every((d) => d.target.status === "done" || d.target.status === "dropped"),
    };
  });

  diagnostics.sort((a, b) => a.line - b.line);
  return { nodes, diagnostics };
}
