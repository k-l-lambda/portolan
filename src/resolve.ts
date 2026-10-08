// Anchor resolution (spec section 4): link target → file, heading and entry line.
// File access goes through `readFile` so the same code can run against a server or tests.

import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { diagnostic } from "./parse.ts";
import type { Anchor, Diagnostic, RhumbDocument, RhumbNode } from "./types.ts";

export interface ResolveContext {
  /** Directory of the .rhumb file; relative targets resolve against it. */
  baseDir: string;
  links: Record<string, string>;
  /** Returns file text, or null when the file does not exist. */
  readFile: (path: string) => string | null;
}

export interface Resolved {
  /** Absolute URL when the target is (or a link template expands to) a URL. */
  url: string | null;
  file: string | null;
  heading: { text: string; line: number } | null;
  /** 1-based line of the list entry matched by the text fragment. */
  entryLine: number | null;
  /** Diagnostics are reported on the anchor's line in the .rhumb file. */
  diagnostics: Diagnostic[];
}

const MARKDOWN = /\.(md|markdown|rhumb)$/i;

export function resolveAnchor(anchor: Anchor, ctx: ResolveContext): Resolved {
  const out: Resolved = { url: null, file: null, heading: null, entryLine: null, diagnostics: [] };
  const warn = (msg: string) => out.diagnostics.push(diagnostic("W003", anchor.line, msg));

  if (anchor.kind === "url") {
    out.url = anchor.target;
    return out;
  }

  let path = anchor.path ?? "";
  if (anchor.kind === "prefix") {
    const template = ctx.links[anchor.prefix!];
    if (template === undefined) return out; // E005 is reported by the parser.
    path = template.replace("{path}", path);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
      out.url = path + (anchor.fragment ? `#${anchor.fragment}` : "");
      return out;
    }
  }
  path = safeDecode(path);
  out.file = isAbsolute(path) ? path : resolvePath(ctx.baseDir, path);

  const text = ctx.readFile(out.file);
  if (text === null) {
    warn(`File not found: ${out.file}`);
    return out;
  }
  if (!anchor.fragment || !MARKDOWN.test(out.file)) return out;

  const headings = markdownHeadings(text);
  const exact = headings.filter((h) => h.slug === anchor.fragment);
  const matches = exact.length > 0 ? exact : headings.filter((h) => h.slug.startsWith(anchor.fragment!));
  if (matches.length === 0) {
    warn(`Heading #${anchor.fragment} not found in ${out.file}`);
    return out;
  }
  if (matches.length > 1) {
    warn(`Heading prefix #${anchor.fragment} is ambiguous in ${out.file}`);
    return out;
  }
  const h = matches[0]!;
  out.heading = { text: h.text, line: h.line };

  if (anchor.text_fragment) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const end = headings.find((x) => x.line > h.line && x.depth <= h.depth)?.line ?? lines.length + 1;
    out.entryLine = findEntry(lines, h.line, end, anchor.text_fragment);
    if (out.entryLine === null) warn(`Text "${anchor.text_fragment}" not found under #${h.slug}`);
  }
  return out;
}

/** Resolves every anchor in the document and returns only the diagnostics. */
export function checkAnchors(doc: RhumbDocument, ctx: ResolveContext): Diagnostic[] {
  const all: RhumbNode[] = [];
  const walk = (nodes: RhumbNode[]) => nodes.forEach((n) => (all.push(n), walk(n.children)));
  walk(doc.nodes);
  return all.flatMap((n) => n.anchors.flatMap((a) => resolveAnchor(a, ctx).diagnostics));
}

/** The Markdown excerpt an anchor points at: the matched entry, else the heading section. */
export function excerpt(text: string, r: Resolved, maxLines = 200): string | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const start = r.entryLine ?? r.heading?.line;
  if (!start) return null;
  let end = start;
  if (r.entryLine) {
    // An entry ends at the next top-level list item or heading.
    const indent = lines[start - 1]!.search(/\S/);
    while (end < lines.length && !isEntryBoundary(lines[end]!, indent)) end++;
  } else {
    const depth = /^(#+)/.exec(lines[start - 1]!)![1]!.length;
    while (end < lines.length && !(/^(#+)\s/.exec(lines[end]!)?.[1]!.length! <= depth)) end++;
  }
  return lines.slice(start - 1, Math.min(end, start - 1 + maxLines)).join("\n");
}

export function contextFor(rhumbPath: string, doc: RhumbDocument, readFile: ResolveContext["readFile"]): ResolveContext {
  return { baseDir: dirname(rhumbPath), links: doc.links, readFile };
}

// ---------- Markdown helpers ----------

interface Heading { text: string; slug: string; depth: number; line: number }

/** ATX headings outside fenced code, with GitHub-style slugs (duplicates get -1, -2…). */
export function markdownHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;
  text.replace(/\r\n?/g, "\n").split("\n").forEach((line, i) => {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) {
      fence = fence === null ? f[1]! : fence === f[1] ? null : fence;
      return;
    }
    if (fence !== null) return;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) return;
    const base = githubSlug(m[2]!);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ text: m[2]!, slug: n === 0 ? base : `${base}-${n}`, depth: m[1]!.length, line: i + 1 });
  });
  return out;
}

export function githubSlug(heading: string): string {
  return heading
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function findEntry(lines: string[], from: number, to: number, needle: string): number | null {
  let entry: number | null = null;
  for (let i = from; i < to - 1; i++) {
    const line = lines[i]!;
    if (/^[*-]\s/.test(line)) entry = i + 1;
    if (entry !== null && line.includes(needle)) return entry;
  }
  return null;
}

function isEntryBoundary(line: string, indent: number): boolean {
  if (/^#{1,6}\s/.test(line)) return true;
  const m = /^(\s*)[*-]\s/.exec(line);
  return m !== null && m[1]!.length <= indent;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

