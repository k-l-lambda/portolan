// Line-level edit operations shared by the CLI, agents and the UI.
//
// Every operation rewrites only the lines it touches, so comments, blank lines and
// formatting elsewhere survive and a single change stays a small diff. After each
// edit the result is re-parsed; an edit that introduces new errors is rejected.

import { randomBytes } from "node:crypto";
import { parse as parseLine } from "./generated/line-parser.js";
import { EDGE_KINDS, GEN_ID, HAND_ID, parse, splitIndent } from "./parse.ts";
import type { EdgeKind, RhumbDocument, RhumbNode, Status } from "./types.ts";

export type EditOp =
  | { op: "set-status"; id: string; status: Status }
  | { op: "set-title"; id: string; title: string }
  /** Sets one attribute; `null` (and `false` for `star`) removes the key. */
  | { op: "set-attr"; id: string; key: string; value: AttrValue | null }
  | { op: "add-node"; parent: string | null; title: string; status?: Status; id?: string }
  | { op: "remove-node"; id: string; recursive?: boolean }
  | { op: "rename-id"; id: string; to: string }
  | { op: "add-edge"; from: string; kind: EdgeKind; to: string; label?: string }
  | { op: "remove-edge"; from: string; kind: EdgeKind; to: string }
  /** Reserved: moving a subtree needs re-indentation of notes and children. Not implemented in 0.1. */
  | { op: "move-node"; id: string; parent: string | null };

export interface EditResult {
  source: string;
  /** ID of the node an add-node created. */
  id?: string;
  /** Old → new IDs from rename-id, so callers can retarget sidecar data (threads). */
  renamed?: { from: string; to: string };
  /** IDs removed by remove-node (the node and its descendants). */
  removed?: string[];
}

export class EditError extends Error {}

export type AttrValue = string | number | boolean | (string | number | boolean)[];

const ATTR_KEY = /^[a-z][a-z0-9_-]{0,31}$/;

const SYMBOL: Record<Status, string> = {
  todo: " ", doing: "/", done: "x", dropped: "-", blocked: "!", idea: "?",
};

export function applyEdit(source: string, edit: EditOp): EditResult {
  const doc = parse(source);
  if (doc.diagnostics.some((d) => d.code === "E012")) {
    throw new EditError("Front matter is invalid; fix it before editing");
  }
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const trailingNewline = lines[lines.length - 1] === "";
  if (trailingNewline) lines.pop();

  const result = run(doc, lines, edit);

  const out = lines.join(eol) + (trailingNewline || lines.length > 0 ? eol : "");
  const errorsBefore = countErrors(doc);
  const after = parse(out);
  if (countErrors(after) > errorsBefore) {
    const added = after.diagnostics.find((d) => d.level === "error")!;
    throw new EditError(`Edit would introduce ${added.code}: ${added.message}`);
  }
  return { ...result, source: out };
}

