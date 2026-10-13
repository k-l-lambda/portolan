// Rows of a unified diff for the diff panel: file headers, hunk headers and lines with their old
// and new line numbers. Pure, so it can be tested without the view.

export interface DiffRow {
  kind: "file" | "hunk" | "add" | "del" | "ctx";
  /** The line without its leading marker (file and hunk rows keep their whole text). */
  text: string;
  /** Line number in the old file (removed and context lines). */
  old: number | null;
  /** Line number in the new file (added and context lines). */
  new: number | null;
}

export function parseUnified(diff: string): { rows: DiffRow[]; added: number; removed: number } {
  const rows: DiffRow[] = [];
  let a = 0, b = 0, added = 0, removed = 0;
  for (const line of diff.split("\n")) {
    if (line === "") continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      // A side with no lines names the line before the hunk, so numbering continues from it.
      a = Number(hunk[1]); b = Number(hunk[2]);
      if (/^@@ -\d+,0 /.test(line)) a++;
      if (/ \+\d+,0 @@/.test(line)) b++;
      rows.push({ kind: "hunk", text: line, old: null, new: null });
    } else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      rows.push({ kind: "file", text: line, old: null, new: null });
    } else if (line[0] === "+") {
      rows.push({ kind: "add", text: line.slice(1), old: null, new: b++ });
      added++;
    } else if (line[0] === "-") {
      rows.push({ kind: "del", text: line.slice(1), old: a++, new: null });
      removed++;
    } else {
      rows.push({ kind: "ctx", text: line.slice(1), old: a++, new: b++ });
    }
  }
  return { rows, added, removed };
}
