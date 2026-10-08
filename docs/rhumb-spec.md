# Rhumb 0.1 Syntax Specification (draft)

Rhumb is Portolan's graph DSL. It describes the hierarchy, status and relations of work items. Each project has one `.rhumb` file. Details live in the diary, and Rhumb only links to them.

Design principle: every syntax element reuses a notation that LLMs and people already know. Rhumb only adds syntax for what those notations cannot express, namely edges.

| Element | Notation | Borrowed from |
| --- | --- | --- |
| File metadata | YAML front matter | Markdown / Jekyll / Mermaid |
| Node | nested `- [ ] title` list | GFM task list |
| Extended statuses | `[/]` `[-]` `[!]` `[?]` | Obsidian Tasks / alternate checkboxes |
| Node ID | trailing `^id` | Obsidian block ID |
| Attributes | trailing `{key: value}` | YAML flow mapping |
| Anchor | `[text](target#heading)` | Markdown link, GitHub heading slug |
| Entry locator | `#heading:~:text=snippet` | URL Text Fragments |
| Comment | `%% ...` | Mermaid / Obsidian |
| Edge | `a needs b` | plain English verb sentence, see section 5 |

## 1. Example

```rhumb
---
rhumb: 0.1
title: Portolan
links:
  diary: ../diary-job/{path}.md
---

- [/] Portolan project ^portolan
  - [x] Prior-art survey ^survey
    - [survey notes](diary:2026/1008#portolan)
  - [/] Rhumb DSL design {owner: claude} ^dsl
    - [/] Syntax spec ^dsl-spec
    - [ ] Parser + formatter ^dsl-parser
  - [ ] Visual frontend ^ui
  - [?] Node annotations and threads ^threads

%% relations
dsl-parser needs dsl-spec
ui needs dsl-parser
threads relates ui
```

## 2. File structure

- Encoding is UTF-8, the extension is `.rhumb`, and line endings are LF. The parser accepts CRLF, and `fmt` writes LF.
- A file has optional front matter followed by a body. The body is parsed line by line, and each line has one of these types:

| Line type | Recognized by |
| --- | --- |
| Blank | whitespace only |
| Comment | starts with `%%` after indentation |
| Node | list item whose marker is followed by a `[S]` checkbox |
| Note | list item without a checkbox |
| Edge | starts at column 0, shaped `ref kind ref…` |

Any other line is error `E001`.

### 2.1 Front matter

If the first line is `---`, everything up to the next `---` is parsed as YAML. The block is optional.

| Key | Meaning | Default |
| --- | --- | --- |
| `rhumb` | syntax version | current version |
| `title` | graph title | file name |
| `links` | link prefix table, `prefix: template`, with a `{path}` placeholder in the template | empty |

Unknown keys are kept and reported as `I001`. A version newer than the parser supports is error `E013`. A missing closing `---`, invalid YAML, or a `links` value that is not a string map is error `E012`; an unterminated block makes the whole file unusable.

## 3. Nodes

```
node-line = indent ("-" | "*") SP "[" S "]" SP title [SP attrs] [SP "^" ID]
```

### 3.1 Statuses

| Symbol | Status | Meaning |
| --- | --- | --- |
| `[ ]` | todo | not started |
| `[/]` | doing | in progress |
| `[x]` | done | finished |
| `[-]` | dropped | abandoned |
| `[!]` | blocked | explicitly blocked; put the reason in a note |
| `[?]` | idea | proposed, not yet committed |

For tolerance the parser also accepts `[X]` and `[~]`, which `fmt` normalizes to `[x]` and `[/]`. Any other symbol is error `E002`.

### 3.2 IDs

- An ID goes at the end of the line as `^` plus the ID. Hand-written IDs match `[a-z0-9][a-z0-9-]{0,47}`.
- A readable ID is the default, and agents must always write one. If the ID is omitted, `fmt` or any write command generates `^_` plus 6 random base32 characters (for example `^_k3f7q2`) and writes it back. The ID never changes after that. IDs starting with `_` are reserved for generated IDs, so hand-written IDs cannot start with `_`.
- Generated IDs are random, not derived from the title, so renaming a node does not change its ID.
- IDs are unique within the file. A duplicate is error `E003`; the first occurrence is the one edges resolve to.
- A trailing `^token` that is not a valid ID (for example `^Not_Valid`) stays in the title and is warning `W009`.
- A node with an empty title (`- [ ] ^id`, `- [ ]`) is error `E011`.
- Edges can only reference IDs, so a node without an ID cannot be the target of an edge.

