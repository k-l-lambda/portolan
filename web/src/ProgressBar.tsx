export function ProgressBar({ progress }: { progress: { done: number; total: number } | null }) {
  if (!progress) return null;
  const pct = Math.round((progress.done / progress.total) * 100);
  return (
    <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
      aria-label={`${progress.done} of ${progress.total} done`}>
      <span className="progress-fill" style={{ width: `${pct}%` }} />
      <span className="progress-text">{progress.done}/{progress.total}</span>
    </span>
  );
}
