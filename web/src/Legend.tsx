import type { CSSProperties } from "react";
import type { EdgeKind } from "../../src/types.ts";
import { PRESET_KINDS, QUALIFIERS, VERDICTS, type ClaimMark } from "../../src/kinds.ts";
import { CLAIM_MEANING, ClaimIcon, KIND_MEANING, KindMark } from "./KindIcons.tsx";
import { TimerChip } from "./TimerChip.tsx";

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
      <path d={arrow ? "M2.5 6h32.5" : "M2.5 6h38.5"} strokeDasharray={dashed} />
      <rect className="legend-tab" x="1" y="3.9" width="1.5" height="4.2" rx="0.4" />
      {arrow ? <path className="legend-arrow" d="M35 2.5 42 6l-7 3.5z" /> : <rect className="legend-tab" x="41" y="3.9" width="1.5" height="4.2" rx="0.4" />}
    </svg>
  );
}

const CLAIMS: ClaimMark[] = ["untested", ...VERDICTS, ...QUALIFIERS];

/** What the lines, card colors, kind icons and the card's left edge mean; `letters` maps this map's custom kinds. */
export function Legend({ letters = new Map() }: { letters?: Map<string, string> }) {
  return (
    <div className="legend">
      <section>
        <h3>Lines between items</h3>
        <p className="muted legend-hint">The small bar marks where a line leaves an item; the arrow marks where it points.</p>
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
        <h3>Kinds</h3>
        <p className="muted legend-hint">Set with <code>{"{kind: …}"}</code>; an item without one is a task.</p>
        <ul className="legend-grid legend-marks">
          {PRESET_KINDS.map((k) => (
            <li key={k}>
              <KindMark kind={k} />
              <span className="legend-name">{k}</span>
              <span className="muted">{KIND_MEANING[k]}</span>
            </li>
          ))}
          {[...letters].map(([k, l]) => (
            <li key={`custom:${k}`}>
              <KindMark kind={k} letters={l} />
              <span className="legend-name">{k}</span>
              <span className="muted">custom kind in this map</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Claims</h3>
        <p className="muted legend-hint">
          Flags such as <code>{"{refuted: true}"}</code> on a hypothesis or finding, independent of its status.
          One verdict at most; replicated, contested and retracted combine with it.
        </p>
        <ul className="legend-grid legend-marks">
          {CLAIMS.map((m) => (
            <li key={m}>
              <ClaimIcon mark={m} />
              <span className="legend-name">{m}</span>
              <span className="muted">{CLAIM_MEANING[m]}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Time</h3>
        <p className="muted legend-hint">
          From <code>{"{estimate: 2h, started: …, finished: …}"}</code>: on a doing item the time since the start against the estimate; on a finished one only the time it took.
        </p>
        <ul className="legend-grid legend-timers">
          {([["ok", 2_400, false, "on time, under 80% of the estimate"], ["near", 6_300, false, "nearly due, 80% or more"], ["over", 9_000, false, "over the estimate"],
            ["ok", 6_000, true, "finished: the time it took"]] as const).map(([state, elapsed, closed, meaning]) => (
            <li key={`${state}-${closed}`}>
              <TimerChip timing={{ estimate: 7_200, started: 0, finished: closed ? elapsed : null, elapsed, closed, state }} />
              <span className="muted">{meaning}</span>
            </li>
          ))}
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
