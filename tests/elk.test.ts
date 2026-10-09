import { describe, expect, it } from "vitest";
import { parse } from "../src/index.ts";
import { layoutElk } from "../web/src/elkLayout.ts";
import { labelPoint, roundedPath } from "../web/src/geometry.ts";

const SRC = `- [/] Root ^root
  - [x] Spec ^spec
  - [/] Parser ^parser
  - [ ] UI ^ui
    - [ ] Tree ^tree
    - [ ] Panel ^panel
- [ ] Other ^other
parser needs spec
tree needs parser
other relates panel: uses
root needs spec
`;

describe("layoutElk", () => {
  it("nests children inside containers and routes only relations", async () => {
    const doc = parse(SRC);
    const r = await layoutElk(doc.nodes, doc.edges, new Set());
    const box = Object.fromEntries(r.boxes.map((b) => [b.key, b]));
    expect(box.root!.container).toBe(true);
    expect(box.ui!.container).toBe(true);
    expect(box.spec!.container).toBe(false);
    const inside = (c: string, p: string) =>
      box[c]!.x >= box[p]!.x && box[c]!.y >= box[p]!.y
      && box[c]!.x + box[c]!.width <= box[p]!.x + box[p]!.width
      && box[c]!.y + box[c]!.height <= box[p]!.y + box[p]!.height;
    for (const [c, p] of [["spec", "root"], ["ui", "root"], ["tree", "ui"], ["panel", "ui"]]) expect(inside(c!, p!), `${c} in ${p}`).toBe(true);
    // root needs spec is containment and is dropped; the other three relations are routed.
    expect(r.routes.map((x) => x.key).sort()).toEqual(["needs:parser->spec", "needs:tree->parser", "relates:other->panel:uses"]);
    // Points run from the Rhumb source to the target, even when layout flows the other way.
    const needs = r.routes.find((x) => x.key === "needs:parser->spec")!;
    const near = (p: { x: number; y: number }, k: string) =>
      p.x >= box[k]!.x - 1 && p.x <= box[k]!.x + box[k]!.width + 1 && p.y >= box[k]!.y - 1 && p.y <= box[k]!.y + box[k]!.height + 1;
    expect(near(needs.points[0]!, "parser")).toBe(true);
    expect(near(needs.points.at(-1)!, "spec")).toBe(true);
    // Prerequisites sit above what needs them.
    expect(box.spec!.y + box.spec!.height).toBeLessThanOrEqual(box.parser!.y);
  });

  it("folds collapsed subtrees and their edges into the visible card", async () => {
    const doc = parse(SRC);
    const r = await layoutElk(doc.nodes, doc.edges, new Set(["ui"]));
    expect(r.boxes.map((b) => b.key)).not.toContain("tree");
    const ui = r.boxes.find((b) => b.key === "ui")!;
    expect(ui).toMatchObject({ container: false, hidden: 2 });
    expect(r.routes.map((x) => x.key).sort()).toEqual(["needs:parser->spec", "needs:ui->parser:folded", "relates:other->ui:folded"]);
  });

  it("merges same-kind edges folded onto one pair and counts them", async () => {
    const d = parse(`- [ ] Group ^g
  - [ ] A ^a
  - [ ] B ^b
- [ ] X ^x
a relates x: uses
b relates x: tests
a needs x
`);
    const r = await layoutElk(d.nodes, d.edges, new Set(["g"]));
    expect(r.routes.map((e) => [e.key, e.count, e.labels])).toEqual([
      ["relates:g->x:folded", 2, ["uses", "tests"]],
      ["needs:g->x:folded", 1, []],
    ]);
  });

  it("keeps labeled relates between the same pair distinct", async () => {
    const d = parse("- [ ] A ^a\n- [ ] B ^b\na relates b: uses\na relates b: tests\n");
    const r = await layoutElk(d.nodes, d.edges, new Set());
    expect(r.routes.map((e) => e.key)).toEqual(["relates:a->b:uses", "relates:a->b:tests"]);
  });

  it("stacks history by day on top, then doing, todo and ideas", async () => {
    const doc = parse(`- [?] Idea ^idea
- [ ] Planned ^todo
- [/] Current ^doing
- [x] Done later ^done2
- [x] Done first ^done1
- [x] Done first too ^done1b
`);
    const day = 86_400;
    const t: Record<string, number> = { done1: 10 * day, done1b: 10 * day + 60, done2: 12 * day, doing: 13 * day, todo: 1, idea: 2 };
    const r = await layoutElk(doc.nodes, doc.edges, new Set(), (n) => t[n.id!]);
    const at = Object.fromEntries(r.boxes.map((b) => [b.key, b]));
    const rows = ["done1", "done2", "doing", "todo", "idea"].map((k) => at[k]!.y);
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
    // Same day, same band: side by side, older on the left.
    expect(at.done1b!.y).toBe(at.done1!.y);
    expect(at.done1!.x).toBeLessThan(at.done1b!.x);
    // Ordering edges are not drawn.
    expect(r.routes).toEqual([]);
  });

  it("keeps the time order when relates edges would form a cycle", async () => {
    // Without global orientation, ELK sees x -> a1 (relates) and done -> x (order) plus
    // a1 inside done, a cycle; it then breaks the ordering edge and x floats above done.
    const day = 86_400;
    const doc = parse(`- [x] Old group ^done
  - [x] A1 ^a1
- [ ] Later ^x
x relates a1: revisits
`);
    const t: Record<string, number> = { done: 5 * day, a1: 5 * day, x: 9 * day };
    const r = await layoutElk(doc.nodes, doc.edges, new Set(), (n) => t[n.id!]);
    const at = Object.fromEntries(r.boxes.map((b) => [b.key, b]));
    expect(at.done!.y + at.done!.height).toBeLessThanOrEqual(at.x!.y);
    const rel = r.routes.find((e) => e.kind === "relates")!;
    // Drawn from x (Rhumb source) to a1.
    expect(rel.points[0]!.y).toBeGreaterThan(rel.points.at(-1)!.y);
  });

  it("lets dependencies win over the time order", async () => {
    // An old, finished item that needs a planned one: the prerequisite goes on top anyway.
    const doc = parse("- [x] Old ^old\n- [ ] Planned ^plan\nold needs plan\n");
    const r = await layoutElk(doc.nodes, doc.edges, new Set(), (n) => (n.id === "old" ? 100 : 200));
    const at = Object.fromEntries(r.boxes.map((b) => [b.key, b]));
    expect(at.plan!.y).toBeLessThan(at.old!.y);
  });
});

describe("polyline helpers", () => {
  it("rounds corners and places labels on the longest segment", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }];
    expect(roundedPath(pts)).toMatch(/^M 0 0 L 92 0 Q 100 0 100 8 L 100 20$/);
    expect(labelPoint(pts)).toEqual({ x: 50, y: 0 });
  });
});
