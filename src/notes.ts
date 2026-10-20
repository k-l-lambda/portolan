// What a node's notes say beyond their text, for the checks (derive.ts) and the web view alike.
// Kept free of the parser, so the web view can import it.

import type { RhumbNode } from "./types.ts";

/** The note prefix that says why a blocked node is blocked. */
export const BLOCKED_BY = "blocked_by:";
/** More notes than this on one node is a sign it has become a log (I007). */
export const MAX_NOTES = 10;

/**
 * Why a node is blocked: the text after `blocked_by:` in each of its notes that starts with it,
 * joined with "; "; null when no note does (an empty reason still counts as the note being there).
 */
export function blockedReason(n: RhumbNode): string | null {
  const reasons = n.notes.map((x) => x.text.trim()).filter((t) => t.startsWith(BLOCKED_BY));
  return reasons.length === 0 ? null : reasons.map((t) => t.slice(BLOCKED_BY.length).trim()).filter(Boolean).join("; ");
}
