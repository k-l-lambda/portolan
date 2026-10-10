import type { EditOp } from "../../src/edit.ts";
import type { Commit, NodeTime } from "../../src/history.ts";
import type { NodeState } from "../../src/derive.ts";
import type { Resolved } from "../../src/resolve.ts";
import type { Anchor, RhumbDocument } from "../../src/types.ts";

export interface FileSummary {
  file: string;
  title: string | null;
  nodes: number;
  progress: { done: number; total: number };
  errors: number;
  warnings: number;
  starred: { id: string; title: string; status: string | null }[];
}

export interface Freshness {
  repo: string | null;
  head: string | null;
  tracked: boolean;
  mtime: number;
  dirtyLines: number;
  lastCommit: Commit | null;
  nodes: NodeTime[];
  commits: Record<string, Commit>;
}

export interface DocResponse {
  file: string;
  version: string;
  doc: RhumbDocument;
  derived: NodeState[];
  freshness: Freshness;
}

export interface AnchorResponse extends Resolved {
  anchor: Anchor;
  excerpt: string | null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * A static export (`pnpm build:pages`, the GitHub Pages demo) has no server: the page carries
 * `<meta name="portolan-static" content="<default file>">` and reads JSON files written at
 * build time from `api/`, relative to the page. Edits and live updates are off there.
 */
const STATIC = typeof document === "undefined" ? null
  : document.querySelector<HTMLMetaElement>('meta[name="portolan-static"]')?.content ?? null;
/** True on a static export: the map can be read but not changed. */
export const READ_ONLY = STATIC !== null;
/** The map a static export opens by default; none (the index) when it holds several. */
export const DEFAULT_FILE = STATIC || null;

/** Static file for an API call; mirrors what scripts/build-pages.ts writes. */
export function staticPath(kind: "files" | "doc" | "anchor" | "source", file?: string, line?: number, index?: number): string {
  if (kind === "files") return "api/files.json";
  // Each path segment is encoded on its own, so `sub/a.rhumb` maps to real folders on the host.
  const f = file!.split("/").map(encodeURIComponent).join("/");
  // Source is saved as .txt, so a static host serves it as text instead of a download.
  if (kind === "source") return `api/source/${f}.txt`;
  return kind === "doc" ? `api/doc/${f}.json` : `api/anchor/${f}/${line}-${index}.json`;
}

/** URL of a map's raw .rhumb text, to open in a new tab. */
export const sourceUrl = (file: string) => (STATIC !== null ? staticPath("source", file) : `/api/source?${q(file)}`);

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

const q = (file: string) => `file=${encodeURIComponent(file)}`;

export const api = {
  files: () => call<{ root: string; files: FileSummary[] }>(STATIC !== null ? staticPath("files") : "/api/files"),
  doc: (file: string) => call<DocResponse>(STATIC !== null ? staticPath("doc", file) : `/api/doc?${q(file)}`),
  edit: (file: string, version: string, edit: EditOp) =>
    STATIC !== null ? Promise.reject(new ApiError(405, "This is a read-only demo")) :
    call<{ version: string; id?: string }>(`/api/edit?${q(file)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, edit }),
    }),
  anchor: (file: string, line: number, index: number) =>
    call<AnchorResponse>(STATIC !== null ? staticPath("anchor", file, line, index) : `/api/anchor?${q(file)}&node=${line}&index=${index}`),
};

/**
 * Subscribes to server file events; returns an unsubscribe function. EventSource reconnects
 * by itself after a server restart; `reconnect` fires then so callers can refetch whatever
 * changed while the connection was down.
 */
export function onServerEvents(handlers: {
  change?: (data: { file: string; version: string }) => void;
  files?: () => void;
  /** A repository HEAD moved: blame times may have changed without a content change. */
  history?: () => void;
  reconnect?: () => void;
}): () => void {
  if (STATIC !== null) return () => {}; // a static export never changes
  const source = new EventSource("/api/events");
  let connected = false;
  source.addEventListener("hello", () => {
    if (connected) handlers.reconnect?.();
    connected = true;
  });
  if (handlers.change) source.addEventListener("change", (e) => handlers.change!(JSON.parse((e as MessageEvent).data)));
  if (handlers.files) source.addEventListener("files", () => handlers.files!());
  if (handlers.history) source.addEventListener("history", () => handlers.history!());
  return () => source.close();
}
