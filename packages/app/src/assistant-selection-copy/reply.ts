import { createContext } from "react";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

export const SelectionReplyContext = createContext<((text: string) => void) | null>(null);

// The web composer hides the markup of these nodes (link targets of `##`/`@@` and attachment
// references, quote markers, code fences, emphasis markers). Splitting one would break the
// Markdown the editor decorates, so a caret inside one moves to its end.
const UNSPLITTABLE = new Set<Nodes["type"]>([
  "link",
  "image",
  "inlineCode",
  "strong",
  "emphasis",
  "code",
  "blockquote",
]);

function tokenEnd(text: string, position: number): number {
  let end = position;
  const pending: Nodes[] = [fromMarkdown(text)];
  while (pending.length > 0) {
    const node = pending.pop() as Nodes;
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined || to <= end || from >= end) {
      if (node.type === "root") pending.push(...node.children);
      continue;
    }
    if (UNSPLITTABLE.has(node.type)) {
      // The outermost node is visited first; nothing inside it can extend past its end.
      end = to;
      continue;
    }
    if ("children" in node) pending.push(...node.children);
  }
  return end;
}

function formatQuote(selectedText: string): string {
  return selectedText
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .trimEnd()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Inserts the excerpt as a Markdown quote on its own lines at the caret, or at the end of the
 * draft when the caret is unknown or no longer fits the draft. A selection is kept: the quote
 * goes after it. The returned caret sits on an empty line after the quote, one blank line
 * below it, so the comment typed there is not a lazy continuation of the quote.
 */
export function insertQuotedReply(
  draft: string,
  selectedText: string,
  caret: { start: number; end: number } | null,
): { text: string; caret: number } {
  const inRange =
    caret !== null &&
    Math.min(caret.start, caret.end) >= 0 &&
    Math.max(caret.start, caret.end) <= draft.length;
  const position = inRange ? tokenEnd(draft, Math.max(caret.start, caret.end)) : draft.length;
  const before = draft.slice(0, position).trimEnd();
  const splitsLine = position > 0 && draft[position - 1] !== "\n";
  let after = draft.slice(position).replace(/^(?:[ \t]*\r?\n)+/, "");
  if (splitsLine) after = after.replace(/^[ \t]+/, "");
  if (after.trim() === "") after = "";
  const head = `${before ? `${before}\n\n` : ""}${formatQuote(selectedText)}\n\n`;
  return { text: `${head}${after ? `\n\n${after}` : ""}`, caret: head.length };
}
