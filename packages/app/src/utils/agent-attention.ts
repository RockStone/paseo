interface AttentionState {
  focused: boolean;
  ready: boolean;
  requiresAttention: boolean;
  // Paseoi: another chat in the owning workspace finished unread. Reading this chat reads it too.
  workspaceHasFinishedAttention?: boolean;
  attentionReason: "finished" | "error" | "permission" | null | undefined;
  focusRequest: object | null;
}

function hasAttention(state: AttentionState): boolean {
  return state.requiresAttention || state.workspaceHasFinishedAttention === true;
}

function hasFinishedAttention(state: AttentionState): boolean {
  return state.requiresAttention
    ? state.attentionReason === "finished"
    : state.workspaceHasFinishedAttention === true;
}

export function createAgentAttentionController(deps: {
  clear: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  let state: AttentionState | null = null;
  let inFlight = false;
  let pendingFocus = false;

  function acknowledgeFocus() {
    if (!pendingFocus || !state?.focused || !state.ready) return;
    pendingFocus = false;
    if (!hasAttention(state) || state.attentionReason === "permission" || inFlight) return;
    inFlight = true;
    void deps.clear().then(
      () => {
        inFlight = false;
        return undefined;
      },
      (error: unknown) => {
        inFlight = false;
        deps.onError(error);
      },
    );
  }

  return {
    focus() {
      if (!state?.focused) return;
      pendingFocus = true;
      acknowledgeFocus();
    },
    // Paseoi: a touch or key press in the chat reads a finished completion, even one that arrived
    // while the chat was in view. Errors and permission requests wait for a deliberate focus.
    interaction() {
      if (!state?.focused || !hasFinishedAttention(state)) return;
      pendingFocus = true;
      acknowledgeFocus();
    },
    update(next: AttentionState) {
      const entered = next.focused && !state?.focused;
      const requested = next.focusRequest !== null && next.focusRequest !== state?.focusRequest;
      state = { ...next };
      if (!next.focused) pendingFocus = false;
      else if (entered || requested) pendingFocus = true;
      acknowledgeFocus();
    },
  };
}
