# Changelog

How Portolan was built, entry by entry, copied from the development diary. Each entry is one
piece of work: its outcome as the heading, then what was done, the decisions, the problems and
how they were checked. Commit hashes refer to this repository. The project map
[demo/portolan.rhumb](demo/portolan.rhumb) links into this file.

## 2026-10-08

### No single project covers the whole scope; closest pieces are Beads/Backlog.md (agent task graph), Plannotator (annotate→agent feedback), simple-mind-map/Mind Elixir/markmap (mind map UI), tldraw agent kit (canvas+agent chat)

* Agent-native task stores (data layer):
  - `gastownhall/beads` (27.7K★, MIT): dependency-graph issue tracker for agents (Dolt, hash IDs, `bd ready`, epics `bd-a3f8.1.1`, `relates-to/supersedes/replies-to`, threaded messages, compaction). Viewers: `Dicklesworthstone/beads_viewer` (TUI, DAG/critical path/kanban), `mgalpert/beads-viewer` (web).
  - `MrLesk/Backlog.md` (7.0K★, MIT): tasks as plain Markdown in git, milestones + dependencies, acceptance criteria, implementation plan in the task, CLI + MCP + web Kanban (`backlog browser`). Closest to the "markdown + diary" style of this repo.
  - `BloopAI/vibe-kanban` (28.3K★, Apache-2.0), `eyaltoledano/claude-task-master` (28.2K★, custom license): orchestration/kanban, no mind map.
* Annotation ↔ agent dialogue: `backnotprop/plannotator` (9.2K★): browser review of plans/markdown/HTML/diffs via agent hooks; comments sent back to Claude Code/Codex/Kiro etc. Closest to "talk to the agent inside annotations", but review-per-turn, not a persistent map.
* Mind map frontends: `wanglin2/mind-map` (simple-mind-map, 12.8K★, MIT; notes, todo, tags, summary nodes, associative lines, export Mermaid/Markdown/XMind; client/plugins closed), `SSShooter/mind-elixir-core` (3.2K★, MIT, framework-agnostic), `markmap/markmap` (13.1K★, MIT, Markdown→mind map, read-mostly). Mind-map MCP servers exist (`wanglin2/mind-map-mcp` etc.) but are generators only.
* Canvas + agent: `tldraw/tldraw` `templates/agent` (agent chat panel, agent edits shapes, keeps its own todo list). tldraw license requires a license key for production use. `excalidraw/excalidraw-mcp` (5.5K★). `obsidianmd/jsoncanvas` = open canvas file format.
* DSL: Mermaid `mindmap` (no edge/status semantics beyond tree), D2 (MPL-2.0, containers + edges + classes), PlantUML mindmap/WBS. None has task-status/dependency/anchor semantics natively → a custom DSL compiled to an existing renderer is the realistic route.
* Suggested assembly: Beads or Backlog.md-like store (or own Markdown/YAML DSL) as source of truth → render with simple-mind-map/Mind Elixir (tree) + React Flow/xyflow (MIT, cross-links/DAG) → annotation threads stored next to nodes, exposed to agents via MCP/CLI → node `anchor:` fields linking to `yyyy/mmdd.md#heading`.
* Search-tool notes: native WebSearch returned fabricated, source-less results in this network (discarded). Bing CN MCP ignores `site:`/quotes and returns dictionary/shopping noise for English tech names. `gh search repos` / `gh api repos/<r>/readme` via `HTTPS_PROXY=http://localhost:1091` was the reliable channel.

### Yes: one task per file with YAML front matter + fixed `##` sections wrapped in HTML-comment markers; CLI is the canonical writer, hand edits discouraged

* Design (from `MANIFESTO.md`): humans and agents are equal users of one Markdown task model; loop `capture intent → review scope → plan → review → execute → verify → preserve record`; three human checkpoints (spec/AC, implementation plan, code); one task = one agent session = one PR; completed tasks stay in git as history. Surface hierarchy: CLI canonical, CLI instructions = agent workflow, TUI/Web/MCP are views over the same semantics.
* Layout: `backlog/{tasks,drafts,completed,archive,milestones,decisions,docs}/` + `config.yml` (statuses, DoD defaults, `task_prefix`). Filename `back-702 - Title-With-Dashes.md`.
* Task file: YAML front matter (`id, title, status, assignee, created_date, updated_date, labels, dependencies, references, type, ordinal`, optional `parent`, `milestone`, `priority`) + sections `## Description / Acceptance Criteria / Definition of Done / Implementation Plan / Implementation Notes / Final Summary`, each body fenced by markers like `<!-- SECTION:PLAN:BEGIN -->…END`, `<!-- AC:BEGIN -->`, checklist items `- [x] #1 …`. Comments are append-only with author (`--comment … --comment-author @sara`).
* Dependency graph and readiness (`isReady`, `blockingDependencies`) are derived at read time, not stored. Milestones/decisions/docs use lighter front matter + free body.
* Fit for our mind-map idea: good reference for data model + human checkpoints; but kanban/list-centric (no graph/mind-map view; architecture map via separate Groma.md), comments are flat (not node-anchored threads), and the rigid per-task-file format does not match our one-file-per-day diary.

### Tentatively named **Portolan** (project) + **Rhumb** (graph DSL, `.rhumb`)

