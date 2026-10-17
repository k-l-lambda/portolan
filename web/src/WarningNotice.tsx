// Warnings about the map's own state (a reload or an edit that failed, a layout that failed) as
// one icon in the control bar. The text goes in the icon's tooltip rather than on the bar, so a
// long message does not push the controls about; clicking the icon dismisses it.

import { WarningIcon } from "./Icons.tsx";

export function WarningNotice({ messages, onDismiss }: { messages: string[]; onDismiss: () => void }) {
  const text = messages.join("\n");
  return (
    <>
      {messages.length > 0 && (
        <button type="button" className="btn icon-btn warn-btn" aria-label={`Warning: ${messages.join(" ")} Click to dismiss.`}
          data-tip={`${text}\nClick to dismiss.`} onClick={onDismiss}>
          <WarningIcon />
          {messages.length > 1 && <span className="warn-count">{messages.length}</span>}
        </button>
      )}
      {/* Always mounted, so a screen reader announces a warning when it appears. */}
      <span className="visually-hidden" role="status" aria-live="polite">{text}</span>
    </>
  );
}
