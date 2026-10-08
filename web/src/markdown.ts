import DOMPurify from "dompurify";
import { marked } from "marked";

// Links in rendered Markdown open in a new tab without access to this window.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** Markdown → sanitized HTML. Content comes from local files, but files can be edited by anyone with repo access. */
export function renderMarkdown(text: string, inline = false): string {
  const html = inline ? marked.parseInline(text, { async: false }) : marked.parse(text, { async: false });
  return DOMPurify.sanitize(html);
}
