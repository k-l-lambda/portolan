import type { EditOp } from "../../src/edit.ts";
import type { Commit, NodeTime } from "../../src/history.ts";
import type { NodeState } from "../../src/derive.ts";
import type { Resolved } from "../../src/resolve.ts";
import type { Timeline } from "../../src/timeline.ts";
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
  /** `links`: the map dates items by links only and git was not read (front matter `dates`). */
  dates?: "git" | "links";
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
  /** Missing from static exports built before the history rail existed. */
  timeline?: Timeline;
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
/** True when older history points can be asked for (a server, not a static export). */
export const MORE_HISTORY = STATIC === null;
/** The map a static export opens by default; none (the index) when it holds several. */
export const DEFAULT_FILE = STATIC || null;

/** Static file for an API call; mirrors what scripts/build-pages.ts writes. */
export function staticPath(kind: "files" | "doc" | "anchor" | "source" | "diff", file?: string, line?: number | string, index?: number): string {
  if (kind === "files") return "api/files.json";
  // Each path segment is encoded on its own, so `sub/a.rhumb` maps to real folders on the host.
  const f = file!.split("/").map(encodeURIComponent).join("/");
  // Source is saved as .txt, so a static host serves it as text instead of a download.
  if (kind === "source") return `api/source/${f}.txt`;
  // `line` is the history point here: a commit sha or "local".
  if (kind === "diff") return `api/diff/${f}/${line}.txt`;
  return kind === "doc" ? `api/doc/${f}.json` : `api/anchor/${f}/${line}-${index}.json`;
}

/** URL of a map's raw .rhumb text, to open in a new tab. */
export const sourceUrl = (file: string) => (STATIC !== null ? staticPath("source", file) : `/api/source?${q(file)}`);

