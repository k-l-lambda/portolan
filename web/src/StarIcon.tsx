// The star of a starred item, filled when on: on cards, in the index and in the side panel's lists.
// Kept on its own so the timer list (TimerChip.tsx, which the cards import) can show it too.

export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="star-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
        fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
