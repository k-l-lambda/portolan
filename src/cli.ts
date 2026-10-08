#!/usr/bin/env node
// rhumb check <file>   parse + derived + anchor diagnostics; exit 1 on errors
// rhumb fmt <file>     assign missing IDs and normalize status aliases in place
// rhumb serve <file> [--port N]   local API server for the frontend (127.0.0.1 only)

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { derive } from "./derive.ts";
import { format } from "./format.ts";
import { parse } from "./parse.ts";
import { checkAnchors, contextFor } from "./resolve.ts";
import { createRhumbServer } from "./server.ts";

const [cmd, file, ...rest] = process.argv.slice(2);
if (!cmd || !file || !["check", "fmt", "serve"].includes(cmd)) {
  console.error("usage: rhumb <check|fmt|serve> <file.rhumb> [--port N]");
  process.exit(2);
}
const path = resolve(file);
const source = readFileSync(path, "utf8");

if (cmd === "check") {
  const doc = parse(source, { fileName: path });
  const read = (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : null);
  const diags = [...doc.diagnostics, ...derive(doc).diagnostics, ...checkAnchors(doc, contextFor(path, doc, read))]
    .sort((a, b) => a.line - b.line);
  for (const d of diags) console.log(`${file}:${d.line}: ${d.level} ${d.code} ${d.message}`);
  process.exit(diags.some((d) => d.level === "error") ? 1 : 0);
}

if (cmd === "fmt") {
  const out = format(source);
  if (out.source !== source) writeFileSync(path, out.source);
  for (const a of out.assigned) console.log(`${file}:${a.line}: assigned ^${a.id}`);
}

if (cmd === "serve") {
  const i = rest.indexOf("--port");
  const port = i >= 0 ? Number(rest[i + 1]) : 4310;
  createRhumbServer({ file: path }).listen(port, "127.0.0.1", () => {
    console.log(`rhumb: serving ${path} at http://127.0.0.1:${port} (no auth, loopback only)`);
  });
}
