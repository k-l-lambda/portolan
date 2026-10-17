// The page's live connection to the server (web/src/api.ts): one shared event stream, whose
// status the top bar shows, and a test the user can run on demand. EventSource is faked, so the
// server's greeting, a drop and a refusal can each be played in turn.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "../web/src/api.ts";

class FakeSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeSource[] = [];
  readyState = FakeSource.CONNECTING;
  closed = false;
  private listeners = new Map<string, ((e: { data?: string }) => void)[]>();
  url: string;
  constructor(url: string) { this.url = url; FakeSource.all.push(this); }
  addEventListener(type: string, fn: (e: { data?: string }) => void) {
    (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)!).push(fn);
  }
  close() { this.closed = true; this.readyState = FakeSource.CLOSED; }
  emit(type: string, data?: unknown) {
    if (type === "hello") this.readyState = FakeSource.OPEN;
    for (const fn of this.listeners.get(type) ?? []) fn({ data: data === undefined ? undefined : JSON.stringify(data) });
  }
  /** The server went away: the browser keeps retrying (CONNECTING), or gives up (CLOSED). */
  fail(giveUp = false) {
    this.readyState = giveUp ? FakeSource.CLOSED : FakeSource.CONNECTING;
    this.emit("error");
  }
}
const last = () => FakeSource.all[FakeSource.all.length - 1]!;

async function fresh() {
  vi.resetModules();
  return import("../web/src/api.ts");
}

beforeEach(() => {
  FakeSource.all = [];
  vi.stubGlobal("EventSource", FakeSource);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the live connection", () => {
  it("is one stream for every subscriber, opened when the first one arrives", async () => {
    const api = await fresh();
    expect(FakeSource.all.length).toBe(0);
    const a = vi.fn(), b = vi.fn();
    api.onServerEvents({ change: a });
    api.onServerEvents({ change: b });
    expect(FakeSource.all.length).toBe(1);
    expect(last().url).toBe("/api/events");
    last().emit("change", { file: "x.rhumb", version: "v2" });
    expect(a).toHaveBeenCalledWith({ file: "x.rhumb", version: "v2" });
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("reports checking, then online at the server's greeting, then offline when it drops", async () => {
    const api = await fresh();
    const seen: ConnectionState["status"][] = [];
    api.watchConnection((s) => seen.push(s.status));
    expect(seen).toEqual(["checking"]);
    last().emit("hello");
    expect(seen.at(-1)).toBe("online");
    last().fail();
    expect(seen.at(-1)).toBe("offline");
  });

  it("refetches on a greeting after a drop, not on the first one", async () => {
    const api = await fresh();
    const reconnect = vi.fn();
    api.onServerEvents({ reconnect });
    last().emit("hello");
    expect(reconnect).not.toHaveBeenCalled();
    last().fail();
    last().emit("hello"); // the browser's own retry got through
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps the time the status changed, not the time of each retry", async () => {
    const api = await fresh();
    let state: ConnectionState | null = null;
    api.watchConnection((s) => (state = s));
    last().emit("hello");
    last().fail();
    const since = state!.since;
    vi.advanceTimersByTime(3_000);
    last().fail();
    expect(state!.since).toBe(since);
  });

  it("opens the stream again when the browser gives up on it", async () => {
    const api = await fresh();
    api.watchConnection(() => {});
    const first = last();
    first.fail(true);
    expect(FakeSource.all.length).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(FakeSource.all.length).toBe(2);
    expect(first.closed).toBe(true);
  });
});

describe("testing the connection", () => {
  it("opens a fresh stream and passes when the server greets it", async () => {
    const api = await fresh();
    let state: ConnectionState | null = null;
    api.watchConnection((s) => (state = s));
    const old = last();
    old.emit("hello");
    api.testConnection();
    expect(old.closed).toBe(true);
    expect(FakeSource.all.length).toBe(2);
    expect(state!.status).toBe("checking");
    last().emit("hello");
    expect(state!.status).toBe("online");
    expect(state!.test?.ok).toBe(true);
  });

  it("fails at once when the server refuses", async () => {
    const api = await fresh();
    let state: ConnectionState | null = null;
    api.watchConnection((s) => (state = s));
    api.testConnection();
    last().fail();
    expect(state!.status).toBe("offline");
    expect(state!.test?.ok).toBe(false);
  });

  it("fails after a few seconds when the server says nothing", async () => {
    const api = await fresh();
    let state: ConnectionState | null = null;
    api.watchConnection((s) => (state = s));
    api.testConnection();
    vi.advanceTimersByTime(4_900);
    expect(state!.status).toBe("checking");
    vi.advanceTimersByTime(200);
    expect(state!.status).toBe("offline");
    expect(state!.test?.ok).toBe(false);
  });

  it("still delivers events to the views over the new stream", async () => {
    const api = await fresh();
    const change = vi.fn();
    api.onServerEvents({ change });
    last().emit("hello");
    api.testConnection();
    last().emit("hello");
    last().emit("change", { file: "a.rhumb", version: "v3" });
    expect(change).toHaveBeenCalledWith({ file: "a.rhumb", version: "v3" });
  });

  it("ignores events from the stream it replaced", async () => {
    const api = await fresh();
    let state: ConnectionState | null = null;
    api.watchConnection((s) => (state = s));
    const old = last();
    api.testConnection();
    old.fail(); // the closed stream's late error must not decide the test
    expect(state!.status).toBe("checking");
  });
});

describe("the status text", () => {
  it("says what is wrong and what a click does", async () => {
    const { connectionText } = await import("../web/src/connectionText.ts");
    const now = Date.now();
    expect(connectionText({ status: "online", since: now })).toMatch(/^Connected to the server since just now;.*Click to test/);
    expect(connectionText({ status: "checking", since: now })).toMatch(/^Testing/);
    const down = connectionText({ status: "offline", since: now - 3 * 60_000, test: { at: now, ok: false } });
    expect(down).toMatch(/^Disconnected from the server since 3 min ago/);
    expect(down).toContain("edits will fail");
    expect(down).toContain("no answer");
    expect(down).toMatch(/Click to test now\.$/);
  });
});
