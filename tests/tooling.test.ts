import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyEdit, checkAnchors, createRhumbServer, derive, EditError, excerpt, foldThreads, format, headingDate, parse, resolveAnchor, ThreadStore,
} from "../src/index.ts";

const SRC = `---
title: T
---

%% keep me
- [ ] Root ^root
  - [x] Done child ^a
    - a note
  - [ ] Open child ^b
- [ ] Other ^other

b needs a
other needs b, a: label
`;

describe("applyEdit", () => {
  it("changes only the status line", () => {
    const out = applyEdit(SRC, { op: "set-status", id: "b", status: "doing" }).source;
    expect(diffLines(SRC, out)).toEqual([["  - [ ] Open child ^b", "  - [/] Open child ^b"]]);
  });

  it("sets a title, keeping attrs and id, escaping a trailing ^token", () => {
    const src = "- [ ] Old {owner: kl} ^n\n";
    expect(applyEdit(src, { op: "set-title", id: "n", title: "New ^x" }).source)
      .toBe("- [ ] New \\^x {owner: kl} ^n\n");
    expect(parse(applyEdit(src, { op: "set-title", id: "n", title: "New ^x" }).source).nodes[0]!.title).toBe("New ^x");
  });

  it("adds a child after the parent's subtree with a slug id", () => {
    const r = applyEdit(SRC, { op: "add-node", parent: "root", title: "Write tests!" });
    expect(r.id).toBe("write-tests");
    const doc = parse(r.source);
    expect(doc.nodes[0]!.children.map((c) => c.id)).toEqual(["a", "b", "write-tests"]);
    expect(doc.diagnostics).toEqual([]);
  });

  it("generates an id when the title has no ASCII slug", () => {
    const r = applyEdit(SRC, { op: "add-node", parent: null, title: "批注" });
    expect(r.id).toMatch(/^_[a-z2-7]{6}$/);
    expect(parse(r.source).nodes.at(-1)!.id).toBe(r.id);
  });

  it("removes a subtree and the edges that touch it", () => {
    expect(() => applyEdit(SRC, { op: "remove-node", id: "root" })).toThrow(EditError);
    const r = applyEdit(SRC, { op: "remove-node", id: "root", recursive: true });
    expect(r.removed).toEqual(["root", "a", "b"]);
    const doc = parse(r.source);
    expect(doc.nodes.map((n) => n.id)).toEqual(["other"]);
    expect(doc.edges).toEqual([]);
    expect(r.source).toContain("%% keep me");
  });

  it("renames an id in the node and all edges", () => {
    const r = applyEdit(SRC, { op: "rename-id", id: "b", to: "beta" });
    expect(r.renamed).toEqual({ from: "b", to: "beta" });
    const doc = parse(r.source);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.edges.map((e) => `${e.from} ${e.to}`)).toEqual(["beta a", "other beta", "other a"]);
    expect(r.source).toContain("other needs beta, a: label");
  });

  it("adds and removes edges", () => {
    const added = applyEdit(SRC, { op: "add-edge", from: "other", kind: "relates", to: "root" }).source;
    expect(added.trimEnd().split("\n").at(-1)).toBe("other relates root");
    const labeled = applyEdit(added, { op: "add-edge", from: "other", kind: "relates", to: "root", label: "uses" }).source;
    expect(parse(labeled).edges.filter((e) => e.kind === "relates")).toHaveLength(2);
    expect(() => applyEdit(added, { op: "add-edge", from: "root", kind: "relates", to: "other" })).toThrow("Edge already exists");
    const removed = applyEdit(SRC, { op: "remove-edge", from: "other", kind: "needs", to: "b" }).source;
    expect(removed).toContain("other needs a: label");
    expect(() => applyEdit(SRC, { op: "remove-edge", from: "a", kind: "needs", to: "b" })).toThrow("Edge not found");
  });

  it("rejects edits that would introduce errors", () => {
    expect(() => applyEdit(SRC, { op: "add-edge", from: "a", kind: "needs", to: "other" })).toThrow(/E009/);
    expect(() => applyEdit(SRC, { op: "rename-id", id: "a", to: "b" })).toThrow(/already exists/);
    expect(() => applyEdit(SRC, { op: "set-status", id: "ghost", status: "done" })).toThrow(/Unknown node/);
    expect(() => applyEdit(SRC, { op: "move-node", id: "a", parent: null })).toThrow(/not implemented/);
  });

  it("stars and unstars a node through set-attr, keeping the line's own markers", () => {
    const src = "* [~] Parser {owner: kl} ^p\n";
    const on = applyEdit(src, { op: "set-attr", id: "p", key: "star", value: true }).source;
    expect(on).toBe("* [~] Parser {owner: kl, star: true} ^p\n");
    expect(applyEdit(on, { op: "set-attr", id: "p", key: "star", value: null }).source).toBe(src);
    expect(applyEdit(on, { op: "set-attr", id: "p", key: "star", value: false }).source).toBe(src);
    expect(applyEdit("- [ ] A ^a\n", { op: "set-attr", id: "a", key: "star", value: true }).source).toBe("- [ ] A {star: true} ^a\n");
    expect(applyEdit("- [ ] A {star: true} ^a\n", { op: "set-attr", id: "a", key: "star", value: null }).source).toBe("- [ ] A ^a\n");
  });

  it("validates set-attr keys and values", () => {
    const src = "- [ ] A ^a\n";
    expect(() => applyEdit(src, { op: "set-attr", id: "a", key: "Bad Key", value: 1 })).toThrow(/Invalid attribute key/);
    expect(() => applyEdit(src, { op: "set-attr", id: "a", key: "star", value: "yes" })).toThrow(/true or false/);
    expect(() => applyEdit(src, { op: "set-attr", id: "a", key: "owner", value: { x: 1 } as never })).toThrow(/string, number, boolean/);
    expect(() => applyEdit(src, { op: "set-attr", id: "a", key: "owner", value: "a\nb" })).toThrow(/single line/);
    expect(applyEdit(src, { op: "set-attr", id: "a", key: "tags", value: ["ui", "star"] }).source).toBe("- [ ] A {tags: [ui, star]} ^a\n");
  });

  it("preserves CRLF line endings", () => {
    const out = applyEdit("- [ ] A ^a\r\n", { op: "set-status", id: "a", status: "done" }).source;
    expect(out).toBe("- [x] A ^a\r\n");
  });
});

