import { basename, extname } from "node:path";
import { isMap, isScalar, parseDocument } from "yaml";
import { parse as parseLine } from "./generated/line-parser.js";
import type { Anchor, Diagnostic, Edge, EdgeKind, Level, RhumbDocument, RhumbNode, Status } from "./types.js";

export const RHUMB_VERSION = "0.1";

const STATUS: Record<string, Status> = {
  " ": "todo", "/": "doing", "~": "doing", x: "done", X: "done",
  "-": "dropped", "!": "blocked", "?": "idea",
};
const EDGE_KINDS = new Set<EdgeKind>(["needs", "blocks", "relates", "replaces", "from"]);
const FRONT_MATTER_KEYS = new Set(["rhumb", "title", "links"]);
const ATTR_KEYS = new Set(["owner", "due", "tags", "priority"]);
const URL_SCHEMES = new Set(["http", "https", "mailto"]);
const HAND_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const GEN_ID = /^_[a-z2-7]{6}$/;

const LEVELS: Record<string, Level> = { E: "error", W: "warning", I: "info" };

export interface ParseOptions {
  /** Used as the default title when front matter has none. */
  fileName?: string;
}

/** Raw edge statement, resolved after all nodes are known. */
interface EdgeStmt {
  from: { file: string | null; id: string };
  kind: string;
  to: { file: string | null; id: string }[];
  label: string | null;
  line: number;
}

/** Stack entry for indentation-based nesting. `owner` is the node a note belongs to. */
type Entry =
  | { type: "node"; indent: number; node: RhumbNode }
  | { type: "note"; indent: number; owner: RhumbNode | null; depth: number };

export function parse(source: string, options: ParseOptions = {}): RhumbDocument {
  const diagnostics: Diagnostic[] = [];
  const report = (code: string, line: number, message: string) =>
    diagnostics.push({ code, level: LEVELS[code[0]!]!, line, message });

  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const doc: RhumbDocument = {
    rhumb: RHUMB_VERSION,
    title: options.fileName ? basename(options.fileName, extname(options.fileName)) : null,
    links: {},
    nodes: [],
    edges: [],
    diagnostics,
  };

  const bodyStart = readFrontMatter(lines, doc, report);
  if (bodyStart < 0) return finish(doc);

  const parents = new Map<RhumbNode, RhumbNode | null>();
  const stmts: EdgeStmt[] = [];
  const stack: Entry[] = [];

  for (let i = bodyStart; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i]!;
    const { indent, rest } = splitIndent(raw);

    let parsed: any;
    try {
      parsed = parseLine(rest, { startRule: "Line" });
    } catch {
      report("E001", lineNo, "Unrecognized line");
      continue;
    }
    if (parsed.type === "blank" || parsed.type === "comment") continue;

    if (parsed.type === "edge") {
      if (indent > 0) {
        report("E001", lineNo, "Edge statements must start at column 0");
        continue;
      }
      stmts.push({ from: parsed.from, kind: parsed.kind, to: parsed.to, label: parsed.label, line: lineNo });
      continue;
    }

    // List item: find its parent by indentation.
    let popped = false;
    while (stack.length > 0 && stack[stack.length - 1]!.indent > indent) {
      stack.pop();
      popped = true;
    }
    const top = stack[stack.length - 1];
    if (top && top.indent === indent) stack.pop();
    else if (top && popped) report("E004", lineNo, "Dedent does not match any open indentation level");
    const parent = stack[stack.length - 1] ?? null;

    if (parsed.type === "note") {
      let owner: RhumbNode | null;
      let depth = 0;
      if (parent === null) {
        owner = null;
        report("W001", lineNo, "Top-level note has no owning node and is ignored");
      } else if (parent.type === "node") {
        owner = parent.node;
      } else {
        owner = parent.owner;
        depth = parent.depth + 1;
      }
      if (owner) {
        owner.notes.push({ text: parsed.text, line: lineNo, depth });
        owner.anchors.push(...extractAnchors(parsed.text, lineNo, doc.links, report));
      }
      stack.push({ type: "note", indent, owner, depth });
      continue;
    }

    // Node.
    const status = STATUS[parsed.status] ?? null;
    if (status === null) report("E002", lineNo, `Unknown status [${parsed.status}]`);
    const { title, attrs, id, generated, badId } = splitBody(parsed.body);
    if (badId) report("W009", lineNo, "Trailing ^token is not a valid ID and is kept in the title");
    if (title === "") report("E011", lineNo, "Node has an empty title");
    for (const key of Object.keys(attrs)) {
      if (!ATTR_KEYS.has(key)) report("I002", lineNo, `Unknown attribute key "${key}"`);
    }
    const node: RhumbNode = {
      id, generated_id: generated, status, title, attrs,
      notes: [], anchors: extractAnchors(title, lineNo, doc.links, report),
      children: [], line: lineNo,
    };

    let parentNode: RhumbNode | null = null;
    if (parent?.type === "node") parentNode = parent.node;
    else if (parent?.type === "note") {
      parentNode = parent.owner;
      report("W002", lineNo, "Node nested under a note is attached to the note's owner");
    }
    (parentNode ? parentNode.children : doc.nodes).push(node);
    parents.set(node, parentNode);
    stack.push({ type: "node", indent, node });
  }

  resolveEdges(doc, stmts, parents, report);
  return finish(doc);
}

