// The diff of one history point, shown under the Diagnostics panel while that point is the last
// one hovered or focused on the history rail. Lines are colored by the diff syntax: file and hunk
// headers, removed and added lines, with old and new line numbers.

import { useMemo } from "react";
import type { TimelinePoint } from "../../src/timeline.ts";
import { parseUnified } from "./diffView.ts";
import { absoluteTime, shortAgo } from "./time.ts";

export function DiffPanel({ point, diff, error, now, onClose, onHover }: {
  point: TimelinePoint;
  /** The diff text; null while loading. */
  diff: string | null;
  error: string | null;
  now: number;
  onClose: () => void;
  /** Pointer over the panel: highlight this point's nodes again, as on the rail. */
  onHover: (on: boolean) => void;
}) {
  const parsed = useMemo(() => (diff === null ? null : parseUnified(diff)), [diff]);
  const head = point.kind === "local" ? "Uncommitted changes" : `${point.sha!.slice(0, 8)} ${point.summary ?? ""}`;
  return (
    <section className="diff-panel" aria-label="Changes at this point" onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
      <div className="diff-head">
        <h2 className="diff-title" title={head}>{head}</h2>
        <button type="button" className="diff-close" aria-label="Close the diff" title="Close" onClick={onClose}>×</button>
      </div>
      <p className="diff-meta muted">
        <time title={absoluteTime(point.time)}>{shortAgo(point.time, now)}</time>
        {parsed && <> · <span className="diff-stat-add">+{parsed.added}</span> <span className="diff-stat-del">−{parsed.removed}</span></>}
      </p>
      {error ? <p role="alert" className="error">{error}</p>
        : !parsed ? <p className="muted">Loading…</p>
        : parsed.rows.length === 0 ? <p className="muted">No change to the text.</p>
        : (
          <div className="diff-body" tabIndex={0} aria-label="Diff">
            <table className="diff">
              <tbody>
                {parsed.rows.map((r, i) => (
                  <tr key={i} className={`diff-${r.kind}`}>
                    {r.kind === "file" || r.kind === "hunk"
                      ? <td className="diff-text" colSpan={3}>{r.text}</td>
                      : <>
                        <td className="diff-num" aria-hidden="true">{r.old ?? ""}</td>
                        <td className="diff-num" aria-hidden="true">{r.new ?? ""}</td>
                        <td className="diff-text"><span className="diff-mark" aria-hidden="true">{r.kind === "add" ? "+" : r.kind === "del" ? "-" : " "}</span>{r.text}</td>
                      </>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
