// History rail beside the Diagnostics panel: the map's commits as dots on a vertical line, newest
// on top (uncommitted changes first, when there are any), or its linked dates for a map outside
// git. Hovering or focusing a dot highlights the nodes that point changed.

import type { Timeline } from "../../src/timeline.ts";
import { pointKey, pointTitle, railLabels } from "./timelineLabels.ts";

export function TimelineRail({ timeline, now, active, onActive }: {
  timeline: Timeline;
  now: number;
  /** Key of the highlighted point, see pointKey. */
  active: string | null;
  onActive: (key: string | null) => void;
}) {
  const labels = railLabels(timeline.points, now);
  return (
    <nav className="rail" aria-label={timeline.source === "git" ? "Commit history" : "Linked dates"}>
      <h2 className="rail-title">{timeline.source === "git" ? "History" : "Links"}</h2>
      {timeline.points.length === 0
        ? <p className="rail-empty muted">{timeline.source === "git" ? "No commits" : "No dated links"}</p>
        : (
          <ol className="rail-list" onPointerLeave={() => onActive(null)}>
            {timeline.points.map((p, i) => {
              const key = pointKey(p);
              return (
                <li key={key} className={`rail-point rail-${p.kind}${active === key ? " active" : ""}`}>
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
