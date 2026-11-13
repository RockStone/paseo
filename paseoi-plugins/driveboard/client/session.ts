import { useCallback, useState } from "react";
import { HighlightStore } from "../shared/highlights";

export type TabKey = "owner" | "progress" | "notes";

// Per workspace and tab, for this app session. Module-level so closing the drawer keeps them.
const queries = new Map<string, string>();
const highlights = new HighlightStore();

/** The tab's search query, kept across tab switches and drawer closes. */
export function useSearchQuery(workspaceId: string, tab: TabKey): [string, (next: string) => void] {
  const key = `${workspaceId}:${tab}`;
  const [query, setQueryState] = useState(() => queries.get(key) ?? "");
  const setQuery = useCallback(
    (next: string) => {
      if (next) queries.set(key, next);
      else queries.delete(key);
      setQueryState(next);
    },
    [key],
  );
  return [query, setQuery];
}

export interface Highlights {
  /** Id → "New" or "Updated" for items still highlighted. */
  labels: ReadonlyMap<string, string>;
  dismiss(id: string): void;
  /** Starts the clock for ids first shown now. */
  show(entries: { id: string; label: string }[]): void;
}

/** Highlighted ids for a tab: 30 minutes from first shown, or until the owner taps the card. */
export function useHighlights(workspaceId: string, tab: TabKey): Highlights {
  const key = `${workspaceId}:${tab}`;
  const [, setTick] = useState(0);
  const show = useCallback(
    (entries: { id: string; label: string }[]) => {
      if (highlights.record(key, entries, Date.now())) setTick((value) => value + 1);
    },
    [key],
  );
  const dismiss = useCallback(
    (id: string) => {
      if (highlights.dismiss(key, id)) setTick((value) => value + 1);
    },
    [key],
  );
  return { labels: highlights.active(key, Date.now()), dismiss, show };
}
