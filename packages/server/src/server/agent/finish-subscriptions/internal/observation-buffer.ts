import type { WaitForFinishResult } from "@getpaseo/client/internal/daemon-client";

export type FinishObservationResult = WaitForFinishResult & {
  reason?: "was canceled" | "host unreachable" | "host removed";
  /** Closing an already-reported parent-owned turn only retires its watch. */
  silent?: boolean;
};

/** Coalesces permission checkpoints and preserves completed turns while delivery is pending. */
export function createObservationBuffer(signal: AbortSignal) {
  const delivered = new Set<string>();
  const permissions = new Map<string, FinishObservationResult>();
  const resolvedBeforeInitial = new Set<string>();
  let initialPending = true;
  const terminals: FinishObservationResult[] = [];
  let terminalObserved = false;
  let failure: unknown;
  let wake: (() => void) | undefined;
  const abort = () => {
    failure = signal.reason;
    wake?.();
  };
  signal.addEventListener("abort", abort, { once: true });
  function push(result: FinishObservationResult): void {
    if (result.status === "timeout") return;
    if (result.status === "permission") {
      for (const request of result.final?.pendingPermissions ?? [])
        if (!delivered.has(request.id)) permissions.set(request.id, result);
    } else {
      terminalObserved = true;
      terminals.push(result);
    }
    wake?.();
  }
  return {
    pushInitial(result: FinishObservationResult, skip = false) {
      initialPending = false;
      let settled = false;
      if (result.status === "permission" && result.final) {
        const pendingPermissions = result.final.pendingPermissions.filter(
          (request) => !resolvedBeforeInitial.has(request.id),
        );
        if (pendingPermissions.length)
          push({ ...result, final: { ...result.final, pendingPermissions } });
      } else if (
        !skip &&
        !terminalObserved &&
        result.final?.status !== "running" &&
        result.final?.status !== "initializing"
      ) {
        push(result);
        settled = result.status !== "timeout";
      }
      resolvedBeforeInitial.clear();
      return settled;
    },
    push,
    resolved(id: string) {
      if (initialPending) resolvedBeforeInitial.add(id);
      delivered.delete(id);
      permissions.delete(id);
    },
    fail(error: unknown) {
      failure = error;
      wake?.();
    },
    async next(): Promise<FinishObservationResult> {
      while (true) {
        signal.throwIfAborted();
        const first = permissions.entries().next().value;
        if (first) {
          for (const request of first[1].final?.pendingPermissions ?? []) {
            delivered.add(request.id);
            permissions.delete(request.id);
          }
          return first[1];
        }
        const terminal = terminals.shift();
        if (terminal) return terminal;
        if (failure) throw failure;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    },
    dispose() {
      signal.removeEventListener("abort", abort);
    },
  };
}