describe("format", () => {
  it("assigns ids and normalizes aliases, skipping W009 lines", () => {
    const r = format("- [X] One\n- [~] Two ^two\n- [ ] Bad ^Not_Valid\n");
    expect(r.assigned).toHaveLength(1);
    const lines = r.source.split("\n");
    expect(lines[0]).toMatch(/^- \[x\] One \^_[a-z2-7]{6}$/);
    expect(lines[1]).toBe("- [/] Two ^two");
    expect(lines[2]).toBe("- [ ] Bad ^Not_Valid");
    expect(format(r.source).source).toBe(r.source);
  });
});

describe("derive", () => {
  it("computes progress, readiness and consistency diagnostics", () => {
    const doc = parse(`- [x] P ^p
  - [x] A ^a
  - [ ] B ^b
  - [?] Idea ^i
- [ ] Q ^q
  - [/] Started ^s
- [ ] R ^r
- [/] S ^s2
- [-] Gone ^gone
r needs a
s2 needs b
r needs gone
`);
    const d = derive(doc);
    const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
    expect(byId.p!.progress).toEqual({ done: 1, total: 2 });
    expect(byId.i!.progress).toBeNull();
    expect(byId.r!.ready).toBe(true);
    expect(byId.b!.ready).toBe(true);
    expect(d.diagnostics.map((x) => [x.code, x.line])).toEqual([["W007", 1], ["I003", 5], ["W008", 8], ["W006", 12]]);
  });
});

