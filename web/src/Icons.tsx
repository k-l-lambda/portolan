// Small line icons for the toolbar: 16px grid, 1.6px round strokes, drawn in currentColor.

import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/** A page with lines of text and a folded corner: the map's source file. */
export const SourceIcon = () => (
  <Icon>
    <path d="M4 1.8h5.2L12.4 5v9.2H4z" />
    <path d="M9.2 1.8V5h3.2" />
    <path d="M6 8h4.4M6 10.5h4.4M6 13h2.6" opacity=".7" />
  </Icon>
);

/** Two chevrons pulling apart: unfold every group. */
export const ExpandAllIcon = () => (
  <Icon>
    <path d="M4.5 5.5 8 2l3.5 3.5" />
    <path d="M4.5 10.5 8 14l3.5-3.5" />
    <path d="M3 8h10" opacity=".45" />
  </Icon>
);

/** Arrow turning back: restore the default folding. */
export const ResetViewIcon = () => (
  <Icon>
    <path d="M3.2 6.3A5 5 0 1 1 3 9.6" />
    <path d="M2.6 2.9v3.6h3.6" />
  </Icon>
);

/** A label riding on a line: show every relation label. */
export const EdgeLabelsIcon = () => (
  <Icon>
    <path d="M1.5 12.5h3M11.5 12.5h3" />
    <rect x="4.5" y="9.5" width="7" height="6" rx="1.6" transform="translate(0 -3)" />
    <path d="M6.6 9.5h2.8" opacity=".6" />
  </Icon>
);

/** Swatches beside lines: what the colors and strokes mean. */
export const LegendIcon = () => (
  <Icon>
    <rect x="2" y="2.5" width="3.5" height="3.5" rx="0.8" />
    <rect x="2" y="10" width="3.5" height="3.5" rx="0.8" />
    <path d="M8 4.25h6M8 11.75h6" />
  </Icon>
);
