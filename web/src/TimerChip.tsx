// Time on an item (spec 3.5) in the card's foot. While doing: how long the current run has taken
// against its estimate, as a bar and text, green on time, amber nearly due, red over. Once it has
// finished: only the actual time it took, with a check mark, no estimate and no bar. A todo item
// with an estimate shows the estimate alone: what the work is expected to take before it starts.

import type { Timing } from "../../src/timing.ts";
import { formatDuration, sharePercent } from "../../src/timing.ts";
import { timerState } from "./timerState.ts";
import { absoluteTime } from "./time.ts";

const STATE_TEXT = { ok: "on time", near: "nearly due", over: "over the estimate" } as const;

/** Tooltip and accessible text for a timing. */
export function timerText(t: Timing): string {
  if (t.closed) return `took ${formatDuration(t.elapsed!)}; ${absoluteTime(t.started!)} – ${absoluteTime(t.finished!)}`;
  const since = t.started === null ? null : `started ${absoluteTime(t.started)}`;
  if (t.estimate !== null && t.elapsed !== null) {
    const pct = sharePercent(t.elapsed, t.estimate);
    const over = t.elapsed > t.estimate ? `, ${formatDuration(t.elapsed - t.estimate)} over` : "";
    return `${formatDuration(t.elapsed)} of ${formatDuration(t.estimate)} estimated (${pct}%${over}), ${STATE_TEXT[t.state!]}; ${since}`;
  }
  if (t.elapsed !== null) return `${formatDuration(t.elapsed)} so far, no estimate; ${since}`;
  return `estimated ${formatDuration(t.estimate!)}, no start time`;
}

/** The values as a record, for an item that is not in progress: no comparison with now. */
export function timingRecord(t: Timing): string {
  return [t.estimate !== null ? `estimated ${formatDuration(t.estimate)}` : null, t.started !== null ? `started ${absoluteTime(t.started)}` : null,
    t.finished !== null ? `finished ${absoluteTime(t.finished)}` : null].filter(Boolean).join("; ");
}

export function TimerChip({ timing }: { timing: Timing }) {
  const { estimate, elapsed, state, closed } = timing;
  // A finished run shows only what it took: no estimate, no bar, no on-time color.
  const label = closed ? formatDuration(elapsed!)
    : elapsed !== null && estimate !== null ? `${formatDuration(elapsed)}/${formatDuration(estimate)}`
    : elapsed !== null ? formatDuration(elapsed) : `est. ${formatDuration(estimate!)}`;
  const share = !closed && elapsed !== null && estimate !== null ? Math.min(1, elapsed / estimate) : null;
  const text = timerText(timing);
  return (
    <span className={`timer timer-${closed ? "plain" : state ?? "plain"}${closed ? " timer-closed" : ""}`} role="img" aria-label={`Time: ${text}`} title={text}>
      <svg className="timer-icon" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* A running clock while doing; a clock with a check once the run has finished. */}
        {closed ? <><circle cx="8" cy="8" r="6" /><path d="m5.2 8.2 1.9 1.9 3.7-4" /></> : <><circle cx="8" cy="9" r="5.6" /><path d="M8 6.2V9l1.9 1.3M6.4 1.8h3.2" /></>}
      </svg>
      {share !== null && <span className="timer-bar" aria-hidden="true"><span className="timer-fill" style={{ width: `${share * 100}%` }} /></span>}
      <span className="timer-label" aria-hidden="true">{label}</span>
    </span>
  );
}

/** One timed doing item for the Diagnostics panel. */
export interface TimedItem {
  key: string;
  line: number;
  title: string;
  timing: Timing;
}

/**
 * Doing items with timing, most urgent first: each row shows its time against the estimate on a
 * bar. Past the estimate the bar keeps the estimate's mark and runs on, so the overrun shows.
 */
export function TimedWork({ items, onSelect }: { items: TimedItem[]; onSelect: (item: TimedItem) => void }) {
  const over = items.filter((i) => i.timing.state === "over").length;
  const near = items.filter((i) => i.timing.state === "near").length;
  return (
    <section className="timed" aria-label="Timed work in progress">
      <h3>
        In progress <span className="timed-count">{items.length}</span>
        {over > 0 && <span className="timed-flag timer-over">{over} over</span>}
        {near > 0 && <span className="timed-flag timer-near">{near} nearly due</span>}
      </h3>
      <ul className="timed-list">
        {items.map((i) => {
          const { estimate, elapsed, state } = i.timing;
          // Where the estimate falls on the bar: the whole bar while on time, earlier once over.
          const span = estimate !== null && elapsed !== null ? Math.max(estimate, elapsed) : null;
          return (
            <li key={i.key}>
              <button type="button" className={`timed-row timer-${state ?? "plain"}`} title={timerText(i.timing)} onClick={() => onSelect(i)}>
                <span className="timed-title">{i.title}</span>
                <span className="timed-value">
                  {elapsed !== null && estimate !== null ? `${formatDuration(elapsed)} / ${formatDuration(estimate)}`
                    : elapsed !== null ? `${formatDuration(elapsed)}, no estimate` : `est. ${formatDuration(estimate!)}, not started`}
                </span>
                {span !== null && (
                  <span className="timed-bar" aria-hidden="true">
                    <span className="timed-fill" style={{ width: `${(elapsed! / span) * 100}%` }} />
                    {state === "over" && <span className="timed-mark" style={{ left: `${(estimate! / span) * 100}%` }} />}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
