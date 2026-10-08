// Local HTTP server for the frontend: serves the AST, derived values, anchor excerpts and
// threads, applies edits, and pushes file changes over Server-Sent Events.
//
// Security: there is no authentication. The server binds to 127.0.0.1 by default and
// rejects requests whose Host header is not a loopback name (DNS-rebinding guard). Do not
// bind it to other interfaces until authentication exists.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, dirname, resolve } from "node:path";
import { derive } from "./derive.ts";
import { applyEdit, EditError, type EditOp } from "./edit.ts";
import { parse } from "./parse.ts";
import { checkAnchors, contextFor, excerpt, resolveAnchor } from "./resolve.ts";
import { ThreadStore, type ThreadAction } from "./threads.ts";
import type { RhumbNode } from "./types.ts";

export interface ServerOptions {
  file: string;
  port?: number;
  host?: string;
}

class HttpError extends Error {}

const MAX_BODY = 1 << 20;
const MAX_LINKED_FILE = 2 << 20;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

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

export function createRhumbServer(options: ServerOptions): Server {
  const file = resolve(options.file);
  const threads = new ThreadStore(file);
  const clients = new Set<ServerResponse>();

  const load = () => {
    const source = readFileSync(file, "utf8");
    return { source, version: versionOf(source), doc: parse(source, { fileName: file }) };
  };

  const broadcast = (event: string, data: unknown) => {
    for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Watch the directory: editors and agents often replace the file instead of writing in place.
  let lastVersion = versionOf(readFileSync(file, "utf8"));
  let timer: NodeJS.Timeout | null = null;
  const watcher = watch(dirname(file), (_type, name) => {
    if (name !== basename(file) && name !== basename(threads.path)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (name === basename(threads.path)) return broadcast("threads", {});
      if (!existsSync(file)) return;
      const version = versionOf(readFileSync(file, "utf8"));
      if (version !== lastVersion) {
        lastVersion = version;
        broadcast("change", { version });
      }
    }, 50);
  });

  const server = createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? "").replace(/:\d+$/, "");
      if (!LOOPBACK_HOSTS.has(host)) return send(res, 403, { error: "Host not allowed" });
      const url = new URL(req.url ?? "/", "http://localhost");
      await route(req, res, url);
    } catch (err) {
      if (!res.headersSent) send(res, err instanceof HttpError ? 400 : 500, { error: String((err as Error).message ?? err) });
    }
  });

  async function route(req: IncomingMessage, res: ServerResponse, url: URL) {
    const key = `${req.method} ${url.pathname}`;

    if (key === "GET /") {
      return send(res, 200, {
        name: "rhumb", file,
        endpoints: ["GET /api/doc", "POST /api/edit", "GET /api/anchor", "GET /api/threads", "POST /api/threads", "GET /api/events"],
      });
    }

    if (key === "GET /api/doc") {
      const { version, doc } = load();
      const derived = derive(doc);
      const anchors = checkAnchors(doc, contextFor(file, doc, readLinked));
      const diagnostics = [...doc.diagnostics, ...derived.diagnostics, ...anchors].sort((a, b) => a.line - b.line);
      return send(res, 200, { version, doc: { ...doc, diagnostics }, derived: derived.nodes });
    }

    if (key === "POST /api/edit") {
      // Optimistic concurrency: the client sends the version it edited against.
      const body = await readJson(req);
      const { source, version } = load();
      if (body.version !== version) return send(res, 409, { error: "Document changed", version });
      try {
        const result = applyEdit(source, body.edit as EditOp);
        writeFileSync(file, result.source);
        if (result.renamed) threads.retarget(result.renamed.from, result.renamed.to);
        const { source: _s, ...rest } = result;
        return send(res, 200, { ...rest, version: versionOf(result.source) });
      } catch (err) {
        if (err instanceof EditError) return send(res, 400, { error: err.message });
        throw err;
      }
    }

    if (key === "GET /api/anchor") {
      // ?node=<line>&index=<n>: the n-th anchor of the node on that line.
      const { doc } = load();
      const line = Number(url.searchParams.get("node"));
      const index = Number(url.searchParams.get("index") ?? 0);
      const node = findByLine(doc.nodes, line);
      const anchor = node?.anchors[index];
      if (!anchor) return send(res, 404, { error: "Anchor not found" });
      const r = resolveAnchor(anchor, contextFor(file, doc, readLinked));
      const text = r.file ? readLinked(r.file) : null;
      return send(res, 200, { anchor, ...r, excerpt: text ? excerpt(text, r) : null });
    }

    if (key === "GET /api/threads") {
      const { doc } = load();
      const ids = new Set<string>();
      const walk = (ns: RhumbNode[]) => ns.forEach((n) => (n.id && ids.add(n.id), walk(n.children)));
      walk(doc.nodes);
      const status = url.searchParams.get("status");
      const { threads: list, problems } = threads.load();
      return send(res, 200, {
        threads: list.filter((t) => !status || t.status === status).map((t) => ({ ...t, orphan: !ids.has(t.target) })),
        problems,
      });
    }

    if (key === "POST /api/threads") {
      const body = (await readJson(req)) as ThreadAction;
      try {
        return send(res, 200, { event: threads.apply(body) });
      } catch (err) {
        return send(res, 400, { error: (err as Error).message });
      }
    }

    if (key === "GET /api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ version: lastVersion })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 30_000);
      req.on("close", () => (clearInterval(ping), clients.delete(res)));
      return;
    }

    send(res, 404, { error: "Not found" });
  }

  server.on("close", () => {
    watcher.close();
    if (timer) clearTimeout(timer);
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
    if (size > MAX_BODY) throw new HttpError("Request body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError("Invalid JSON body");
  }
}
