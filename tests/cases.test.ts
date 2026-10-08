import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/index.ts";

const casesDir = join(import.meta.dirname, "cases");

/**
 * Partial match: only keys present in `expected` are compared, but arrays must have
 * the same length so a missing or extra node/edge fails the case.
 */
function expectSubset(actual: unknown, expected: unknown, path = "$"): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path} is an array`).toBe(true);
    const arr = actual as unknown[];
    expect(arr.length, `${path}.length`).toBe(expected.length);
    expected.forEach((e, i) => expectSubset(arr[i], e, `${path}[${i}]`));
  } else if (expected !== null && typeof expected === "object") {
    expect(actual, path).toBeTypeOf("object");
    for (const [k, v] of Object.entries(expected)) {
      expectSubset((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
    }
  } else {
    expect(actual, path).toEqual(expected);
  }
}

describe("rhumb cases", () => {
  const files = readdirSync(casesDir).filter((f) => f.endsWith(".rhumb")).sort();
  for (const file of files) {
    it(file, () => {
      const source = readFileSync(join(casesDir, file), "utf8");
      const { diagnostics: expectedDiags, ...expected } = JSON.parse(
        readFileSync(join(casesDir, file.replace(/\.rhumb$/, ".expect.json")), "utf8"),
      );
      const doc = parse(source);
      // Diagnostics are compared exactly as [code, line] pairs.
      expect(doc.diagnostics.map((d) => [d.code, d.line])).toEqual(expectedDiags ?? []);
      expectSubset(doc, expected);
    });
  }
});

describe("parse", () => {
  it("accepts CRLF line endings", () => {
    const doc = parse("- [ ] A ^a\r\n- [ ] B ^b\r\nb needs a\r\n");
    expect(doc.diagnostics).toEqual([]);
    expect(doc.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(doc.edges).toHaveLength(1);
  });

  it("uses the file name as the default title", () => {
    expect(parse("- [ ] A\n", { fileName: "dir/plan.rhumb" }).title).toBe("plan");
  });

  it("parses the repository example without diagnostics", () => {
    const source = readFileSync(join(import.meta.dirname, "../examples/portolan.rhumb"), "utf8");
    const doc = parse(source);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.title).toBe("Portolan");
    expect(doc.edges).toHaveLength(5);
  });
});
