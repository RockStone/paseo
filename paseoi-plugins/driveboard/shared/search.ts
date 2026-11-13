import type { TrackerItem } from "./board";
import type { Note } from "./notes";

/** Lowercased, trimmed query; empty means no filter. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function includesQuery(parts: readonly (string | null | undefined)[], query: string): boolean {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  return parts.some((part) => part?.toLowerCase().includes(needle));
}

/** Matches the id (e.g. "N-9"), title, text, detail blocks and reply text, case-insensitively. */
export function itemMatches(item: TrackerItem, query: string): boolean {
  return includesQuery(
    [
      item.id,
      item.title,
      item.text,
      ...item.detailBlocks.map((block) => block.text),
      ...item.replies.map((reply) => reply.text),
    ],
    query,
  );
}

export function filterItems(items: TrackerItem[], query: string): TrackerItem[] {
  return normalizeQuery(query) ? items.filter((item) => itemMatches(item, query)) : items;
}

export function filterNotes(notes: Note[], query: string): Note[] {
  return normalizeQuery(query)
    ? notes.filter((note) => includesQuery([note.title, note.text], query))
    : notes;
}
