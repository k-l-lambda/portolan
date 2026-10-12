// Node search for the control bar: an exact ID wins; otherwise titles and IDs are matched
// loosely and ranked by how well they match. Pure, so it can be tested without the view.

import type { RhumbNode } from "../../src/types.ts";
import { nodeKey, plainTitle } from "./layout.ts";

export interface SearchResult {
  /** Matching node keys in document order (what the map highlights). */
  keys: string[];
  /** The same keys, best match first (what the candidate list shows). */
  ranked: string[];
  /** The query named a node ID exactly. */
  exact: boolean;
}

/** Score of `w` occurring in `text`: whole text, then prefix, then the start of a word, then anywhere (earlier is better). */
function directScore(text: string, w: string): number {
  if (!text) return 0;
  if (text === w) return 100;
  if (text.startsWith(w)) return 80;
  const i = text.indexOf(w);
  if (i < 0) return 0;
  const boundary = !/[\p{L}\p{N}]/u.test(text[i - 1]!);
  return (boundary ? 70 : 50) - Math.min(i, 20) / 2;
}

/**
 * Score of `w` as an in-order subsequence of `text` ("hlsap" in "history-life-sapiens"):
 * up to 30, higher when the matched characters sit closer together; 0 if absent.
 */
function fuzzyScore(text: string, w: string): number {
  let best = Infinity;
  for (let start = text.indexOf(w[0]!); start >= 0; start = text.indexOf(w[0]!, start + 1)) {
    let j = 1, end = start;
    for (let k = start + 1; k < text.length && j < w.length; k++) if (text[k] === w[j]) (j++, (end = k));
    if (j < w.length) break; // later starts cannot complete either
    best = Math.min(best, end - start + 1);
  }
  return best === Infinity ? 0 : (30 * w.length) / best;
}

/**
 * Finds nodes for `query` among `nodes` (keyed by `nodeKey`, in document order). A leading `^`
 * is ignored, so a pasted `^id` works. If the query is an ID, only that node matches. Otherwise
 * every whitespace-separated word must occur in the title or ID, case-insensitively; when no
 * node has them all, the words are tried as in-order subsequences of the ID or title instead.
 * Matches are ranked by the sum of each word's best score, then shorter titles, then document order.
 */
export function searchNodes(nodes: Iterable<RhumbNode>, query: string): SearchResult {
  const q = query.trim().replace(/^\^/, "");
  if (!q) return { keys: [], ranked: [], exact: false };
  const list = [...nodes];
  const exact = list.find((n) => n.id === q);
  if (exact) return { keys: [nodeKey(exact)], ranked: [nodeKey(exact)], exact: true };

  const words = q.toLowerCase().split(/\s+/);
  const texts = list.map((n, i) => ({ i, key: nodeKey(n), id: (n.id ?? "").toLowerCase(), title: plainTitle(n.title).toLowerCase() }));
  const scoreBy = (f: (text: string, w: string) => number) => texts
    .map((t) => {
      const per = words.map((w) => Math.max(f(t.id, w), f(t.title, w)));
      return { ...t, score: per.every((s) => s > 0) ? per.reduce((a, b) => a + b, 0) : 0 };
    })
    .filter((t) => t.score > 0);
  let hits = scoreBy(directScore);
  if (hits.length === 0) hits = scoreBy(fuzzyScore);
  const ranked = [...hits].sort((a, b) => b.score - a.score || a.title.length - b.title.length || a.i - b.i);
  return { keys: hits.map((t) => t.key), ranked: ranked.map((t) => t.key), exact: false };
}
