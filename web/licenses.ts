// Vite plugin: writes THIRD-PARTY-LICENSES.txt next to the bundle, with the license text of every
// npm package whose code ended up in it. Minification drops license comments, and some licenses
// (elkjs: EPL-2.0) require shipping the notice with the code.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { Plugin } from "vite";

/** The package root (the folder with package.json) that a module file belongs to. */
function packageRoot(file: string): string | null {
  const i = file.lastIndexOf(`${sep}node_modules${sep}`);
  if (i < 0) return null;
  let dir = dirname(file);
  while (dir.length > i + 14) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return null;
}

export function thirdPartyLicenses(fileName = "THIRD-PARTY-LICENSES.txt"): Plugin {
  return {
    name: "portolan-third-party-licenses",
    apply: "build",
    generateBundle(_options, bundle) {
      const roots = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of Object.keys(chunk.modules)) {
          const root = packageRoot(id.replace(/^\0/, "").split("?")[0]!);
          if (root) roots.add(root);
        }
      }
      const entries = [...roots].map((root) => {
        const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        const file = readdirSync(root).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
        const text = file ? readFileSync(join(root, file), "utf8").trim() : `License: ${pkg.license ?? "unknown"} (no license file in the package)`;
        return { name: pkg.name as string, version: pkg.version as string, license: String(pkg.license ?? "unknown"), text };
      }).sort((a, b) => a.name.localeCompare(b.name));
      const unique = entries.filter((e, i) => i === 0 || e.name !== entries[i - 1]!.name || e.version !== entries[i - 1]!.version);
      const body = [
        "Third-party software bundled in the Portolan web app",
        "",
        ...unique.map((e) => `- ${e.name}@${e.version} (${e.license})`),
        "",
        ...unique.flatMap((e) => ["=".repeat(72), `${e.name}@${e.version} (${e.license})`, "=".repeat(72), "", e.text, ""]),
      ].join("\n");
      this.emitFile({ type: "asset", fileName, source: body });
    },
  };
}