* Rationale: a portolan chart was drawn from sailors' logbooks, with rhumb lines connecting ports, i.e. a map that grows out of logs. That matches "mind map + task log"; rhumb lines map to links between work items.
* Collision check (npm + GitHub repo names only; trademark/domains NOT checked): npm `portolan` taken by an unrelated 0.1.0 package (modified 2026-08-11), so publish under a scope (`@<scope>/portolan`); GitHub `portolan` hits are geospatial/transit tools. npm `rhumb` 0.0.1 taken, `rhumbline` free.
* Other shortlisted: Jingluo 经络 (经 = main work items, 络 = relations, 穴位 = diary anchors), Gangmu 纲目, Mindtrail, Comind, Coplot.
* Avoid (same-domain clashes): `weft` (jonesphillip/weft = AI-agent task management), Trellis / Cairn (AI-agent repos 14.9K★ / 3.3K★), Plait (plait-board/drawnix 14.9K★ whiteboard with mind map), Mailuo 脉络 (hwy11/mailuo: mind map with a local agent interface, 0★ but same idea), Ariadne / Wayfinder / Threadmap.
* Prior-art additions found during the check, worth a look later: [plait-board/drawnix](https://github.com/plait-board/drawnix) (open-source whiteboard incl. mind map/flowchart), [hwy11/mailuo](https://github.com/hwy11/mailuo).

### Rhumb 0.1 spec written, Peggy-based parser passes 17 tests; committed as portolan `ebeb107`

* User decisions: readable `^id` by default, generated hash only when omitted; independent Markdown-like syntax (not a strict Markdown subset); diary linkage written on the Rhumb side; one `.rhumb` file per project (cross-file `file^id` reserved); no Obsidian compatibility goal; repo docs in English. Guiding rule from the user: stay close to syntax LLMs already know.
* Syntax (`docs/rhumb-spec.md`): YAML front matter (`rhumb`, `title`, `links: {diary: ../diary-job/{path}.md}`); nodes are GFM task lists `- [ ] Title {owner: x} ^id`; statuses `[ ] [/] [x] [-] [!] [?]` (aliases `[X]`, `[~]`); checkbox-less list items are notes, not children; anchors are plain Markdown links `[t](diary:2026/1008#slug)` with unique slug prefixes and `:~:text=` entry locators; `%%` comments; edges are column-0 English sentences `a needs b, c: label` with kinds `needs/blocks/relates/replaces/from` (no `-->`, its direction is ambiguous for dependencies). Generated IDs are `^_` + 6 base32 chars, random, not title-derived. `fmt` does no column alignment so one edit stays a one-line diff.
* Example: `examples/portolan.rhumb` holds the project's own plan and links to this diary file via `#portolan`. This new heading deliberately does not start with "Portolan", otherwise that prefix anchor would become ambiguous (`W003`).
* Parser: chose Peggy 5.1.0 over Jison (last release 0.4.18, unmaintained). `src/grammar.peggy` classifies single lines and scans inline links (skips images and code spans); `src/parse.ts` reads front matter (yaml 2.9.1), builds the tree by indentation (tab = 4 columns), strips trailing `^id` then `{attrs}`, classifies anchors, and checks edges (unknown ID, self-edge, duplicate, `needs/blocks` cycle, parent-descendant dependency). Added diagnostic codes during implementation: `W009` invalid `^token`, `E011` empty title, `E012` front matter error, `E013` unsupported version.
* Tests: `tests/cases/*.rhumb` + `.expect.json` (14 cases: tree, statuses, IDs, duplicates, attrs, notes, anchors, edges, cycle, indentation, front matter x3, invalid lines). AST compared as a subset with exact array lengths; diagnostics compared exactly as `[code, line]`. Plus CRLF, default title and example-file tests. `pnpm test` → 17/17 passed, `tsc --noEmit` clean.
* Trouble: `npm install` failed with `npm error Cannot read properties of null (reading 'edgesOut')` (npm 10.9.4 arborist `#loadPeerSet`, triggered by vitest 5.0.1 peer deps). Switched to pnpm 10.23.0 (`HTTPS_PROXY=http://localhost:1091 pnpm install`), lockfile `pnpm-lock.yaml`. One fixture failed first because the example generated ID `_k3f9q2` contains `9`, which is not base32; fixed the fixture/spec to `_k3f7q2`, the parser was right.
* Pinned deps (each release ≥ 2 weeks old): peggy 5.1.0, yaml 2.9.1, vitest 5.0.1, typescript 6.0.3, @types/node 22.20.4.
* Not done yet: `rhumb fmt` (CST, ID generation/write-back), `rhumb check` (resolve anchors against files, progress/readiness/consistency `W006–W008`, `I003`). No remote configured for portolan.

### Keep the current task-graph foundation; prioritize cross-file references and a small set of semantic node and relation types as real usage exposes gaps.

**Assessment.** Rhumb's hierarchy, statuses and five relations already cover most work organization: containment, execution dependencies (`needs`/`blocks`), provenance (`from`), supersession (`replaces`) and general association (`relates`). The Camelot map exposes a different need: representing experimental controls, shared inputs, hypotheses and evidence. Free-text labels can describe these today, but do not let tools reliably distinguish their meaning.

Concrete examples: A1 is a controlled comparison against A0, not merely work derived from it; A0/A1/A3 share data, initialization and update budgets; RW05 provides bounded evidence for a treatment rather than a universal causal conclusion; learning-rate/data-size mismatch is a hypothesis rather than an ordinary task. Conversely, scoring completion and independent acceptance are already expressible as separate tasks, so that case does not require another status.

**Proposed extensions, not implemented syntax:**

- Optional node types such as `kind: task / experiment / artifact / hypothesis / finding`, retaining the common node structure. Task completion must remain distinct from confidence in a claim: marking an investigation done must not imply its hypothesis is true. The current spec does not define these types; their semantics and diagnostics would require an explicit design change.
- A small set of typed, non-blocking relations, with candidate names such as `compares`, `uses` and `tests`. These could make controls, shared artifacts and hypothesis-testing explicit without affecting readiness. Define a small standard vocabulary first, then decide whether custom relation types are justified; do not add a keyword for every incidental relationship. The names are design candidates, not commands accepted by the current parser.
- Cross-file references through stable node IDs. Training, data preparation, deployment and evaluation maps could reference the same model, dataset or protocol without duplicating its identity and status. This is more valuable than adding more status symbols; the current reserved cross-file syntax is not yet supported.

**Keep out of scope for now.** Do not turn Rhumb into a conditional workflow engine, metric query language or full experiment-configuration format. Tables, formulas, raw results and detailed evidence remain in diary/project artifacts; the map organizes their relationships. Semantic types should not be presented as proof that two experiments are scientifically comparable without checking the underlying evidence.

**Recommended sequence.** Organize a broader range of real diary work with the current grammar, record recurring meanings hidden in `relates` notes, then prioritize cross-file references and a few well-defined node/relation types. Preserve readability, stable IDs, small diffs and easy human/agent maintenance. These recommendations are research proposals; this diary update does not authorize or claim parser implementation.

### Edit API, derive, anchor resolver, threads store, local server and CLI landed as portolan `5a0a5d5`; agent guide and README written by subagents

* `memo/portolan.rhumb` is the live project map (diary + `repo:` link prefixes). Annotations are a sidecar, never inside the `.rhumb`: append-only `<name>.threads.jsonl` with `open/reply/resolve/reopen/retarget` events; how human comments reach the agent (polling, MCP or hook) stays an open interface.
* `src/edit.ts`: set-status, set-title, add/remove node, rename-id, add/remove edge. Rewrites only affected lines, keeps comments and CRLF, re-parses and rejects edits that add errors; `move-node` is reserved. `src/format.ts` (`fmt` subset: generate missing IDs, normalize `[X]`/`[~]`), `src/derive.ts` (progress, readiness, W006-W008, I003), `src/resolve.ts` (link → file, heading, entry line, excerpt; W003).
* `src/server.ts`: loopback-only HTTP API with version-checked edits (409 on stale), SSE pushes, Host-header check against DNS rebinding, body/file size caps. No authentication; do not bind it elsewhere.
* Switched to `.ts` import specifiers so Node 22 runs sources directly (`node src/cli.ts check|fmt|serve`).
* `docs/skill.md` (agent guide; every example checked with `check`) and `README.md` (motivation and vision) were written by background subagents.
* Trouble: a server test expected 403 for `host: evil.example` but got 200. Cause: `fetch()` silently drops a custom `Host` header. Fixed by sending that request with `node:http`.

### React + Vite + xyflow map view with status editing and a diary panel; directory-mode server; portolan `d2ce447`

* User choices (asked via askme): React + Vite + xyflow; first version = mind map with status editing + diary panel (no annotation UI, no structural editing).
* Index of all `.rhumb` under the root (skips `node_modules`, `.git`, dot-dirs); mind map with roots on the left, status/progress cards, typed cross edges, collapse; status `<select>` writes through the edit API; side panel with notes, attrs, diagnostics and the resolved diary excerpt (marked + DOMPurify). `file` params cannot leave the root; static files cannot leave `web/dist`; CSP `default-src 'self'`.
* Trouble 1: user saw the page stuck at loading on `:4310`. Nothing was listening there (my test server had used another port). The user works over SSH from 192.168.111.234, and the server binds to 127.0.0.1 only, so the browser needs VS Code port forwarding or `ssh -L 4310:127.0.0.1:4310`.
* Trouble 2: `google-chrome --headless --screenshot --virtual-time-budget` hung forever (killed by timeout, exit 144); the open SSE connection keeps virtual time from finishing. Driving Chrome through the DevTools protocol (`--remote-debugging-port`, `Page.navigate`, `Runtime.evaluate`) worked, and DOM probes replaced screenshots (the saved PNG could not be viewed).
* Trouble 3: `npm` still crashes on install (see the Rhumb parser entry); all installs use pnpm.

### Keep the five general edge kinds; domain relations are verb-phrase labels on a directed `relates`; portolan `7a2ade5`

* Promotion test for a keyword: recurs across unrelated domains, tools must treat it differently, and the meaning is hard to confuse. `needs/blocks` (readiness, cycles), `replaces`, `from` and `relates` pass; `compares`, `uses`, `tests` do not and become labels.
* Spec 5.1: the edge reads source + label + target; a labeled `relates` keeps its direction (duplicates match on direction and label), an unlabeled one stays undirected; `needs` is only for execution order. The web view draws labeled relates with an arrow.
* The Camelot map used `camelot-loss-a1/a2/a3 needs camelot-loss-a0` for controls; rewritten as `relates camelot-loss-a0: 对比基线`. No readiness changed because A0 was done. Five unlabeled `camelot-next-*` relates were left for the map's maintainer.

### Status-tinted cards, default collapse, `^…-suffix` IDs; portolan `fb6b7b6`

* Subtrees with no `doing` node anywhere below start collapsed; user toggles override the default, "Reset view" restores it, jumping to a diagnostic reveals the node.
* Trouble: the first version used CSS `direction: rtl` to clip IDs from the start. Bidi reordering moved `^` and `…` to the end of the text (user report). My probe only compared `textContent`, which was correct, so it missed the bug. Fixed by truncating in JS (parent prefix stripped only at a `-`/`_` boundary, then keep the last 12 characters); verified by measuring glyph x-positions of all 64 IDs in headless Chrome.

### Per-directory watchers plus a 2 s rescan; recreated files no longer go silent; portolan `05b336e`

* Trouble: after `rm a.rhumb; printf ... > a.rhumb` (how many editors save), Node 22's `fs.watch(dir, {recursive: true})` on Linux reported nothing for that file again, not even later in-place writes. Reproduced with an SSE client and timestamped steps.
* Fix: one non-recursive watcher per directory, synced as directories appear/disappear, plus a 2 s rescan using an mtime/size shortcut. `change` now also fires for recreated files; `files` fires when the set changes.
* Client: keeps collapse state and selection, drops out-of-order responses, keeps the last good version on read errors, refetches after SSE reconnect, shows "updated hh:mm". `tests/hotreload.test.ts` covers in-place, atomic rename, delete-recreate, edits after recreate, new subdirectory and delete; checked live in Chrome.
* Limitation: diary files are outside the served root, so an open excerpt refreshes only when the map changes.

### Freshness view from git blame, dated links and child nodes; portolan `7981b47`, `4a5bdc1`

* `src/history.ts`: `git blame --line-porcelain` on the working tree; lines with the zero SHA are uncommitted and dated by file mtime (git reports "now" for them); untracked files and files outside a repo are all local. Cached per content, mtime and HEAD; the server polls HEAD and emits a `history` event after commit/checkout/pull. `GIT_OPTIONAL_LOCKS=0` so polling does not fight other sessions' commits.
* Border: 5px, full status color within an hour, fading on a log scale to 90 days; re-rendered every minute. Panel shows file last commit, mtime and uncommitted line count; selected node shows its time and source.
* Rules: latest dated link (`2026/1008`, `2026-10-08`, `2026/10/08`; bare 8-digit numbers are not dates) on an earlier local calendar day than the line's time → end of that day; a link-less node with children → newest child, bottom-up. Notes are not children.
* Trouble: user reported link dates not taking effect. The server had restarted with the new code, but my first rule skipped links for uncommitted lines; the other session had 154 uncommitted lines in `camelot-training.rhumb`, so 27 nodes linking to July-September entries stayed brightest. Applied the link rule to uncommitted lines too: 29 Camelot nodes now use linked dates, 11 group nodes use their newest child.
* Trouble: my test fixtures wrote `^id` before a trailing link, so the parser kept it in the title (IDs must end the line); earlier tests passed only because they did not check IDs. Fixed the fixtures.
* Restarting `:4310` with `pkill -f "cli.ts serve …"` also killed the shell running the command (its own command line matched), exit 144; stop the server by PID from `ss -ltnp` instead.
* 50 tests pass. Limitation: all uncommitted lines in a file share its mtime.

## 2026-10-09

### Hover focus (portolan `c3c86c2`, 10-08 evening), then nested containers laid out by ELK (`3b74937`)

* Hover/select a node: its edges and endpoint cards stay, everything else dims; hover an edge: only that edge. Cross-edge labels are hidden unless focused ("All edge labels" toggle); a label shared by a multi-target line shows once per source.
* Layout options offered via askme: nested containers + ELK (chosen), timeline view, both, or tweak the old mind map. Libraries checked: elkjs 0.12.0 (EPL-2.0 OR GPL-3.0), @dagrejs/dagre 3.1.1 (MIT), d3-dag 1.2.2 (MIT).
* Containers follow Mermaid/D2 subgraphs: a node with expanded children is a frame, so tree edges disappear; ELK `layered`, `INCLUDE_CHILDREN`, orthogonal routing; rounded polylines from ELK bend points. Edges between a container and its own descendant are dropped; same-kind edges folded onto one visible pair become one route (`relates ×4`; Camelot default view 47 → 39 routes). Frame interiors pass the mouse through (`pointer-events: none !important`, because xyflow sets pointer-events inline), only the header is clickable.
* Measured on the real maps: no route passes through a card in any view.

### Top-to-bottom layout: prerequisites above dependents; siblings stack done work by day, then doing, todo, ideas

* The first ELK version ran left to right and only used time for sibling order (answering "is the timeline horizontal?": no).
* Sibling order is enforced with invisible ordering edges between consecutive rows (Mermaid `~~~` trick). Rows come from a band (done/dropped by local day, then doing/blocked, todo, idea), pushed below every sibling they depend on, with dependencies lifted to the pair of siblings under the endpoints' common ancestor.
* Trouble: 8 dependency edges in the Camelot map still pointed upward and groups such as `next` floated above the history. Debug showed the computed rows were right; ELK reversed the ordering edges. ELK treats every edge as directed, including `relates`, so relates edges plus ordering edges formed cycles. Experiments: `elk.layered.priority.direction` 10 vs 1 does decide a 2-node cycle under the default cycle breaker, but `MODEL_ORDER` and `INTERACTIVE` cycle breaking ignore it.
* Fix: hand every edge to ELK oriented along one global order (rows from the root down, compared where the two ancestor chains split) and flip the drawn route back to the Rhumb direction. Result: Camelot groups now read origin, bringup, design, scale, parity, offline, fit, methods (done, by date), then next, loss, eval (doing). 3 edges stay inverted because `loss` and `eval` depend on each other, which nested siblings cannot satisfy.

### Labels are placed along their own edge and drawn in an HTML layer above all edges; portolan `1089f0f`

* Cause 1: every label sat at the middle of its longest segment, so parallel edges put labels at the same height. `placeLabels` now slides each label along its edge to the nearest spot clear of placed labels (then other highlighted lines, then cards; hovered edge first) and moves it beside the line on edges too short to slide along. Widths measured with canvas `measureText`, capped at 260px with ellipsis.
* Cause 2 (camelot-eval-loss): labels did not overlap each other; later edges drew their lines across earlier labels, because each label lived in its own edge's SVG group. Labels now go through `EdgeLabelRenderer` (HTML layer, `z-index: 20`) with an opaque background and a border in the edge color.
* Debugging notes: after "Expand all" the hover probe saw nothing until the view was re-fitted (`.react-flow__controls-fitview`); a first "labels covered" count was wrong because labels have `pointer-events: none`, so `elementFromPoint` skipped them; my own label was also counted as a line under itself until labels carried `data-edge`.
* Expanded Camelot, hovering eval-loss / loss-compare / eval-p30 / loss-seeds: 0 overlapping label pairs, all labels on top; 2 lines still pass under loss-seeds labels in a tight bundle, masked by the label background.

### Shared reserved attribute `{star: true}`, a general `set-attr` edit op and a dedicated star UI; portolan `e39fff9`

* Options compared: attribute, tag, title emoji, `[*]` checkbox (conflicts with status), separate statement, front-matter list. User choices via askme: shared in the `.rhumb` (not per user), named `star`.
* Syntax: reserved boolean attribute; unstar by removing the key; other values are `W010` and count as not starred (spec 3.3, skill.md: agents star only when asked). `set-attr {id, key, value}` (`null` removes; for star, `false` removes) rewrites only that line and keeps its own list marker and status symbol; `set-title` now uses the same rewrite.
* UI: star toggle on cards and in the panel, `s` shortcut, gold frame, starred nodes and their ancestors never collapse by default, `★n` on collapsed cards, "Starred" menu that expands, selects and centers a node, "Highlight starred" mode, stars listed on the index page with `#/doc/<file>?node=<id>` deep links, gold outline on the minimap. Checked end to end in headless Chrome on a temporary copy.
* Trouble: the home page crashed with `Uncaught TypeError: Cannot read properties of undefined (reading 'length')`. The `:4310` server process had started 10-08 20:50, before `server.ts` began returning `starred`, while the page was the new build. Restarted the server and made the index treat a missing list as empty. Server-side changes need a restart; web changes only need `pnpm build:web`.

### 36 `Why:` notes from diary, README and commits; new map nodes for hover, layout, labels and stars

* The subagent added 36 one-sentence `Why:` notes, all sourced; five nodes have no stated reason and stayed without one (`ui-freshness`, `ui-struct-edit`, `ui-dag`, `threads-targets`, `threads-mentions`).
* Map update: `rhumb-star`, `ui-hover`, `ui-layout`, `ui-labels`, `ui-star` (done) with their commits; `ui-dag` dropped (`ui-layout replaces ui-dag`); test count 64/64. Nodes now link to their diary entries.

### Package `@k-l-lambda/portolan` builds to `dist/`; publish workflow uses npm Trusted Publishing; portolan `9957ecd`

* lilylet reference: `@k-l-lambda/lilylet`, ISC, `.github/workflows/publish.yml` publishes on push to main when `package.json` changes, Node 24, `npm install -g npm@latest`, Trusted Publishing (OIDC, `id-token: write`, no token secret). Repo `k-l-lambda/portolan` already existed (public, `origin` set, `main` pushed to 1089f0f); npm name `@k-l-lambda/portolan` was free (E404).
* Published Node packages cannot run `.ts` from `node_modules`, so `build` compiles `src/` to `dist/` with `tsc -p tsconfig.build.json` (`rewriteRelativeImportExtensions` turns `.ts` imports into `.js`), copies the generated Peggy parser, then builds the web app. Bins `portolan`/`rhumb` → `dist/cli.js`; library `exports` → `dist/index.js`; files `dist`, `web/dist`, `docs` (648 KB tarball, no sources or tests). The web libraries moved to devDependencies; `yaml` is the only runtime dependency. `engines.node >= 22.12`, `packageManager: pnpm@10.23.0`.
* Workflow differs from lilylet: it checks npm for the version instead of comparing with HEAD~1 (idempotent re-runs, multi-commit pushes), has a concurrency group, `pnpm install --frozen-lockfile` + tests before `npm publish --access public`, pinned actions (checkout v7.0.1, setup-node v7.0.0, pnpm/action-setup v6.1.0) and npm 11.20.0 instead of `latest`.
* From docs.npmjs.com/trusted-publishers: Trusted Publishing needs npm CLI >= 11.5.1 and Node >= 22.14; the trusted publisher is added in the package settings, so the package must exist; provenance is generated automatically. Hence the first release is manual (`pnpm run build && npm publish --access public` with OTP), then add the trusted publisher (user k-l-lambda, repo portolan, workflow publish.yml).
* Verified by installing the packed tarball into an empty directory: `rhumb check`, `import { parse, createRhumbServer }` and `portolan serve` (web page + `/api/files`) all worked.
* Trouble while checking the docs: WebFetch returned nothing and a ppio-search grep failed (`ugrep: error … exceeds complexity limits`); fetching the page with `curl -x http://localhost:1091` and stripping HTML in Python worked.
* Open: first manual publish, trusted publisher setup, and a LICENSE file (ISC chosen to match lilylet; the bundled elkjs is EPL-2.0 OR GPL-3.0, its notice must be kept).

### Recent-maps menu and click-to-copy IDs and commit hashes; portolan `9dad94b`

* The map path in the top bar is a button opening the recently visited maps (per browser, `localStorage`, up to 10, wrapped in try/catch), titles from `/api/files`, maps the server no longer has hidden, "All maps…" back to the index.
* Node IDs (copied bare, without `^`) and commit hashes (full 40 characters) in the side panel copy on click, with a short "Copied" flag; falls back to a hidden textarea + `execCommand("copy")` when the async clipboard API is unavailable.
* Checked in headless Chrome with `Browser.grantPermissions` for the clipboard: the menu listed both visited maps, picking one switched maps, the clipboard held `camelot-eval` and a 40-character hash.

### 16-point portolan compass rose on a navy tile; also the README logo; portolan `2dfaf35`

* `web/public/favicon.svg` (2.6 KB): navy rounded tile `#14233b`, lighter disc, thin parchment bearing ring with ticks every 22.5°, faceted points (lit counter-clockwise half, shaded clockwise half), vermilion north `#e0563b`/`#a83a26`, parchment cardinal points `#f3ead4`/`#bfae86`, darker intercardinal points behind, navy pivot. Same colors in light and dark tabs.
* Rendered at 16 and 32 px in headless Chrome and read back as ASCII: at 32 px the red north, facets, short diagonals and ring all read; at 16 px the star, red north and light/shade split read, the ticks blend in. The image itself could not be viewed in this environment.
* Linked from `web/index.html` (Vite copies `public/` into `web/dist`, the server sends `image/svg+xml`), included in the npm package; README shows it centered above the title.

### Browser tab title follows the map title; portolan `57b3f25`

* Map pages show `<title> · Portolan` (file name when the front matter has no title); the first check showed `Portolan · Portolan` for the Portolan map, so a map titled "Portolan" now shows just "Portolan". The index page shows "Portolan". The in-page heading already showed the map title.
* portolan `main` is now 6 commits ahead of `origin/main` (not pushed).

### Fragments narrow left to right: heading, `^=` line prefix, `+L`/`-L` offset, or absolute `#L42`/`#L42-L50`; failures are W003; portolan `81619b4`

* Suggested `^=` (CSS "starts with") instead of a bare `^`: a trailing `^id` is already Rhumb's node ID marker, and `#^block-id` is Obsidian's block reference, so `#anchor^xxx` would be read as an ID. Also suggested GitHub-style absolute lines for code files without headings. User chose `^=` and absolute lines (askme).
* Grammar (spec 4.1): `slug [":~:text=" text]` | `[slug] "^=" prefix [offset]` | `slug offset` | `"L" n ["-L" m]`; prefix in backticks when it has spaces or `+ # : ~`; offset `("+"|"-") "L" n`. Unambiguous because GitHub slugs are lowercase and drop `+ ^ = \` : ~`. `^=` ignores indentation, first match wins, an offset may not leave the heading's section; without a heading `^=` searches the whole file (any text file).
* Tests first: parse fixture `17-anchor-lines` (12 anchors incl. 4 malformed) and 8 resolver/excerpt/check cases; they failed before the code (6 failures), then passed. 73 tests.
* Trouble: several of my own fixtures failed because a `>` inside `<…>` ends a Markdown link destination, so `<…#^=`* > [host]`>` was cut short and the link vanished without any message. Fix: the grammar now accepts CommonMark backslash escapes inside `<…>` (write `\>`), and a `](<` that does not become a link is the new warning `W011`. One offset expectation was also wrong (`#other-heading-L1` leaves the section, so it is W003, not line 13).
* Checked on real files: all three memo maps still `check` clean; ``^=`* \> [camus-HP-Z440-Workstation][portolan] Design a vector` `` resolved to line 197 of this diary and `+L2` to its summary line 199; `repo:src/edit.ts#L1-L5` and `repo:src/resolve.ts#^=export function resolveAnchor` resolved; prefix not found, line past the end and an unescaped `>` each warned. The diary panel excerpt starts at the resolved line ("line N[-M]").
* Follow-up question "what does `:~:text=` mean now, and is `^=` a duplicate?": `:~:text=` finds the first top-level list entry in the section whose lines contain the text (case-sensitive substring) and lands on the entry's first line; `^=` lands on the exact line that starts with the text and takes offsets. They overlap only when pointing at an entry's first line. Found a gap: `#:~:text=…` without a heading resolves to nothing and gives no warning. Proposed (not done): search the whole file in that case, and add a "which form to use" rule to skill.md.

### New "Write for a human reading the big picture" rule in skill.md; the project map rewritten by it; portolan `2ad807f`, diary-job `55234853`

* skill.md section 1: titles are short plain names (two to four words), not sentences or files/functions/flags; the first note is `Why:` tied to the larger goal; other notes carry decisions, outcomes and open questions; commands, errors, numbers, paths and hashes stay in the diary behind exact links (`^=` / `+L`). Includes a before/after example, checked with `check`.
* Map rewrite: 51 node IDs, statuses and attributes and all 49 edges unchanged (compared parse results); commit hashes in notes 15 → 0 lines, code spans 32 → 5 (link targets only), 248 → 214 lines; five nodes got their first diary link, each resolved to the right line.
* First pass turned titles into sentences ("Pages follow edits without a refresh"); the user pointed out that brevity is part of readability, so short titles that were already clear were restored ("Portolan", "Hot reload", …) and only technical ones renamed ("Timeline layout", "Line anchors", "Copy IDs", "Publishing"). Longest title is four words.
* Trouble: a `^=` prefix could not contain a backtick inside backticks; `check` rejected ``^=`* \`src/edit.ts\``` as a bad fragment. Percent-encoding works (``^=`* %60src/edit.ts%60` ``); documented in the spec and skill.md.
* Side effect: almost every map line now blames to this rewrite, so nodes without an earlier dated link look freshly changed in the freshness view.

### Not a package or scope problem: npm did not recognize the login; both available tokens return 401

* npm answers an unauthorized publish with 404 so it does not reveal whether a package exists. Debug log: npm 10.9.4, `PUT 404`, reached the upload step; `@k-l-lambda:registry` points to registry.npmjs.org.
* `npm whoami` with `~/.npmrc` → `401 Unauthorized`; with only the token from `env.local.md` (the one lilylet's `publish.local.sh` uses) → `401` too. Both tokens are expired or revoked, possibly when lilylet moved to Trusted Publishing.
* Fix (for the user, not run here because publishing is public and needs login + OTP): `npm login --auth-type=web` or a new token with read/write on all packages or the @k-l-lambda scope (a token limited to existing packages also fails on a new one); then `pnpm run build && npm publish --access public`, then add the trusted publisher (k-l-lambda / portolan / publish.yml).

### Lines above frames, labels above all, full text on hover, stable hover; portolan `0a05378`, `64ad5e9`

* Lines were not missing but hidden: most run inside group frames, and the frame fill was stacked over them (pixel check: 40 of 40 sampled idle lines identical to the background). Fixed z-index bands: frames 0–99, lines 100, cards 200–299 (350 on hover), labels 400. Result: 120/120 idle sample points visible.
* Labels: the label layer still had z-index 20, below lines and cards; moved to 400 (38/38 labels on top). Focused labels show full text; unfocused ones keep the 260px ellipsis; hovering a label shows its full text by CSS only.
* Trouble (several rounds): hovering a label made it vanish. A frame-by-frame trace showed all 42 edges unmounting for 1–2 frames, so the pointer fell onto the frame header and focus jumped there. Two causes: (1) xyflow's default `zIndexMode="basic"` adds the parent node's z to an edge, so focus moved the edge to another SVG layer and remounted it → `zIndexMode="manual"` and a constant edge z-index; (2) dimming set a new `className` on every node, which makes xyflow re-measure nodes and drop edges meanwhile → dimming is now a `<style>` keyed by node ID, node objects never change on hover. A temporary "pin the hovered label" fix was removed once the user clarified that label hover should only expand the text.
* Lines were not hoverable at all: non-selectable edges get xyflow's `inactive` class with `pointer-events: none`, including the 14px hit stroke; `.react-flow__edge.inactive .react-flow__edge-interaction { pointer-events: stroke }` restores it.
* Titles: the first version grew the card on hover, squeezing out the controls row (user report). Now the title runs on one line past the card's right edge on the card's own fill (`--card-bg`); measured card, header, controls and select boxes unchanged; frames do not rise (their fill would cover their children).
* Flicker: the focus rule `.react-flow__edge.is-active path { stroke-width: 2.5 }` also matched the invisible 14px hit stroke, so focusing shrank the hit area, the pointer fell off it, focus dropped and it widened again (9–10 switches in 40 frames). Rules now target only `.react-flow__edge-path`: 0–1 switches at every tested distance. Open: in that test only the 2-flow-px position focused the line although the hit stroke is 14px; not investigated yet.

### Legend popover and an icon toolbar with tooltips; portolan `f446de3`

* Legend (`web/src/Legend.tsx`): the five line types drawn with their real color, dash and arrow plus which way the arrow points; a "needs ×3" chip for folded lines; mini cards for the six statuses, a group frame, the gold starred frame and the ready badge; three mini cards with dim → bright left edges and a gradient bar for freshness ("fades over about 90 days"). Same colors in dark mode; stays inside the window.
* Icons (`web/src/Icons.tsx`, 16px grid, 1.6px round strokes): expand all = two chevrons pulling apart, reset = arrow turning back, all labels = a label on a line, legend = swatches beside lines. `IconButton` puts the label in `aria-label` and a CSS tooltip (`data-tip`, shown after 300 ms on hover or keyboard focus). All edge labels became an `aria-pressed` toggle whose tooltip flips between "Show all edge labels" and "Hide edge labels".
* Trouble 1: clicking the canvas did not close the Legend or Starred popover. Both closed only on blur, and a canvas click does not move focus. Fix: a document `pointerdown` listener closes a popover when the press lands outside it.
* Trouble 2 (user report): the Reset view tooltip looked covered. Reset is disabled by default, and `.btn:disabled { opacity: 0.5 }` also faded its `::after` tooltip; the toolbar also had no stacking context, so the canvas below could paint over it. Fix: disabled icon buttons dim only the icon (`color`), and `.doc-bar` is `position: relative; z-index: 30`. Screenshot check: tooltip covers 71% of its area on the disabled Reset button vs 69% on Expand all.
* Verified: Expand all 25 → 69 nodes, Reset back to 25, labels toggle 0 ↔ 38 labels.

### Dimming, line width and labels now ease over 0.5 s; portolan `1d2ede6`

* Lines, cards and the visible path width transition over 0.5 s. Labels could not fade while hidden ones were removed from the page, so they now stay mounted and toggle an `is-hidden` class: opacity fades, then `visibility: hidden` and `pointer-events: none` apply after 0.5 s; hidden labels are `aria-hidden` and keep their last placed position so they fade out where they were. All transitions are off under `prefers-reduced-motion`.
* Measured while hovering a card: other cards 1 → 0.81 (150 ms) → 0.42 (350 ms) → 0.35; labels 0.3 → 0.89 → 1; on leave cards 0.72 after 200 ms, back to 1. Hidden labels catching the pointer: 0; near-line hover flicker check: 1 switch in 60 frames; 42 labels stay mounted throughout.

### Frames are split into a fill layer below the lines and a header layer above them; portolan `faa0eaa`

* A single node cannot be both below the lines (its fill) and above them (its title), so each frame now renders as two nodes: a `fill` node under the lines, and the frame itself above them with a transparent body. Stacking, bottom to top: frame fills 0–99, lines 100, frame borders and headers 150–199, cards 200–299 (350 hovered), focused lines 360, labels 400. Fill nodes dim with their frame (`cardFocusCss` keeps `<id>::fill` too), and are skipped by the minimap and hit-testing.
* Header backdrop is 60% of the frame colour (`color-mix(... 60%, transparent)`, extended over the 8px padding with a box-shadow) rather than `opacity: 0.6`, which would also fade the title, status select and star.
* Checked by diffing screenshots with lines on/off at line points: idle line inside a header 0/20 visible when the header was opaque, then 68/100 visible at median contrast 40 after the 60% change (vs 7970/8147 at contrast 112 in the open); solid lines in frame bodies 247/247 visible; a focused line over a header 20/20 visible; near-line hover still 1 switch in 60 frames.
* Trouble in my own checks: a neighbour-contrast test reported the line as visible inside the header (10/11) because the title text next to the line produced contrast; only the on/off screenshot diff gave the right answer. The fit-view zoom also made headers too small to click, so header-click and header checks were redone after `?node=` deep-linking to the frame.

### A 1.8×4.8 tab across the line at its node end, in the line's colour; portolan `12dffaa`

* `endTab()` (geometry.ts, unit-tested) places the bar just outside the node border, rotated across the first (or last) segment. Arrowed lines get one at the tail; arrowless (unlabeled relates) lines get one at each end. It sits in the edge's SVG group, so it dims and fades with its line and never takes the pointer. The legend line samples show it, with a hint "bar = where a line leaves an item, arrow = where it points".
* First size 3×8, then 0.6× as asked (1.8×4.8, corner radius 0.5).
* Verified on Camelot: 45 lines (40 arrowed) with the right tab count each, 50 tabs, colour matches the line for all, all 50 at a card or frame border, 16/16 tabs inside the canvas drawn. Three tabs first reported as invisible were only under the app top bar at that scroll position.

## 2026-10-10

### LICENSE, bundled third-party notices, and text links without a heading; portolan `65d90e1`

* `LICENSE` is ISC, matching lilylet. Minification drops the license comments of bundled packages, and elkjs is EPL-2.0 OR GPL-3.0, whose notice must ship with the build. A small Vite plugin (`web/licenses.ts`) writes `web/dist/THIRD-PARTY-LICENSES.txt` with the license text of every npm package in the bundle. Both files go into the npm package, and the server now sends `.txt` as `text/plain`.
* `#:~:text=…` with no heading used to resolve to nothing, silently. It now searches the whole file, like `^=`, and reports W003 when nothing matches. skill.md now says when to use which: `:~:text=` for a whole diary entry, `^=` for one line, code, or an offset.

### Labels now stay centred on their own line and move only up or down; portolan `08efdc9`

* Cause: when no spot along the line was free, `placeLabels` moved a label on a vertical segment sideways by one or two label widths (`k * (w/2 + gap + 2)`), which put wide labels well away from their line.
* Now the fallback keeps x on the line and tries y offsets in half-row steps, up to ±4 rows, nearest first.
* Rebalanced the cost. Covering another label is still effectively forbidden. Staying near the own line now outweighs avoiding other lines (penalty 200 → 40). Card cover used to count as overlap area, which grows with label width and pushed a 227px label 68px down; it now counts as the covered fraction of the label box (× 60).
* Measured in headless Chrome on camelot-training with all edge labels shown (41 labels), old vs new: overlapping label pairs 1 → 0; labels more than 10 flow px from their own line 12 → 3; farthest 156 → 41 px (about two rows, in a crowded column). portolan.rhumb: 0 overlaps and 0 offsets both before and after.
* Tests: the old "moves labels beside a short edge" case became two cases: three short parallel vertical edges, and two close parallel horizontal edges. Each label must not overlap the others and must keep x on its own line. 79 tests pass, tsc clean.
* Measuring pitfalls: navigating between maps by hash alone kept view state from the previous map (3 labels instead of 41), so each run first loads `about:blank`. A run that measured before the 0.5 s transition finished reported stale positions. Screenshots could not be read back in this session, so checks were numeric: label translate in flow coordinates against the edge path from `getPointAtLength`.

### Label dedupe treated every unlabeled edge's "needs" as a repeat; portolan `95386d4`

* Cause: labels were deduplicated per source by their displayed text, so `a needs b, c: reason` would not show the reason twice. An edge with no written label displays its kind, so both edges of `ui-legend needs ui-tree, ui-freshness` had the key `ui-legend + "needs"` and the second was hidden. A hovered edge skips the dedupe, which is why it appeared on hover. Nine sources in portolan.rhumb were affected: server, ui-dag, ui-diary, ui-edit, ui-freshness, ui-legend, ui-star, ui-threads, ui-tree.
* Fix: each route carries the label as written (`null` when there is none, or when a folded route merges several edges), and only those labels are deduplicated.
* Measured in headless Chrome with all labels on. portolan: 28 of 29 labels shown (21 before), no overlaps. The one still hidden is the shared label of `threads-lifecycle needs threads-store, rhumb-edit: …`, as intended. camelot-training: 41 of 44 shown, the 3 hidden are the same kind of shared label.

### Every line blinked out for about 200 ms twice per reload; nodes now carry their measured size; portolan `ad106cf`

* First checks found nothing. Edge DOM counts stayed whole for title, node, edge and status edits, for direct and atomic (`rename`) writes, and while hovering or with a node selected. Line pixels compared with lines shown vs hidden were the same before and after a reload.
* Sampling the number of drawn edge paths on every animation frame across a reload showed the problem. portolan: `[1,29],[618,0],[805,29],[819,0],[834,29]`. camelot-training: `[1,44],[638,0],[865,44],[877,0],[898,44]`. So all lines vanish for about 190 ms when new data arrives, and again briefly when the new layout lands.
* Cause (xyflow 12.11 source): each rebuild creates new node objects. `adoptUserNodes` builds the internal node from a user node without `measured` and sets `handleBounds` from `parseHandles`, which returns `undefined` in that case. `getEdgePosition` then sees the node as not initialized and the edge renders nothing until the ResizeObserver measures the card again. The freshness tick (`now`, every 60 s) rebuilds the nodes too, so an idle page blinked once a minute.
* Fix: cards already have their size from the ELK layout, so `DocView` passes `measured: { width, height }` with it. After the fix the per-frame samples are `[1,29]` and `[1,44]`: no frame without lines. Adding three nodes with two edges, then removing them, left 0 lines detached from their cards. Hover focus still works (3 active, 26 dimmed on `server`). 79 tests pass, tsc clean.
* Seen but not fixed: an editor that truncates the file and writes it slowly can make the server read a half-written file, so the view is briefly empty (nodes and edges 0) until the next change event, then recovers on its own.

### The README shows the example map's source and its SVG rendering; portolan `46022b9`

* The example moved to `docs/portolan.rhumb` (`examples/` is gone) and grew to 12 items and 8 lines: every status, a `{star: true}` item, blocked and dropped items with a reason note, `Why:` first notes, and `needs`, labeled `relates`, `replaces` and `from` lines. The spec link became an absolute GitHub URL so it works both from the README and from `docs/`. `tests/cases.test.ts` reads the new path and expects 8 edges.
* `scripts/example-svg.ts` (`pnpm example:svg`) draws a map as a static SVG in the web view's light theme. It reuses the app's `layoutElk`, `placeLabels`, `roundedPath` and `endTab`, expands every subtree, shows every label, and keeps the app's stacking: frame fills, lines, frame headers, cards, labels. Status pill, title (two lines at most), star, short ID, ready/link badges, progress bar and fold button are drawn as in `NodeCard`; colours come from the `styles.css` light tokens with `color-mix` computed in the script.
* There is no DOM in Node, so text width is a per-glyph estimate. The first estimate (0.6 em per character) wrapped every title; a glyph table at 1.04× was about 15% narrower than Chrome's system font, so one title and three labels overflowed; 1.18× fits everything. Erring wide is safer because viewers' fonts differ.
* Checked in Chrome on the SVG inlined in a page: no text past its card, star or label box; 8 labels, none overlapping, each touching its own line; one `needs` label overlaps a card edge, which the app also allows. Box positions match the app's layout of the same file except where the app orders siblings by git time. Screenshots could not be read back in this session (PNG and JPEG both came back empty), so the image itself was not looked at.

### The web view follows the system theme; there is no manual switch, and the README image and favicon are light-only

* `web/src/styles.css` defines every colour as a `:root` token and redefines them all under `@media (prefers-color-scheme: dark)`, with `color-scheme` set for native controls. The rest of the stylesheet uses those tokens or `color-mix` on them; the only fixed colours are `rgb(0 0 0 / 0.18)` shadows. The xyflow canvas uses `colorMode="system"`.
* Gaps: no `data-theme` override or toggle; `docs/example.svg` has fixed light colours, so it shows as a light image in GitHub's dark mode (a dark variant plus `<picture>` would fix it); the favicon has fixed colours but reads on both. Not checked: arrowheads have no colour set (`MarkerType.ArrowClosed`), so they follow xyflow's default rather than each line's colour.

### docs/changelog.md holds the 35 Portolan diary entries; docs/portolan.rhumb is now the project map, linked into it

* The changelog has one `##` heading per day and one `###` heading per entry, made from the entry's summary (`<code>`/`<b>` turned into Markdown); the prompt lines and the diary's section headings are gone, bodies are kept verbatim with tabs as two-space levels. Entries: every `[portolan]`-tagged one from 10-08 to 10-10, plus four untagged design entries from 10-08 (prior-art survey, Backlog.md analysis, naming, the Rhumb relationship review). Left out: the DLoop/PPIO-search entries and the Camelot map work that only used Rhumb.
* `docs/portolan.rhumb` is a copy of `memo/portolan.rhumb`. Each `diary:` link was resolved with the project's own `resolveAnchor` to the diary line it lands on, then pointed at the changelog heading of the entry containing that line: 38 links, none unresolved. `repo:` links became relative to `docs/`, and the `links:` front matter was dropped. `check` is clean. The memo map stays the working copy and keeps its diary links; the docs copy is a snapshot to refresh by rerunning the conversion.
* The README's small example moved to `docs/example.rhumb` (the SVG script and `pnpm example:svg` read it); a new test checks that the project map parses without diagnostics. 80 tests pass.
* Heading anchors are GitHub's full slugs, so links work both on GitHub and in the Portolan diary panel; long summaries make long anchors.

### Read-only demo at https://k-l-lambda.github.io/portolan/, deployed by `.github/workflows/pages.yml`; portolan `5eea371`

* Pages serves static files only, so `pnpm build:pages` (`scripts/build-pages.ts`) starts the existing server on an ephemeral loopback port and saves its API answers as files next to the built web app: `api/files.json`, `api/doc/<file>.json` and one `api/anchor/<file>/<line>-<index>.json` per link (44). The build machine's absolute paths are rewritten to repository-relative ones. A `.nojekyll` file stops Jekyll from dropping paths with `_`.
* The export injects `<meta name="portolan-static" content="portolan.rhumb">`. `web/src/api.ts` sees it and reads those files instead of `/api/…`, rejects edits, and opens no `EventSource`. Status selects, stars and the `s` shortcut are disabled, the bar shows a "read-only demo" badge, and `#/` opens the map directly. Vite `base: "./"` makes asset URLs relative, so the same build works at `/` and under `/portolan/` (routing is by hash).
* The workflow checks out with `fetch-depth: 0` so freshness comes from real blame, builds with pnpm/Node 24, and deploys with `configure-pages@v6.0.0`, `upload-pages-artifact@v5.0.0`, `deploy-pages@v5.0.1` (each release over two weeks old). It runs on pushes touching `docs/`, `web/`, `src/`, the build script, package files or itself, and by hand.
* Checked locally under a `/portolan/` subpath in headless Chrome: 31 cards and 29 lines, all edit controls disabled, the side panel shows changelog excerpts, no failed requests or console errors, and no request to `/api/events`. The normal server still lists files and allows edits. First run `38039641890`: build and deploy succeeded. Over HTTP the page, `api/files.json`, the map JSON (52 nodes, 51 edges, every node timed), an anchor file, the bundle and the favicon all returned 200. The same push ran the npm workflow, which skipped because 0.1.2 is already published.

### No: one `#` names one heading at any depth; narrowing below it uses `:~:text=` or `^=`

* Tested with a temporary file: `notes.md#day-two#setup` reads the fragment as the slug `day-two#setup` and reports W003. `#setup` with two Setup headings is not ambiguous: duplicate slugs are numbered as on GitHub (`setup`, `setup-1`), so it lands on the first.
* Existing ways to narrow: `#day-two^=## Setup` or `#day-two:~:text=second setup`. A `#a#b` syntax would be a Rhumb-only extension that GitHub and browsers ignore (and `#` may appear only once in a URL); if wanted, `#day-two/setup` is a cleaner separator. Not implemented.

### Links without a path date take the date of the nearest dated heading above their target; portolan `dcdae36`

* Path dates (`diary:2026/1008`) still come first. Otherwise `headingDate` (`src/resolve.ts`) starts at the line the link resolves to (the matched entry, the matched line or the heading), walks up through ancestor headings, each a level shallower, and takes the first one that starts with a date (`## 2026-10-08`, `## 2026-10-08 Notes`). A date in the middle ("Release 2026-10-10 retro") does not count. URLs, missing files and unresolved links give no date.
* `dateIn` in `src/history.ts` holds the date rule shared with `linkDate` (named groups, validated calendar day). `nodeTimes` takes an optional `dateOf(anchor)` and calls it only when the path has no date, so other callers are unchanged. `src/server.ts` passes `headingDate(resolveAnchor(a, ctx), readLinked)`, and the static export goes through the server, so the demo gets it too.
* Tests written first and seen failing: nested headings, the dated heading itself, `#L11`, `:~:text=`, `^=`, a mid-heading date ignored, no-date cases, a node whose diary link is later than its changelog link, and `nodeTimes` without a resolver. 85 tests pass.
* Effect: `docs/portolan.rhumb` went from `{children: 5, commit: 47}` to `{children: 5, link: 26, commit: 21}` (16 on 10-08, 10 on 10-09); before, every item was dated by the commit that added the file today. `memo/portolan.rhumb` is unchanged (its diary paths carry dates). `/api/doc` takes about 200 ms on the docs map.

### "Source: <u>portolan.rhumb</u>" opens the raw `.rhumb` as text in a new tab; portolan `93ea6e1`

* `GET /api/source?file=…` returns the file as `text/plain; charset=utf-8`, with the same checks as the other endpoints (inside the root, `.rhumb` only); a test covers `../plan.rhumb` and `plan.threads.jsonl` being rejected. The static export saves it as `api/source/<file>.txt` so Pages serves text instead of a download. The link sits after Legend, same 26 px height; only the file name is shown, in the text colour with the underline.
* Checked in headless Chrome: live and static (under `/portolan/`) both return the 19,078-byte file, and a click opened a new tab at `…/api/source/portolan.rhumb.txt` while the page stayed put.
* Trouble: the `{"error":"Not found"}` came from the long-running `portolan serve` on port 4310, started 10-09 21:25, before the endpoint existed. The page loads the rebuilt bundle on refresh, but the Node process keeps its old code, so the new link hit a server without the route. Restarting it fixed it; `portolan.rhumb` and `camelot-training.rhumb` both return 200 text. After server-side changes, restart that server.

### The project map is now `docs/demo/portolan.rhumb`; Pages exports every map under `docs/demo`; portolan `d59ccdd`

* Links in the map were rewritten one level up (`../changelog.md`, `../rhumb-spec.md`, `../skill.md`, `../../README.md`); `pnpm build:pages` now defaults to `docs/demo _site`.
* With one map the `portolan-static` meta names it and the page opens it directly; with several the meta is empty and `#/` shows the index. `staticPath` encodes each path segment separately, so a nested map becomes folders on disk instead of one `%2F` name.
* Tests for the encoded static paths were added; the project-map test points at the new location.

### No BCE before; headings may now start with `<year>[-MM[-DD]] HE`, and dates beyond the JS range show "long time ago"; portolan `caae1df`

* Answer to the first question: dates were read as four-digit CE `YYYY[-MM[-DD]]` only, so a BCE year could not be written.
* Format, fixed before the code: `<year>[-MM[-DD]] HE` at the start of a heading, HE = CE + 10000. The year may be negative, grouped with commas (`-4,352,814,673 HE`) and use U+2212 for the minus. Link paths stay CE-only, and an invalid HE date (bad month or day) is no date. `docs/demo/civilization-log.md` was converted first, e.g. `## 11,942-12-02 HE`.
* A JS `Date` reaches only ±8.64e15 ms (about 271,821 BCE). Earlier dates are clamped to `LONG_AGO = -8.64e12` s, and the view shows "long time ago" for anything at or below it. `-Infinity` was rejected: `JSON.stringify` turns it into `null`, and `Infinity - Infinity` gives `NaN` in sort comparators. Years before 1 CE are shown with the BC era.
* `nodeTimes` now compares `link.time < dayStart(lineTime.time)` instead of date strings, which HE labels would have broken.
* Trouble: the side panel threw `RangeError: Invalid time value` from `toISOString()` on these times; `isoTime()` in `web/src/time.ts` guards the three `<time dateTime>` uses. Test helper trouble: `linkDate` only reads 19xx/20xx paths, so a 1701 case needed its own CE helper; an `afterEach` `rmSync` on an undefined temp dir needed a guard.
* Tests cover HE parsing (negative, grouped, U+2212, invalid days), the long-ago clamp and `nodeTimes` with HE headings.

### `history-life-primates needs history-life-neocortex`; stars no longer keep a branch open; portolan `5e0aa8b`, `869c143`

* `defaultCollapsed` (`web/src/layout.ts`) now opens a branch only when it contains `doing` work. A folded card still shows how many stars it holds, and the star menu reveals them.
* Trouble: another session had committed the same primates edge in parallel, so the map had it twice (W004); `869c143` removed the duplicate.

### GitHub mark at the right end of the top bar, and a one-line intro under the map index; portolan `caab2ea`, `49b96ed`

* The mark is Primer Octicons 19.38.0 `mark-github-16` (MIT, attributed in `Icons.tsx`); the latest Octicons release was under two weeks old, so the older pinned one was used.
* The index footer reads "Portolan is a shared map of work for humans and AI agents: a mind map, TODO list and task log in one." followed by the repository link; a first, multi-line version was cut to one line. `REPO_URL` lives in `layout.ts` for both uses.

## 2026-10-12

### 15 branch nodes with reasons, designer-voice notes for the life stages, 11 new HE log entries; committed by the user as portolan `c8483af`

* Life (all `[-]` under the done group): snowball-period multicellular pilot (frozen by the Sturtian glaciation; `history-life-animals replaces` it), octopus civilization (mothers die around hatching, no cross-generation transfer; kept as the control "individual intelligence is not civilization"), dragon breeding plan (brain-to-body ratio stalled for 160 Myr, ended by the impact; the neocortex `replaces` it, corvids are `from` it), Neanderthal parallel lineage (`history-life-sapiens replaces` it).
* Other candidates: `[!]` cetacean ocean civilization (no fire underwater), `[?]` corvid backup lineage. Technology (real projects): airships `[-]`, Orion `[-]`, NERVA `[!]` (`needs foundation-governance` for orbital nuclear rules), Buran `[-]`, MSRE `[!]`, cold fusion `[-]`, Fifth Generation Computer `[-]` (`history-information-agent replaces` it). Future: `[?]` Mercury dismantling as a backup material source.
* Statuses respect W007 (only `[-]`/`[?]` under `[x]` groups) and no `needs` points at a dropped node (W006). The eukaryote note now reads as an endosymbiosis experiment; the impact note says the asteroid was not intercepted after the dragon plan failed review.
* Log: one intro sentence states the designer voice and that "（虚构方案）" headings are invented; those four cite only the scientific background. The seven technology entries cite pages fetched through the :1091 proxy (Henry Ford museum, Physics Today, NASA, OSTI, NASM, Berkeley, Nature, ICOT). The MSRE source is a 1969 progress report, so the heading says only `11,969-12 HE`.
* Checks: `check` clean, every in-log `#` link resolves to a heading slug, headings stay chronological, 90 tests pass. A `web_search` call failed once with "All search engines failed"; other queries worked.

### Groups are placed by the weighted mean of their leaves' times (done/doing ×10, others ×1); portolan `64d40b7`

* Cause: a node without its own link takes its newest child's time. The new undated children (cetaceans, corvids) are dated by today's commit, so the whole group counted as "today".
* `layoutTime` in `web/src/elkLayout.ts` feeds sibling ordering only; a group without timed leaves falls back to its own time, and the time shown on the card is unchanged. Dependencies still win over time.
* Measured with the real map through `layoutElk`: 智慧文明培养 y 4783 → 1396, directly below 有机生命培养; the doing groups now run 智慧文明, 能源, 材料, 空间, 信息. A test checks the centroid value and the sibling order; 91 tests pass.

### Search box with a ranked candidate list; matches are outlined on the map; portolan `b8f68ba`

* `web/src/search.ts`: an exact ID (a leading `^` is ignored) matches only that node, which is revealed and centered. Otherwise every word must occur in the title or ID, case-insensitively; with no such node, words are tried as in-order subsequences (`hlsap` finds `history-life-sapiens`, and also `history-life-snowball-pilot`).
* Ranking: whole text 100, prefix 80, word start 70, inside a word 50, minus up to 10 for later positions; subsequences up to 30 by tightness. Scores add over words; ties go to shorter titles, then document order. The map keeps document order, the list shows the best 10 and "N more".
* View: matches get an orange outline (`--match`, light and dark), the rest dims, and only lines between matches light up; matches in folded groups are shown on the nearest visible card; no match dims everything. `/` focuses the box, arrows move through the list, Enter or a click goes to a node (select, expand, center), Enter with the list closed steps through all matches (Shift+Enter backwards), Escape closes the list and then clears. The input is an ARIA combobox with `aria-activedescendant`.
* Checked in headless Chrome on the civilization map: "核" ranks 核热火箭, 核脉冲推进, 真核细胞, 受控核裂变, 室温核聚变; `history-` gives 10 of 52 with "42 more"; arrows wrap, Enter and click select and center; no JS errors. Found while testing: clicking the already focused box did not reopen the list after a pick; an `onClick` fixed it. 95 tests pass.

### Both were `[?]` ideas: optional node types from the 10-08 expressiveness review, and editing the map's structure in the view; `ui-struct-edit` got its Why

* `rhumb-kinds`: an optional `kind` attribute (task / experiment / artifact / hypothesis / finding) so tools can tell work from claims; the rule set first was that finishing an investigation must not read as proving its hypothesis. The same review proposed `compares`/`uses`/`tests` relations, still written as labeled `relates`.
* `ui-struct-edit`: add, remove, rename and move items and relations from the view. `src/edit.ts` already has every operation except `move-node` (reserved: a moved subtree needs its notes and children re-indented); the first version left the controls out by the user's choice on 10-08.
* Added to `memo/portolan.rhumb`: a Why, the missing-move note and a link to the 10-08 scope line (`#rhumb-tooling:~:text=no structural editing`). No UI idea for kinds existed anywhere; I proposed kind marks on cards, a separate claim state, legend entries and a search filter.

### 11 preset kinds and 8 claim icons on the 16 px toolbar grid; claim states became boolean attributes like `star`

* Kinds: task (default, no mark), milestone, experiment, hypothesis, finding, question, decision, risk, artifact, reference, event. Claims: verdicts supported / partial / refuted / inconclusive (one at most) drawn as circles, qualifiers replicated / contested / retracted drawn as non-circles, and an implied dashed-circle untested for a hypothesis without a verdict.
* Prefix rule: compared only among custom kinds, case-insensitive, by character; a name that prefixes another keeps its whole name (`data`/`dataset` → `Data`/`Datas`).
* Built as a single HTML page with a live prefix playground and mock cards; headless check: 19 icons inside the 16×16 box, no script errors, no horizontal scroll at 420 px.
* Trouble: publishing it as an artifact was refused: `Artifacts need a claude.ai login, and this session is authenticating with ANTHROPIC_AUTH_TOKEN`. The page stayed a local file; it was deleted after the implementation.

### `{kind: …}` and claim flags in the parser, spec, cards, legend and search; portolan `976233a`

* Core: `src/kinds.ts` (`PRESET_KINDS`, `VERDICTS`, `QUALIFIERS`, `nodeKind`, `claimOf`). `kind` and the 7 flags are reserved keys. New diagnostics: `W012` kind not a non-empty string or flag not boolean, `W013` more than one verdict (none shown), `I004` a flag on anything but hypothesis/finding. Spec gets section 3.4 (Hierarchy and Notes become 3.5/3.6). Case `tests/cases/18-kinds` written first and seen failing.
* View: `kindLetters` computes custom-kind letters for the whole map (sorted by code point, longest common prefix with a neighbour + 1); `claimMarks` gives the verdict or untested, then qualifiers. Cards show the kind (muted) between the status select and the title and claim icons after the ID; the legend adds Kinds (with this map's custom letters) and Claims; search accepts `kind:<kind>` and `is:<claim>` filters, alone or with words.
* Trouble: `tsc --noEmit` on the root project failed with `TS6142: Module './KindIcons.tsx' was resolved … but '--jsx' is not set`, because `web/src/layout.ts` (also type-checked by the root project) imported a type from a `.tsx` file. Moving `ClaimMark` into `src/kinds.ts` fixed it.
* Civilization demo: 17 nodes got kinds, including a custom `lineage` (dragons, sapiens, Neanderthals, cetaceans → `L`) and cold fusion as a refuted hypothesis. Headless Chrome: marks sit between select and title with no overlap; `kind:lineage` 4 found, `is:refuted` → 室温核聚变, `is:untested` → 鸦科备份谱系; no JS errors. `skill.md` and the README describe the attributes; 99 tests pass.
* Open: the legend popover is now 685 px tall and scrolls; kinds and flags are not editable from the view yet.

### The README example shows 7 preset kinds, two custom ones (`Su`, `Sp`), every verdict style and two qualifiers; same commit `976233a`

* Added: decision, question, a three-hypothesis Readability study with an experiment and a finding, a risk and a milestone, plus `tags`, `priority` and `due`. Edges 8 → 17 (`trial relates frames-help: tests`, `labels-overlap from trial`, …). The test asserts 17 edges and that each mark appears; the README copy is diffed against the file.
* The README image is drawn by `scripts/example-svg.ts` under plain Node, which cannot import JSX. The icon geometry moved to `web/src/markShapes.ts` as data; `KindIcons.tsx` renders it with React and the script with `shapesToSvg`, so the image matches the app.
* `docs/example.svg` is 1369×1265 (23 boxes, 17 lines). A first overlap check reported every claim icon "OUTSIDE": it compared `getBoundingClientRect` with `getBBox`, which differ by the viewBox offset. With screen boxes for both, every mark is inside its card, before the title or after the ID, with no overlap.

### `memo/portolan.rhumb` got kinds and topic tags; the changelog and shipped map were regenerated from the diary (diary-job `7211fab1`, portolan `ef29e2c`)

* Kinds only where an item clearly is one: `decision` (naming, design decisions, relation labels, renderer choice), `artifact` (Spec 0.1), `milestone` (Publishing), and `finding` + `partial` for the expressiveness review (most work fits, experiments stretch it). Topic tags across branches: `research`, `links`, `lines`, `time`, `agents` on 15 items.
* The one-off `/tmp/chlog/build.ts` was extended to days 1008-1012 and to the map's new home: links become `../changelog.md#…`, `repo:` links `../x.md` / `../../README.md`. Before overwriting, a dry run of the old build matched the repo changelog except for its link line, so it held no hand edits. 43 → 50 entries, 58 anchors, no misses.
* Two fixes in the copy: a summary's `&lt;year&gt;` stayed escaped in a Markdown heading (entities are now decoded), and the shipped map's header comment says "changelog" again, as hand-edited before.
* The `I002` came from the :4310 server started before the kinds commit: the Node process keeps its old parser. After a restart camelot-training, deep-starry-midi and portolan load with no diagnostics.

### The hovered card lifts with a drop-shadow, the cards its highlight reaches with a lighter one; portolan `c6c110f`

* A `filter: drop-shadow()` rather than a box-shadow, so the selection ring and the star frame (both box-shadows) are left as they are. Frames never lift. Tokens `--lift-hover` 0 6px 14px / 0.16 and `--lift-near` 0 3px 8px / 0.1, deeper in dark (0.55 / 0.4); 0.5 s fade like the other highlight changes, none under reduced motion.
* Headless check on the project map: hovering Prior-art survey lifted it and its two linked cards (Backlog.md analysis, Naming), no frame, and nothing before or after the hover.

### 12 kinds and every claim style but `retracted` in the civilization demo; portolan `c8fda73`

* More kinds on existing nodes: milestones (LUCA, first crewed orbit, continuous ISS crew), `decision` for the oxygen trade-off, the neocortex as a backup `lineage`, Orion/NERVA/Buran as experiments, the agent toolchain as an `artifact`, and a custom `law` for the three governance items (badges `La` next to `Li`).
* Claims need hypothesis/finding nodes, so the experiments' conclusions became their own nodes: size-brings-intelligence `refuted` (dragon plan), individual-intelligence-is-not-civilization `supported` + `replicated` (octopus; cetaceans and corvids replicate), early seeding `inconclusive` (snowball pilot cut short), molten-salt operation `partial` + `contested`, tether-grade nanotube strength untested. Plus a debris-cascade `risk`, a collector-layout `question` that the first collectors `needs`, and the luminosity `reference`.
* The four finished claim nodes link to their experiment's log entry; without it they were dated by today's commit and would pull their groups down. Headless check: group order unchanged, `kind:hypothesis` 5, `is:refuted` 2, `kind:law` 3, no JS errors.

## 2026-10-13

### An 88 px rail at the far right next to Diagnostics; commits from the server, nodes highlighted on hover; portolan `2513c2b`

* Server: `HistoryTracker.revisions()` runs `git log --follow -n51 --name-only` and `git show <sha>:<path>` per commit (8 at a time), cached by HEAD. `src/timeline.ts` parses each version and compares it with the one before: a node counts as changed when its status, title, attributes, notes or outgoing edges differ, matched by ID, else by title. A local point comes first when the file text differs from the newest commit, dated by mtime. Up to 50 points; one more revision is fetched only as the base. A map without commits gets one point per linked date (same date rule as freshness). Sent as `timeline` in `/api/doc`, so the Pages export includes it.
* View: `TimelineRail` beside the panel, hidden while a node is selected. Ages via `shortAgo` (`now`, `17h`, `2d`, `3mo`, `long time ago`); linked dates via `shortDaysAgo` in whole days (`today`, `3d`) since their time is the end of the day; a run of equal ages labels only its first dot. Hover or keyboard focus highlights the point's nodes like a search (only their lines light up, folded ones through the nearest visible card) and lifts them; the tooltip gives the absolute time, short sha and message, the number of items changed and how many were since removed. At phone width panel and rail share the strip under the map.
* Headless checks: on the shipped map 6 dots, matching `git log --follow` (including commits from before the move into `docs/demo`), labels `17h · 2d · · ·`, every dot on the line; hovering the latest commit (27 items) lit 17 visible cards; moving off the dots cleared it; selecting a node hid the rail; a temporary map outside git showed `today 3d 5d`; no horizontal scroll at 400 px; no JS errors. 105 tests pass, including a rename plus local edit, the cutoff and a deleted node.
* Trouble: `tsc` failed with `TS6142: Module '../web/src/Timeline.tsx' … '--jsx' is not set` because a test imported label helpers from the `.tsx`; they moved to `web/src/timelineLabels.ts`. The rail did not show on :4310 because that server still ran the code from before; after a restart it returns 23 commits for portolan.rhumb and 32 for camelot-training.rhumb.

### The :4310 server still ran the code from before the timeline; restarted, it returns 23 commits for portolan.rhumb and 32 for camelot-training.rhumb

* Same cause as the `I002` on 10-12: the long-running Node process keeps the server code it started with, while the page picks up the rebuilt bundle on refresh. Its `/api/doc` had no `timeline`, so the rail was not drawn. From now on I restart it after any server-side change.

### Newest dot 14 px, spacing 18 → 29 px, ages refreshed on entry, no scrollbar; portolan `7995d54`

* Dots sit centred in a fixed 16 px column, so the line passes through the larger first dot too; the line now starts and ends at the first and last dot centres (`--row / 2`). A first measurement showed the line starting below the first dot (16 px against a 14.5 px centre); fixed.
* `TimelineRail` keeps its own `entered` time and shows ages at `max(now, entered)`; entering the rail sets it when the shown ages are 60 s or more old. Checked by moving the page clock: +30 s left `8m 18h` as is, +2 h changed it to `2h 20h` only after entering.
* Trouble with that check: the clock override passed through `Page.addScriptToEvaluateOnNewDocument` never ran (`window.__realNow is not a function`), so the first runs proved nothing; installing it with `Runtime.evaluate` after load worked.
* Scrollbar: `scrollbar-width: none` plus `::-webkit-scrollbar { display: none }`, `touch-action: pan-y`, `overscroll-behavior: contain`. On camelot-training (590 px of overflow) a 240 px wheel moved it 240 px, and raw touch events moved it 173 px. `Input.synthesizeScrollGesture` with a touch source did not scroll it in headless Chrome, while raw touch events did, so that is the tool, not the page.

### Diff panel under Diagnostics, pinned to the last hovered point; diffs computed by the server from the revision texts; portolan `c2318bf`

* `src/diff.ts`: Myers line diff (common prefix and suffix trimmed first, capped at 2000 edits, beyond which the middle is shown removed then added) and `unifiedDiff` with 3 lines of context and merged hunks. A commit is compared with the revision before it, the first commit with nothing (`--- /dev/null`), local changes with the newest commit. This reuses the texts the timeline already holds, so renames need no git rename detection; the shipped map's first diff shows its old path `docs/portolan.rhumb`.
* Fuzzed against an LCS reference: 4000 random pairs, both sides rebuilt and the edit count always minimal. 20,000 lines with two edits: 29 ms; two unrelated 2,000-line files: about 0.3 s. `Revision` now carries the file's path at each commit.
* `GET /api/diff?file=…&point=<sha|local>` (400 for anything else, 404 for a point not in the history); the Pages export writes `api/diff/<file>/<point>.txt`, 18 for the demo.
* View: `DiffPanel` stays on the last git point hovered or focused, fetched after 120 ms and cached (commits by sha, local by file version); the dot gets a ring; pointing at the panel highlights the point's nodes again; Close dismisses it. File and hunk headers, added and removed lines are colored from the status tokens, with old and new line numbers.
* Checks: the panel's +/− counts match `git show --numstat` (9/0 and 8/1); headless Chrome showed it under Diagnostics, kept after the pointer left, switched between dots, highlighted from the panel and closed, with no JS errors. 108 tests pass.

### Pages runs no server and no git; the history is computed at build time on the Actions runner and published as static files

* `.github/workflows/pages.yml` checks out with `fetch-depth: 0`, so the runner has the full history. `pnpm build:pages` starts `portolan serve` on an ephemeral port there and saves its answers: `api/doc/<file>.json` (with `freshness` and `timeline`, built from `git log --follow` / `git show`) and one `api/diff/<file>/<sha>.txt` per point. The page sees the `portolan-static` meta and reads those files instead of `/api/…`.
* Consequences: the history is frozen at the last deploy; there is never a local point (CI checks out a clean tree); nothing new is exposed, since the repository and its commits are public anyway.

### Front matter `dates: links`: items take only their links' dates and git is not read; on in the civilization demo; portolan `afbe2ee`

* `dates: git | links` (default `git`); any other value is `W014` and counts as `git`. With `links` an item takes its newest dated link, else its newest dated child, else no time; `nodeTimes(doc, null, dateOf)` returns no entry for it, and `NodeTime.lineTime` is null. The card text and the side panel drop the "earlier than commit …" part when there is no line time.
* Server: for such a map `/api/doc` skips `HistoryTracker` entirely (`repo`, `lastCommit` null, `freshness.dates: "links"`), the history rail uses `linkTimeline`, and `/api/diff` returns 404. Diagnostics shows "Dates: from the dates of linked entries; git history is not read" instead of Last commit. The Pages export follows: links timeline for civilization, 6 diffs only for the project map.
* Civilization: 62 items timed (56 by link, 6 by a child), 45 linked dates from 12,025 HE back to -4,352,814,673 HE, ages `9mo` … `40199y`, `long time ago`. Trouble found there: the 13 dates older than about 271,821 BCE are all clamped to `LONG_AGO`, so they tied and kept file order (-66M, -55M, -6M at the end). Ties now fall back to the year as written (HE minus 10000); a test covers it.
* Side effect: undated plan items no longer borrow commit times, so two top-level groups swapped (stellar now below industry). Cases `19-dates` and `20-dates-invalid` plus a committed repo test (times and history stay off git, diff refused); 112 tests pass.

## 2026-10-15

### `{estimate: 2h, started: 2026-10-15T09:30+08:00}`; doing cards show elapsed against estimate, green / amber from 80% / red over

* `src/timing.ts`: `parseDuration` (units largest first, each once; a bare number is not a duration), `parseMoment` (ISO date-time with or without seconds and offset, or a date; local time without an offset; impossible dates rejected), `timingOf`, `formatDuration`. `W015` for a bad estimate, `W016` for a bad start. Case `21-timing` written first and seen failing.
* Attributes work on any node, not only `kind: task`, since experiments take time too; the view only compares while the node is doing. Card chip in the foot: clock icon, a 26 px bar and `31m/2h`; started only shows `21m` grey, estimate only `est. 3h`. Long IDs in the foot now shrink with an ellipsis so the chip fits. Side panel Time row and a legend section.
* Skill: set both when an item becomes or is created `[/]`; a group that is doing only because of a child needs none; on resuming after an interruption, re-estimate the remaining work and reset `started`. Spec section 3.5 (Hierarchy and Notes become 3.6/3.7).
* Headless check on a temporary map with every state: `31m/2h` green, `53m/1h` amber, `2h11m/45m` red with a full bar, all fitting the card; dark-theme chip contrast 8.6-11.7:1.

### An In progress list under the panel's dates, most urgent first, each row a bar of elapsed against estimate

* `byUrgency`: over (by share), nearly due, on time, running without an estimate, estimated but not started. Heading with the count and red/amber flags; past the estimate the bar keeps a mark where the estimate ran out and the rest is the overrun. A row click reveals, selects and centres the node, including inside a folded group.
* Trouble: every row came out grey. `.timed-row { --timer: var(--muted) }` was declared after `.timer-ok/near/over` with equal specificity, so it won. Moving the default before the state classes fixed both rows and card chips in light and dark.

### `finished` and actual times, years in durations, a timing report from `check`, real mission times in the demo; portolan `5ac7e78`

* `timingOf(node, now)` now takes the status: doing counts the time since `started` (a stale `finished` is ignored, `I005`); otherwise both moments give the actual time (`closed`), shown with a check-mark chip, green within the estimate, red over, never amber. `W017` for a finish before the start, which then shows no time. Units gain `y`; durations show their two largest units (`13d`, `5w2d`, `7y2w`).
* Moderate precision: the spec and skill call the values working figures (minutes for hours of work, a date for weeks). A `finished` written as a date is the end of that day, so a same-day run finished as a date does not trip `W017`.
* `portolan check` prints `timing: N doing (…)` and one aligned row per doing node with timing after the diagnostics, without changing the exit code. On the demo: governance 54y20w / 50y over, orbital transport 25y50w / 30y nearly due, three on time.
* Demo: Gagarin 1h48m/2h, Buran 3h25m/4h, Bennu 7y2w/7y4w within, Apollo 8d3h/7d over; times from memory, not looked up. Found there: Bennu at 99.5% read "100%, 10d under"; `sharePercent` now never shows 100 while under the estimate. 121 tests pass.
* The :4310 server had started at 11:41, before the last `timing.ts` edit at 11:42 (the share fix, used only by the bundle and `check`); restarted at 11:45 anyway.

## 2026-10-16

### `W018` for a doing group with nothing doing below it, `I006` for an isolated node; portolan `49816fa`

* `W018`: a node with children in `[/]` whose whole subtree has stopped, so the status is on the wrong node or the group should be finished. A doing leaf anywhere below keeps its ancestors quiet, however deep.
* `I006`: the node and everything below it are untouched by every edge, among several siblings and not at the top level. Both exemptions are as asked: a root answers to nothing, and an only child has no sibling to relate it to.
* Effect: camelot-training gets 7 I006 and no W018; the project map gets 1 W018 (Web view is `[/]` with all children done) and 5 I006. The example map was meant to be a showcase, so its two flagged nodes were given relations (edges 17 → 19) and the README image regenerated.
* The panel showed nothing because :4310 still ran the `derive` from before the checks. The page is served from disk each time, so only the Node process was stale; after a restart camelot-training reports its 7 I006. Third time, so I now restart that server myself after any `src/` change.

### A todo with an estimate and no start shows `est. 30y` as a grey chip; portolan `faf49cd`

* The rule for which cards carry a chip is now one function: doing compares its run with the estimate, a finished run shows what it took, a todo shows only the estimate. Dropped, idea, and a todo that also has a start show none, keeping the values in the side panel as a record.

### Clicking a rail dot opens the groups above the changed nodes and fits the view to their box, zoom capped at about 1.1; portolan `f731362`

* `fitZoom` (`web/src/layout.ts`) centres the box and takes the zoom from the viewport and the box, capped. It uses the same padding arithmetic as the library's `fitBounds` (a share of the viewport per side), read out of the bundled implementation after my first guess of a multiplicative padding was wrong.
* Measured at 1032x825 on the civilization map: four different points framed 6 to 12 nodes each, areas from 383x594 to 937x638, with the cap holding at 1.1 every time.
* Trouble: the test importing `timerState` from `TimerChip.tsx` broke the root typecheck with `TS6142: … '--jsx' is not set`, the same trap as the rail labels on 10-13. The helper moved to `web/src/timerState.ts`.

### Time as height under a real perspective camera: the gauge on the ground, the cards floating at their own times, and the projection done in points so pan, zoom, clicking and the navigator keep working; portolan `1366444`, `b9fc359` → the perspective rework

* A shear was the first attempt and it did not read as 3D at all: `screen = (x + 0.4·z, y − 0.85·z)` changes no size and runs roughly parallel to the layout's own vertical ordering, so the picture stayed the flat map with a nudge. Rebuilt as a real camera — the map on the ground, time as height, an eye with pitch ~29°, yaw ~23°, a distance and a focal length — so the ground converges into a trapezoid (far edge 5476 px of map across vs the near edge, which is off-screen), the nearest card draws 2.82× the farthest, and far cards sit higher on screen and fade to fog 0.62. The pitch sign is the trap: get it wrong and the far ground draws *below* the near ground.
* The projection still computes each point itself rather than transforming the panes. That is not a style choice but the whole reason the follow-up report ("3D 模式下主视图不再能拖动缩放") is answered: with the renderer tilted by a CSS transform, the pan maths keeps working in screen space while the drawing is sheared, so a drag stops following the pointer. Verified in headless Chrome with the view on — a drag of 80,40 px moved the viewport transform by exactly 80.0,40.0, and a wheel notch changed the scale 0.138 → 0.192. Since the camera is real, cards *are* scaled by distance now, so handles sit on the drawn outline and relation lines are projected point by point to lean with the height.
* The depth window comes from the navigator's frame (the visible region), as asked. It is quantised twice — to a round span and to a whole step for its front edge — which is what stops the projection and the visible set from chasing each other: without it the layout moves the cards, the moved cards suggest another window, and it oscillates. A candidate that merely repeats the window from before last is refused. Measured on the demo: zooming in walked the axis 1M years → 1000y → 5y, and panning right off the map kept the last window instead of emptying the ruler.
* Under each timed card, standing on the ground at the foot of its drop line: a solid bar in the status colour from `started` to `finished` for a finished run, the same solid in green/amber/red while running, and a dashed outline for a todo's estimate — a plan is a guess, not a measurement, so it should not read as one. Bar height is the square root of the share of the window, so a fifty-year job does not dwarf a day's work while lengths stay ordered. Groups lie on the ground as flat rectangles with their header floating at the group's own time; the drop lines are what let a height be read against the ruler. A group's own layout size is dropped in 3D — kept, a container drew as a 430×779 px billboard.
* The ruler rises from the ground into the past along the map's left edge, labelling whatever unit suits its span — clock time, days, months (with the date carried on the midnight tick once the span passes a day), then whole years — with every fifth tick drawn heavier. Year ticks are built from year numbers rather than from a running time: a 365-day year is a quarter-day short of a real one, so a grid of them drifted a whole year over a thousand-year step and the labels came out off by one era-wise. Compacting a year also needs its era spelled out, or `1M` reads as a literal year.
* Checked in headless Chrome on the demo and on the real project map: 13 assertions on how it reads (size falls off with distance, the ground is a trapezoid, far cards higher and fainter, bars on the ground, 44 drop lines, toggling off restores the flat view with nothing left behind) plus pan and zoom still following the pointer. 152 tests pass, including the pure-geometry ones. On `civilization.rhumb` the flat view fits at zoom 0.10 and 3D at 0.139, so small cards on a big map in a small pane is the existing framing rather than a 3D defect.
* Two frames of my own test were wrong rather than the code: a synthetic click needs `mouseMoved` first or xyflow never enters the node, and a "card is on screen" probe used the window rather than the canvas, so it kept picking a card under the toolbar.

## 2026-10-17

### Time runs level through the map and every card is a perspective panel at its own moment, drawn by a per-card `matrix3d`; portolan `1609387`

* World axes changed from "map on the ground, time as height" to `t` along time, `d` across (layout x) and `h` up (layout −y). The flat layout is kept whole inside each moment, so a card is its layout rectangle in the (d, h) plane set at its own `t`: its face is orthogonal to the time axis, and cards at the same time share a plane.
* The camera stands on the newer side, looking back along −t: pitch 3.4°, azimuth 44.9°, so `acos(cos az · cos p)` is exactly 45°. Newest is on the right and nearest the eye, so newer panels are drawn larger (1.27× across a window); the text reads the right way round (checked: +d edge to the right, top edge up).
* A panel's exact shape is the perspective image of its rectangle, a projective map of the plane, and CSS `matrix3d` with a perspective row computes exactly that. Each card gets the matrix that carries its own (u, v) onto the projected quad, measured from the node box's corner; matrix vs quad agree to 1e-7 px. The panes are still never 3D-transformed, so drag and wheel stay 1:1. The node is the quad's bounding box with `pointer-events: none !important` (xyflow sets it inline), and only the transformed card takes the pointer, so empty corners do not swallow clicks.
* Hover shows a flat title above the panel, in screen space outside the viewport transform.

### A flat navigator, a pose fitted to the focus nodes, and a camera move that starts on the flat view to the pixel

* xyflow's own `MiniMap` draws nodes where they are rendered, which in 3D is their projected panels, so it is replaced by `FlatMiniMap`: the layout's boxes and the flat view's frame, with the same drag, click and wheel. Entering 3D leaves the main viewport, and the navigator's viewBox, boxes and mask, byte-identical.
* Focus nodes are the cards whose centre the flat frame holds (a group by its header's centre, since a frame can reach far past its title). Their time span is the window — the axis's offset; the axis's length is bisected on a log scale so their 3D bounding box has the pane's shape; then a fit scale and anchor place that box in the frame, with the ruler under it. On both demo maps the focus box comes out at 82–86% of the pane's width or height.
* Everything that places the scene is a blendable `Pose`, and the flat view is the pose at blend 0 (pitch 0, azimuth 0, axis length 0, scale 1, anchor at the aim), where every card lands on its own layout box. Entering 3D is a 900 ms eased move from that pose; leaving turns back and then drops to the flat cards. The first frame of the move matches the flat view at 0.00 px on both maps. Group fills fade out as the camera turns, so it starts from the flat view and ends with frames that are borders only.
* Panning or zooming the flat camera, in the main view or on the navigator, moves to the pose for the cards it now frames (450 ms). The navigator reports its drag start and end, so the pose follows once at the end rather than on every step.
* Judgement calls, both mentioned to the user: the fit scale is capped at 1.6× flat, since a frame of one or two cards would otherwise blow them up several times; and a small pan that changes no focus node gives the same 3D view, which follows directly from "the pose is decided by the focus nodes".
* In the navigator, groups were solid rectangles that hid every card inside them; they are now faint outlines.
* Verified with 159 unit tests and 16 headless-Chrome checks on each demo map: first frame on the flat view, cards in motion at 250 ms, unchanged flat camera and navigator, perspective panels, focus box inside the frame and filling it, the view following a pan of the main view and a drag of the navigator, hover title, click selection, and the move back to flat.

* Troubles on the way, worth keeping:
  * The time axis first sloped about 20° despite a 45° sight line and a small pitch. Lines along time converge on a vanishing point at eye height, so only a line near the eye's height stays level, and the ruler sat on a floor far below. Putting the eye just above the floor (12% of the layout's height), lowering the pitch to 3.4° and moving the eye back to 3× the scene's extent brought it to 5–6°.
  * One card dated 250,000 years ago stretched the civilization map's window so every other card piled at one end. The window is now the shortest stretch holding 85% of the moments; outliers stand in squeezed tails (`axisU`: at most 12% of the axis either side) and keep their order.
  * `localhost:4321` is `portolan serve docs/demo`, which serves `web/dist`, not the sources: two rounds of screenshots showed the old design until `vite build web` was rerun.
  * A crashed probe left headless Chrome listening on its debugging port, and later probes on that port silently connected to it and its old bundle, so instrumentation never appeared. Listing `chrome` processes by `comm` and killing them fixed it. `pkill -f "remote-debugging-port=93"` killed my own shell instead (exit 144), since the pattern is in its own command line — the same self-kill as before.
  * Two probe mistakes, not code bugs: a pan started on an edge's interaction path rather than bare pane, and a zoom point computed from the ruler's bounding-box top slid off the ruler as it tilted.

### Three kinds of bar by status, stacked into lanes where they cross, with a least size on screen; portolan `0893051`

* `ribbonFor` now decides by status: done (or any closed run) is solid from `started` to `finished`, and a done node without both times draws nothing rather than its estimate; doing with an estimate and a start is a progress bar, the plan (start to start + estimate) as an outlined track, the run solid along it to a "now" mark, and anything past the plan's end as overtime; doing without an estimate is the run alone, without a start the estimate alone; any other status with an estimate is a dashed outline from its start if it has one, else from the node's own time. Labels use the timer chip's short form (`4d23h`, `40m/2h`, `est. 3d`), so a bar and its card's chip say the same thing.
* Colours follow the chip's state: ok green, near amber, over red. On an overdue run the in-plan part is paler and the overtime deep red, since with both red the point where the plan ended disappeared.
* At 45° sibling cards in one layout row land at overlapping screen positions, so their bars drew over each other. Bars whose stretches, labels included, would cross on screen now go into lanes under their row by greedy interval partitioning, and the floor sits below the lowest lane. Labels moved from under a bar to beside its newer end, so lanes need no room for text between them. A label's width depends on the fitted scale, so `targetPose` fits once without lanes, assigns them at that scale, then fits again; the lanes are stored in the pose.
* Checked on a scratch git repo whose lines were committed at different dates (`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`), so each node got its own moment: all eight cases drew as specified, including the done node without times drawing nothing. 163 unit tests; 16 browser checks on each demo map still pass.
* The user saw no bars on `:4310`. The server was already serving the new build (it reads `web/dist` per request; the bundle hash matched), but three things combined: the open tab still ran the old bundle; `portolan.rhumb` has no timed node at all (`camelot-training.rhumb` has 114 attributes); and the bars on camelot-training were sub-pixel — sized in world units only, a 16-unit bar at the fitted zoom of about 0.1 is 2 px tall, and an hour on a ten-day axis less than 1 px wide. Bars now keep a least size in screen pixels (7 px thick, 10 px long), carried in the pose as `px`.
* Open: the user then reported the bars looked vertical although the time axis is horizontal. Not diagnosed yet. A likely cause is the least length: a 20-minute run on a ten-day axis is widened to 10 px against a 7 px thickness, which on a foreshortened axis can read as an upright tick rather than a strip; the drop lines from cards to the floor are also vertical and may be what was seen.

### It did not: the page looked live while edits failed; checked by killing a scratch server under an open page

* Each view opened its own `EventSource` in `onServerEvents` and listened only for `hello`, never for `error`, so a dead server left the page unchanged; the browser retried silently.
* 8 s after the drop the bar showed nothing. A status change then came back as `Could not reload: Failed to fetch`: `runEdit` had set `Edit failed: …`, but the `load()` it calls afterwards failed too and overwrote it, so the message did not say the edit was lost. Recovery after the server returned already worked (the `reconnect` refetch).

### One shared event stream with a status, and an icon that tests it on a click; portolan `0192cb4`

* `api.ts` now keeps one `EventSource` for the whole page, shared by the views and the icon, and records its status: checking until the server's `hello`, online after it, offline on `error`. A greeting after an earlier one is a reconnection, and the views refetch. When the browser gives up on the stream (`readyState` CLOSED, as with a proxy error) it is reopened after 5 s; a plainly refused connection keeps being retried by the browser itself.
* A click tests the link: the stream is dropped and opened afresh, and the server must greet it within 5 s, or the first error or the timeout calls it lost. Events from the replaced stream are ignored, so a late error from it cannot decide the test.
* The icon is green while connected, pulses while testing (off under reduced motion), and is red with the word "Disconnected" when lost, since a colour alone is easy to miss. Its tooltip says since when, that disk changes will not show and edits will fail, and the last test's result; a polite live region announces losing and regaining the server. Static exports show no icon.
* 11 unit tests drive a fake `EventSource` with fake timers; a browser run against a scratch server passed 8 checks, among them the drop showing within 1.5 s, a test failing while down, a click reconnecting once the server is back, live updates flowing again after it, and recovery without a click.

### Moved into the doc bar after the reload time, kept there by a wrapper with the bar's auto margin

* The reload time and the icon share a `.live-end` wrapper that takes the bar's `margin-left: auto`, so the icon stays at the right end whether or not an "updated" time is showing. Measured: the icon sat 16 px from the window's right edge, after "updated 9:19:57 PM", and no longer in the top bar. The start page has no control bar, so it now shows no connection status.

### The view is panned by however far the node's box moved in the relayout, then nudged inside the pane; portolan `94a2f5e`

* `followToggle` (layout.ts, pure) takes the node's box before and after the relayout and the viewport, and pans by the difference, so the box's top-left corner — its title and fold button — stays put on screen; the zoom is unchanged. If its top strip (a card, or a group's header, at most 400 px wide) would still be outside the pane, it is moved back inside by 24 px; a group wider than the pane is kept by its title end.
* Only the fold button's own toggle is followed: `onToggle` records the node, and an effect compares the previous and the new ELK layout when it lands. Search, history points and a node from the URL keep their own centring.
* In the browser, 12 folds and unfolds across the portolan map in 2D and the civilization map in 2D and 3D kept the clicked node inside the viewport every time, and the view panned in 8 of them. In 2D the node moved at most 9.5 px, the fold button changing width between "−" and "+12"; in 3D up to 129 px, since the fold changes the focus nodes and the pose refits.

### A failed reload, edit or layout is now one amber warning triangle, its text in the tooltip; portolan `75ba5b8`

* `WarningNotice` sits at the bar's right end before the reload time and the connection icon. The text is in the tooltip, which opens leftward and keeps line breaks; two warnings at once show a count; a click dismisses it; an always-mounted polite live region still announces each warning. The tooltip uses the toolbar's own `data-tip` style rather than a native `title`, so it matches the other icons and shows on keyboard focus too.
* Checked by stubbing `fetch` so the next edit came back 409: the triangle appeared with the text only in its tooltip, the bar stayed 43 px tall, and a click removed it.
* The screenshot showed the triangle turning black on hover and its tooltip running off the window's right edge. The generic `.icon-btn` hover and tooltip rules come later in the sheet with the same specificity, so they won the tie; the connection icon had the same fault. Both buttons' rules now name both classes (`.icon-btn.warn-btn`, `.icon-btn.conn-btn`).

### Folded done nodes take their run from the earliest start to the latest finish inside them; portolan `3c8722c`

* `innerRun` walks every descendant, however deep, and takes the earliest start and the latest finish among those with a closed run (as `timingOf` counts it: any status but doing, with both times). `nodeRibbon` uses it for a done node that is folded and has no closed run of its own; a time the node does have is kept and only the missing end is read from inside.
* Folded only, which the box's `hidden` count says for the layout actually on screen: unfolded, the children draw their own bars, and one for the group would repeat them. Any other status, and a done node with its own run, draw as before.
* The bar is the done colour, paler with a dashed edge, labelled `6d3h · 2 inside`, since it spans its items' work rather than measuring its own.
* 5 unit tests over a parsed map, covering nesting, a dropped item's run counting, a running one not, a one-sided time and nothing timed inside. On a scratch git repo with per-line commit dates, the folded "Release 1" drew `6d3h · 2 inside`, and unfolding it swapped that for its children's `2d9h` and `3d3h`.
* Its run can lie mostly outside the window, which is taken from the cards' own times, not from inferred runs, so it may be squeezed into the tail: in the check it spanned Oct 6–12 against an Oct 12–15 window.

### Regenerated from the diary through 10-17 with the old one-off script, extended; entries up to 10-13 came out identical; portolan `da036ca`

* The generator from the 10-12 copy (`/tmp/chlog/build.ts`) rebuilds the whole changelog from the diary's `[portolan]` entries and rewrites every diary link in `memo/portolan.rhumb` to the changelog heading of the entry it lands in. Extended to 10-14..10-17 and run into a scratch folder first: up to 10-13 the output was identical to the shipped changelog, so nothing hand-edited there was lost; 10-14 has no Portolan entry. It now also keeps a plain top-level bullet that follows an entry without a prompt of its own, such as 10-17's "Troubles on the way" list, which the old script dropped.
* 17 new entries for 10-15..10-17. All 65 changelog anchors the shipped map links to resolve; the Pages build exports both maps; no secret in the copied text.

### Seven nodes of their own instead of notes on older nodes; Web view moved from doing to todo for W018; diary-job `5aa2ba9a`

* The work had been recorded as notes under `ui-depth`, `hot-reload` and `ui-tree`. It now has nodes, each with its Why and links: under `ui-depth`, `ui-depth-panels`, `ui-depth-pose`, `ui-depth-bars` and `ui-depth-inferred`; beside it, `ui-connection`, `ui-warnings` and `ui-fold-follow`. Each new node has a relation (`ui-depth-bars needs ui-depth-panels, ui-timers`, `ui-connection needs hot-reload`, …), so none raises I006.
* The one warning was W018 on `Web view`: doing, with nothing doing below it. It still holds open work (Annotation panel), so it cannot be done, and nothing under it is being worked on, so there is no child to move `[/]` to without inventing one. Set to todo; that leaves an I003 suggestion to mark it doing, which does not apply while nothing is under way. Told the user, to be put back if the 3D view is still considered in progress. The six I006 infos already there were left alone rather than given made-up relations.

### A diagnostic frames the node on its line, or both ends of a relation there, through the history point's framing; portolan `c5ed822`

* Clicking used to select the node on the line and open its groups, but the view did not move. `nodesForLine` (layout.ts, pure) gives what a line is about: the node written there or whose note is, else both ends of a relation written there. The history point's framing was factored into `frameNodes`, which opens the groups above, waits for the layout to show the boxes and fits them with the same 1.1 zoom cap and 500 ms move; a single node is also selected, so its own panel opens. A node's own diagnostics in its panel behave the same.
* A line about no node frames nothing: the front matter, and a relation naming an unknown ID. The parser drops that relation and reports E007 on its line (checked: `a relates ghost` gives no edge), so the view never has it; the first test assumed the known end would survive and was wrong.
* 3 unit tests; in the browser, on a scratch map built to raise W018, W005, W008 and I006: with the view dragged away, W018 brought "Stalled group" back on screen and selected it, and W005 on `deep needs leaf` opened the folded "Old branch" and framed both ends, which had not been on the page at all. The first probe looked for a diagnostic mentioning "working" that the map does not raise.

### The example is timed, its still image draws timer chips, and docs/example-3d.svg animates the turn into 3D and back from the app's own poses; portolan `d960976`

* The example gained six finished runs, three in progress (on time `2d/4d`, nearly due `2d18h/3d`, over `9d9h/7d`) and plans with an estimate, mirrored in the README's copy; `check` is clean. Timers are read at a fixed moment (2026-10-17 18:00 UTC, with `TZ=UTC` set in the scripts), so both images regenerate byte for byte in any time zone. The README copy is checked against the file with a diff.
* The drawing code moved from `example-svg.ts` into `scripts/mapSvg.ts`, shared by both images, and draws each card's timer chip as `TimerChip` does. Ordering siblings by time, as the app does, stretched the example into a tall, mostly empty diagonal (1220×1503 against 1369×1265), so the still image keeps the compact layout.
* `scripts/example-anim.ts` (`pnpm example:anim`) takes poses from `web/src/depth.ts` — `targetPose` for the frame, `flatPose`, `blendPose`, `depthScene` — and samples the same eased move: an 8.8 s loop of flat, turn, 3D, turn back, 32 samples. SVG has no perspective transform, so each card and frame header is carried by a CSS `matrix()` fitted to three corners of its panel, within a pixel or two of the fourth at this camera; lines (as `roundedPath` `d`), bars, the floor and the ruler are re-projected per sample with SMIL. CSS and SMIL share the document clock and duration. A 3D view needs each item's moment, which the app takes from git; the drawing stands in finish, else start, else a group's newest item, else now.
* Checked by pausing both clocks at chosen moments in headless Chrome, and through an `<img>` as the README shows it (flat at 0.6 s, 3D at 4.6 s). The flat frame first differed from the still image in 5% of pixels: the cards were shifted twice, by the panel matrix (which already maps into the frame's corner) and by an inner `translate`; without it the difference is 0.17%, the small end tabs the animated lines leave out.
* Reduced motion should show the flat map still: CSS animations stop and each layer has its flat transform as its base, and since SMIL ignores the media query, the SMIL-moved layers are swapped for still copies. Verified opening the SVG directly; headless Chrome's media emulation does not reach an SVG loaded through `<img>`, so that path was not verified.
* The user then set the still image's display width in the README to 800 themselves (`d47a36d`) instead of the 1.4× intrinsic size I had first written into the script, which they did not keep.

### Every item's line on the floor with a freshness dot, and each bar's stretch projected under it; portolan `611cf9e`

* `depthScene` now returns `shadows`: for each item, the floor line its panel stands on, across its width at its own moment, from its left edge; its drop line lands on it. `barFor` takes the floor height and returns `ground`, the bar's track, fill and overtime projected along the time axis right under the bar.
* `DepthFloor` draws them in the item's status colour; the dot's fill is the status colour mixed toward the surface by freshness, the same 20–100% mapping as a card's left edge, which DocView passes in per item. Bar projections use the bar's own colours: a finished run solid, a run in progress as a pale plan with the run solid along it and overtime red, an estimate dashed. The dot was then shrunk to 0.6× (radius 3.5 → 2.1 screen px) at the user's request.
* Only the 3D animation changed: the still image has no floor and regenerated byte for byte. In the animation an overtime part exists only once the time axis has a length, so the first samples lacked it and the script crashed; a missing part is now a zero-length line at the end of the fill. The file grew from 311 to 423 KB.
* 2 tests (projections on the floor at the right moment and width, the drop landing on its line, the bar's projection under it); on the civilization map 80 panels drew 80 projections and 11 bars their ground lines.
* At a pitch of 3.4° the floor is a thin strip, so on a busy map the lines and dots crowd; old items' dots are pale, as their freshness says. A steeper pitch would show the floor better at the cost of a less level time axis.

## 2026-10-18

### Projections follow the cards' focus both ways, and the title shows where the pointer met the projection; portolan `1062fae`

* The focus memo in DocView now also returns its focus set (`activeNodes` when focused), and `DepthFloor` marks a focused item's projection and its bar's ground line `lit` and every other one `dim` (22 % opacity), with nothing changed when nothing is focused. So a hovered card, the selection, a search and a history point all carry to the floor.
* Pointing at a projection sets the same hover as pointing at the item, with `floor: true`: the item and its lines are highlighted and the other cards dimmed as usual. The card's lift needed a change: `liftCss` left the hovered card out because plain `:hover` lifts it, which does not apply when the pointer is on the floor. Each 2 px projection gets a 10 px transparent line with `pointer-events: stroke`, so it can be hit; the floor layer still passes the pointer through elsewhere, so panning is unaffected. `onFloorHover` is a stable callback so the memoised floor does not redraw on every render.
* The title first went to the projection's middle, which a check caught 44 px from the pointer: a group's projection can be long. It now goes where the pointer met the projection (`screenToFlowPosition` of the enter event). 10 browser checks on the civilization map: with a card hovered, 7 projections lit and 73 dimmed; with a projection hovered, 79 cards dimmed, the card lifted and the title at the pointer; all cleared on leaving.

### Its plan ran out of the time window and was squeezed into the window's tail, with nothing to say so

* The node is a doing milestone, started 2026-10-18 12:56:59+08:00 with an estimate of 8d. Measured on `:4310`: the window was about two days (6195 px); the 13 minutes run was 28 px, to scale; the 8-day plan was 1312 px where its scale gave about 24 800, 19 times short. Bars went through `axisU`, which squeezes times outside the window into a tail of at most 12 % of the axis either side (`TAIL`), and the plan's end, Oct 26, is not a node's moment, so it does not take part in choosing the window. On screen the run looked 2 % of the plan, against 0.1 % in fact.

### Bars use the window's linear scale everywhere; the framing ignores how far they reach; portolan `9965c48`, `bf1369f`

* `linearU` gives a moment's place on the window's own scale with no squeezing, and `barFor` uses it, so a plan of eight days on a two-day window is four windows long. Panels keep `axisU` and its tails.
* Time's newer end comes toward the eye (it stands on the newer side), so a bar reaching far enough passes it, where the projection turns inside out. It is clipped where the eye distance falls to 15 % of the camera distance, along the line of sight's time component; that is always far off screen.
* `targetPose` framed the focus nodes' panels and their bars' points. A long bar's far end, projected near the eye, lands far down the screen, and a test caught it: a 300-day estimate brought the fit scale from 1.6 to 0.32. Now only a bar's height under its own card counts, and a 300-day bar frames exactly as a one-day one. Lanes are assigned from the part of each bar inside the frame, or one long bar would have pushed its whole row into lanes of their own.
* A bar's label stays beside its newer end, or at the screen's right edge on the bar's own line when that end is off screen (`BarLabels`, which follows the viewport so the rest of the floor need not redraw on every pan). The README animation's `est. 2d` label had gone past the image's edge and got the same clamp; that script change went into a second commit, since I left it out of the first.
* Checked against the server's own times on camelot-training: a 10.4-day window, the 8-day plan drawn to 7.90 days before the eye's clip, everything on screen (up to 4.35 days of it) to true scale, the 24.3-minute run drawn as 24.4 minutes, and its label `23m/8d` at the canvas edge. On screen the run is only 0.04 % of the track's width against 0.2 % in time: the track's far end is nearer the eye and drawn larger, so ratios of screen widths are not ratios of time under perspective. 190 tests; the still image has no bars and did not change.

## 2026-10-19

### Rendered as an APNG (720×667, 73 frames, 8.6 s, 3.4 MB); not committed, and the file and script have since left the working tree

* `scripts/example-png.ts`: headless Chrome draws the SVG inline with every animation paused, set per sample to the same time through `document.getAnimations()` (CSS) and `setCurrentTime` (SMIL), and screenshotted over CDP at 20 fps; a frame equal to the one before only lengthens it (the holds).
* ffmpeg 4.4 here has no `-fps_mode` (`Error splitting the argument list: Option not found`); `-vsync vfr` with the concat demuxer worked, but its APNG came out at 10 MB and its delays rounded to 40 and 80 ms instead of 50. The first run also failed cleaning up, `ENOTEMPTY: directory not empty, rmdir '/tmp/example-png-…/profile/Default'`: Chrome was still writing its profile, so the script now waits for it to exit.
* Final route: ffmpeg only makes one 255-colour palette and maps the frames to it (`palettegen`, `paletteuse=dither=none`, raw `pal8`); the script writes the APNG itself, each frame the box round what changed, blended over the one before with unchanged pixels set to a spare transparent entry. 3.4 MB, delays summing to exactly 8.6 s, CRCs checked, frames decoded and looked at.
* The PNG was gone from the working tree before the next commit, so the script, the `example:png` npm script and the README line were held back rather than commit a broken link; later they were gone from the working tree too. Nothing of it is in portolan's history.

### The rail asks for 50 more points at a time, through a rail-only endpoint; each page reads and parses only its own commits; portolan `e417d83`

* Server: `/api/doc` and `/api/diff` take `points` (clamped to 1…2000, `TIMELINE_MAX`), and a new `/api/timeline` sends the rail alone, so loading more does not send the map again or lay it out again. `/api/diff` needs the rail's length too, or an older point's diff is not among the revisions read (a test checks the oldest point is a 404 at `points=2` and found at `points=6`). Linked-date rails are cut at the same length.
* Web: DocView keeps the timeline as its own state, apart from `data`, so a page of history does not rebuild every memo keyed on the map. A ref keeps the rail's length, so a reload asks for as many points as are shown. `TimelineRail` asks for more within 48 px of its end, and right after a page lands if the rail cannot scroll; the old "older not shown" is a "load older" button (also for the keyboard), except on a static export, which has no server.
* Slowness: camelot-training.rhumb has 850 commits, and the first cut took 7 s for 50 points, 11 s for 100, 17 s for 150, because each longer list read and parsed every revision again. Two caches: revisions are reused by sha and path from the list read before (a commit's text never changes), and each revision's parsed signatures are kept per revision object rather than per list. A repeated length now takes 0.1 s; a new page about 5 s, which is the parse itself, about 157 ms for one 240 KB revision of that map, as the first page always cost.
* Browser check on camelot-training: 50 points at first, none asked for unscrolled, 100 after scrolling to the end, and the diff of the oldest loaded point opens. 3 new tests; 193 in all.

### In 3D the flat camera is its own state: the 3D view's pan and zoom leave it and the pose alone; portolan `baac2d6`

* Before, the navigator's frame was the main view's viewport in 3D as well, so looking round the 3D scene moved the frame, and `onMoveEnd` refitted the pose to what it then held. Entering 3D now copies the viewport into a `camera` state; `FlatMiniMap` takes `camera`/`onCamera` and in 3D reads and moves that instead of the main view. `onMoveEnd` only sets the ruler's zoom.
* Dragging, clicking or wheeling the navigator moves the frame, and the pose follows once the drag ends. The view's own framings (a search hit, a history point, a warning, a fold's follow) go through `moveCamera`, which moves the main view in 2D and the frame in 3D. Leaving 3D takes the main view back to the frame in 700 ms while the camera turns flat.
* `targetPose` takes the region the 3D view shows as a separate `screen`: the frame picks the focus nodes, which are fitted into that region, so a refit after the 3D view was panned or zoomed lands where one is looking.
* My first browser check reported nothing moved, because it never entered 3D: the toggle has visible text, so its label is in `data-tip`, not `aria-label`. Redone: a wheel zoom and a drag in 3D moved the view and kept the frame and the ruler; a navigator drag moved the frame and the pose and kept the 3D view; leaving 3D kept the frame, and in 2D a pan moves it again. 1 new test.

### The ruler is solid to true scale over the window, the bars and now, with even ticks; a red "now" line across the floor; projections at 40 %; portolan `6847a95`

* `depthScene` takes `now` and works out the ruler's extent: the window, every bar's `reach` (its stretch along time, as clipped in front of the eye) and the present, clipped there too. The floor widens to it, and `rulerLine`'s solid part is that extent, with dashed tails only beyond it where only squeezed panels stand. Panels outside the window keep `axisU`'s tails, so one standing over the extended ruler does not read true against it; its hover title has the exact time.
* `axisTicks` takes a range and keeps the window's step over it, with ticks at `linearU`. Far back, the perspective packs them; `rulerTicks` keeps major ticks first, then the rest, each only if its label box clears those kept.
* The present is a 2.5 px red line from the ruler to the floor's far edge over a 6 px halo of the background, labelled `now`, left out when off the ruler. `.floor-grounds` has opacity 0.4, which scales lit, plain and dimmed projections alike.
* The README animation passes its fixed moment as now, draws the line, and fades its grounds the same way. A probe of mine showed infinite extents in the flat pose: that was the probe dividing by an axis of length 0, not the scene. Screenshots on portolan.rhumb and camelot-training.rhumb, and of the animation's 3D hold. 195 tests.

### A right-button drag turns the camera about its aim; 0°–90° round the vertical, ±15° from the default pitch, 0.2° per pixel; portolan `f52c1d7`

* `orbitAngles` clamps to `ORBIT`: azimuth from 0° (looking straight back along time) to 90° (straight across it, the ruler level), pitch from `PITCH` − 15° to + 15°. The bounds are the default's, not the drag's start, so repeated drags cannot walk past them. Dragging right now turns towards 90°, and 225 px takes it from the default 45° to either end.
* The canvas wrapper takes the right button in the capture phase, so xyflow's pan never sees it; the turn replaces `pitch`/`azimuth` on the pose and keeps `sigma` and `anchor`, so the scene turns in place about the point it looks at, and the navigator is untouched. The turn is kept across refits (`targetPose` takes `angles`) and reset on entering 3D; the context menu is held back in 3D; a grabbing cursor while turning.
* Ruler labels near 0° run into the screen and were all thinned away by the across-only test; they now collide by their boxes, across and down.
* Browser check: right 225 px brought the ruler level, left 225 px back to the default, far left stopped at 0°; the frame and the view's pan and zoom stayed put, no context menu got through, left-drag still pans. 197 tests.

## 2026-10-20

### The hovered line's label goes on the part of the line on screen, a horizontal run first, off the navigator; portolan `a8f9295`

* `placeLabels` takes `within` (the region on screen, in flow units) and `avoid` (overlays) per request. With `within`, `visibleSpots` clips each segment to the region shrunk by half the label and a gap (Liang–Barsky, the same clip `crosses` used, now shared), samples the visible pieces, and ranks them by distance from the middle of the longest visible horizontal run, a vertical run costing 50 more. Where no stretch of the line has room for the whole label, the visible points are moved in until it fits, and the result is clamped once more.
* DocView gives only the hovered edge a region: the `.react-flow` pane less 6 px, and every `.react-flow__panel` (navigator, zoom buttons, attribution) as `avoid`, under a label is costed 400 per covered share. The memo is not keyed on the viewport, which would replace it on every pan frame; a `viewTick` bumped in `onMoveEnd` places it again once a pan or zoom settles.
* Browser check: portolan.rhumb's longest labelled line, zoomed in to 1.6 at one end so its middle was off screen; on hover the `needs` label was inside the view, under no panel, and on a horizontal run, in 2D and in 3D. 5 new tests; 202 in all.

### W019 and I007, a Blocked list above In progress, rows that highlight their item; portolan `3740273`

* `src/notes.ts` holds `BLOCKED_BY`, `MAX_NOTES` (10) and `blockedReason`, which joins every note starting `blocked_by:` with "; " and returns null when there is none. It is a module of its own because `derive.ts` imports the parser, and with it `node:path` and `yaml`, which the web bundle should not pull in. `derive` reports `W019` for a blocked node with no such note (an empty reason still counts as present) and `I007` for more than 10 notes.
* Side panel: `BlockedWork` lists blocked items in map order, each with its reason as plain text (the row is a button, and a link inside it could not be followed), or "no blocked_by: note" in the warning colour; its header counts those without one. Clicking goes to the item as `TimedWork` does. Both lists report the row under the pointer or keyboard focus; DocView's focus memo treats it as hovering that card (or its nearest visible ancestor in a folded group), with `floor: true` so the card lifts though the pointer is not on it, and the 3D hover title follows it.
* Spec 3.7 and 6, and the skill's status table, notes guidance and diagnostics table, describe both. A node's notes are a description, not a log: on a state change, replace the old state's note.
* Real maps: camelot-training.rhumb's six blocked items all lack the note, and seven of its items have 11 to 36 notes; I left that map to its own session. The example's `Blocked:` note and the civilization demo's three `搁置原因：` notes became `blocked_by:`; portolan.rhumb's Publishing node went from 13 notes to 7, every fact and all eight links kept, in both the memo map (diary-job `06122507`) and its shipped copy. A test keeps the shipped maps free of warnings.
* The first browser check counted 0 dimmed cards on hover: it read the card's opacity, while the focus stylesheet dims the node element. Read there: 69 of 80 cards dimmed for a blocked row, 61 for an in-progress row, none after leaving; a click selected the item. 205 tests.
* The commit was split in two by hand, since DocView carried both changes: the label-only DocView was built from HEAD with only the label edits and typechecked with the rest stashed, committed, and the full file and the stash restored. HEAD had meanwhile moved to the user's `867979e [VERSION] 0.1.4`.

## 2026-10-21

### The whole title in a label laid over the clamped one, wrapped the same way; portolan `3eae0ca`

* `.card-title-box` (relative, not clipping) holds the clamped `.card-title` and an `aria-hidden` `.card-title-full`, absolutely placed over it with `pointer-events: none` and the card's fill. The status `<select>` is `user-select: none`.
* My first version made the label one line, `white-space: nowrap` running past the card's edge, and hid the clamped title under it. The user saw the title still turn from two lines into one on hover. Now the label is the title's own width (`right: 0`) and wraps the same way (`overflow-wrap: anywhere` on both), so its first two lines are the title's and only a longer title runs on below, over the foot; nothing is hidden or moved.
* Browser check on camelot-training: a title of six lines; on hover the clamped title's line positions and the card's size were unchanged, the label's first two lines matched the title's to the pixel, and four more ran below. At its natural size a star under the label still took the click. A first measurement was meaningless, the map being fitted so far out that cards were 26 px wide; the check zooms each card to about 1:1 first. Its second sample card was off screen and was not hovered.

### A starred item's row shows its star before the title, a mark and not a control; portolan `70b69ac`

* `TimedItem` and `BlockedItem` carry `starred`; `ListStar` draws the filled star in the star colour, `role="img"` labelled "Starred", inside the row's one button. `StarIcon` moved to `web/src/StarIcon.tsx`, since `TimerChip.tsx` is imported by `NodeCard.tsx`, which held it; NodeCard re-exports it.
* On camelot-training only the one starred blocked item showed a star: its three starred doing items have no timing, so they are not in In progress at all. A throwaway map served on :4399 checked the timed case: only the starred timed row had a star, clicking the star went to the item, and nothing inside it is a control.

### Faint at rest, whole while hovered, focused or dragged; portolan `44f8b28`

* `.flat-minimap` is at 0.3 with a 0.2 s fade, and at 1 under `:hover`, `:focus-within` and `:active`; `:active` keeps it whole through a drag that leaves it (its pointer capture), which hover alone would not. Reduced motion drops the fade. Measured: 0.3 at rest, 1 hovered, 1 while dragged off it, 0.3 after release.
