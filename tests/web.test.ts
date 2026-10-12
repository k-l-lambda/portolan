import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRhumbServer, parse } from "../src/index.ts";
import { defaultCollapsed, plainTitle, shortId, starredInside } from "../web/src/layout.ts";
import { searchNodes } from "../web/src/search.ts";

describe("view helpers", () => {
  it("collapses subtrees without doing work by default", () => {
    const d = parse(`- [/] Root ^root
  - [x] Done branch ^done
    - [x] Leaf ^leaf
  - [ ] Active branch ^active
    - [ ] Mid ^mid
      - [/] Deep doing ^deep
- [ ] Idle root ^idle
  - [ ] Child ^child
`);
    expect([...defaultCollapsed(d.nodes)].sort()).toEqual(["done", "idle"]);
  });

  it("folds starred nodes like any other and counts stars inside", () => {
    const d = parse(`- [x] Archive ^archive
  - [x] Group ^group
    - [x] Key result {star: true} ^key
  - [x] Other ^other
- [x] Plain ^plain
  - [x] Leaf ^leaf
`);
    // A star does not keep its branch open: only doing work does.
    expect([...defaultCollapsed(d.nodes)].sort()).toEqual(["archive", "group", "plain"]);
    const n = starredInside(d.nodes);
    expect([n.get("archive"), n.get("group"), n.get("key"), n.get("plain")]).toEqual([1, 1, 0, 0]);
  });

  it("shortens ids that repeat the parent id", () => {
    expect(shortId("rhumb-parser", "rhumb")).toBe("^…-parser");
    expect(shortId("camelot-loss-a1", "camelot-loss")).toBe("^…-a1");
    expect(shortId("rhumbline", "rhumb")).toBe("^rhumbline");
    expect(shortId("ui", null)).toBe("^ui");
    expect(shortId(null, "x")).toBe("no id");
    // Long IDs keep their end.
    expect(shortId("camelot-next-final-teacher", null)).toBe("^…inal-teacher");
    expect(shortId("camelot-next-final-teacher", "camelot-next")).toBe("^…inal-teacher");
    expect(shortId("rhumb-decisions", "rhumb")).toBe("^…-decisions");
  });

  it("strips link syntax from titles", () => {
    expect(plainTitle("Survey [notes](diary:x#y) and `code` \\^x")).toBe("Survey notes and code ^x");
  });
});

describe("directory server", () => {
  let dir: string;
  let close: () => Promise<void> = async () => {};
  afterEach(async () => {
    await close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists .rhumb files, serves each by relative path and rejects escapes", async () => {
    dir = mkdtempSync(join(tmpdir(), "portolan-"));
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "a.rhumb"), "---\ntitle: Alpha\n---\n- [x] Done ^d\n- [ ] Todo ^t\n");
    writeFileSync(join(dir, "sub", "b.rhumb"), "- [ ] B ^b\n");
    writeFileSync(join(dir, "node_modules", "skip.rhumb"), "- [ ] X ^x\n");
    writeFileSync(join(dir, "secret.txt"), "nope");
    const webDir = join(dir, "web");
    mkdirSync(webDir);
    writeFileSync(join(webDir, "index.html"), "<!doctype html><title>t</title>");

    const server = createRhumbServer({ root: dir, webDir });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    close = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); });
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    writeFileSync(join(dir, "sub", "b.rhumb"), "- [ ] B {star: true} ^b\n");
    const list = await (await fetch(`${base}/api/files`)).json();
    expect(list.files.map((f: any) => f.file)).toEqual(["a.rhumb", "sub/b.rhumb"]);
    expect(list.files[1].starred).toEqual([{ id: "b", title: "B", status: "todo" }]);
    expect(list.files[0]).toMatchObject({ title: "Alpha", nodes: 2, progress: { done: 1, total: 2 }, errors: 0 });

    const b = await (await fetch(`${base}/api/doc?file=sub%2Fb.rhumb`)).json();
    expect(b.doc.nodes[0].id).toBe("b");
    expect((await fetch(`${base}/api/doc`)).status).toBe(400);
    expect((await fetch(`${base}/api/doc?file=secret.txt`)).status).toBe(400);
    expect((await fetch(`${base}/api/doc?file=..%2F..%2Fetc%2Fx.rhumb`)).status).toBe(400);
    expect((await fetch(`${base}/api/doc?file=missing.rhumb`)).status).toBe(404);

    const ok = await fetch(`${base}/api/edit?file=a.rhumb`, {
      method: "POST", body: JSON.stringify({ version: (await (await fetch(`${base}/api/doc?file=a.rhumb`)).json()).version,
        edit: { op: "set-status", id: "t", status: "done" } }),
    });
    expect(ok.status).toBe(200);

    const page = await fetch(`${base}/`);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    // Static paths cannot escape the web directory.
    const escaped = await new Promise<string>((r) =>
      request({ host: "127.0.0.1", port, path: "/../secret.txt" }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => r(body));
      }).end());
    expect(escaped).not.toContain("nope");
  });
});

describe("recent maps", () => {
  it("moves a file to the front, drops duplicates and caps the list", async () => {
    const { pushRecent } = await import("../web/src/recent.ts");
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent([], "x")).toEqual(["x"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("searchNodes", () => {
  const d = parse(`- [/] History of life ^history-life
  - [x] Homo sapiens appears ^history-life-sapiens
  - [-] Dragon program ^history-life-dragons
- [ ] Untitled-id node
- [?] Life support ^life
`);
  const all = () => {
    const out: (typeof d.nodes)[number][] = [];
    const walk = (ns: typeof d.nodes) => ns.forEach((n) => (out.push(n), walk(n.children)));
    walk(d.nodes);
    return out;
  };

  it("returns only the node whose ID matches exactly, with or without ^", () => {
    expect(searchNodes(all(), "life")).toEqual({ keys: ["life"], ranked: ["life"], exact: true });
    expect(searchNodes(all(), " ^history-life ")).toMatchObject({ keys: ["history-life"], exact: true });
  });

  it("matches titles and IDs by case-insensitive words, in document order", () => {
    expect(searchNodes(all(), "LIFE").keys).toEqual(["history-life", "history-life-sapiens", "history-life-dragons", "life"]);
    expect(searchNodes(all(), "dragon life").keys).toEqual(["history-life-dragons"]);
    expect(searchNodes(all(), "untitled").keys).toEqual(["line:4"]);
  });

  it("ranks whole, prefix and word-start matches first, earlier positions higher", () => {
    const d2 = parse(`- [ ] Field notes ^notes
- [ ] Lifeboat drill ^drill
- [ ] Life ^x1
- [ ] History of life ^x2
- [ ] Support systems for life ^x3
`);
    const r = searchNodes(d2.nodes, "life");
    expect(r.keys).toEqual(["drill", "x1", "x2", "x3"]); // the map keeps document order
    expect(r.ranked).toEqual(["x1", "drill", "x2", "x3"]);
    // Fuzzy: the tighter subsequence wins.
    const d3 = parse("- [ ] alpha-b-c-d-e ^wide\n- [ ] abc-de ^tight\n");
    expect(searchNodes(d3.nodes, "abde").ranked).toEqual(["tight", "wide"]);
  });

  it("falls back to in-order subsequences when no word matches directly", () => {
    expect(searchNodes(all(), "hlsap")).toMatchObject({ keys: ["history-life-sapiens"], exact: false });
    expect(searchNodes(all(), "zzz").keys).toEqual([]);
    expect(searchNodes(all(), "   ").keys).toEqual([]);
  });
});
