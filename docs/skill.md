---
name: rhumb
description: Record and maintain project work in a Portolan Rhumb (.rhumb) map - nodes, statuses, diary anchors, dependency edges, and the check/fmt/serve tooling.
---

# Maintaining a Rhumb map

A `.rhumb` file is the structural map of one project: work items, their status, hierarchy and relations. Details (what was tried, results, commands, decisions) live in the daily diary. The map links to diary entries and never copies them. Syntax source of truth: `docs/rhumb-spec.md` (0.1). Run commands from the portolan repo root.

## 1. When to update the map

Update the map in the same turn as the work, whenever:

- a new work item appears (planned, proposed, split off) → add a node
- an item starts, finishes, gets blocked or is abandoned → change its status
- you learn that one item depends on another → add an edge
- you finish a diary entry about an item → add an anchor note linking to it

Keep the map structural. A note is one line: a blocked reason, a key decision, a pointer. If you need more, write it in the diary and link to it.

## 2. Nodes

```
- [S] Title {attrs} ^id
```

| Status | Meaning |
| --- | --- |
| `[ ]` | todo, not started |
| `[/]` | doing, in progress |
| `[x]` | done |
| `[-]` | dropped, abandoned (keep the node) |
| `[!]` | blocked; add a note with the reason |
| `[?]` | idea, proposed but not committed |

- Always write a readable kebab-case ID matching `[a-z0-9][a-z0-9-]{0,47}`. Prefix child IDs with the parent's (`threads`, `threads-model`). Never write `^_xxxxxx`: the `_` prefix is reserved for IDs that `fmt` generates when a human omits one.
- IDs are permanent. Edges and threads reference them; change one only with `rename-id` (section 7).
- Attributes are optional: `owner`, `due` (ISO date), `tags` (list), `priority` (`high`/`normal`/`low`). Other keys are kept but reported as `I002`.
- Hierarchy is 2 spaces per level. A node's parent is the nearest preceding node with smaller indentation; siblings share one indentation.
- Notes are list items without a checkbox. They belong to the node above them and are not children. Use them for blocked reasons, short context and links.
- Titles are inline Markdown (code spans, links). A title that itself ends in `^word` or `{...}` must escape it as `\^` or `\{`.

```rhumb
- [/] Visual frontend {owner: claude, priority: high} ^ui
  - Read-only viewer first; editing goes through the server
  - [x] Renderer spike ^ui-spike
  - [!] Mind map view ^ui-tree
    - Blocked: renderer license review pending
  - [?] Dependency graph view {tags: [dag, xyflow]} ^ui-dag
  - [-] Canvas prototype ^ui-canvas
    - Dropped: the license requires a production key
```

## 3. Anchors

Every Markdown link in a node's title or notes is an anchor of that node. Prefer an anchor note over a link in the title.

- Define link prefixes in front matter `links:`; `{path}` is replaced and the result is relative to the `.rhumb` file. Then write `diary:2026/1008#frag`.
- Plain relative paths (`../notes/x.md#frag`) and `https://` URLs also work.
- The fragment is a GitHub heading slug (lowercase, punctuation removed, spaces → `-`). A unique prefix is enough: `#portolan` matches `## Portolan: agent-human shared mind map ...`.
- To point at one entry under the heading, append a text fragment: `#portolan:~:text=Backlog.md`. The resolver picks the first top-level list item under that heading whose lines contain the text. Choose a distinctive phrase from the entry's first line or summary.
- If the target contains spaces, wrap the whole target in `<...>`.
- When you write a diary heading, start it with a word no other heading in that day's file starts with, so a short prefix like `#rhumb-tooling` stays unique. An ambiguous prefix is `W003`.

```rhumb
---
rhumb: 0.1
title: Portolan
links:
  diary: ../{path}.md
---

- [x] [Prior-art survey](diary:2026/1008#portolan) ^survey
  - [Backlog.md analysis](<diary:2026/1008#portolan:~:text=Explain Backlog.md>)
  - [Backlog.md repo](https://github.com/MrLesk/Backlog.md)
- [x] Parser (Peggy) ^rhumb-parser
  - [parser record](<diary:2026/1008#rhumb-dsl:~:text=Parser: chose Peggy>)
```

## 4. Edges

```
a needs b, c: optional label
```

Edge lines start at column 0, reference IDs (no `^` needed) and can go anywhere in the body; convention is a `%%`-commented group after the tree.

| Kind | Use when | Affects readiness |
| --- | --- | --- |
| `needs` | a cannot finish (or start) before b is done | yes |
| `blocks` | same as `b needs a`; use only when the sentence reads better that way | yes |
| `relates` | any other relation; add a verb-phrase label for domain meaning (see below) | no |
| `replaces` | a supersedes b (usually b is `[-]`) | no |
| `from` | a was split off, followed up or derived from b | no |

