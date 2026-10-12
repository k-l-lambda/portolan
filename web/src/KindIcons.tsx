// Icons for node kinds and claim flags (spec 3.4), drawn from the shapes in `markShapes.ts`.
// A custom kind is shown as letters instead.

import type { ReactNode } from "react";
import type { ClaimMark, PresetKind } from "../../src/kinds.ts";
import { CLAIM_SHAPES, KIND_SHAPES, type Shape } from "./markShapes.ts";

/** React props from SVG attribute names (`stroke-dasharray` → `strokeDasharray`). */
const props = (attrs: Shape[1]) =>
  Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
const draw = (shapes: Shape[]): ReactNode => shapes.map(([Tag, attrs], i) => <Tag key={i} {...props(attrs)} />);

export const KIND_MEANING: Record<PresetKind, string> = {
  task: "work to do (the default, not shown on cards)",
  milestone: "a stage or delivery point",
  experiment: "a bounded trial with a control or budget",
  hypothesis: "a claim waiting to be tested",
  finding: "a conclusion drawn from results",
  question: "an open question to investigate",
  decision: "a choice made between options",
  risk: "something that may go wrong",
  artifact: "a dataset, model, checkpoint or build",
  reference: "a paper, spec or outside source",
  event: "something that happened, not work",
};

export const CLAIM_MEANING: Record<ClaimMark, string> = {
  untested: "a hypothesis with no verdict yet",
  supported: "the evidence supports it",
  partial: "holds only under some conditions",
  refuted: "the evidence contradicts it",
  inconclusive: "tested, not decided",
  replicated: "reproduced independently",
  contested: "conflicting evidence or opinions",
  retracted: "withdrawn after an error",
};

export function MarkIcon({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/** A node's kind: the preset icon, or the custom kind's letters in a small box. */
export function KindMark({ kind, letters }: { kind: string; letters?: string }) {
  const shapes = KIND_SHAPES[kind as PresetKind];
  return (
    <span className="kind-mark" role="img" aria-label={`kind: ${kind}`} title={`kind: ${kind}`}>
      {shapes ? <MarkIcon>{draw(shapes)}</MarkIcon> : <span className="kind-letters" aria-hidden="true">{letters ?? kind.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

export function ClaimIcon({ mark }: { mark: ClaimMark }) {
  return (
    <span className={`claim-mark claim-${mark}`} role="img" aria-label={mark} title={`${mark}: ${CLAIM_MEANING[mark]}`}>
      <MarkIcon>{draw(CLAIM_SHAPES[mark])}</MarkIcon>
    </span>
  );
}
