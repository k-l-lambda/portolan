import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { readRecent } from "./recent.ts";

/** The current map's path in the top bar; opens a list of recently visited maps. */
export function RecentMenu({ file }: { file: string }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  // Titles of the maps the server currently has; null until loaded (or if loading failed).
  const [titles, setTitles] = useState<Map<string, string | null> | null>(null);

  useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
    let live = true;
    api.files().then(
      (r) => live && setTitles(new Map(r.files.map((f) => [f.file, f.title]))),
      () => live && setTitles(null),
    );
    return () => { live = false; };
  }, [open]);

  // Hide entries the server no longer has (another directory may be served on this port now).
  const entries = recent.filter((f) => !titles || titles.has(f));

  return (
    <div className="recent-wrap"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      <button type="button" className="crumb-btn" aria-haspopup="true" aria-expanded={open}
        title="Recently visited maps" onClick={() => setOpen((v) => !v)}>
        <span className="crumb-path">{file}</span>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open && (
        <div className="popover recent-menu" role="group" aria-label="Recently visited maps">
          <p className="popover-head">Recent</p>
          <ul>
            {entries.map((f) => (
              <li key={f}>
                <a className={`popover-item${f === file ? " current" : ""}`} aria-current={f === file ? "page" : undefined}
                  href={`#/doc/${encodeURIComponent(f)}`} onClick={() => setOpen(false)}>
                  <span className="popover-title">{titles?.get(f) ?? f}</span>
                  <span className="muted popover-sub">{f}</span>
                </a>
              </li>
            ))}
          </ul>
          <a className="popover-item popover-foot" href="#/" onClick={() => setOpen(false)}>All maps…</a>
        </div>
      )}
    </div>
  );
}
