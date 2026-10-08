# Portolan

Portolan is a shared map of work for humans and AI agents. It is a mind map that is also a TODO list and a task log, showing the relations, progress and plans across an agent's whole workflow.

## Why

Agents now do long, branching work: surveys, experiments, refactors that split into sub-tasks and depend on each other. Logs and diaries record what happened, but not the shape of the work. Chat history is linear. It is hard to see what is done, what is blocked and what comes next.

Existing tools cover pieces of this. Agent task trackers keep a task graph, mind-map UIs draw trees, plan-annotation tools let you comment on an agent's plan. None of them gives one shared map that is human-readable, git-friendly, and edited by both the human and the agent.

## Core ideas

- The map holds structure only: work items, status, hierarchy and relations. Details stay in the diary, and the map links into it.
- The map is plain text in the Rhumb DSL (`.rhumb`). It is designed to be easy for LLMs to write: it borrows GFM task lists, YAML and Markdown links, and adds only a small sentence syntax for edges.
- It is designed to diff well in git: one change is one line.
- Annotations live in a sidecar file next to the map, so humans and agents can discuss a node in a thread without cluttering the map.

## The name

A portolan chart was a nautical map drawn from sailors' logbooks, with rhumb lines connecting the ports. It is a map that grows out of logs, which is what this project tries to be. Rhumb is the name of the DSL; its edges are the rhumb lines between work items.

## What a map looks like

```rhumb
---
rhumb: 0.1
title: Portolan
---

- [/] Portolan ^portolan
  - [x] Prior-art survey ^survey
    - Closest pieces: [Backlog.md](https://github.com/MrLesk/Backlog.md), Beads, Plannotator
  - [/] Rhumb DSL {owner: claude} ^rhumb
    - [x] Spec 0.1 ^rhumb-spec
    - [x] Parser ^rhumb-parser
  - [ ] Visual frontend ^ui
  - [?] Agent loop for threads ^threads-agent

%% relations
rhumb-parser needs rhumb-spec
ui needs rhumb-parser: needs a stable AST
threads-agent relates ui
```

Each `- [ ]` item is a node with a status (`[ ]` todo, `[/]` doing, `[x]` done, `[-]` dropped, `[!]` blocked, `[?]` idea) and a stable `^id`. Items without a checkbox are notes. Links are anchors into the diary or elsewhere. Lines like `a needs b` are edges. Progress and readiness are derived by the tools, never stored in the file.

## Status

Portolan is experimental and changing quickly. What exists today:

- Rhumb 0.1 spec and a Peggy-based parser with tests
- `check` (parse errors, consistency, anchor resolution) and a first `fmt` (assigns missing IDs, normalizes status aliases)
- An edit API (set status, add or delete nodes, rename IDs, add or remove edges) that keeps untouched lines intact
- A thread store for annotations in an append-only `.threads.jsonl` sidecar
- A local server that serves the map, derived values and threads, and pushes file changes live
- A first web view, with a mind map and a diary panel, still being built

The server has no authentication and binds to `127.0.0.1` only. Do not expose it.

Next:

- Annotation UI in the web view
- An agent loop that delivers human comments in threads to the agent and writes replies back
- A fuller formatter

## Quick start

pnpm is required. `npm install` crashes with npm 10.9 on this dependency set.

```sh
pnpm install
pnpm test
pnpm build:web

node src/cli.ts check examples/portolan.rhumb
node src/cli.ts serve examples
```

Then open http://127.0.0.1:4310.

## Docs

- [docs/rhumb-spec.md](docs/rhumb-spec.md): the Rhumb 0.1 syntax specification
- [docs/skill.md](docs/skill.md): guide for agents that maintain a Rhumb map
