import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

// Paseoi: how long the first-unread highlight stays mounted. The row's fade runs inside it.
export const UNREAD_JUMP_HIGHLIGHT_DURATION_MS = 1300;

interface ActiveUnreadJumpHighlight {
  messageId: string;
  /** Changes on every flash, so a second jump to the same message plays again. */
  token: number;
}

/**
 * Paseoi: which row shows the highlight after an unread jump lands. Each row subscribes for its
 * own message id, so a flash re-renders the target row alone, never the stream.
 */
export interface UnreadJumpHighlightStore {
  flash(messageId: string): void;
  getActive(): ActiveUnreadJumpHighlight | null;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export function createUnreadJumpHighlightStore(
  timers: {
    setTimeout: (callback: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  } = {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): UnreadJumpHighlightStore {
  let active: ActiveUnreadJumpHighlight | null = null;
  let nextToken = 0;
  let clearHandle: unknown = null;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function cancelClear(): void {
    if (clearHandle !== null) timers.clearTimeout(clearHandle);
    clearHandle = null;
  }

  return {
    flash(messageId) {
      cancelClear();
      nextToken += 1;
      const token = nextToken;
      active = { messageId, token };
      emit();
      clearHandle = timers.setTimeout(() => {
        clearHandle = null;
        if (active?.token !== token) return;
        active = null;
        emit();
      }, UNREAD_JUMP_HIGHLIGHT_DURATION_MS);
    },
    getActive: () => active,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      cancelClear();
      active = null;
    },
  };
}

export const UnreadJumpHighlightContext = createContext<UnreadJumpHighlightStore | null>(null);

const subscribeToNothing = () => () => undefined;
const getNothing = () => null;

/** Paseoi: the active flash token for this message's row, or null. */
export function useUnreadJumpHighlightToken(messageId: string): number | null {
  const store = useContext(UnreadJumpHighlightContext);
  const getSnapshot = useCallback(() => {
    const active = store?.getActive();
    return active && active.messageId === messageId ? active.token : null;
  }, [messageId, store]);
  return useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    store ? getSnapshot : getNothing,
  );
}
