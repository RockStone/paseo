import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

interface ListEdit {
  from: number;
  to: number;
  insert: string;
}

interface NumberedList {
  node: Extract<Nodes, { type: "list" }>;
  from: number;
  depth: number;
}

interface EditBounds {
  from: number;
  beforeEnd: number;
  afterEnd: number;
}

interface MarkdownEntry {
  node: Nodes;
  depth: number;
}

function editBounds(before: string, after: string): EditBounds {
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > from && afterEnd > from && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }
  return { from, beforeEnd, afterEnd };
}

function touchesListMarker(text: string, offset: number): boolean {
  const start = offset === 0 ? 0 : text.lastIndexOf("\n", offset - 1) + 1;
  const marker = /^[ \t]*(?:>[ \t]*)*\d{1,9}[.)](?:[ \t]+|$)/.exec(text.slice(start));
  return marker !== null && offset <= start + marker[0].length;
}

function orderedLists(text: string): NumberedList[] {
  const lists: NumberedList[] = [];
  const pending: MarkdownEntry[] = [{ node: fromMarkdown(text), depth: 0 }];
  for (const { node, depth } of pending) {
    const from = node.position?.start.offset;
    if (node.type === "list" && node.ordered && from !== undefined)
      lists.push({ node, from, depth });
    if ("children" in node) {
      const childDepth = node.type === "list" ? depth + 1 : depth;
      for (const child of node.children) pending.push({ node: child, depth: childDepth });
    }
  }
  return lists;
}

function mappedListStart(offset: number, edit: EditBounds): number {
  if (offset <= edit.from) return offset;
  if (offset >= edit.beforeEnd) return offset + edit.afterEnd - edit.beforeEnd;
  return edit.from;
}

/** Only item-count changes renumber an existing list; typing text or editing a number is literal. */
export function numberedListChanges(before: string, after: string): ListEdit[] {
  if (before === after) return [];
  const edit = editBounds(before, after);
  const removed = before.slice(edit.from, edit.beforeEnd);
  const inserted = after.slice(edit.from, edit.afterEnd);
  const structural =
    removed.includes("\n") ||
    inserted.includes("\n") ||
    touchesListMarker(before, edit.from) ||
    touchesListMarker(after, edit.from);
  if (!structural) return [];

  const originals = new Map<string, NumberedList>();
  for (const list of orderedLists(before)) {
    const key = `${list.depth}:${mappedListStart(list.from, edit)}`;
    if (!originals.has(key)) originals.set(key, list);
  }
  if (originals.size === 0) return [];
  const edits: ListEdit[] = [];
  for (const list of orderedLists(after)) {
    const original = originals.get(`${list.depth}:${list.from}`);
    if (!original || original.node.children.length === list.node.children.length) continue;
    const start = original.node.start ?? 1;
    list.node.children.forEach((item, index) => {
      const from = item.position?.start.offset;
      if (from === undefined) return;
      const marker = /^\d+/.exec(after.slice(from));
      const insert = String(start + index);
      if (marker && marker[0] !== insert) edits.push({ from, to: from + marker[0].length, insert });
    });
  }
  return edits.sort((a, b) => a.from - b.from);
}

function mapSelectionOffset(offset: number, edits: ListEdit[]): number {
  let delta = 0;
  for (const edit of edits) {
    if (offset <= edit.from) break;
    if (offset < edit.to)
      return edit.from + delta + Math.min(offset - edit.from, edit.insert.length);
    delta += edit.insert.length - (edit.to - edit.from);
  }
  return offset + delta;
}

export function normalizeNumberedList(input: {
  before: string;
  text: string;
  selection?: { start: number; end: number };
}) {
  const edits = numberedListChanges(input.before, input.text);
  // Native text-change events precede their selection event. The edit end is the new caret.
  const caret = editBounds(input.before, input.text).afterEnd;
  const selection = input.selection ?? { start: caret, end: caret };
  let text = input.text;
  for (const edit of edits.toReversed())
    text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return {
    text,
    selection: {
      start: mapSelectionOffset(selection.start, edits),
      end: mapSelectionOffset(selection.end, edits),
    },
  };
}

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
    return normalizeNumberedList({
      before: text,
      text: text.slice(0, lineStart) + text.slice(selection.end),
      selection: { start: lineStart, end: lineStart },
    });
  }
  const insertion = `\n${match[1]}${Number(match[2]) + 1}${match[3]} `;
  const caret = selection.start + insertion.length;
  return normalizeNumberedList({
    before: text,
    text: text.slice(0, selection.start) + insertion + text.slice(selection.end),
    selection: { start: caret, end: caret },
  });
}

const INDENT = "  ";
const LIST_ITEM_LINE = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

interface LineEdit {
  at: number;
  removed: number;
  inserted: number;
}

function mapIndentOffset(offset: number, edits: LineEdit[]): number {
  let mapped = offset;
  for (const edit of edits) {
    if (offset < edit.at) break;
    if (edit.inserted > 0) mapped += edit.inserted;
    else if (offset >= edit.at + edit.removed) mapped -= edit.removed;
    else mapped -= offset - edit.at;
  }
  return mapped;
}

function resolveLineEdit(
  text: string,
  at: number,
  direction: "in" | "out",
  multiLine: boolean,
): LineEdit | null {
  if (direction === "in") {
    // Blank lines between indented ones stay empty instead of gaining trailing spaces.
    const isEmpty = at === text.length || text[at] === "\n";
    return multiLine && isEmpty ? null : { at, removed: 0, inserted: INDENT.length };
  }
  const removed = text[at] === "\t" ? 1 : (/^ {1,2}/.exec(text.slice(at, at + 2))?.[0].length ?? 0);
  return removed > 0 ? { at, removed, inserted: 0 } : null;
}

/**
 * Tab and Shift+Tab in the expanded composer. A selection or a list item moves its whole
 * lines by two spaces; a caret in plain text gets two spaces, as in a code editor. Returns
 * null when nothing would change.
 */
export function indentLines(
  text: string,
  selection: { start: number; end: number },
  direction: "in" | "out",
): { text: string; selection: { start: number; end: number } } | null {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  const firstLineStart = text.lastIndexOf("\n", start - 1) + 1;
  const firstLineEnd = text.indexOf("\n", start);
  const firstLine = text.slice(firstLineStart, firstLineEnd < 0 ? text.length : firstLineEnd);
  if (direction === "in" && start === end && !LIST_ITEM_LINE.test(firstLine)) {
    const caret = start + INDENT.length;
    return {
      text: text.slice(0, start) + INDENT + text.slice(end),
      selection: { start: caret, end: caret },
    };
  }
  const lineStarts = [firstLineStart];
  for (let index = text.indexOf("\n", firstLineStart); index >= 0; ) {
    const next = index + 1;
    // A selection that ends at the start of a line does not include that line.
    if (next > end || (next === end && end > start)) break;
    lineStarts.push(next);
    index = text.indexOf("\n", next);
  }
  const edits = lineStarts.flatMap(
    (at) => resolveLineEdit(text, at, direction, lineStarts.length > 1) ?? [],
  );
  if (edits.length === 0) return null;
  let next = text;
  for (const edit of edits.toReversed()) {
    next =
      next.slice(0, edit.at) +
      (edit.inserted > 0 ? INDENT : "") +
      next.slice(edit.at + edit.removed);
  }
  return {
    text: next,
    selection: {
      start: mapIndentOffset(selection.start, edits),
      end: mapIndentOffset(selection.end, edits),
    },
  };
}
