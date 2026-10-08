// Derived semantics (spec section 6): computed from the AST, never written to the file.

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

  const hasOpenDescendant = (n: RhumbNode): boolean =>
    n.children.some((c) => OPEN.has(c.status ?? "") || hasOpenDescendant(c));

  const nodes: NodeState[] = all.map((n) => {
    const deps = needs.get(n) ?? [];
    for (const d of deps) {
      if (d.target.status === "dropped") {
        diagnostics.push(diagnostic("W006", d.line, `"${n.id}" depends on dropped node "${d.target.id}"`));
      } else if ((n.status === "doing" || n.status === "done") && d.target.status !== "done") {
        diagnostics.push(diagnostic("W008", n.line, `"${n.id}" is ${n.status} but "${d.target.id}" is not done`));
      }
    }
    if (n.status === "done" && hasOpenDescendant(n)) {
      diagnostics.push(diagnostic("W007", n.line, "Node is done but its subtree still has open work"));
    }
    if (n.status === "todo" && n.children.some((c) => c.status === "doing" || c.status === "done")) {
      diagnostics.push(diagnostic("I003", n.line, "Children have started; consider marking this node doing"));
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
