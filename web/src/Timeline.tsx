// History rail beside the Diagnostics panel: the map's commits as dots on a vertical line, newest
// on top (uncommitted changes first, when there are any), or its linked dates for a map outside
// git. Hovering or focusing a dot highlights the nodes that point changed.

import { useState } from "react";
import type { Timeline } from "../../src/timeline.ts";
import { pointKey, pointTitle, railLabels } from "./timelineLabels.ts";

export function TimelineRail({ timeline, now, active, pinned = null, onActive }: {
  timeline: Timeline;
  now: number;
  /** Key of the highlighted point, see pointKey. */
  active: string | null;
  /** Key of the point whose diff is shown, marked with a ring. */
  pinned?: string | null;
  onActive: (key: string | null) => void;
}) {
  // The view's clock ticks once a minute; entering the rail also refreshes the ages when they
  // are a minute or more old (a background tab's timer may have been held back).
  const [entered, setEntered] = useState(0);
  const shownAt = Math.max(now, entered);
  const refresh = () => {
    const t = Math.floor(Date.now() / 1000);
    if (t - shownAt >= 60) setEntered(t);
  };
  const labels = railLabels(timeline.points, shownAt);
  return (
    <nav className="rail" aria-label={timeline.source === "git" ? "Commit history" : "Linked dates"} onPointerEnter={refresh}>
      <h2 className="rail-title">{timeline.source === "git" ? "History" : "Links"}</h2>
      {timeline.points.length === 0
        ? <p className="rail-empty muted">{timeline.source === "git" ? "No commits" : "No dated links"}</p>
        : (
          <ol className="rail-list" onPointerLeave={() => onActive(null)}>
            {timeline.points.map((p, i) => {
              const key = pointKey(p);
              return (
                <li key={key} className={`rail-point rail-${p.kind}${active === key ? " active" : ""}${pinned === key ? " pinned" : ""}`}>
                  <span className="rail-age" aria-hidden={labels[i] === null}>{labels[i] ?? ""}</span>
                  <button type="button" className="rail-dot" title={pointTitle(p)}
                    aria-label={pointTitle(p).replace(/\n/g, ", ")}
                    onPointerEnter={() => onActive(key)} onFocus={() => onActive(key)} onBlur={() => onActive(null)} />
                </li>
              );
            })}
          </ol>
        )}
      {timeline.truncated && <p className="rail-more muted">older not shown</p>}
    </nav>
  );
}
