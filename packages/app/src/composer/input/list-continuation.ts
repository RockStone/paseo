import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

export function continueNumberedList(text: string, selection: { start: number; end: number }) {
  const lineStart = text.lastIndexOf("\n", selection.start - 1) + 1;
  const before = text.slice(lineStart, selection.start);
  const match = /^(\s*)(\d+)([.)]) (.*)$/.exec(before);
  if (!match) return null;
  const nodes: Nodes[] = [fromMarkdown(text)];
  for (const node of nodes) {
    if (
      node.type === "code" &&
      (node.position?.start.offset ?? 0) <= selection.start &&
      (node.position?.end.offset ?? 0) >= selection.start
    )
      return null;
    if ("children" in node) nodes.push(...node.children);
  }
  const nextNewline = text.indexOf("\n", selection.end);
  const lineEnd = nextNewline < 0 ? text.length : nextNewline;
  const isEmptyItem = match[4] === "" && text.slice(selection.end, lineEnd).trim() === "";
  if (isEmptyItem) {
    return {
      text: text.slice(0, lineStart) + text.slice(selection.end),
      selection: { start: lineStart, end: lineStart },
    };
  }
  const insertion = `\n${match[1]}${Number(match[2]) + 1}${match[3]} `;
  const caret = selection.start + insertion.length;
  return {
    text: text.slice(0, selection.start) + insertion + text.slice(selection.end),
    selection: { start: caret, end: caret },
  };
}
