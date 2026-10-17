// The server connection's status in the top bar: a glyph coloured by whether the live event
// stream is up, and a button that tests it on demand. A lost connection also says so in words,
// since a colour alone is easy to miss and says nothing to a screen reader.

import { useEffect, useState } from "react";
import { testConnection, watchConnection, type ConnectionState } from "./api.ts";
import { connectionText } from "./connectionText.ts";
import { ConnectionIcon } from "./Icons.tsx";

/** Null on a static export, which has no server to be connected to. */
export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState | null>(null);
  // The text says "since 3 min ago", so it is refreshed while the page is open.
  const [, tick] = useState(0);
  useEffect(() => watchConnection(setState) ?? undefined, []);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!state) return null;
  const text = connectionText(state);
  return (
    <span className={`conn conn-${state.status}`}>
      <button type="button" className="btn icon-btn conn-btn" aria-label={text} data-tip={text}
        aria-busy={state.status === "checking"} onClick={() => testConnection()}>
        <ConnectionIcon />
        {state.status === "offline" && <span className="conn-text">Disconnected</span>}
      </button>
      {/* Announced when it changes: losing the server, and getting it back. */}
      <span className="visually-hidden" role="status" aria-live="polite">
        {state.status === "offline" ? "Disconnected from the server" : state.status === "online" ? "Connected to the server" : ""}
      </span>
    </span>
  );
}
