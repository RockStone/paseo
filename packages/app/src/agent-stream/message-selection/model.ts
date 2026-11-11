import type { StreamItem } from "@/types/stream";

export type SelectableMessage = Extract<StreamItem, { kind: "user_message" | "assistant_message" }>;
interface SelectedMessage {
  item: SelectableMessage;
  order: number;
}
interface SelectionState {
  target: string | null;
  selected: ReadonlyMap<string, SelectedMessage>;
  pending: boolean;
  error: boolean;
}

export function messageSelectionTarget(serverId: string, agentId: string) {
  return JSON.stringify([serverId, agentId]);
}

/** Owned by one workspace. Source readers outlive virtualized rows; selected snapshots
 * also survive history-window eviction. No timeline scan runs on streaming ticks. */
export function openMessageSelection() {
  let state: SelectionState = { target: null, selected: new Map(), pending: false, error: false };
  const listeners = new Set<() => void>();
  const sources = new Map<string, () => readonly StreamItem[]>();
  let operation = 0;
  function publish(next: SelectionState) {
    state = next;
    for (const listener of listeners) listener();
  }
  function cancel() {
    operation++;
    publish({ target: null, selected: new Map(), pending: false, error: false });
  }
  function markdown() {
    const items = sources.get(state.target ?? "")?.() ?? [];
    const current = new Map(items.map((item, index) => [item.id, { item, order: index }]));
    const selected = [...state.selected.values()].map((entry) => {
      const latest = current.get(entry.item.id);
      return latest &&
        (latest.item.kind === "user_message" || latest.item.kind === "assistant_message")
        ? { item: latest.item, order: latest.order }
        : entry;
    });
    selected.sort((a, b) => {
      const left = a.item.timelineCursor;
      const right = b.item.timelineCursor;
      if (left && right && left.epoch === right.epoch) return left.seq - right.seq;
      return a.item.timestamp.getTime() - b.item.timestamp.getTime() || a.order - b.order;
    });
    return selected
      .map(
        ({ item }) => `### ${item.kind === "user_message" ? "User" : "Assistant"}\n\n${item.text}`,
      )
      .join("\n\n---\n\n");
  }
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    registerSource: (target: string, read: () => readonly StreamItem[]) => {
      sources.set(target, read);
      return () => {
        if (sources.get(target) === read) sources.delete(target);
      };
    },
    start: (target: string) => {
      operation++;
      publish({ target, selected: new Map(), pending: false, error: false });
    },
    cancel,
    toggle: (target: string, item: SelectableMessage) => {
      if (state.target !== target || state.pending) return;
      const selected = new Map(state.selected);
      if (selected.has(item.id)) selected.delete(item.id);
      else
        selected.set(item.id, {
          item,
          order:
            sources
              .get(target)?.()
              .findIndex((row) => row.id === item.id) ?? 0,
        });
      publish({ ...state, selected, error: false });
    },
    markdown,
    copy: async (write: (text: string) => Promise<void>) => {
      if (state.pending || !state.selected.size) return false;
      const text = markdown();
      const request = ++operation;
      publish({ ...state, pending: true, error: false });
      try {
        await write(text);
        if (request !== operation) return false;
        cancel();
        return true;
      } catch {
        if (request === operation) publish({ ...state, pending: false, error: true });
        return false;
      }
    },
  };
}
export type MessageSelectionModel = ReturnType<typeof openMessageSelection>;
