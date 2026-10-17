// What the connection icon says (ConnectionStatus.tsx). Pure, so it can be tested without the view.

import type { ConnectionState } from "./api.ts";
import { relativeTime } from "./time.ts";

const ago = (ms: number) => relativeTime(Math.floor(ms / 1000), Math.floor(Date.now() / 1000));

/** The tooltip and accessible name: what the status is, since when, and what a click does. */
export function connectionText(s: ConnectionState): string {
  const test = s.test ? ` Last test ${ago(s.test.at)}: ${s.test.ok ? "the server answered" : "no answer"}.` : "";
  if (s.status === "online") return `Connected to the server since ${ago(s.since)}; live updates are on.${test} Click to test the connection.`;
  if (s.status === "checking") return "Testing the connection to the server…";
  return `Disconnected from the server since ${ago(s.since)}: changes on disk will not show, and edits will fail. Retrying in the background.${test} Click to test now.`;
}
