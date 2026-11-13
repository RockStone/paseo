/** How long a new or changed item stays highlighted after it was first shown. */
export const HIGHLIGHT_MS = 30 * 60 * 1000;

interface Entry {
  label: string;
  shownAt: number;
}

/**
 * New or changed ids per key (workspace and tab), with the time each was first shown. Lives at
 * module level so it outlives the drawer closing and remounting.
 */
export class HighlightStore {
  private readonly byKey = new Map<string, Map<string, Entry>>();

  /** Starts the clock for ids not already highlighted; an active id keeps its first time. */
  record(key: string, entries: { id: string; label: string }[], now: number): boolean {
    let changed = false;
    const map = this.byKey.get(key) ?? new Map<string, Entry>();
    for (const { id, label } of entries) {
      const existing = map.get(id);
      if (existing && now - existing.shownAt < HIGHLIGHT_MS) continue;
      map.set(id, { label, shownAt: now });
      changed = true;
    }
    this.byKey.set(key, map);
    return changed;
  }

  /** Id → label for the highlights that have not expired. */
  active(key: string, now: number): Map<string, string> {
    const result = new Map<string, string>();
    const map = this.byKey.get(key);
    if (!map) return result;
    for (const [id, entry] of map) {
      if (now - entry.shownAt >= HIGHLIGHT_MS) map.delete(id);
      else result.set(id, entry.label);
    }
    return result;
  }

  dismiss(key: string, id: string): boolean {
    return this.byKey.get(key)?.delete(id) ?? false;
  }
}
