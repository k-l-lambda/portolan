// `rhumb fmt`, 0.1 subset: assign missing IDs and normalize status aliases.
//
// Not yet implemented from spec section 7: re-indentation to 2 spaces, `-` markers,
// attribute normalization, edge `^` stripping and dedup, blank-line collapsing.
// Those need a full CST printer; this pass only rewrites node lines in place.

import { generateId } from "./edit.ts";
import { parse } from "./parse.ts";
import type { RhumbNode } from "./types.ts";

export interface FormatResult {
  source: string;
  /** IDs generated for nodes that had none, with their 1-based lines. */
  assigned: { line: number; id: string }[];
}

export function format(source: string): FormatResult {
  const doc = parse(source);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.replace(/\r\n?/g, "\n").split("\n");

  const taken = new Set<string>();
  const all: RhumbNode[] = [];
  const walk = (nodes: RhumbNode[]) => nodes.forEach((n) => (all.push(n), walk(n.children)));
  walk(doc.nodes);
  for (const n of all) if (n.id) taken.add(n.id);

  // Lines whose trailing token is an invalid ID (W009): appending another ID would
  // silently turn that token into title text, so leave them for the user.
  const skip = new Set(doc.diagnostics.filter((d) => d.code === "W009" || d.code === "E011").map((d) => d.line));

  const assigned: FormatResult["assigned"] = [];
  for (const node of all) {
    const i = node.line - 1;
    lines[i] = lines[i]!.replace(/^(\s*[-*]\s+\[)([X~])(\])/, (_m, a, s, b) => a + (s === "X" ? "x" : "/") + b);
    if (node.id === null && !skip.has(node.line)) {
      const id = generateId(taken);
      taken.add(id);
      lines[i] = `${lines[i]!.trimEnd()} ^${id}`;
      assigned.push({ line: node.line, id });
    }
  }
  return { source: lines.join(eol), assigned };
}
