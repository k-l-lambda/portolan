// Local HTTP server for the Portolan frontend. Serves every .rhumb file under a root
// directory (or a single file): AST, derived values, anchor excerpts and threads; applies
// edits; pushes file changes over Server-Sent Events; and serves the built web app.
//
// Security: there is no authentication. The server binds to 127.0.0.1 by default and
// rejects requests whose Host header is not a loopback name (DNS-rebinding guard). Do not
// bind it to other interfaces until authentication exists.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { derive } from "./derive.ts";
import { applyEdit, EditError, type EditOp } from "./edit.ts";
import { HistoryTracker, nodeTimes } from "./history.ts";
import { isStarred, parse } from "./parse.ts";
import { checkAnchors, contextFor, excerpt, resolveAnchor } from "./resolve.ts";
import { ThreadStore, type ThreadAction } from "./threads.ts";
import type { RhumbNode } from "./types.ts";

export interface ServerOptions {
  /** A directory (serves every .rhumb below it) or a single .rhumb file. */
  root: string;
  /** Built web app; defaults to web/dist next to src/. */
  webDir?: string;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY = 1 << 20;
const MAX_LINKED_FILE = 2 << 20;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);
const DEFAULT_WEB_DIR = fileURLToPath(new URL("../web/dist/", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".json": "application/json; charset=utf-8", ".woff2": "font/woff2",
};

export function versionOf(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function readLinked(path: string): string | null {
  try {
    if (!existsSync(path) || statSync(path).size > MAX_LINKED_FILE) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Relative POSIX paths of all .rhumb files under `dir`, sorted. */
function scan(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".rhumb")) out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

export function createRhumbServer(options: ServerOptions): Server {
  const rootPath = resolve(options.root);
  const singleFile = statSync(rootPath).isFile() ? basename(rootPath) : null;
  const rootDir = singleFile ? dirname(rootPath) : rootPath;
  const webDir = resolve(options.webDir ?? DEFAULT_WEB_DIR);
  const clients = new Set<ServerResponse>();
  const versions = new Map<string, string>();
  const history = new HistoryTracker();

  const listFiles = () => (singleFile ? [singleFile] : scan(rootDir));

  /** Maps a client-supplied relative path to an absolute .rhumb path inside the root. */
  const fileFor = (rel: string | null): { rel: string; abs: string } => {
    const name = rel ?? singleFile;
    if (!name) throw new HttpError(400, "Missing file parameter");
    const abs = resolve(rootDir, name);
    if (!abs.startsWith(rootDir + sep) || !abs.endsWith(".rhumb")) throw new HttpError(400, "Invalid file");
    if (singleFile && name !== singleFile) throw new HttpError(404, "File not found");
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new HttpError(404, "File not found");
    return { rel: relative(rootDir, abs).split(sep).join("/"), abs };
  };

  const load = (abs: string) => {
    const source = readFileSync(abs, "utf8");
    return { source, version: versionOf(source), doc: parse(source, { fileName: abs }) };
  };

  const broadcast = (event: string, data: unknown) => {
    for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // ---------- hot reload ----------
  // One non-recursive watcher per directory. Node's recursive watcher on Linux stops
  // reporting a file after it is deleted and recreated (what many editors do on save), so
  // directories are watched individually and a periodic rescan catches anything missed.
  // Events: `change` {file, version} when a file's content changes (including recreation),
  // `files` {} when files appear or disappear, `threads` {file} when a sidecar changes,
  // `history` {repo} when a repository's HEAD moves (commit, checkout, pull).
  const stamps = new Map<string, string>(); // rel → "mtime:size", to skip unchanged files when polling
  const dirWatchers = new Map<string, FSWatcher>();
  const pending = new Map<string, NodeJS.Timeout>();

  const debounce = (key: string, fn: () => void) => {
    clearTimeout(pending.get(key));
    pending.set(key, setTimeout(() => (pending.delete(key), fn()), 50));
  };

  /** Re-reads one file; `force` skips the mtime/size shortcut (mtime can be coarse). */
  const checkFile = (rel: string, force: boolean) => {
    const abs = join(rootDir, rel);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      stat = null;
    }
    if (!stat?.isFile()) {
      stamps.delete(rel);
      if (versions.delete(rel)) broadcast("files", {});
      return;
    }
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    if (!force && stamps.get(rel) === stamp) return;
    stamps.set(rel, stamp);
    const version = versionOf(readFileSync(abs, "utf8"));
    const known = versions.has(rel);
    if (versions.get(rel) === version) return;
    versions.set(rel, version);
    if (!known) broadcast("files", {});
    broadcast("change", { file: rel, version });
  };

  const dirsUnder = (dir: string): string[] => {
    const out = [dir];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) {
        out.push(...dirsUnder(join(dir, entry.name)));
      }
    }
    return out;
  };

  const syncWatchers = () => {
    const dirs = new Set(singleFile ? [rootDir] : dirsUnder(rootDir));
    for (const [dir, w] of dirWatchers) if (!dirs.has(dir)) (w.close(), dirWatchers.delete(dir));
    for (const dir of dirs) {
      if (dirWatchers.has(dir)) continue;
      try {
        const w = watch(dir, (_type, name) => onEvent(dir, name?.toString() ?? null));
        w.on("error", () => (w.close(), dirWatchers.delete(dir)));
        dirWatchers.set(dir, w);
      } catch {
        // Directory vanished between listing and watching; the next rescan handles it.
      }
    }
  };

  const rescan = () => {
    history.pollHeads().then((repos) => repos.forEach((repo) => broadcast("history", { repo })), () => {});
    syncWatchers();
    const now = new Set(listFiles());
    for (const rel of now) checkFile(rel, false);
    for (const rel of [...versions.keys()]) if (!now.has(rel)) checkFile(rel, true);
  };

  const onEvent = (dir: string, name: string | null) => {
    const rel = name ? relative(rootDir, join(dir, name)).split(sep).join("/") : null;
    if (rel && singleFile && rel !== singleFile && rel !== singleFile.replace(/\.rhumb$/, ".threads.jsonl")) return;
    if (rel?.endsWith(".threads.jsonl")) {
      return debounce(rel, () => broadcast("threads", { file: rel.replace(/\.threads\.jsonl$/, ".rhumb") }));
    }
    if (rel?.endsWith(".rhumb")) return debounce(rel, () => checkFile(rel, true));
    // Anything else may be a new or removed directory, or an unnamed event.
    debounce("*rescan", rescan);
  };

  rescan();
  const poll = setInterval(rescan, 2000);
  poll.unref();

  const server = createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? "").replace(/:\d+$/, "");
      if (!LOOPBACK_HOSTS.has(host)) return send(res, 403, { error: "Host not allowed" });
      const url = new URL(req.url ?? "/", "http://localhost");
      await route(req, res, url);
    } catch (err) {
      if (res.headersSent) return;
      const status = err instanceof HttpError ? err.status : 500;
      send(res, status, { error: String((err as Error).message ?? err) });
    }
  });

  async function route(req: IncomingMessage, res: ServerResponse, url: URL) {
    const key = `${req.method} ${url.pathname}`;
    const param = url.searchParams.get("file");

    if (key === "GET /api/files") {
      const files = listFiles().map((rel) => {
        const { doc } = load(join(rootDir, rel));
        const derived = derive(doc);
        const roots = doc.nodes.map((n) => derived.nodes.find((s) => s.line === n.line)!.progress);
        const progress = { done: 0, total: 0 };
        for (const p of roots) if (p) (progress.done += p.done, progress.total += p.total);
        const levels = [...doc.diagnostics, ...derived.diagnostics].map((d) => d.level);
        const starred: { id: string; title: string; status: string | null }[] = [];
        const walk = (ns: RhumbNode[]) => ns.forEach((n) => {
          if (n.id && isStarred(n)) starred.push({ id: n.id, title: n.title, status: n.status });
          walk(n.children);
        });
        walk(doc.nodes);
        return {
          file: rel, title: doc.title, nodes: derived.nodes.length, progress, starred,
          errors: levels.filter((l) => l === "error").length,
          warnings: levels.filter((l) => l === "warning").length,
        };
      });
      return send(res, 200, { root: rootDir, files });
    }

    if (key === "GET /api/doc") {
      const { rel, abs } = fileFor(param);
      const { version, doc } = load(abs);
      const derived = derive(doc);
      const anchors = checkAnchors(doc, contextFor(abs, doc, readLinked));
      const diagnostics = [...doc.diagnostics, ...derived.diagnostics, ...anchors].sort((a, b) => a.line - b.line);
      const h = await history.file(abs, version);
      const freshness = {
        repo: h.repo, head: h.head, tracked: h.tracked, mtime: h.mtime, dirtyLines: h.dirtyLines,
        lastCommit: h.lastCommit, nodes: nodeTimes(doc, h), commits: h.commits,
      };
      return send(res, 200, { file: rel, version, doc: { ...doc, diagnostics }, derived: derived.nodes, freshness });
    }

    if (key === "POST /api/edit") {
      // Optimistic concurrency: the client sends the version it edited against.
      const { abs } = fileFor(param);
      const body = await readJson(req);
      const { source, version } = load(abs);
      if (body.version !== version) return send(res, 409, { error: "Document changed", version });
      try {
        const result = applyEdit(source, body.edit as EditOp);
        writeFileSync(abs, result.source);
        if (result.renamed) new ThreadStore(abs).retarget(result.renamed.from, result.renamed.to);
        const { source: _s, ...rest } = result;
        return send(res, 200, { ...rest, version: versionOf(result.source) });
      } catch (err) {
        if (err instanceof EditError) return send(res, 400, { error: err.message });
        throw err;
      }
    }

    if (key === "GET /api/anchor") {
      // ?node=<line>&index=<n>: the n-th anchor of the node on that line.
      const { abs } = fileFor(param);
      const { doc } = load(abs);
      const node = findByLine(doc.nodes, Number(url.searchParams.get("node")));
      const anchor = node?.anchors[Number(url.searchParams.get("index") ?? 0)];
      if (!anchor) return send(res, 404, { error: "Anchor not found" });
      const r = resolveAnchor(anchor, contextFor(abs, doc, readLinked));
      const text = r.file ? readLinked(r.file) : null;
      return send(res, 200, { anchor, ...r, excerpt: text ? excerpt(text, r) : null });
    }

    if (key === "GET /api/threads") {
      const { abs } = fileFor(param);
      const { doc } = load(abs);
      const ids = new Set<string>();
      const walk = (ns: RhumbNode[]) => ns.forEach((n) => (n.id && ids.add(n.id), walk(n.children)));
      walk(doc.nodes);
      const status = url.searchParams.get("status");
      const { threads, problems } = new ThreadStore(abs).load();
      return send(res, 200, {
        threads: threads.filter((t) => !status || t.status === status).map((t) => ({ ...t, orphan: !ids.has(t.target) })),
        problems,
      });
    }

    if (key === "POST /api/threads") {
      const { abs } = fileFor(param);
      const body = (await readJson(req)) as ThreadAction;
      try {
        return send(res, 200, { event: new ThreadStore(abs).apply(body) });
      } catch (err) {
        return send(res, 400, { error: (err as Error).message });
      }
    }

    if (key === "GET /api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write("event: hello\ndata: {}\n\n");
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 30_000);
      req.on("close", () => (clearInterval(ping), clients.delete(res)));
      return;
    }

    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
    if (req.method === "GET") return serveStatic(res, url.pathname);
    send(res, 404, { error: "Not found" });
  }

  function serveStatic(res: ServerResponse, pathname: string) {
    const index = join(webDir, "index.html");
    if (!existsSync(index)) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Web app is not built. Run `pnpm build:web` in the portolan repo.\n");
    }
    let path = resolve(webDir, "." + decodeURIComponent(pathname));
    // Unknown paths fall back to index.html (client-side routing uses the hash, but be lenient).
    if (!path.startsWith(webDir + sep) || !existsSync(path) || !statSync(path).isFile()) path = index;
    res.writeHead(200, {
      "content-type": MIME[extname(path)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
    });
    res.end(readFileSync(path));
  }

  server.on("close", () => {
    clearInterval(poll);
    for (const w of dirWatchers.values()) w.close();
    for (const t of pending.values()) clearTimeout(t);
    for (const res of clients) res.end();
  });
  return server;
}

function findByLine(nodes: RhumbNode[], line: number): RhumbNode | undefined {
  for (const n of nodes) {
    if (n.line === line) return n;
    const hit = findByLine(n.children, line);
    if (hit) return hit;
  }
  return undefined;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Request body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
