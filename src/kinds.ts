// Node kinds and claim flags (spec 3.4): what sort of thing a node is, and, for a claim, how
// the evidence stands. Both are optional attributes and never affect status or readiness.

import type { RhumbNode } from "./types.ts";

/** Kinds with their own icon in the view. Any other string is a custom kind, shown by letters. */
export const PRESET_KINDS = [
  "task", "milestone", "experiment", "hypothesis", "finding", "question",
  "decision", "risk", "artifact", "reference", "event",
] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];

/** Outcome of testing a claim; at most one may be true (`W013`). */
export const VERDICTS = ["supported", "partial", "refuted", "inconclusive"] as const;
/** Further notes on a claim, combinable with a verdict. */
export const QUALIFIERS = ["replicated", "contested", "retracted"] as const;
export const CLAIM_FLAGS = [...VERDICTS, ...QUALIFIERS] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Qualifier = (typeof QUALIFIERS)[number];
export type ClaimFlag = (typeof CLAIM_FLAGS)[number];
/** What a card shows for a claim: a flag, or "untested" for a hypothesis with no verdict (never written). */
export type ClaimMark = ClaimFlag | "untested";

/** Kinds a verdict or qualifier is meant for; elsewhere it is `I004`. */
export const CLAIM_KINDS: readonly string[] = ["hypothesis", "finding"];

/** The node's kind, lower-cased and trimmed, or null when unset or not a string (`W012`). */
export function nodeKind(node: Pick<RhumbNode, "attrs">): string | null {
  const k = node.attrs.kind;
  if (typeof k !== "string") return null;
  const t = k.trim().toLowerCase();
  return t === "" ? null : t;
}

export function isPresetKind(kind: string): kind is PresetKind {
  return (PRESET_KINDS as readonly string[]).includes(kind);
}

export interface Claim {
  /** The one verdict set to true; null when none is, or when several conflict (`W013`). */
  verdict: Verdict | null;
  /** A hypothesis with no verdict flag at all: shown as untested. */
  untested: boolean;
  qualifiers: Qualifier[];
}

/** Claim flags set to `true` on the node; any other value counts as unset (`W012`). */
export function claimOf(node: Pick<RhumbNode, "attrs">): Claim {
  const on = (f: ClaimFlag) => node.attrs[f] === true;
  const verdicts = VERDICTS.filter(on);
  return {
    verdict: verdicts.length === 1 ? verdicts[0]! : null,
    untested: verdicts.length === 0 && nodeKind(node) === "hypothesis",
    qualifiers: QUALIFIERS.filter(on),
  };
}