async function text(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.text();
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

const q = (file: string) => `file=${encodeURIComponent(file)}`;

export const api = {
  files: () => call<{ root: string; files: FileSummary[] }>(STATIC !== null ? staticPath("files") : "/api/files"),
  /** `points`: how many history points to send, when more than the first page were loaded. */
  doc: (file: string, points?: number) =>
    call<DocResponse>(STATIC !== null ? staticPath("doc", file) : `/api/doc?${q(file)}${points ? `&points=${points}` : ""}`),
  edit: (file: string, version: string, edit: EditOp) =>
    STATIC !== null ? Promise.reject(new ApiError(405, "This is a read-only demo")) :
    call<{ version: string; id?: string }>(`/api/edit?${q(file)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, edit }),
    }),
  /**
   * The history rail alone, at most `points` points, for loading older ones. A static export
   * holds only the points it was built with, so there it never resolves to more.
   */
  timeline: (file: string, points: number) =>
    STATIC !== null ? Promise.reject(new ApiError(405, "This is a read-only demo")) :
    call<{ version: string; timeline: Timeline }>(`/api/timeline?${q(file)}&points=${points}`),
  /**
   * What a history point changed, as a unified diff; `point` is a commit sha or "local". `points`
   * is how long the rail showing it is, so an older point loaded later is found too.
   */
  diff: (file: string, point: string, points?: number) =>
    text(STATIC !== null ? staticPath("diff", file, point)
      : `/api/diff?${q(file)}&point=${encodeURIComponent(point)}${points ? `&points=${points}` : ""}`),
  anchor: (file: string, line: number, index: number) =>
    call<AnchorResponse>(STATIC !== null ? staticPath("anchor", file, line, index) : `/api/anchor?${q(file)}&node=${line}&index=${index}`),
};

/** The live connection to the server: up, being tested, or lost. */
export type ConnectionStatus = "online" | "checking" | "offline";
export interface ConnectionState {
  status: ConnectionStatus;
  /** When the status last changed, in ms since the epoch. */
  since: number;
  /** Set after a test the user asked for, with when it finished and whether the server answered. */
  test?: { at: number; ok: boolean };
}

interface Handlers {
  change?: (data: { file: string; version: string }) => void;
  files?: () => void;
  /** A repository HEAD moved: blame times may have changed without a content change. */
  history?: () => void;
  reconnect?: () => void;
}

/** How long a test waits for the server's greeting before calling the connection lost. */
const TEST_TIMEOUT = 5_000;
/** How soon a stream the browser has given up on is opened again. */
const REOPEN_AFTER = 5_000;

/**
 * One event stream for the whole page, shared by every view and by the status icon. The server
 * greets each new stream with `hello`; that is what "online" means. EventSource retries by itself
 * when a running server drops it, and is reopened here when the browser gives up (a proxy error,
 * say), so the page comes back on its own when the server does.
 */
const live = (() => {
  const subs = new Set<Handlers>();
  const watchers = new Set<(s: ConnectionState) => void>();
  let state: ConnectionState = { status: "checking", since: Date.now() };
  let source: EventSource | null = null;
  let greeted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let testing = false;

  const set = (next: Partial<ConnectionState>) => {
    const status = next.status ?? state.status;
    state = { ...state, ...next, since: status !== state.status ? Date.now() : state.since };
    watchers.forEach((w) => w(state));
  };
  const open = () => {
    source?.close();
    clearTimeout(timer);
    const es = new EventSource("/api/events");
    source = es;
    es.addEventListener("hello", () => {
      if (source !== es) return;
      clearTimeout(timer);
      // A greeting after an earlier one is a reconnection: the views refetch what they show.
      if (greeted) subs.forEach((h) => h.reconnect?.());
      greeted = true;
      set({ status: "online", ...(testing ? { test: { at: Date.now(), ok: true } } : {}) });
      testing = false;
    });
    es.addEventListener("error", () => {
      if (source !== es) return;
      // A test ends on the first failure; ordinary retries carry on behind it.
      set({ status: "offline", ...(testing ? { test: { at: Date.now(), ok: false } } : {}) });
      testing = false;
      if (es.readyState === EventSource.CLOSED) {
        clearTimeout(timer);
        timer = setTimeout(() => source === es && open(), REOPEN_AFTER);
      }
    });
    es.addEventListener("change", (e) => subs.forEach((h) => h.change?.(JSON.parse((e as MessageEvent).data))));
    es.addEventListener("files", () => subs.forEach((h) => h.files?.()));
    es.addEventListener("history", () => subs.forEach((h) => h.history?.()));
  };
  const ensure = () => { if (!source) open(); };

  return {
    subscribe(h: Handlers) {
      subs.add(h);
      ensure();
      return () => { subs.delete(h); };
    },
    watch(w: (s: ConnectionState) => void) {
      watchers.add(w);
      ensure();
      w(state);
      return () => { watchers.delete(w); };
    },
    /** Drop the stream and open a fresh one: the server answers within the timeout, or it is down. */
    test() {
      testing = true;
      set({ status: "checking" });
      open();
      const es = source;
      timer = setTimeout(() => {
        if (source !== es || !testing) return;
        testing = false;
        set({ status: "offline", test: { at: Date.now(), ok: false } });
      }, TEST_TIMEOUT);
    },
  };
})();

/**
 * Subscribes to server file events; returns an unsubscribe function. `reconnect` fires when the
 * stream comes back after a drop, so callers can refetch whatever they show.
 */
export function onServerEvents(handlers: Handlers): () => void {
  if (STATIC !== null) return () => {}; // a static export never changes
  return live.subscribe(handlers);
}

/** Follows the connection's status; returns an unsubscribe function. Null on a static export. */
export function watchConnection(watcher: (s: ConnectionState) => void): (() => void) | null {
  if (STATIC !== null) return null;
  return live.watch(watcher);
}

/** Tests the connection now: a fresh stream, which the server must greet within a few seconds. */
export function testConnection(): void {
  if (STATIC === null) live.test();
}