function finish(doc: RhumbDocument): RhumbDocument {
  doc.diagnostics.sort((a, b) => a.line - b.line);
  return doc;
}

/** Returns the body's first line index, or -1 when the front matter is unusable. */
function readFrontMatter(
  lines: string[],
  doc: RhumbDocument,
  report: (code: string, line: number, message: string) => void,
): number {
  if (lines[0]?.trimEnd() !== "---") return 0;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  if (end < 0) {
    report("E012", 1, "Front matter is not terminated by ---");
    return -1;
  }

  const text = lines.slice(1, end).join("\n");
  const yaml = parseDocument(text);
  if (yaml.errors.length > 0) {
    report("E012", 1, `Front matter is not valid YAML: ${yaml.errors[0]!.message}`);
    return end + 1;
  }
  if (yaml.contents === null) return end + 1;
  if (!isMap(yaml.contents)) {
    report("E012", 1, "Front matter must be a YAML mapping");
    return end + 1;
  }

  // Line of a YAML node, offset by the opening --- line.
  const lineOf = (offset: number) => text.slice(0, offset).split("\n").length + 1;

  for (const pair of yaml.contents.items) {
    if (!isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const keyLine = lineOf(pair.key.range?.[0] ?? 0);
    const value = pair.value;

    if (key === "rhumb") {
      // Use the source text so that `0.10` or `9.0` are read as written, not as numbers.
      const version = isScalar(value) && value.range ? text.slice(value.range[0], value.range[1]).trim() : "";
      doc.rhumb = version;
      if (!isSupportedVersion(version)) report("E013", keyLine, `Unsupported rhumb version "${version}"`);
    } else if (key === "title") {
      if (isScalar(value) && value.value !== null) doc.title = String(value.value);
    } else if (key === "links") {
      const links = (value as any)?.toJSON?.();
      if (!links || typeof links !== "object" || Array.isArray(links)
        || !Object.values(links).every((v) => typeof v === "string")) {
        report("E012", keyLine, "links must map prefixes to string templates");
      } else {
        doc.links = links;
      }
    } else if (!FRONT_MATTER_KEYS.has(key)) {
      report("I001", keyLine, `Unknown front matter key "${key}"`);
    }
  }
  return end + 1;
}

function isSupportedVersion(version: string): boolean {
  const m = /^(\d+)\.(\d+)$/.exec(version);
  if (!m) return false;
  const [major, minor] = RHUMB_VERSION.split(".").map(Number) as [number, number];
  return Number(m[1]) === major && Number(m[2]) <= minor;
}

/** Leading whitespace width with tabs advancing to the next multiple of 4 (CommonMark). */
function splitIndent(line: string): { indent: number; rest: string } {
  let col = 0;
  let i = 0;
  for (; i < line.length; i++) {
    if (line[i] === " ") col++;
    else if (line[i] === "\t") col += 4 - (col % 4);
    else break;
  }
  return { indent: col, rest: line.slice(i).trimEnd() };
}

/** Strips trailing `^id` then `{attrs}` from a node body; the rest is the title. */
function splitBody(body: string): {
  title: string; attrs: Record<string, unknown>; id: string | null; generated: boolean; badId: boolean;
} {
  let rest = body.trimEnd();
  let id: string | null = null;
  let badId = false;

  const idMatch = /(^|\s)\^(\S+)$/.exec(rest);
  if (idMatch && !rest.endsWith("\\^" + idMatch[2])) {
    const token = idMatch[2]!;
    if (HAND_ID.test(token) || GEN_ID.test(token)) {
      id = token;
      rest = rest.slice(0, rest.length - token.length - 1).trimEnd();
    } else {
      badId = true;
    }
  }

  let attrs: Record<string, unknown> = {};
  if (rest.endsWith("}")) {
    const open = matchingBrace(rest);
    if (open !== null && (open === 0 || /\s/.test(rest[open - 1]!))) {
      const parsed = tryAttrs(rest.slice(open));
      if (parsed) {
        attrs = parsed;
        rest = rest.slice(0, open).trimEnd();
      }
    }
  }

  const title = rest.replace(/\\([\^{])/g, "$1");
  return { title, attrs, id, generated: id !== null && GEN_ID.test(id), badId };
}

/** Index of the unescaped `{` balancing the final `}`, or null. */
function matchingBrace(text: string): number | null {
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (i > 0 && text[i - 1] === "\\") continue;
    if (ch === "}") depth++;
    else if (ch === "{" && --depth === 0) return i;
  }
  return null;
}

/** A YAML flow mapping whose every key has a value; `{}` is allowed. */
function tryAttrs(text: string): Record<string, unknown> | null {
  const yaml = parseDocument(text);
  if (yaml.errors.length > 0 || !isMap(yaml.contents)) return null;
  const value = yaml.toJSON() as Record<string, unknown>;
  if (Object.values(value).some((v) => v === null)) return null;
  return value;
}

function extractAnchors(
  text: string,
  line: number,
  links: Record<string, string>,
  report: (code: string, line: number, message: string) => void,
): Anchor[] {
  const found = parseLine(text, { startRule: "Inline" }) as { text: string; target: string }[];
  return found.map(({ text: label, target }) => {
    const anchor = classifyTarget(label, target, line);
    if (anchor.kind === "prefix" && !(anchor.prefix! in links)) {
      report("E005", line, `Link prefix "${anchor.prefix}" is not defined in front matter links`);
    }
    return anchor;
  });
}

function classifyTarget(text: string, target: string, line: number): Anchor {
  const hash = target.indexOf("#");
  const base = hash < 0 ? target : target.slice(0, hash);
  let fragment: string | null = hash < 0 ? null : target.slice(hash + 1);
  let textFragment: string | null = null;
  if (fragment !== null) {
    const tf = fragment.indexOf(":~:text=");
    if (tf >= 0) {
      textFragment = safeDecode(fragment.slice(tf + ":~:text=".length));
      fragment = fragment.slice(0, tf);
    }
  }

  const anchor: Anchor = {
    text, target, line, kind: "relative", prefix: null, path: base,
    fragment: fragment || null, text_fragment: textFragment,
  };
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(base);
  if (scheme) {
    const name = scheme[1]!;
    if (URL_SCHEMES.has(name.toLowerCase())) {
      Object.assign(anchor, { kind: "url", path: null, fragment: null, text_fragment: null });
    } else {
      Object.assign(anchor, { kind: "prefix", prefix: name, path: base.slice(name.length + 1) });
    }
  }
  return anchor;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function resolveEdges(
  doc: RhumbDocument,
  stmts: EdgeStmt[],
  parents: Map<RhumbNode, RhumbNode | null>,
  report: (code: string, line: number, message: string) => void,
): void {
  // First occurrence wins for duplicate IDs.
  const byId = new Map<string, RhumbNode>();
  for (const node of parents.keys()) {
    if (node.id === null) continue;
    if (byId.has(node.id)) report("E003", node.line, `Duplicate ID "${node.id}"`);
    else byId.set(node.id, node);
  }

  const isAncestor = (a: RhumbNode, b: RhumbNode) => {
    for (let p = parents.get(b) ?? null; p; p = parents.get(p) ?? null) if (p === a) return true;
    return false;
  };

  // Dependency graph: x -> y means x needs y.
  const deps = new Map<string, Set<string>>();
  const reaches = (from: string, to: string) => {
    const seen = new Set<string>();
    const todo = [from];
    while (todo.length > 0) {
      const cur = todo.pop()!;
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of deps.get(cur) ?? []) todo.push(next);
    }
    return false;
  };

  const seen = new Set<string>();
  for (const stmt of stmts) {
    if (!EDGE_KINDS.has(stmt.kind as EdgeKind)) {
      // Prose that happens to look like `word word word` is not an edge attempt.
      if (byId.has(stmt.from.id)) report("E008", stmt.line, `Unknown edge kind "${stmt.kind}"`);
      else report("E001", stmt.line, "Unrecognized line");
      continue;
    }
    const kind = stmt.kind as EdgeKind;

    for (const to of stmt.to) {
      if (stmt.from.file !== null || to.file !== null) {
        report("E006", stmt.line, "Cross-file references are not supported in 0.1");
        continue;
      }
      const a = byId.get(stmt.from.id);
      const b = byId.get(to.id);
      if (!a || !b) {
        report("E007", stmt.line, `Unknown ID "${!a ? stmt.from.id : to.id}"`);
        continue;
      }
      if (a === b) {
        report("E010", stmt.line, `Edge from "${a.id}" to itself`);
        continue;
      }
      const key = kind === "relates"
        ? `relates ${[a.id, b.id].sort().join(" ")}`
        : `${kind} ${a.id} ${b.id}`;
      if (seen.has(key)) {
        report("W004", stmt.line, "Duplicate edge");
        continue;
      }
      seen.add(key);

      if (kind === "needs" || kind === "blocks") {
        if (isAncestor(a, b) || isAncestor(b, a)) {
          report("W005", stmt.line, "Dependency between a node and its descendant");
        }
        const [x, y] = kind === "needs" ? [a.id!, b.id!] : [b.id!, a.id!];
        if (reaches(y, x)) report("E009", stmt.line, "Dependency cycle");
        if (!deps.has(x)) deps.set(x, new Set());
        deps.get(x)!.add(y);
      }
      doc.edges.push({ kind, from: a.id!, to: b.id!, label: stmt.label, line: stmt.line });
    }
  }
}
