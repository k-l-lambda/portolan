import { useEffect, useState } from "react";
import type { NodeState } from "../../src/derive.ts";
import type { Diagnostic, RhumbNode } from "../../src/types.ts";
import { api, type AnchorResponse } from "./api.ts";
import { renderMarkdown } from "./markdown.ts";
import { ProgressBar } from "./ProgressBar.tsx";

interface Props {
  file: string;
  node: RhumbNode | null;
  state: NodeState | undefined;
  diagnostics: Diagnostic[];
  onSelectLine: (line: number) => void;
}

export function SidePanel({ file, node, state, diagnostics, onSelectLine }: Props) {
  if (!node) return <DiagnosticsPanel diagnostics={diagnostics} onSelectLine={onSelectLine} />;
  const own = diagnostics.filter((d) => d.line === node.line || node.notes.some((n) => n.line === d.line));
  return (
    <aside className="panel" aria-label="Node details">
      <p className={`status-pill status-${node.status ?? "todo"}`}>{node.status ?? "unknown"}</p>
      <h2 className="panel-title" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.title, true) }} />
      <p className="muted">
        {node.id ? `^${node.id}` : "no id"} · line {node.line}
        {state?.ready && <span className="badge badge-ready">ready</span>}
      </p>
      <ProgressBar progress={state?.progress ?? null} />
      {Object.keys(node.attrs).length > 0 && (
        <dl className="attrs">
          {Object.entries(node.attrs).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd></div>
          ))}
        </dl>
      )}
      {node.notes.length > 0 && (
        <section>
          <h3>Notes</h3>
          <ul className="notes">
            {node.notes.map((n) => (
              <li key={n.line} style={{ marginLeft: `${n.depth}rem` }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(n.text, true) }} />
            ))}
          </ul>
        </section>
      )}
      {node.anchors.length > 0 && (
        <section>
          <h3>Links</h3>
          {node.anchors.map((a, i) => <AnchorView key={`${node.line}:${i}`} file={file} line={node.line} index={i} />)}
        </section>
      )}
      {own.length > 0 && <DiagnosticList diagnostics={own} onSelectLine={onSelectLine} />}
    </aside>
  );
}

/** One anchor: resolves on demand and shows the diary excerpt it points at. */
function AnchorView({ file, line, index }: { file: string; line: number; index: number }) {
  const [data, setData] = useState<AnchorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.anchor(file, line, index).then((r) => live && setData(r), (e) => live && setError(String(e.message)));
    return () => { live = false; };
  }, [file, line, index]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Resolving…</p>;
  const where = data.url ?? data.file;
  return (
    <details className="anchor" open={index === 0}>
      <summary>
        <span className="anchor-text">{data.anchor.text}</span>
        <span className="muted anchor-target">{data.anchor.target}</span>
      </summary>
      {where && (
        <p className="muted anchor-where">
          {data.url ? <a href={data.url} target="_blank" rel="noopener noreferrer">{data.url}</a> : where}
          {data.entryLine ? ` · line ${data.entryLine}` : data.heading ? ` · line ${data.heading.line}` : ""}
        </p>
      )}
      {data.diagnostics.map((d, i) => <p key={i} className="badge badge-warning">{d.code} {d.message}</p>)}
      {data.excerpt && (
        <div className="excerpt" dangerouslySetInnerHTML={{ __html: renderMarkdown(data.excerpt) }} />
      )}
    </details>
  );
}

function DiagnosticsPanel({ diagnostics, onSelectLine }: { diagnostics: Diagnostic[]; onSelectLine: (line: number) => void }) {
  return (
    <aside className="panel" aria-label="Document diagnostics">
      <h2 className="panel-title">Diagnostics</h2>
      {diagnostics.length === 0
        ? <p className="muted">No problems. Select a node to see its notes and diary links.</p>
        : <DiagnosticList diagnostics={diagnostics} onSelectLine={onSelectLine} />}
    </aside>
  );
}

function DiagnosticList({ diagnostics, onSelectLine }: { diagnostics: Diagnostic[]; onSelectLine: (line: number) => void }) {
  return (
    <ul className="diags">
      {diagnostics.map((d, i) => (
        <li key={i}>
          <button type="button" className={`diag diag-${d.level}`} onClick={() => onSelectLine(d.line)}>
            <span className="diag-code">{d.code}</span> line {d.line}: {d.message}
          </button>
        </li>
      ))}
    </ul>
  );
}
