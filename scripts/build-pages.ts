// Static export for GitHub Pages: the built web app plus the JSON its API calls would return
// for every map under a directory (or one map), written as files (see `staticPath` in
// web/src/api.ts). The page is read-only: no server, no editing, no live reload. It opens the
// map directly when there is one, else the index of maps.
// Usage: node scripts/build-pages.ts [dir or map.rhumb] [out dir]   (after `pnpm build:web`)

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createRhumbServer } from "../src/server.ts";
import type { RhumbNode } from "../src/types.ts";
import { staticPath } from "../web/src/api.ts";

const [input = "docs/demo", outArg = "_site"] = process.argv.slice(2);
const repo = resolve(import.meta.dirname, "..");
const webDist = join(repo, "web/dist");
const out = resolve(outArg);
if (!existsSync(join(webDist, "index.html"))) throw new Error("web/dist is missing; run `pnpm build:web` first");

const server = createRhumbServer({ root: input });
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// Absolute paths of the build machine become repository-relative.
const scrub = (json: string) => json.replaceAll(`${repo}/`, "").replaceAll(repo, ".");
/** Where a static URL path (encoded per segment) lives on disk; the host decodes it the same way. */
const onDisk = (rel: string) => join(out, ...rel.split("/").map(decodeURIComponent));
async function save(path: string, rel: string) {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const file = onDisk(rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, scrub(await res.text()));
}

rmSync(out, { recursive: true, force: true });
cpSync(webDist, out, { recursive: true });

await save("/api/files", staticPath("files"));
const { files } = (await (await fetch(`${base}/api/files`)).json()) as { files: { file: string }[] };
let anchors = 0;
for (const { file } of files) {
  const q = `file=${encodeURIComponent(file)}`;
  await save(`/api/doc?${q}`, staticPath("doc", file));
  // The source as is: no path scrubbing, it is the user's own text.
  const source = onDisk(staticPath("source", file));
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, await (await fetch(`${base}/api/source?${q}`)).text());
  const { doc } = (await (await fetch(`${base}/api/doc?${q}`)).json()) as { doc: { nodes: RhumbNode[] } };
  const walk = async (nodes: RhumbNode[]) => {
    for (const n of nodes) {
      for (let i = 0; i < n.anchors.length; i++, anchors++) {
        await save(`/api/anchor?${q}&node=${n.line}&index=${i}`, staticPath("anchor", file, n.line, i));
      }
      await walk(n.children);
    }
  };
  await walk(doc.nodes);
}

// Mark the page as a static export; with a single map it opens that map directly.
const index = join(out, "index.html");
const only = files.length === 1 ? files[0]!.file : "";
const meta = `<meta name="portolan-static" content="${only.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" />`;
writeFileSync(index, readFileSync(index, "utf8").replace("<head>", `<head>\n    ${meta}`));
// Pages runs Jekyll by default, which drops files and folders starting with `_`.
writeFileSync(join(out, ".nojekyll"), "");

server.close();
console.log(`${outArg}: ${files.length} map(s), ${anchors} anchors`);
process.exit(0); // the server's history poller would keep the process alive