- Do not add `needs`/`blocks` between a node and its own ancestor or descendant (`W005`); the hierarchy already says that.
- Never create a dependency cycle (`E009`). If two items depend on each other, split one or use `relates`.
- A label applies to every target on the line. Write one only when the reason is not obvious.
- Use `needs` only for execution order: a really cannot finish before b is done. Do not use it for "a is compared against b", "a uses b" or "a tests b".
- Domain relations are labeled `relates`, never new keywords. The label is a verb phrase and the edge reads source + label + target. A labeled `relates` is directed; an unlabeled one is not.

```rhumb
- [x] A0 baseline loss ^loss-a0
- [/] A1 forward KL ^loss-a1
- [ ] Shared fixed50 cohort ^cohort
- [?] LR/data-size mismatch ^lr-hypothesis

loss-a1 relates loss-a0: compared against
loss-a1 relates cohort: uses
loss-a1 relates lr-hypothesis: tests
```

```rhumb
- [/] Rhumb DSL ^rhumb
  - [x] Parser ^rhumb-parser
  - [ ] Edit operations API ^rhumb-edit
- [ ] Local server ^server
- [ ] Agent interface ^agent-api
- [-] Old JSON format ^json-format
- [ ] Sidecar thread format ^threads-format

%% dependencies
rhumb-edit needs rhumb-parser
server needs rhumb-edit, rhumb-parser: serves the AST and applies edits
agent-api needs rhumb-edit
agent-api relates server

%% provenance
rhumb replaces json-format
threads-format from server
```

## 5. Status discipline

- Parent status is written, not derived. When the first child starts, set the parent to `[/]` (otherwise `I003`).
- Do not mark a parent `[x]` while its subtree has `[ ]`, `[/]` or `[!]` nodes (`W007`). Finish, drop (`[-]`) or move the open children first.
- Do not mark a node `[/]` or `[x]` while one of its `needs` targets is not done (`W008`). Either finish the dependency, or the edge is wrong and should be removed or changed to `relates`.
- Use `[!]` only with a note that says what it is waiting for.
- Never delete abandoned work. Set it to `[-]` and add a note with the reason. A dependency on a dropped node is `W006` and no longer blocks readiness; retarget or remove that edge.
- `[?]` ideas do not count toward progress. Promote to `[ ]` when the work is committed.

## 6. Editing rules (minimal diffs)

- Change only the lines you mean to change. A status change is a one-character diff.
- One space between title, `{attrs}` and `^id`. Never align columns.
- Keep `%%` comments, blank lines and the existing order.
- Insert new nodes at the end of their sibling group unless order matters.
- Append new edges next to related edges (same `%%` group) or at the end of the file. Do not reorder edges.
- Re-read the file before editing; a human or the UI may have changed it.

## 7. Tooling

```sh
node src/cli.ts check <file>   # parse, derived and anchor diagnostics
node src/cli.ts fmt <file>     # in-place: assign missing IDs, normalize [X]→[x], [~]→[/]
node src/cli.ts serve <file> [--port N]   # local API on 127.0.0.1, default port 4310
```

- Run `check` after every edit. Output is `<file>:<line>: <level> <code> <message>`; exit code 1 means at least one error. Fix all errors and every warning you caused. `W003` for a diary that is not checked out is acceptable.
- `fmt` in 0.1 does only the two things above (it prints `assigned ^_xxxxxx` per ID). It does not re-indent, dedupe edges or collapse blank lines. Use it when a human left nodes without IDs; you should never need it for your own lines.

### Edit API (`serve`)

The server has no authentication and accepts only loopback `Host` headers. Get the current version, then post one operation:

```sh
v=$(curl -s http://127.0.0.1:4310/api/doc | jq -r .version)
curl -s -X POST http://127.0.0.1:4310/api/edit -H 'content-type: application/json' \
  -d "{\"version\":\"$v\",\"edit\":{\"op\":\"set-status\",\"id\":\"rhumb-fmt\",\"status\":\"done\"}}"
```

| `op` | Fields | Effect |
| --- | --- | --- |
| `set-status` | `id`, `status` | rewrites the checkbox only |
| `set-title` | `id`, `title` | rewrites the node line, keeps attrs and ID |
| `add-node` | `parent` (ID or `null`), `title`, `status?`, `id?` | inserts after the parent's subtree; ID defaults to a slug of the title, so pass a readable `id` |
| `remove-node` | `id`, `recursive?` | deletes the node, its notes and (with `recursive`) its subtree, plus edges touching them |
| `rename-id` | `id`, `to` | renames the ID and every edge reference; threads are retargeted |
| `add-edge` | `from`, `kind`, `to`, `label?` | appends one edge line at the end of the file |
| `remove-edge` | `from`, `kind`, `to` | removes that target from matching edge lines |

- `status` values are words: `todo`, `doing`, `done`, `dropped`, `blocked`, `idea`.
- `409` means the file changed since your `version`; re-fetch `/api/doc` and retry. `400` means the edit is invalid or would introduce a new error.
- The response is `{version}` plus `id` (add-node), `renamed` or `removed` when relevant.
- The API cannot add notes, attributes or anchors, and `move-node` is not implemented. Make those edits by hand. The server watches the file, so hand edits show up in the UI.
- Prefer `set-status dropped` over `remove-node`.