describe("headingDate", () => {
  const log = [
    "# Changelog",          // 1
    "",                     // 2
    "## 2026-10-08",        // 3
    "",                     // 4
    "### Parser",           // 5
    "* entry one",          // 6
    "#### Detail",          // 7
    "* deep entry",         // 8
    "## 2026-10-09 Notes",  // 9
    "### Layout",           // 10
    "* entry two",          // 11
    "## Release 2026-10-10 retro", // 12
    "### Wrap-up",          // 13
    "* entry three",        // 14
  ].join("\n");
  const notes = "# Notes\n\n## Setup\n\n* no date anywhere\n";
  const files: Record<string, string> = { "/r/docs/changelog.md": log, "/r/docs/notes.md": notes };
  const read = (p: string) => files[p] ?? null;
  const ctx = { baseDir: "/r/docs", links: {}, readFile: read };
  const date = (target: string) => {
    const a = parse(`- [ ] N [x](<${target}>) ^n\n`).nodes[0]!.anchors[0]!;
    return headingDate(resolveAnchor(a, ctx), read)?.date ?? null;
  };

  it("takes the date from the nearest dated ancestor heading", () => {
    expect(date("changelog.md#parser")).toBe("2026-10-08");
    expect(date("changelog.md#detail")).toBe("2026-10-08");
    expect(date("changelog.md#layout")).toBe("2026-10-09");
  });

  it("uses the heading itself, and lines and text fragments inside a section", () => {
    expect(date("changelog.md#2026-10-08")).toBe("2026-10-08");
    expect(date("changelog.md#L11")).toBe("2026-10-09");
    expect(date("changelog.md#:~:text=deep entry")).toBe("2026-10-08");
    expect(date("changelog.md#layout^=* entry")).toBe("2026-10-09");
  });

  it("only counts a date at the start of a heading", () => {
    // "Release 2026-10-10 retro" is not a dated heading, so Wrap-up has no date.
    expect(date("changelog.md#wrap-up")).toBeNull();
  });

  it("returns null without a dated heading, a target line or a file", () => {
    expect(date("notes.md#setup")).toBeNull();
    expect(date("changelog.md#missing")).toBeNull();
    expect(date("missing.md#x")).toBeNull();
    expect(date("https://example.com/2026-10-08")).toBeNull();
  });
});

