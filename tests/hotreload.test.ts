import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRhumbServer } from "../src/index.ts";

interface Event { event: string; data: any }

/** Collects SSE events from /api/events and lets the test wait for one. */
function subscribe(port: number) {
  const events: Event[] = [];
  let res: IncomingMessage | null = null;
  let buffer = "";
  const ready = new Promise<void>((resolve) => {
    request({ host: "127.0.0.1", port, path: "/api/events" }, (r) => {
      res = r;
      r.setEncoding("utf8");
      r.on("data", (chunk: string) => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event) events.push({ event, data: data ? JSON.parse(data) : null });
          if (event === "hello") resolve();
        }
      });
    }).end();
  });
  const waitFor = async (pred: (e: Event) => boolean, ms = 4000) => {
    const start = Date.now();
    for (;;) {
      const hit = events.find(pred);
      if (hit) return hit;
      if (Date.now() - start > ms) throw new Error(`timed out; got ${JSON.stringify(events)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  return { events, ready, waitFor, close: () => res?.destroy() };
}

describe("hot reload events", () => {
  let dir: string;
  let close: () => Promise<void> = async () => {};
  afterEach(async () => {
    await close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports in-place, atomic, delete-recreate and new-directory changes", async () => {
    dir = mkdtempSync(join(tmpdir(), "portolan-hot-"));
    const a = join(dir, "a.rhumb");
    writeFileSync(a, "- [ ] A ^a\n");
    const server = createRhumbServer({ root: dir, webDir: join(dir, "no-web") });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const sse = subscribe(port);
    close = () => new Promise((r) => { sse.close(); server.closeAllConnections(); server.close(() => r()); });
    await sse.ready;

    const changeOf = async (file: string, write: () => void) => {
      const before = sse.events.length;
      write();
      return sse.waitFor((e) => sse.events.indexOf(e) >= before && e.event === "change" && e.data.file === file);
    };

    await changeOf("a.rhumb", () => writeFileSync(a, "- [x] A ^a\n"));
    await changeOf("a.rhumb", () => (writeFileSync(join(dir, ".a.tmp"), "- [/] A ^a\n"), renameSync(join(dir, ".a.tmp"), a)));
    await changeOf("a.rhumb", () => (rmSync(a), writeFileSync(a, "- [-] A ^a\n")));
    // The case Node's recursive watcher misses: edits after a delete-and-recreate.
    await changeOf("a.rhumb", () => writeFileSync(a, "- [!] A ^a\n"));

    const before = sse.events.length;
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.rhumb"), "- [ ] B ^b\n");
    await sse.waitFor((e) => sse.events.indexOf(e) >= before && e.event === "files");
    await changeOf("sub/b.rhumb", () => writeFileSync(join(dir, "sub", "b.rhumb"), "- [x] B ^b\n"));

    const beforeRm = sse.events.length;
    rmSync(join(dir, "sub", "b.rhumb"));
    await sse.waitFor((e) => sse.events.indexOf(e) >= beforeRm && e.event === "files");
  }, 30_000);
});
