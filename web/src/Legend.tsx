import type { CSSProperties } from "react";
import type { EdgeKind } from "../../src/types.ts";

const LINES: { kind: EdgeKind; arrow: boolean; dashed?: string; name: string; meaning: string }[] = [
  { kind: "needs", arrow: true, name: "needs", meaning: "the arrow points to what must happen first" },
  { kind: "blocks", arrow: true, name: "blocks", meaning: "the arrow points to the item held up" },
  { kind: "relates", arrow: false, dashed: "4 4", name: "relates", meaning: "related; with a label it reads as a sentence and gets an arrow" },
  { kind: "replaces", arrow: true, dashed: "8 4", name: "replaces", meaning: "the arrow points to the item it supersedes" },
  { kind: "from", arrow: true, dashed: "2 4", name: "from", meaning: "the arrow points to the work it came out of" },
];

const STATUSES: { status: string; meaning: string }[] = [
  { status: "todo", meaning: "not started" },
  { status: "doing", meaning: "in progress" },
  { status: "done", meaning: "finished" },
  { status: "blocked", meaning: "stuck; the reason is in its notes" },
  { status: "idea", meaning: "proposed, not committed" },
  { status: "dropped", meaning: "abandoned, kept for the record" },
];

function LineSample({ kind, arrow, dashed }: { kind: EdgeKind; arrow: boolean; dashed?: string }) {
  return (
    <svg className={`legend-line edge-${kind}`} viewBox="0 0 44 12" width="44" height="12" aria-hidden="true">
      <path d={arrow ? "M2 6h33" : "M2 6h40"} strokeDasharray={dashed} />
      {arrow && <path className="legend-arrow" d="M35 2.5 42 6l-7 3.5z" />}
    </svg>
  );
}

/** What the lines, card colors and the card's left edge mean. */
export function Legend() {
  return (
    <div className="legend">
      <section>
        <h3>Lines between items</h3>
        <ul>
          {LINES.map((l) => (
            <li key={l.kind}>
              <LineSample kind={l.kind} arrow={l.arrow} dashed={l.dashed} />
              <span className="legend-name">{l.name}</span>
              <span className="muted">{l.meaning}</span>
            </li>
          ))}
          <li>
            <span className="legend-chip">needs ×3</span>
            <span className="muted">several relations folded into one line by a collapsed group</span>
          </li>
        </ul>
      </section>
      <section>
        <h3>Item colors</h3>
        <ul className="legend-grid">
          {STATUSES.map((s) => (
            <li key={s.status}>
              <span className={`legend-card card status-${s.status}`} aria-hidden="true" />
              <span className="legend-name">{s.status}</span>
              <span className="muted">{s.meaning}</span>
            </li>
          ))}
          <li>
            <span className="legend-card card container status-doing" aria-hidden="true" />
            <span className="legend-name">group</span>
            <span className="muted">a frame around the items inside it</span>
          </li>
          <li>
            <span className="legend-card card status-todo starred" aria-hidden="true" />
            <span className="legend-name">starred</span>
            <span className="muted">a gold frame</span>
          </li>
          <li>
            <span className="badge badge-ready">ready</span>
            <span className="muted">to do, and everything it needs is done</span>
          </li>
        </ul>
      </section>
      <section>
        <h3>How recently it changed</h3>
        <div className="legend-fresh">
          {[0.2, 0.55, 1].map((f) => (
            <span key={f} className="legend-card card status-doing" style={{ "--fresh": `${Math.round(20 + f * 80)}%` } as CSSProperties} aria-hidden="true" />
          ))}
          <span className="legend-fresh-scale"><span>older</span><span className="legend-fresh-bar" /><span>newer</span></span>
        </div>
        <p className="muted">
          A brighter left edge means the item's line, or the dated diary entry it links to, changed more recently.
          It fades over about 90 days.
        </p>
      </section>
    </div>
  );
}