describe("resolveAnchor: line prefixes, offsets and line ranges", () => {
  // Line numbers are what the assertions refer to.
  const diary = [
    "# 2026-10-09",                                      // 1
    "",                                                  // 2
    "## Map layout, labels and stars",                   // 3
    "",                                                  // 4
    "* > [host][portolan] Make the view less crowded.",  // 5
    "\t<details>",                                       // 6
    "\t<summary>Hover focus</summary>",                  // 7
    "\t* First detail",                                  // 8
    "\t</details>",                                      // 9
    "",                                                  // 10
    "* > [host][portolan] Lay out top to bottom.",       // 11
    "\t* Second detail",                                 // 12
    "",                                                  // 13
    "## Other heading",                                  // 14
    "* > [host] Unrelated",                              // 15
  ].join("\n");
  const code = ["import x;", "", "export function a() {}", "export function b() {}", "// end"].join("\n");
  const files: Record<string, string> = { "/d/2026/1009.md": diary, "/r/src/edit.ts": code };
  const ctx = {
    baseDir: "/d/memo",
    links: { diary: "../{path}.md", repo: "../../r/{path}" },
    readFile: (p: string) => files[p] ?? null,
  };
  const at = (target: string) => {
    const src = `---\nlinks:\n  diary: ../{path}.md\n  repo: ../../r/{path}\n---\n- [ ] N [x](<${target}>) ^n\n`;
    return resolveAnchor(parse(src).nodes[0]!.anchors[0]!, ctx);
  };
  const codes = (target: string) => at(target).diagnostics.map((d) => d.code);

  it("matches the first line in the section that starts with a prefix, ignoring indentation", () => {
    expect(at("diary:2026/1009#map-layout^=* \\> [host][portolan] Lay")).toMatchObject({ line: 11, diagnostics: [] });
    expect(at("diary:2026/1009#map-layout^=`\\<summary\\>`")).toMatchObject({ line: 7 });
    // The prefix search stays inside the heading's section.
    expect(codes("diary:2026/1009#map-layout^=`* \\> [host] Unrelated`")).toEqual(["W003"]);
  });

  it("applies line offsets from the matched line or from the heading", () => {
    expect(at("diary:2026/1009#map-layout^=`* \\> [host][portolan] Make`+L2").line).toBe(7);
    expect(at("diary:2026/1009#map-layout+L2").line).toBe(5);
    expect(at("diary:2026/1009#map-layout^=`* \\> [host][portolan] Lay`-L1").line).toBe(10);
    // Running past the section is a warning.
    expect(codes("diary:2026/1009#map-layout+L20")).toEqual(["W003"]);
    expect(codes("diary:2026/1009#map-layout-L5")).toEqual(["W003"]);
  });

  it("resolves absolute lines and ranges in any text file", () => {
    expect(at("repo:src/edit.ts#L3")).toMatchObject({ line: 3, lineEnd: 3, diagnostics: [] });
    expect(at("repo:src/edit.ts#L3-L4")).toMatchObject({ line: 3, lineEnd: 4 });
    expect(at("repo:src/edit.ts#^=export function b").line).toBe(4);
    expect(codes("repo:src/edit.ts#L9")).toEqual(["W003"]);
    expect(codes("repo:src/edit.ts#L4-L9")).toEqual(["W003"]);
    expect(codes("repo:src/edit.ts#^=class")).toEqual(["W003"]);
  });

  it("does not recognize a <…> target with an unescaped >, and warns", () => {
    const src = (t: string) => `- [ ] N [x](<${t}>) ^n\n`;
    const broken = parse(src("diary:2026/1009#map-layout^=`* > [host]`"));
    expect(broken.nodes[0]!.anchors).toEqual([]);
    expect(broken.diagnostics.map((d) => d.code)).toContain("W011");
    expect(at("diary:2026/1009#map-layout^=`* \\> [host]`").line).toBe(5);
    expect(parse(src("diary:2026/1009#map-layout^=`* \\> [host]`")).diagnostics.map((d) => d.code)).not.toContain("W011");
  });

  it("searches the whole file for a text fragment without a heading, and warns when it misses", () => {
    // Line 11 is the first top-level entry containing the text; no heading narrows the search.
    expect(at("diary:2026/1009#:~:text=Lay out top to bottom")).toMatchObject({ entryLine: 11, diagnostics: [] });
    expect(at("diary:2026/1009#:~:text=Unrelated").entryLine).toBe(15);
    expect(codes("diary:2026/1009#:~:text=no such text anywhere")).toEqual(["W003"]);
  });

  it("reports malformed fragments as W003", () => {
    expect(codes("repo:src/edit.ts#L9-L3")).toEqual(["W003"]);
    expect(codes("diary:2026/1009#map-layout^=")).toEqual(["W003"]);
  });

  it("starts the excerpt at the resolved line", () => {
    const r = at("diary:2026/1009#map-layout^=`* \\> [host][portolan] Lay`");
    expect(excerpt(diary, r)).toBe(["* > [host][portolan] Lay out top to bottom.", "\t* Second detail"].join("\n"));
    expect(excerpt(code, at("repo:src/edit.ts#L3-L4"))).toBe("export function a() {}\nexport function b() {}");
  });

  it("surfaces failed matches through check", () => {
    const src = "---\nlinks:\n  diary: ../{path}.md\n---\n- [ ] N ^n\n  - [x](<diary:2026/1009#map-layout^=`nothing here`>)\n";
    expect(checkAnchors(parse(src), ctx).map((d) => [d.code, d.line])).toEqual([["W003", 6]]);
  });
});

describe("resolveAnchor", () => {
  const diary = `# 2026-10-08

## Portolan: shared mind map

* > Survey prior art
  details here
* > Explain Backlog.md design
  more

## Rhumb DSL: spec
* > Parser work
`;
  const files: Record<string, string> = { "/d/2026/1008.md": diary };
  const ctx = { baseDir: "/d/memo", links: { diary: "../{path}.md" }, readFile: (p: string) => files[p] ?? null };
  const anchorsOf = (src: string) => parse(src).nodes[0]!.anchors;

  it("resolves prefix, heading prefix and text fragment to an entry line", () => {
    const [a] = anchorsOf("- [ ] N [x](<diary:2026/1008#portolan:~:text=Explain Backlog>) ^n\n");
    const r = resolveAnchor(a!, ctx);
    expect(r.file).toBe("/d/2026/1008.md");
    expect(r.heading).toEqual({ text: "Portolan: shared mind map", line: 3 });
    expect(r.entryLine).toBe(7);
    expect(r.diagnostics).toEqual([]);
  });

  it("reports missing files, headings and text as W003", () => {
    const codes = (target: string) =>
      resolveAnchor(anchorsOf(`- [ ] N [x](<${target}>) ^n\n`)[0]!, ctx).diagnostics.map((d) => d.code);
    expect(codes("diary:2026/1009#x")).toEqual(["W003"]);
    expect(codes("diary:2026/1008#nope")).toEqual(["W003"]);
    expect(codes("diary:2026/1008#rhumb:~:text=Missing")).toEqual(["W003"]);
    expect(codes("https://example.com")).toEqual([]);
  });
});