function run(doc: RhumbDocument, lines: string[], edit: EditOp): Omit<EditResult, "source"> {
  const index = indexNodes(doc);
  const find = (id: string) => {
    const node = index.byId.get(id);
    if (!node) throw new EditError(`Unknown node "${id}"`);
    return node;
  };

  switch (edit.op) {
    case "set-status": {
      const node = find(edit.id);
      const i = node.line - 1;
      lines[i] = lines[i]!.replace(/^(\s*[-*]\s+\[)[^\]](\])/, `$1${SYMBOL[edit.status]}$2`);
      return {};
    }

    case "set-title": {
      const node = find(edit.id);
      checkTitle(edit.title);
      lines[node.line - 1] = rewriteNode(lines[node.line - 1]!, edit.title, node.attrs, node.id);
      return {};
    }

    case "set-attr": {
      const node = find(edit.id);
      if (!ATTR_KEY.test(edit.key)) throw new EditError(`Invalid attribute key "${edit.key}"`);
      const scalar = (v: unknown) => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
      const v = edit.value;
      if (v !== null && !scalar(v) && !(Array.isArray(v) && v.every(scalar))) {
        throw new EditError("Attribute value must be a string, number, boolean or list of those");
      }
      if (typeof v === "string" && /[\r\n]/.test(v)) throw new EditError("Attribute value must be a single line");
      if (edit.key === "star" && v !== null && typeof v !== "boolean") throw new EditError("star must be true or false");
      // Key order is kept; a new key goes last. Unstarring removes the key instead of writing false.
      const attrs = { ...node.attrs };
      if (v === null || (edit.key === "star" && v === false)) delete attrs[edit.key];
      else attrs[edit.key] = v;
      lines[node.line - 1] = rewriteNode(lines[node.line - 1]!, node.title, attrs, node.id);
      return {};
    }

    case "add-node": {
      checkTitle(edit.title);
      const parent = edit.parent === null ? null : find(edit.parent);
      const id = edit.id ?? uniqueId(slug(edit.title), index.byId);
      if (!HAND_ID.test(id) && !GEN_ID.test(id)) throw new EditError(`Invalid ID "${id}"`);
      if (index.byId.has(id)) throw new EditError(`ID "${id}" already exists`);

      const siblings = parent ? parent.children : doc.nodes;
      const indent = siblings.length > 0
        ? splitIndent(lines[siblings[0]!.line - 1]!).indent
        : parent ? splitIndent(lines[parent.line - 1]!).indent + 2 : 0;
      // Insert after the last line of the parent's subtree (or of the last root).
      const anchor = parent ?? doc.nodes[doc.nodes.length - 1];
      const at = anchor ? lastLine(anchor) : bodyStart(lines);
      lines.splice(at, 0, nodeLine(indent, SYMBOL[edit.status ?? "todo"], edit.title, {}, id));
      return { id };
    }

    case "remove-node": {
      const node = find(edit.id);
      if (node.children.length > 0 && !edit.recursive) {
        throw new EditError(`Node "${edit.id}" has children; pass recursive to remove the subtree`);
      }
      const removed = subtree(node).map((n) => n.id).filter((id): id is string => id !== null);
      const gone = new Set(removed);
      lines.splice(node.line - 1, lastLine(node) - node.line + 1);
      // rewriteEdges re-reads lines, so it is safe after the splice shifted them.
      rewriteEdges(lines, (from, _kind, to) => (gone.has(from) ? [] : to.filter((t) => !gone.has(t))));
      return { removed };
    }

    case "rename-id": {
      const node = find(edit.id);
      if (!HAND_ID.test(edit.to)) throw new EditError(`Invalid ID "${edit.to}"`);
      if (index.byId.has(edit.to)) throw new EditError(`ID "${edit.to}" already exists`);
      const i = node.line - 1;
      lines[i] = lines[i]!.replace(new RegExp(`\\^${escapeRe(edit.id)}\\s*$`), `^${edit.to}`);
      rewriteEdges(lines, (_from, _kind, to) => to.map((t) => (t === edit.id ? edit.to : t)), (from) =>
        from === edit.id ? edit.to : from);
      return { renamed: { from: edit.id, to: edit.to } };
    }

    case "add-edge": {
      find(edit.from);
      find(edit.to);
      if (!EDGE_KINDS.has(edit.kind)) throw new EditError(`Unknown edge kind "${edit.kind}"`);
      const label = edit.label ?? null;
      if (doc.edges.some((e) => e.kind === edit.kind && e.label === label
        && ((e.from === edit.from && e.to === edit.to)
          || (edit.kind === "relates" && !label && e.from === edit.to && e.to === edit.from)))) {
        throw new EditError("Edge already exists");
      }
      const hasEdges = lines.some((l) => isEdgeLine(l));
      if (!hasEdges && lines.length > 0 && lines[lines.length - 1]!.trim() !== "") lines.push("");
      lines.push(edgeLine(edit.from, edit.kind, [edit.to], edit.label ?? null));
      return {};
    }

    case "remove-edge": {
      let hit = false;
      rewriteEdges(lines, (from, kind, to) => {
        if (from !== edit.from || kind !== edit.kind) return to;
        const kept = to.filter((t) => t !== edit.to);
        hit ||= kept.length !== to.length;
        return kept;
      });
      if (!hit) throw new EditError("Edge not found");
      return {};
    }

    case "move-node":
      throw new EditError("move-node is not implemented yet");
  }
}

// ---------- helpers ----------

interface NodeIndex {
  byId: Map<string, RhumbNode>;
}

function indexNodes(doc: RhumbDocument): NodeIndex {
  const byId = new Map<string, RhumbNode>();
  const walk = (nodes: RhumbNode[]) => {
    for (const n of nodes) {
      if (n.id !== null && !byId.has(n.id)) byId.set(n.id, n);
      walk(n.children);
    }
  };
  walk(doc.nodes);
  return { byId };
}

function subtree(node: RhumbNode): RhumbNode[] {
  return [node, ...node.children.flatMap(subtree)];
}

/** Last 1-based line that belongs to the node: itself, its notes and its descendants. */
function lastLine(node: RhumbNode): number {
  let last = node.line;
  for (const n of node.notes) last = Math.max(last, n.line);
  for (const c of node.children) last = Math.max(last, lastLine(c));
  return last;
}

