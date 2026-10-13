// Line diff in unified format, for the history rail's diff panel. The server already holds the
// file's text at every commit it shows, so it diffs those texts itself: the same code covers a
// commit (against the one before), uncommitted changes (against the last commit) and the first
// commit (against nothing).

/** One line of an edit script: kept, removed from `a`, or added from `b`. */
export interface DiffOp {
  op: " " | "-" | "+";
  text: string;
}

/** A text's lines; a final newline does not make an empty last line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * Shortest edit script from `a` to `b` (Myers' O(ND) algorithm). The common prefix and suffix are
 * taken off first, so typical small edits to a large file stay cheap.
 */
export function diffLines(a: string[], b: string[]): DiffOp[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const middle = myers(A, B);
  return [
    ...a.slice(0, pre).map((text): DiffOp => ({ op: " ", text })),
    ...middle,
    ...a.slice(a.length - suf).map((text): DiffOp => ({ op: " ", text })),
  ];
}

/** Beyond this many edits, the middle is shown as all removed then all added (correct, not minimal). */
const MAX_EDITS = 2000;

function myers(a: string[], b: string[]): DiffOp[] {
  const n = a.length, m = b.length;
  const replaceAll = (): DiffOp[] => [...a.map((text): DiffOp => ({ op: "-", text })), ...b.map((text): DiffOp => ({ op: "+", text }))];
  if (n === 0 || m === 0) return replaceAll();
  const max = n + m, off = max;
  // v[k + off] = furthest x on diagonal k; trace[d] is v after step d, for walking back.
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, MAX_EDITS) && found < 0; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + off]! < v[k + 1 + off]!) ? v[k + 1 + off]! : v[k - 1 + off]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) (x++, y++);
      next[k + off] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    v = next;
  }
  if (found < 0) return replaceAll();
  // Walk back from (n, m) to (0, 0), one edit per step, collecting the diagonal runs between them.
  const out: DiffOp[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && prev[k - 1 + off]! < prev[k + 1 + off]!);
    const pk = down ? k + 1 : k - 1;
    const px = prev[pk + off]!, py = px - pk;
    while (x > px + (down ? 0 : 1) && y > py + (down ? 1 : 0)) out.push({ op: " ", text: a[--x]! }), y--;
    if (down) out.push({ op: "+", text: b[--y]! });
    else out.push({ op: "-", text: a[--x]! });
  }
  while (x > 0 && y > 0) out.push({ op: " ", text: a[--x]! }), y--;
  return out.reverse();
}

/**
 * Unified diff of `before` → `after` with `context` lines around each change, headed by
 * `--- a/<path>` / `+++ b/<path>` (`/dev/null` for a side that does not exist). Empty when
 * the texts are equal.
 */
export function unifiedDiff(before: string | null, after: string, path: string, context = 3): string {
  const ops = diffLines(splitLines(before ?? ""), splitLines(after));
  if (!ops.some((o) => o.op !== " ")) return "";
  // Old/new line number before each op.
  const at: { a: number; b: number }[] = [];
  let ai = 0, bi = 0;
  for (const o of ops) {
    at.push({ a: ai, b: bi });
    if (o.op !== "+") ai++;
    if (o.op !== "-") bi++;
  }
  // Hunks: runs of ops around changes, joined when their context would touch.
  const changes = ops.map((o, i) => (o.op === " " ? -1 : i)).filter((i) => i >= 0);
  const hunks: [number, number][] = [];
  for (const i of changes) {
    const start = Math.max(0, i - context), end = Math.min(ops.length, i + context + 1);
    const last = hunks.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  }
  const out = [before === null ? "--- /dev/null" : `--- a/${path}`, `+++ b/${path}`];
  for (const [s, e] of hunks) {
    const slice = ops.slice(s, e);
    const aLen = slice.filter((o) => o.op !== "+").length, bLen = slice.filter((o) => o.op !== "-").length;
    // A side with no lines in the hunk names the line before it, as git does.
    const aStart = aLen === 0 ? at[s]!.a : at[s]!.a + 1, bStart = bLen === 0 ? at[s]!.b : at[s]!.b + 1;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of slice) out.push(o.op + o.text);
  }
  return out.join("\n") + "\n";
}