describe("threads", () => {
  it("folds events and reports bad lines", () => {
    const ev = (event: unknown, line: number) => ({ event, line });
    const r = foldThreads([
      ev({ type: "open", thread: "t1", target: "a", author: "kl", text: "why?", time: "1", id: "m1" }, 1),
      ev({ type: "reply", thread: "t1", author: "claude", text: "because", time: "2", id: "m2", reply_to: "m1" }, 2),
      ev({ type: "resolve", thread: "t1", author: "kl", time: "3" }, 3),
      ev({ type: "retarget", thread: "t1", target: "a2", time: "4" }, 4),
      ev({ type: "reply", thread: "nope", author: "x", text: "y", time: "5", id: "m3" }, 5),
    ]);
    expect(r.threads).toHaveLength(1);
    expect(r.threads[0]).toMatchObject({ target: "a2", status: "resolved", updated: "4" });
    expect(r.threads[0]!.messages.map((m) => m.reply_to)).toEqual([null, "m1"]);
    expect(r.problems).toEqual([{ line: 5, message: "Event for an unknown thread" }]);
  });
});

describe("server", () => {
  let dir: string;
  let close: () => Promise<void> = async () => {};
  afterEach(async () => {
    await close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the doc, applies edits with version checks, and stores threads", async () => {
    dir = mkdtempSync(join(tmpdir(), "rhumb-"));
    const file = join(dir, "plan.rhumb");
    writeFileSync(file, SRC);
    const server = createRhumbServer({ root: file });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    close = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown) =>
      fetch(base + path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

    const doc = await (await fetch(`${base}/api/doc`)).json();
    expect(doc.doc.title).toBe("T");
    expect(doc.derived.find((n: any) => n.id === "b").ready).toBe(true);

    expect((await post("/api/edit", { version: "stale", edit: { op: "set-status", id: "b", status: "done" } })).status).toBe(409);
    const ok = await post("/api/edit", { version: doc.version, edit: { op: "set-status", id: "b", status: "done" } });
    expect(ok.status).toBe(200);
    expect(readFileSync(file, "utf8")).toContain("- [x] Open child ^b");
    const v2 = (await ok.json()).version;
    expect((await post("/api/edit", { version: v2, edit: { op: "set-status", id: "ghost", status: "done" } })).status).toBe(400);
    expect((await fetch(base + "/api/edit", { method: "POST", body: "{bad" })).status).toBe(400);

    const opened = await (await post("/api/threads", { action: "open", target: "b", author: "kl", text: "check this" })).json();
    expect(opened.event.type).toBe("open");
    expect((await post("/api/threads", { action: "reply", thread: "nope", author: "kl", text: "x" })).status).toBe(400);
    await post("/api/edit", { version: v2, edit: { op: "rename-id", id: "b", to: "beta" } });
    const threads = await (await fetch(`${base}/api/threads?status=open`)).json();
    expect(threads.threads).toMatchObject([{ target: "beta", orphan: false }]);
    expect(new ThreadStore(file).load().threads[0]!.target).toBe("beta");

    // The raw source, as plain text for a browser tab; only .rhumb files inside the root.
    const source = await fetch(`${base}/api/source?file=plan.rhumb`);
    expect(source.status).toBe(200);
    expect(source.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await source.text()).toBe(readFileSync(file, "utf8"));
    expect((await fetch(`${base}/api/source?file=../plan.rhumb`)).status).toBe(400);
    expect((await fetch(`${base}/api/source?file=plan.threads.jsonl`)).status).toBe(400);

    // fetch() drops a custom Host header, so use node:http for the DNS-rebinding check.
    const port = (server.address() as AddressInfo).port;
    const status = await new Promise<number>((r) =>
      request({ host: "127.0.0.1", port, path: "/api/doc", headers: { host: "evil.example" } }, (res) => {
        res.resume();
        r(res.statusCode!);
      }).end());
    expect(status).toBe(403);
  });
});

function diffLines(a: string, b: string): [string, string][] {
  const x = a.split("\n");
  const y = b.split("\n");
  return x.flatMap((l, i) => (l === y[i] ? [] : [[l, y[i]!] as [string, string]]));
}