function bodyStart(lines: string[]): number {
  if (lines[0]?.trimEnd() !== "---") return 0;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  return end + 1;
}

function countErrors(doc: RhumbDocument): number {
  return doc.diagnostics.filter((d) => d.level === "error").length;
}

function checkTitle(title: string): void {
  if (title.trim() === "") throw new EditError("Title must not be empty");
  if (/[\r\n]/.test(title)) throw new EditError("Title must be a single line");
}

/** Rebuilds a node line, keeping its indentation, list marker and status symbol as written. */
function rewriteNode(line: string, title: string, attrs: Record<string, unknown>, id: string | null): string {
  const prefix = /^(\s*[-*]\s+\[[^\]]\])/.exec(line)?.[1];
  if (!prefix) throw new EditError("Not a node line");
  let text = `${prefix} ${escapeTitle(title)}`;
  if (Object.keys(attrs).length > 0) text += ` ${formatAttrs(attrs)}`;
  if (id) text += ` ^${id}`;
  return text;
}

function nodeLine(
  indent: number, symbol: string, title: string, attrs: Record<string, unknown>, id: string | null,
): string {
  let text = `${" ".repeat(indent)}- [${symbol}] ${escapeTitle(title)}`;
  if (Object.keys(attrs).length > 0) text += ` ${formatAttrs(attrs)}`;
  if (id) text += ` ^${id}`;
  return text;
}

/** Escape only what the parser would otherwise strip as a trailing `^id` or `{attrs}`. */
function escapeTitle(title: string): string {
  let t = title.trim();
  t = t.replace(/(^|\s)\^(\S+)$/, "$1\\^$2");
  if (t.endsWith("}")) {
    const open = t.lastIndexOf("{");
    if (open >= 0 && (open === 0 || /\s/.test(t[open - 1]!))) t = t.slice(0, open) + "\\" + t.slice(open);
  }
  return t;
}

export function formatAttrs(attrs: Record<string, unknown>): string {
  const value = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(value).join(", ")}]`;
    if (typeof v === "string") {
      // Plain only when YAML would read it back as the same string.
      const plain = /^[\w./@-][\w ./@-]*$/.test(v) && v.trim() === v
        && !/^(true|false|null|~|yes|no|on|off|[-+]?(\d[\d_]*)?\.?\d+([eE][-+]?\d+)?|0x[\da-f]+|0o[0-7]+)$/i.test(v);
      return plain ? v : JSON.stringify(v);
    }
    return JSON.stringify(v);
  };
  return `{${Object.entries(attrs).map(([k, v]) => `${k}: ${value(v)}`).join(", ")}}`;
}

function edgeLine(from: string, kind: string, to: string[], label: string | null): string {
  return `${from} ${kind} ${to.join(", ")}${label ? `: ${label}` : ""}`;
}

function isEdgeLine(line: string): boolean {
  if (/^\s/.test(line)) return false;
  try {
    return parseLine(line.trimEnd(), { startRule: "Line" }).type === "edge";
  } catch {
    return false;
  }
}

/**
 * Rewrites every edge statement. `targets` returns the new target list (empty deletes the
 * line); `source` optionally renames the source ID. Lines that do not change are left as is.
 */
function rewriteEdges(
  lines: string[],
  targets: (from: string, kind: string, to: string[]) => string[],
  source: (from: string) => string = (f) => f,
): void {
  for (let i = lines.length - 1; i >= bodyStart(lines); i--) {
    const line = lines[i]!;
    if (!isEdgeLine(line)) continue;
    const e = parseLine(line.trimEnd(), { startRule: "Line" });
    if (e.from.file !== null || e.to.some((t: any) => t.file !== null)) continue;
    const oldTo: string[] = e.to.map((t: any) => t.id);
    const newTo = targets(e.from.id, e.kind, oldTo);
    const newFrom = source(e.from.id);
    if (newTo.length === 0) {
      lines.splice(i, 1);
    } else if (newFrom !== e.from.id || newTo.join(",") !== oldTo.join(",")) {
      lines[i] = edgeLine(newFrom, e.kind, newTo, e.label);
    }
  }
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

function uniqueId(base: string, taken: Map<string, unknown>): string {
  if (base === "") return generateId(taken);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** `_` + 6 random base32 characters, unique among `taken`. */
export function generateId(taken: { has(id: string): boolean }): string {
  for (;;) {
    const id = "_" + [...randomBytes(6)].map((b) => BASE32[b % 32]).join("");
    if (!taken.has(id)) return id;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
