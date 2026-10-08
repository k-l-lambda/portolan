// Annotation threads, stored in an append-only sidecar `<name>.threads.jsonl` next to the
// .rhumb file. One JSON event per line; state is rebuilt by folding events, so resolving
// or retargeting never rewrites old lines and concurrent writers rarely conflict.
//
// Open interfaces (not implemented in 0.1):
// - Delivering new human messages to an agent. The server emits a `threads` SSE event and
//   `GET /api/threads?status=open` lists pending threads; a CLI poller, MCP tool or hook
//   can be built on top of that.
// - Targets other than nodes (edges, anchors) and @mentions.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type ThreadEvent =
  | { type: "open"; thread: string; target: string; author: string; text: string; time: string; id: string }
  | { type: "reply"; thread: string; author: string; text: string; time: string; id: string; reply_to?: string }
  | { type: "resolve"; thread: string; author: string; time: string }
  | { type: "reopen"; thread: string; author: string; time: string }
  /** Written when a node ID is renamed, so threads follow the node. */
  | { type: "retarget"; thread: string; target: string; time: string };

export interface Message {
  id: string;
  author: string;
  text: string;
  time: string;
  reply_to: string | null;
}

export interface Thread {
  id: string;
  /** Node ID the thread is attached to. */
  target: string;
  status: "open" | "resolved";
  messages: Message[];
  updated: string;
}

export interface FoldResult {
  threads: Thread[];
  /** 1-based sidecar lines that could not be applied. */
  problems: { line: number; message: string }[];
}

export function foldThreads(events: { event: unknown; line: number }[]): FoldResult {
  const threads = new Map<string, Thread>();
  const problems: FoldResult["problems"] = [];
  for (const { event, line } of events) {
    const e = event as ThreadEvent;
    const t = threads.get(e?.thread);
    if (e?.type === "open") {
      if (t) { problems.push({ line, message: `Thread ${e.thread} opened twice` }); continue; }
      threads.set(e.thread, {
        id: e.thread, target: e.target, status: "open", updated: e.time,
        messages: [{ id: e.id, author: e.author, text: e.text, time: e.time, reply_to: null }],
      });
      continue;
    }
    if (!t) { problems.push({ line, message: "Event for an unknown thread" }); continue; }
    switch (e.type) {
      case "reply": t.messages.push({ id: e.id, author: e.author, text: e.text, time: e.time, reply_to: e.reply_to ?? null }); break;
      case "resolve": t.status = "resolved"; break;
      case "reopen": t.status = "open"; break;
      case "retarget": t.target = e.target; break;
      default: problems.push({ line, message: "Unknown event type" }); continue;
    }
    t.updated = e.time;
  }
  return { threads: [...threads.values()], problems };
}

/** Input accepted from clients; the store fills in IDs and timestamps. */
export type ThreadAction =
  | { action: "open"; target: string; author: string; text: string }
  | { action: "reply"; thread: string; author: string; text: string; reply_to?: string }
  | { action: "resolve"; thread: string; author: string }
  | { action: "reopen"; thread: string; author: string };

const MAX_TEXT = 20_000;
const MAX_AUTHOR = 100;

export class ThreadStore {
  readonly path: string;

  constructor(rhumbPath: string) {
    this.path = rhumbPath.replace(/\.rhumb$/, "") + ".threads.jsonl";
  }

  load(): FoldResult {
    if (!existsSync(this.path)) return { threads: [], problems: [] };
    const events: { event: unknown; line: number }[] = [];
    const problems: FoldResult["problems"] = [];
    readFileSync(this.path, "utf8").split("\n").forEach((text, i) => {
      if (text.trim() === "") return;
      try {
        events.push({ event: JSON.parse(text), line: i + 1 });
      } catch {
        problems.push({ line: i + 1, message: "Invalid JSON" });
      }
    });
    const folded = foldThreads(events);
    return { threads: folded.threads, problems: [...problems, ...folded.problems] };
  }

  /** Validates a client action, appends the event and returns it. */
  apply(input: ThreadAction): ThreadEvent {
    const a = input as Record<string, unknown>;
    const str = (k: string, max: number) => {
      const v = a[k];
      if (typeof v !== "string" || v.trim() === "" || v.length > max) throw new Error(`Invalid ${k}`);
      return v;
    };
    const time = new Date().toISOString();
    let event: ThreadEvent;
    switch (a.action) {
      case "open":
        event = { type: "open", thread: randomUUID(), target: str("target", 100), author: str("author", MAX_AUTHOR),
          text: str("text", MAX_TEXT), time, id: randomUUID() };
        break;
      case "reply":
        this.requireThread(str("thread", 100));
        event = { type: "reply", thread: a.thread as string, author: str("author", MAX_AUTHOR),
          text: str("text", MAX_TEXT), time, id: randomUUID(),
          ...(typeof a.reply_to === "string" ? { reply_to: a.reply_to } : {}) };
        break;
      case "resolve":
      case "reopen":
        this.requireThread(str("thread", 100));
        event = { type: a.action, thread: a.thread as string, author: str("author", MAX_AUTHOR), time };
        break;
      default:
        throw new Error("Unknown action");
    }
    this.append(event);
    return event;
  }

  /** Makes threads follow a renamed node. */
  retarget(from: string, to: string): void {
    const time = new Date().toISOString();
    for (const t of this.load().threads) {
      if (t.target === from) this.append({ type: "retarget", thread: t.id, target: to, time });
    }
  }

  private requireThread(id: string): void {
    if (!this.load().threads.some((t) => t.id === id)) throw new Error(`Unknown thread ${id}`);
  }

  private append(event: ThreadEvent): void {
    appendFileSync(this.path, JSON.stringify(event) + "\n");
  }
}
