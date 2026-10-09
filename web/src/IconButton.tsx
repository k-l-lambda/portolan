import type { ReactNode } from "react";

/**
 * A toolbar button that shows only an icon; its label is the accessible name and the hover/focus
 * tooltip. `pressed` makes it a toggle.
 */
export function IconButton({ icon, label, onClick, disabled, pressed, children }: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** Optional visible text next to the icon. */
  children?: ReactNode;
}) {
  return (
    <button type="button" className={`btn icon-btn${pressed ? " pressed" : ""}`} aria-label={children ? undefined : label}
      aria-pressed={pressed} data-tip={label} disabled={disabled} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
