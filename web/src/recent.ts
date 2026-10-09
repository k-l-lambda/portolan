// Recently opened maps, kept per browser in localStorage (a viewer convenience, not shared state).

const KEY = "portolan.recent";
export const RECENT_MAX = 10;

/** Moves `file` to the front, drops duplicates and keeps at most `max` entries. */
export function pushRecent(list: string[], file: string, max = RECENT_MAX): string[] {
  return [file, ...list.filter((f) => f !== file)].slice(0, max);
}

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return []; // storage blocked or corrupt: behave as if nothing was visited
  }
}

export function rememberRecent(file: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pushRecent(readRecent(), file)));
  } catch {
    // storage unavailable: the menu just shows fewer entries
  }
}
