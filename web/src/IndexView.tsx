import { useCallback, useEffect, useState } from "react";
import { api, onServerEvents, type FileSummary } from "./api.ts";
import { ProgressBar } from "./ProgressBar.tsx";

export function IndexView() {
  const [files, setFiles] = useState<FileSummary[] | null>(null);
  const [root, setRoot] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.files().then((r) => (setFiles(r.files), setRoot(r.root), setError(null)), (e) => setError(String(e.message)));
  }, []);

  useEffect(() => {
    load();
    return onServerEvents({ change: load, files: load, reconnect: load });
  }, [load]);

  if (error) return <main className="page"><p role="alert" className="error">{error}</p></main>;
  if (!files) return <main className="page"><p className="muted">Loading…</p></main>;

  return (
    <main className="page">
      <h1>Maps</h1>
      <p className="muted">{root}</p>
      {files.length === 0 && <p className="muted">No .rhumb files found under this directory.</p>}
      <ul className="file-list">
        {files.map((f) => (
          <li key={f.file}>
            <a className="file-card" href={`#/doc/${encodeURIComponent(f.file)}`}>
              <span className="file-title">{f.title ?? f.file}</span>
              <span className="muted file-path">{f.file}</span>
              <ProgressBar progress={f.progress.total > 0 ? f.progress : null} />
              <span className="file-meta">
                {f.nodes} nodes
                {f.errors > 0 && <span className="badge badge-error">{f.errors} errors</span>}
                {f.warnings > 0 && <span className="badge badge-warning">{f.warnings} warnings</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
