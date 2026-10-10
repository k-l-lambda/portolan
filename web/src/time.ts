// Time helpers for the freshness view. Pure functions so they can be unit-tested.

const MIN = 60;
const HOUR = 3600;
const DAY = 86_400;
/** Earliest time a JS Date can hold; a date read as further back is clamped to it (LONG_AGO). */
const DATE_MIN = -8.64e12;
const LONG_AGO_TEXT = "long time ago";

/** "just now", "5 min ago", "3 h ago", "2 d ago", "4 mo ago", "long time ago". */
export function relativeTime(time: number, now: number): string {
  if (!(time > DATE_MIN)) return LONG_AGO_TEXT;
  const s = Math.max(0, now - time);
  if (s < MIN) return "just now";
  if (s < HOUR) return `${Math.floor(s / MIN)} min ago`;
  if (s < DAY) return `${Math.floor(s / HOUR)} h ago`;
  if (s < 60 * DAY) return `${Math.floor(s / DAY)} d ago`;
  if (s < 730 * DAY) return `${Math.floor(s / (30 * DAY))} mo ago`;
  return `${Math.floor(s / (365 * DAY))} y ago`;
}

export function absoluteTime(time: number): string {
  if (!(time > DATE_MIN)) return LONG_AGO_TEXT;
  const d = new Date(time * 1000);
  // Before 1 CE the locale format drops the era, so 1 BCE would read as year 1: name it.
  return d.getFullYear() < 1 ? d.toLocaleString(undefined, { era: "short", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric" }) : d.toLocaleString();
}

/** ISO string for a `<time dateTime>`, or undefined when a Date cannot hold the time. */
export function isoTime(time: number): string | undefined {
  return time > DATE_MIN && time < -DATE_MIN ? new Date(time * 1000).toISOString() : undefined;
}

/**
 * Freshness in [0, 1] on a log scale: 1 for anything updated within the last hour,
 * falling to 0 at 90 days.
 */
export function freshness(time: number, now: number): number {
  const age = Math.max(HOUR, now - time);
  const f = 1 - Math.log(age / HOUR) / Math.log((90 * DAY) / HOUR);
  return Math.min(1, Math.max(0, f));
}
