export function openClaudeAuthenticationForm() {
  const listeners = new Set<() => void>();
  const initialRenewal = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  let state = {
    token: "",
    renewal: initialRenewal,
    pending: false,
    error: "",
    saved: false,
    removed: false,
    resetKey: 0,
  };
  function publish(next: Partial<typeof state>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      state = { ...state, token: "" };
      listeners.clear();
    },
    setToken(token: string) {
      publish({ token, saved: false, error: "" });
    },
    setRenewal(value: string) {
      publish({ renewal: value, saved: false, error: "" });
    },
    async remove(remove: () => Promise<unknown>) {
      if (state.pending) return;
      publish({ pending: true, error: "", saved: false, removed: false });
      try {
        await remove();
        publish({ pending: false, token: "", removed: true, resetKey: state.resetKey + 1 });
      } catch {
        publish({
          pending: false,
          error: "Unable to remove the token. Unlock the host’s login keychain and retry.",
        });
      }
    },
    async submit(save: (token: string, renewBy: string) => Promise<unknown>) {
      if (state.pending) return;
      const date = Date.parse(`${state.renewal}T00:00:00Z`);
      const valid =
        /^sk-ant-oat01-[A-Za-z0-9_-]+$/.test(state.token.trim()) &&
        state.token.trim().length <= 8192;
      if (
        !valid ||
        !Number.isFinite(date) ||
        new Date(date).toISOString().slice(0, 10) !== state.renewal ||
        date <= Date.now()
      ) {
        publish({ error: "Enter a setup-token and a future renewal date" });
        return;
      }
      publish({ pending: true, error: "", saved: false, removed: false });
      try {
        await save(state.token.trim(), new Date(date).toISOString());
        publish({ token: "", pending: false, saved: true, resetKey: state.resetKey + 1 });
      } catch {
        publish({
          pending: false,
          error: "Unable to save. Check the host connection and unlocked macOS Keychain.",
        });
      }
    },
  };
}
