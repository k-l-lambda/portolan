// Which nodes carry a timer chip on their card (see TimerChip.tsx). Pure, so it can be tested
// without the view.

import type { Timing } from "../../src/timing.ts";

/**
 * What the card shows for a node at `status`: the chip only where there is something to say.
 * Doing compares its run with the estimate, a finished run shows what it took, and a todo shows
 * just the estimate. Anything else (a todo with no estimate, a dropped or idea item) shows none.
 */
export function timerState(timing: Timing | null, status: string | null): "live" | "closed" | "estimate" | null {
  if (!timing) return null;
  if (status === "doing") return "live";
  if (timing.closed) return "closed";
  if (status === "todo" && timing.estimate !== null && timing.elapsed === null) return "estimate";
  return null;
}

