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
