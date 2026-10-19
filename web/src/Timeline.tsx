// History rail beside the Diagnostics panel: the map's commits as dots on a vertical line, newest
// on top (uncommitted changes first, when there are any), or its linked dates for a map outside
// git. Hovering or focusing a dot highlights the nodes that point changed. A rail cut short loads
// its older points a page at a time as it is scrolled to the end.

import { useEffect, useRef, useState } from "react";
import type { Timeline } from "../../src/timeline.ts";
import { pointKey, pointTitle, railLabels } from "./timelineLabels.ts";

/** How near the end, in pixels, the rail must be scrolled to ask for older points. */
const NEAR_END = 48;

export function TimelineRail({ timeline, now, active, pinned = null, onActive, onPick, onMore, loading = false }: {
  timeline: Timeline;
  now: number;
  /** Key of the highlighted point, see pointKey. */
  active: string | null;
  /** Key of the point whose diff is shown, marked with a ring. */
  pinned?: string | null;
  onActive: (key: string | null) => void;
  /** Clicking a dot: the view frames the nodes that point changed. */
  onPick?: (key: string) => void;
  /** Ask for older points (when `timeline.truncated`); absent where none can be had. */
  onMore?: () => void;
  /** Older points are on their way. */
  loading?: boolean;
}) {
  const nav = useRef<HTMLElement>(null);
  const more = timeline.truncated && onMore ? onMore : null;
  /** Ask for more when the end of the list is in sight. */
  const check = () => {
    const el = nav.current;
    if (!more || loading || !el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_END) more();
  };
  // Also after each page lands (and at first): a rail whose points do not fill it cannot be
  // scrolled, so its end is already in sight.
  useEffect(check, [timeline, loading, more]);
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
    <nav ref={nav} className="rail" aria-label={timeline.source === "git" ? "Commit history" : "Linked dates"} onPointerEnter={refresh}
      onScroll={check} aria-busy={loading}>
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
                    aria-disabled={!onPick || p.nodes.length === 0}
                    onPointerEnter={() => onActive(key)} onFocus={() => onActive(key)} onBlur={() => onActive(null)}
                    onClick={() => onPick?.(key)} />
                </li>
              );
            })}
          </ol>
        )}
      {timeline.truncated && (more
        // A button as well as the scroll, for the keyboard and for a rail that is not scrolled.
        ? <button type="button" className="rail-more rail-more-btn muted" onClick={more} disabled={loading}>{loading ? "loading…" : "load older"}</button>
        : <p className="rail-more muted">older not shown</p>)}
    </nav>
  );
}