### 3.3 Title and attributes

The parser strips suffixes from the end of the line, in this order:

1. If the last token matches `^ID`, it is stripped as the ID.
2. If what remains ends with one complete `{…}` that parses as a YAML flow mapping, it is stripped as the attributes.
3. The rest is the title, which is parsed as inline Markdown (links, code, emphasis).

- `^` and `{` in the middle of a title need no escaping. Only a title that itself ends in `^word` or `{…}` must write `\^` or `\{`.
- Reserved attribute keys are `owner`, `due` (ISO date), `tags` (list) and `priority` (`high` / `normal` / `low`). Unknown keys are kept and reported as `I002`.
- Markdown links in a title are anchors, see section 4.

### 3.4 Hierarchy

Nesting follows Markdown nested lists:

- A list item's parent is the nearest preceding node with smaller indentation.
- Siblings must have the same indentation. A dedent must return to an existing level, otherwise it is error `E004`.
- A tab counts as 4 columns, as in CommonMark. `fmt` always writes 2 spaces per level.

### 3.5 Notes

A list item without a checkbox is a note that belongs to its parent node. A note is not a child node: the UI shows it as part of the node's description, not as a new branch.

```rhumb
- [!] K3 hidden-state capture ^capture
  - Wait for the current 4-GPU training job to finish; TP8 needs the whole machine
  - [record](diary:2026/1008#camelot-exp73)
```

- A note at the top level has no parent. It is ignored and reported as `W001`.
- A node indented under a note is attached to the node that owns the note, and reported as `W002`.

## 4. Anchors (links)

Every Markdown link in a node's title or in its notes is an anchor of that node. A node can have any number of anchors.

```
[text](target)       [text](<target with spaces>)       <https://…>
```

Targets are resolved as follows:

| Form | Resolution |
| --- | --- |
| `diary:2026/1008#frag` | look up prefix `diary` in the front matter `links`, replace `{path}` with `2026/1008`; the path is relative to the `.rhumb` file |
| `../notes/x.md#frag` | path relative to the `.rhumb` file |
| `https://…` | used as is |

The fragment (after `#`) is matched like this:

- Heading slugs follow GitHub rules: lowercase, punctuation removed, spaces replaced with `-`.
- A unique prefix of the slug is enough: `#portolan` matches `## Portolan: agent-human shared mind map …`.
- To point at a specific entry under a heading, append a Text Fragment: `#portolan:~:text=Backlog.md`. The resolver picks the first list entry under that heading that contains the text. If the text has spaces, wrap the whole target in angle brackets.

`rhumb check` resolves anchors against the actual files. An undefined prefix is error `E005`. A missing file, a missing heading, an ambiguous prefix or a text fragment that is not found is warning `W003`. The diary lives in another repository and may not always be present, so these are warnings, not errors.

## 5. Edges

```
edge-line = ref SP kind SP ref ("," [SP] ref)* [[SP] ":" [SP] label]
```

An edge line starts at column 0 and can appear anywhere in the body. `fmt` does not reorder edges.

| kind | Meaning | Affects readiness |
| --- | --- | --- |
| `needs` | a depends on b; a becomes ready once b is done | yes |
| `blocks` | a blocks b, same as `b needs a` | yes |
| `relates` | related; undirected without a label, directed with one (see 5.1) | no |
| `replaces` | a supersedes b | no |
| `from` | a was derived from b (split, follow-up, spin-off) | no |

- A `ref` in an edge is a node ID, with or without the `^` prefix (`^a needs ^b`). `fmt` removes the `^`.
- The label is optional free text: `ui needs dsl-parser: needs a stable AST`. With several targets, the label applies to each resulting edge.
- A line shaped like an edge with an unknown kind is `E008` only when its first word is a known ID; otherwise it is plain prose and `E001`. An indented edge line is also `E001`.
- Cross-file references are not supported in 0.1. The form `other.rhumb^id` is reserved and is error `E006` for now.

### 5.1 Domain relations go in labels

The five kinds are kept because each is general across domains and the tools treat it differently: `needs`/`blocks` drive readiness and cycle checks, `replaces` and `from` record supersession and provenance. A relation that only appears in some kinds of work (an experiment compared against a control, a task that uses a dataset, an investigation that tests a hypothesis) is written as a labeled `relates`, not as a new keyword:

