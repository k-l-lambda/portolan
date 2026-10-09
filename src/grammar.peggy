// Rhumb line grammar. The caller strips indentation and feeds one line at a
// time to `Line`; `Inline` scans Markdown inline text for links (anchors).
// Hierarchy and semantic checks live in parse.ts.

// ---------- Line ----------

Line
  = Comment
  / ListItem
  / Edge
  / Blank

Blank
  = _? !. { return { type: "blank" }; }

Comment
  = "%%" text:$(.*) { return { type: "comment", text }; }

ListItem
  = marker:[-*] _ box:Checkbox body:(_ b:$(.*) { return b; })? {
      return { type: "node", marker, status: box, body: body ?? "" };
    }
  / marker:[-*] _ text:$(.*) { return { type: "note", marker, text }; }
  / marker:[-*] _? !. { return { type: "note", marker, text: "" }; }

// A checkbox must be followed by whitespace or end of line, so `[x](url)` is a link, not a status.
Checkbox
  = "[" s:$[^\]] "]" &([ \t] / !.) { return s; }

Edge
  = from:Ref _ kind:$[a-z]+ _ to:RefList label:Label? _? !. {
      return { type: "edge", from, kind, to, label: label ?? null };
    }

RefList
  = head:Ref tail:(_? "," _? r:Ref { return r; })* { return [head, ...tail]; }

Ref
  = file:$((!".rhumb^" [^ \t,^:])+ ".rhumb") "^" id:IdToken { return { file, id }; }
  / "^"? id:IdToken { return { file: null, id }; }

IdToken
  = $([a-zA-Z0-9_] [a-zA-Z0-9_-]*)

Label
  = _? ":" _? text:$(.+) { return text.trim(); }

_ = [ \t]+

// ---------- Inline ----------

Inline
  = items:InlineItem* { return items.filter((x) => x !== null); }

InlineItem
  = CodeSpan
  / Image
  / Link
  / Autolink
  / Escaped
  / . { return null; }

CodeSpan
  = "`" [^`]* "`" { return null; }

Image
  = "!" LinkBody { return null; }

Link
  = l:LinkBody { return l; }

LinkBody
  = "[" text:$LinkText "]" "(" _? target:Target (_ LinkTitle)? _? ")" {
      return { text, target, start: range().start };
    }

LinkText
  = ([^\]\\] / "\\" .)*

Target
  = "<" t:TargetChar* ">" { return t.join(""); }
  / $[^ \t)]+

// Inside <…>, a backslash escapes ASCII punctuation (CommonMark), e.g. `\>`.
TargetChar
  = "\\" c:[!-/:-@[-`{-~] { return c; }
  / [^>\n]

LinkTitle
  = "\"" [^"]* "\""

Autolink
  = "<" t:$([a-zA-Z] [a-zA-Z0-9+.-]* ":" [^ \t<>]+) ">" {
      return { text: t, target: t, start: range().start };
    }

Escaped
  = "\\" . { return null; }
