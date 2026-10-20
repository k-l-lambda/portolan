import { useEffect, useState } from "react";
import type { NodeState } from "../../src/derive.ts";
import type { Diagnostic, RhumbNode } from "../../src/types.ts";
import { api, READ_ONLY, type AnchorResponse, type Freshness } from "./api.ts";
import { absoluteTime, relativeTime, isoTime } from "./time.ts";
import { plainTitle, starred } from "./layout.ts";
import { StarIcon } from "./NodeCard.tsx";
import { CopyText } from "./CopyText.tsx";
import { renderMarkdown } from "./markdown.ts";
import { ProgressBar } from "./ProgressBar.tsx";
import { timingOf } from "../../src/timing.ts";
import { TimedWork, TimerChip, timerText, timingRecord, type TimedItem } from "./TimerChip.tsx";

interface Props {
  file: string;
  node: RhumbNode | null;
  state: NodeState | undefined;
  diagnostics: Diagnostic[];
  freshness: Freshness;
  now: number;
  onSelectLine: (line: number) => void;
  /** Frame what a diagnostic's line is about, as clicking a history point frames its nodes. */
  onFocusLine?: (line: number) => void;
  onStar: (node: RhumbNode) => void;
  /** Doing items with timing, most urgent first (shown with Diagnostics). */
  timed?: TimedItem[];
  /** Blocked items with what blocks them, in map order (shown with Diagnostics). */
  blocked?: BlockedItem[];
  /** Pointing at an item in those lists: the map highlights it, as pointing at its card does. */
  onHoverItem?: (key: string | null) => void;
  /** Reveal, select and center a node by key. */
  onGoTo?: (key: string) => void;
}

export function SidePanel({ file, node, state, diagnostics, freshness, now, onSelectLine, onFocusLine, onStar, timed = [], blocked = [], onGoTo, onHoverItem }: Props) {
  const focus = onFocusLine ?? onSelectLine;
  if (!node) {
    const lineOf = (key: string) => timed.find((t) => t.key === key)?.line ?? blocked.find((b) => b.key === key)?.line;
    return <DiagnosticsPanel diagnostics={diagnostics} freshness={freshness} now={now} onFocusLine={focus}
      timed={timed} blocked={blocked} onHoverItem={onHoverItem}
      onGoTo={onGoTo ?? ((key) => { const line = lineOf(key); if (line !== undefined) onSelectLine(line); })} />;
  }
  const updated = freshness.nodes.find((t) => t.line === node.line);
  const own = diagnostics.filter((d) => d.line === node.line || node.notes.some((n) => n.line === d.line));
  return (
    <aside className="panel" aria-label="Node details">
      <div className="panel-head">
        <p className={`status-pill status-${node.status ?? "todo"}`}>{node.status ?? "unknown"}</p>
        <button type="button" className={`star-toggle panel-star${starred(node) ? " on" : ""}`}
          aria-pressed={starred(node)} disabled={!node.id || READ_ONLY}
          title={node.id ? "Star or unstar (s)" : "Needs an ID to be starred"}
          onClick={() => onStar(node)}>
          <StarIcon filled={starred(node)} /> {starred(node) ? "Starred" : "Star"}
        </button>
      </div>
      <h2 className="panel-title" dangerouslySetInnerHTML={{ __html: renderMarkdown(node.title, true) }} />
      <p className="muted">
        {node.id ? <CopyText value={node.id} label={`^${node.id}`} className="node-id" /> : "no id"} · line {node.line}
        {state?.ready && <span className="badge badge-ready">ready</span>}
      </p>
      <ProgressBar progress={state?.progress ?? null} />
      {(() => {
        const t = timingOf(node, now);
        if (!t) return null;
        // Work in progress is compared with its estimate, a finished run shows what it took;
        // otherwise the values are only a record.
        const live = node.status === "doing" || t.closed;
        return (
          <dl className="fresh-info">
            <dt>Time</dt>
            <dd>{live ? <><TimerChip timing={t} /> {timerText(t)}</> : timingRecord(t)}</dd>
          </dl>
        );
      })()}
      {updated && (
        <dl className="fresh-info">
          <dt>Updated</dt>
          <dd>
            <time dateTime={isoTime(updated.time)} title={absoluteTime(updated.time)}>
              {relativeTime(updated.time, now)}
            </time>
            {" · "}
            {updated.source === "local" && "uncommitted change (file modified time)"}
            {updated.source === "link" && <>linked entry {updated.link!.date}</>}
            {updated.source === "children" && (
              <>newest child{" "}
                <button type="button" className="linkish" onClick={() => onSelectLine(updated.child!.line)}>
                  {updated.child!.id ? `^${updated.child!.id}` : `line ${updated.child!.line}`}
                </button>
              </>
            )}
            {updated.source === "commit" && updated.lineTime && <CommitRef sha={updated.lineTime.sha!} freshness={freshness} />}
          </dd>
          {(updated.source === "link" || updated.source === "children") && updated.lineTime && (
            <>
              <dt>{updated.lineTime.source === "local" ? "Line edited" : "Line committed"}</dt>
              <dd>
                <time dateTime={isoTime(updated.lineTime.time)} title={absoluteTime(updated.lineTime.time)}>{relativeTime(updated.lineTime.time, now)}</time>
                {" · "}
                {updated.lineTime.source === "local"
                  ? "uncommitted change (file modified time)"
                  : <CommitRef sha={updated.lineTime.sha!} freshness={freshness} />}
              </dd>
            </>
          )}
        </dl>
      )}
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
      {own.length > 0 && <DiagnosticList diagnostics={own} onFocusLine={focus} />}
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
          {data.line !== null
            ? ` · line ${data.line}${data.lineEnd !== null && data.lineEnd > data.line ? `-${data.lineEnd}` : ""}`
            : data.entryLine ? ` · line ${data.entryLine}` : data.heading ? ` · line ${data.heading.line}` : ""}
        </p>
      )}
      {data.diagnostics.map((d, i) => <p key={i} className="badge badge-warning">{d.code} {d.message}</p>)}
      {data.excerpt && (
        <div className="excerpt" dangerouslySetInnerHTML={{ __html: renderMarkdown(data.excerpt) }} />
      )}
    </details>
  );
}