```rhumb
a1 relates a0: compared against
train relates dataset: uses
probe relates lr-hypothesis: tests
```

- The label is a verb phrase. The edge reads as one sentence, source + label + target: "a1 compared against a0".
- A labeled `relates` keeps the direction it is written in. An unlabeled `relates` stays undirected.
- Duplicates (`W004`): an unlabeled `relates` matches either direction; labeled edges match on direction and label, so `a relates b: uses` and `a relates b: tests` are two edges.
- Use `needs` only for execution order. A treatment that is compared against a control does not need the control to finish first; write `relates … : compared against`, otherwise readiness and progress become wrong.
- A label is promoted to a keyword only when it recurs across unrelated domains and a tool needs to treat it differently from `relates`.

Edges do not use Mermaid's `-->` because an arrow is ambiguous for dependencies: `a --> b` can be read as "a depends on b" or as "a comes before b". A plain English verb sentence leaves no room for an LLM to read the direction wrong.

| Problem | Code |
| --- | --- |
| reference to an unknown ID | `E007` |
| unknown kind | `E008` |
| cycle through `needs` / `blocks` | `E009` |
| self-edge | `E010` |
| duplicate edge | `W004` (`fmt` removes it) |
| `needs` / `blocks` between a parent and its descendant | `W005` (the hierarchy already expresses containment) |

## 6. Derived semantics

These values are computed by tools and never written to the file.

- **Progress**: done leaves in the subtree divided by (all leaves minus dropped and idea leaves). If the denominator is 0, no progress is shown.
- **Readiness**: a node is ready when its status is todo and every `needs` target (including reversed `blocks`) is done. A dependency on a dropped node is warning `W006` and does not block readiness.
- **Consistency checks**:
  - a done parent whose subtree still has todo, doing or blocked nodes: `W007`
  - a doing or done node with a `needs` target that is not done: `W008`
  - a todo parent with a doing or done child: `I003` (suggests changing the parent to doing)
- **Parent status** is always written explicitly. 0.1 does not derive it, so the file never disagrees with what the UI shows.

## 7. Formatting (`rhumb fmt`)

Goal: when an agent edits one node, the diff touches only that line.

- 2 spaces per indent level, `-` as the list marker, status aliases normalized.
- One space between title, attributes and `^id`, with no column alignment. Alignment would rewrite every line in a sibling group whenever one sibling's title changes length.
- Attributes are written as `{k: v, k: v}` and keep their original key order.
- Missing IDs are generated.
- Edges lose the `^` prefix, duplicates are removed, and there is one space after each `,`.
- Runs of blank lines collapse to one. Comments and their positions are kept.
- Idempotent: `fmt(fmt(x)) == fmt(x)`.

UI write-back also goes through AST → `fmt`, never by splicing into the original text.

Implementation status (0.1 tooling): `rhumb fmt` currently only assigns missing IDs and normalizes status aliases. Programmatic changes go through the edit operations in `src/edit.ts`, which rewrite only the affected lines and reject edits that add new errors. The rest of this section needs a full CST printer and is not implemented yet.

## 8. AST (JSON)

```json
{
  "rhumb": "0.1",
  "title": "Portolan",
  "links": {"diary": "../diary-job/{path}.md"},
  "nodes": [
    {
      "id": "survey", "generated_id": false,
      "status": "done", "title": "Prior-art survey",
      "attrs": {}, "notes": [{"text": "[survey notes](diary:2026/1008#portolan)", "line": 9}],
      "anchors": [{"text": "survey notes", "target": "diary:2026/1008#portolan", "line": 9}],
      "children": [], "line": 8
    }
  ],
  "edges": [{"kind": "needs", "from": "dsl-parser", "to": "dsl-spec", "label": null, "line": 17}],
  "diagnostics": [{"code": "W003", "level": "warning", "line": 9, "message": "…"}]
}
```

`blocks` is kept as written in the AST, and the derivation layer converts it to `needs`. Comments exist only in the CST (used by `fmt`) and are not part of the AST.

## 9. Open items

- Reference-style links `[text][ref]` with definition lines are not supported in 0.1.
- Cross-file references `other.rhumb^id`.
- The sidecar format for node annotations and threads will get its own spec. The 0.1 implementation (`src/threads.ts`) is an append-only `<name>.threads.jsonl` with `open / reply / resolve / reopen / retarget` events.
