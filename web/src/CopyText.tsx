import { useEffect, useState } from "react";

/** Copies text; falls back to a hidden textarea where the async clipboard API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** A label that copies `value` when clicked and briefly says so. */
export function CopyText({ value, label, className = "" }: { value: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1400);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button type="button" className={`copy-text ${className}`} title={`Copy ${value}`}
      onClick={async () => setState((await copyText(value)) ? "copied" : "failed")}>
      {label}
      <span className={`copy-flag ${state}`} aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : ""}</span>
    </button>
  );
}