function DiagnosticsPanel({ diagnostics, freshness, now, onFocusLine, timed, blocked, onGoTo, onHoverItem }: {
  diagnostics: Diagnostic[]; freshness: Freshness; now: number; onFocusLine: (line: number) => void;
  timed: TimedItem[]; blocked: BlockedItem[]; onGoTo: (key: string) => void; onHoverItem?: (key: string | null) => void;
}) {
  const at = (t: number) => (
    <time dateTime={isoTime(t)} title={absoluteTime(t)}>{relativeTime(t, now)}</time>
  );
  const c = freshness.lastCommit;
  return (
    <aside className="panel" aria-label="Document diagnostics">
      <h2 className="panel-title">Diagnostics</h2>
      <dl className="fresh-info">
        {freshness.dates === "links" ? (
          <>
            <dt>Dates</dt>
            <dd>from the dates of linked entries (<code>dates: links</code>); git history is not read</dd>
          </>
        ) : (
          <>
            <dt>Last commit</dt>
            <dd>
              {!freshness.repo ? "not in a git repository"
                : !freshness.tracked ? "not committed yet (untracked)"
                : c ? <>{at(c.time)} · <CopyText value={c.sha} label={c.sha.slice(0, 8)} className="sha" /> {c.summary}</> : "none"}
            </dd>
          </>
        )}
        <dt>File modified</dt>
        <dd>
          {at(freshness.mtime)}
          {freshness.tracked && (freshness.dirtyLines > 0
            ? ` · ${freshness.dirtyLines} uncommitted line${freshness.dirtyLines > 1 ? "s" : ""}`
            : " · no uncommitted changes")}
        </dd>
      </dl>
      {/* What cannot move first, then what is moving. */}
      {blocked.length > 0 && <BlockedWork items={blocked} onSelect={(i) => onGoTo(i.key)} onHover={onHoverItem} />}
      {timed.length > 0 && <TimedWork items={timed} onSelect={(i) => onGoTo(i.key)} onHover={onHoverItem} />}
      {diagnostics.length > 0 && (timed.length > 0 || blocked.length > 0) && <h3>Problems</h3>}
      {diagnostics.length === 0
        ? <p className="muted">No problems. Select a node to see its notes and diary links.</p>
        : <DiagnosticList diagnostics={diagnostics} onFocusLine={onFocusLine} />}
    </aside>
  );
}

/** One blocked item for the Diagnostics panel, with what its `blocked_by:` notes say blocks it. */
export interface BlockedItem {
  key: string;
  line: number;
  title: string;
  /** The reason as written (inline Markdown); null when the item has no `blocked_by:` note (W019). */
  reason: string | null;
}

/**
 * Blocked items, in map order, each with what blocks it. Clicking a row goes to the item, and
 * pointing at one highlights it in the map, as the in-progress list does. The reason is shown as
 * plain text: the row is a button, and a link inside it could not be followed.
 */
function BlockedWork({ items, onSelect, onHover }: {
  items: BlockedItem[]; onSelect: (item: BlockedItem) => void; onHover?: (key: string | null) => void;
}) {
  const missing = items.filter((i) => i.reason === null).length;
  return (
    <section className="blocked" aria-label="Blocked work">
      <h3>
        Blocked <span className="timed-count">{items.length}</span>
        {missing > 0 && <span className="blocked-flag">{missing === items.length ? "no reasons given" : `${missing} without a reason`}</span>}
      </h3>
      <ul className="timed-list" onPointerLeave={() => onHover?.(null)}>
        {items.map((i) => {
          const reason = i.reason === null ? null : plainTitle(i.reason) || "(empty reason)";
          return (
            <li key={i.key}>
              <button type="button" className={`blocked-row${reason === null ? " no-reason" : ""}`}
                title={reason === null ? "No blocked_by: note says what blocks this item" : `Blocked by: ${reason}`}
                onClick={() => onSelect(i)} onPointerEnter={() => onHover?.(i.key)} onFocus={() => onHover?.(i.key)} onBlur={() => onHover?.(null)}>
                <span className="timed-title">{i.title}</span>
                <span className="blocked-reason">{reason ?? "no blocked_by: note"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DiagnosticList({ diagnostics, onFocusLine }: { diagnostics: Diagnostic[]; onFocusLine: (line: number) => void }) {
  return (
    <ul className="diags">
      {diagnostics.map((d, i) => (
        <li key={i}>
          <button type="button" className={`diag diag-${d.level}`} onClick={() => onFocusLine(d.line)}>
            <span className="diag-code">{d.code}</span> line {d.line}: {d.message}
          </button>
        </li>
      ))}
    </ul>
  );
}

function CommitRef({ sha, freshness }: { sha: string; freshness: Freshness }) {
  return <>commit <CopyText value={sha} label={sha.slice(0, 8)} className="sha" /> {freshness.commits[sha]?.summary}</>;
}
