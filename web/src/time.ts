// Time helpers for the freshness view. Pure functions so they can be unit-tested.

const MIN = 60;
const HOUR = 3600;
const DAY = 86_400;

/** "just now", "5 min ago", "3 h ago", "2 d ago", "4 mo ago". */
export function relativeTime(time: number, now: number): string {
  const s = Math.max(0, now - time);
  if (s < MIN) return "just now";
  if (s < HOUR) return `${Math.floor(s / MIN)} min ago`;
  if (s < DAY) return `${Math.floor(s / HOUR)} h ago`;
  if (s < 60 * DAY) return `${Math.floor(s / DAY)} d ago`;
  if (s < 730 * DAY) return `${Math.floor(s / (30 * DAY))} mo ago`;
  return `${Math.floor(s / (365 * DAY))} y ago`;
}

export function absoluteTime(time: number): string {
  return new Date(time * 1000).toLocaleString();
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
