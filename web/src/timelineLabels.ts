// Labels for the history rail (see Timeline.tsx): ages, tooltips and stable keys. Pure, so they
// can be tested without the view.

import type { TimelinePoint } from "../../src/timeline.ts";
import { absoluteTime, shortAgo, shortDaysAgo } from "./time.ts";

/** Stable key of a point across reloads. */
export const pointKey = (p: TimelinePoint) => (p.kind === "local" ? "local" : p.kind === "commit" ? p.sha! : `link:${p.date}`);

/** The age shown left of a dot. */
export function pointAge(p: TimelinePoint, now: number): string {
  return p.kind === "link" ? shortDaysAgo(p.time, now) : shortAgo(p.time, now);
}

/** Labels for a list of points: a run of equal ages shows its age only on the first dot. */
export function railLabels(points: TimelinePoint[], now: number): (string | null)[] {
  const ages = points.map((p) => pointAge(p, now));
  return ages.map((a, i) => (i > 0 && ages[i - 1] === a ? null : a));
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Tooltip: the absolute time, then what happened. */
export function pointTitle(p: TimelinePoint): string {
  const items = plural(p.nodes.length, "item");
  const gone = p.gone > 0 ? `, ${plural(p.gone, "item")} since removed` : "";
  if (p.kind === "link") return `${p.date}\n${plural(p.nodes.length, "item")} linked to this date`;
  const when = absoluteTime(p.time);
  if (p.kind === "local") return `${when}\nUncommitted changes · ${items} changed${gone}`;
  return `${when}\n${p.sha!.slice(0, 8)} ${p.summary ?? ""}\n${items} changed${gone}`;
}