### Threads

Human/agent discussion threads live in the sidecar `<name>.threads.jsonl` next to the `.rhumb` file (append-only, one event per line). Never write discussion into the `.rhumb` file. Use `GET /api/threads?status=open` to list open threads (`orphan: true` means the target node is gone) and `POST /api/threads` with `{action: "open"|"reply"|"resolve"|"reopen", ...}` to write. Renaming an ID by hand instead of with `rename-id` orphans its threads.

## 8. Worked example

You finish work and write this diary entry in `2026/1009.md`:

```markdown
## Rhumb tooling: fmt and edit API

* > [host][portolan] Implement `rhumb fmt` and the edit operations API
	<details>
	<summary>fmt assigns IDs and normalizes status aliases; edit API started</summary>

	* fmt 0.1 subset only; the full CST printer (re-indent, edge dedup) is postponed
	* edit API: set-status, add-node, add-edge work; move-node not started
	</details>
```

Map before (`memo/portolan.rhumb`):

```rhumb
---
rhumb: 0.1
title: Portolan
links:
  diary: ../{path}.md
---

- [/] Rhumb DSL ^rhumb
  - [x] Parser (Peggy) ^rhumb-parser
    - [parser record](<diary:2026/1008#rhumb-dsl:~:text=Parser: chose Peggy>)
  - [ ] Formatter `rhumb fmt` ^rhumb-fmt
  - [ ] Edit operations API ^rhumb-edit

%% Rhumb tooling
rhumb-fmt needs rhumb-parser
rhumb-edit needs rhumb-fmt
```

Updates: `rhumb-fmt` → done with an anchor to the entry; `rhumb-edit` → doing (allowed now that `rhumb-fmt` is done); the postponed work becomes a new node under `rhumb`, linked to its origin with `from`.

```diff
@@ -8,9 +8,13 @@
 - [/] Rhumb DSL ^rhumb
   - [x] Parser (Peggy) ^rhumb-parser
     - [parser record](<diary:2026/1008#rhumb-dsl:~:text=Parser: chose Peggy>)
-  - [ ] Formatter `rhumb fmt` ^rhumb-fmt
-  - [ ] Edit operations API ^rhumb-edit
+  - [x] Formatter `rhumb fmt` ^rhumb-fmt
+    - [fmt record](<diary:2026/1009#rhumb-tooling:~:text=fmt assigns IDs>)
+  - [/] Edit operations API ^rhumb-edit
+  - [ ] Full CST printer for fmt ^rhumb-fmt-cst
+    - Re-indent, edge dedup, blank-line collapsing
 
 %% Rhumb tooling
 rhumb-fmt needs rhumb-parser
 rhumb-edit needs rhumb-fmt
+rhumb-fmt-cst from rhumb-fmt
```

Then run `node src/cli.ts check memo/portolan.rhumb`: no output, exit 0. If the diary repo is not checked out, the anchors report `W003` only.

## 9. Common mistakes

| Mistake | Code | Fix |
| --- | --- | --- |
| Unknown checkbox, e.g. `[>]` | `E002` | use one of the six statuses |
| Duplicate `^id` | `E003` | pick a new readable ID |
| Dedent to a level that was never opened, odd indentation | `E004` | 2 spaces per level, align siblings |
| `foo:` link prefix missing from front matter | `E005` | add it under `links:` |
| Edge to a typo or missing ID | `E007` | check the ID exists |
| Unknown edge kind (`a depends b`, `a compares b`) | `E008` | use needs/blocks/relates/replaces/from; put domain meaning in a `relates` label |
| Indented edge line, or prose at column 0 | `E001` | edges at column 0; prose goes in a note |
| `a needs b` plus `b needs a` | `E009` | break the cycle |
| Node without a title | `E011` | write a title |
| Note at top level | `W001` | put it under a node |
| Node indented under a note | `W002` | indent it under the node instead |
| Missing diary file, heading, ambiguous prefix, text not found | `W003` | fix the link or the heading |
| Same edge twice | `W004` | delete the duplicate |
| `needs` between parent and descendant | `W005` | remove it |
| `needs` a dropped node | `W006` | retarget or remove the edge |
| `[x]` parent with open children | `W007` | close or drop the children first |
| `[/]`/`[x]` node whose `needs` target is not done | `W008` | fix the status or the edge |
| `^Upper_Case` or `^_handmade` ID | `W009` | lowercase kebab-case, no leading `_` |
| `[ ]` parent with started children | `I003` | set the parent to `[/]` |

This file triggers `W005`, `W006`, `W007`, `W008` and `I003`:

```rhumb
- [x] Release 1.0 ^release
  - [ ] Write changelog ^changelog
- [/] Deploy ^deploy
  - [ ] Smoke test ^smoke
- [ ] Docs ^docs
  - [/] API reference ^docs-api
- [-] Old installer ^old-installer

deploy needs changelog
deploy needs smoke
docs needs old-installer
```
