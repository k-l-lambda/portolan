import type { EditOp } from "../../src/edit.ts";
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
}

export interface DocResponse {
  file: string;
  version: string;
  doc: RhumbDocument;
  derived: NodeState[];
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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

const q = (file: string) => `file=${encodeURIComponent(file)}`;

export const api = {
  files: () => call<{ root: string; files: FileSummary[] }>("/api/files"),
  doc: (file: string) => call<DocResponse>(`/api/doc?${q(file)}`),
  edit: (file: string, version: string, edit: EditOp) =>
    call<{ version: string; id?: string }>(`/api/edit?${q(file)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, edit }),
    }),
  anchor: (file: string, line: number, index: number) =>
    call<AnchorResponse>(`/api/anchor?${q(file)}&node=${line}&index=${index}`),
};

/**
 * Subscribes to server file events; returns an unsubscribe function. EventSource reconnects
 * by itself after a server restart; `reconnect` fires then so callers can refetch whatever
 * changed while the connection was down.
 */
export function onServerEvents(handlers: {
  change?: (data: { file: string; version: string }) => void;
  files?: () => void;
  reconnect?: () => void;
}): () => void {
  const source = new EventSource("/api/events");
  let connected = false;
  source.addEventListener("hello", () => {
    if (connected) handlers.reconnect?.();
    connected = true;
  });
  if (handlers.change) source.addEventListener("change", (e) => handlers.change!(JSON.parse((e as MessageEvent).data)));
  if (handlers.files) source.addEventListener("files", () => handlers.files!());
  return () => source.close();
}
