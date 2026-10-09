export type Status = "todo" | "doing" | "done" | "dropped" | "blocked" | "idea";
export type EdgeKind = "needs" | "blocks" | "relates" | "replaces" | "from";
export type Level = "error" | "warning" | "info";

export interface Diagnostic {
  code: string;
  level: Level;
  line: number;
  message: string;
}

export interface Anchor {
  text: string;
  target: string;
  line: number;
  /** `prefix`: `diary:…` resolved via front matter `links`; `relative`: path from the .rhumb file; `url`: absolute URL. */
  kind: "prefix" | "relative" | "url";
  prefix: string | null;
  path: string | null;
  /** Heading slug (or unique slug prefix) the fragment starts from. */
  fragment: string | null;
  text_fragment: string | null;
  /** `^=prefix`: first line in the section (or file) that starts with this text, ignoring indentation. */
  line_prefix: string | null;
  /** `+L3` / `-L2`: lines below / above the matched line or the heading. */
  line_offset: number | null;
  /** `#L42` or `#L42-L50`: absolute 1-based line range. */
  lines: [number, number] | null;
  /** Why the fragment could not be parsed; the resolver reports it as W003. */
  fragment_error: string | null;
}

export interface Note {
  text: string;
  line: number;
  /** Nesting depth below the owning node; 0 = direct note. */
  depth: number;
}

export interface RhumbNode {
  id: string | null;
  generated_id: boolean;
  /** null only when the checkbox symbol is unknown (E002). */
  status: Status | null;
  title: string;
  attrs: Record<string, unknown>;
  notes: Note[];
  anchors: Anchor[];
  children: RhumbNode[];
  line: number;
}

export interface Edge {
  kind: EdgeKind;
  from: string;
  to: string;
  label: string | null;
  line: number;
}

export interface RhumbDocument {
  rhumb: string;
  title: string | null;
  links: Record<string, string>;
  nodes: RhumbNode[];
  edges: Edge[];
  diagnostics: Diagnostic[];
}
