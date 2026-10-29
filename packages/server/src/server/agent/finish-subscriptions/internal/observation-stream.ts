import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import type { HostObservation } from "../../host-operations/index.js";
import type { FinishSubscription, FinishObservationSession } from "../index.js";
import { createObservationBuffer } from "./observation-buffer.js";

interface ObservationScope {
  use<T>(
    serverId: string | undefined,
    action: (host: HostObservation) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}
function isTerminal(snapshot: AgentSnapshotPayload, event?: AgentStreamEvent): boolean {
  if (snapshot.status === "closed" || snapshot.status === "error") return true;
  return (
    snapshot.status === "idle" &&
    (event?.type === "turn_completed" || event?.type === "turn_canceled")
  );
}
function observeState(
  buffer: ReturnType<typeof createObservationBuffer>,
  snapshot: AgentSnapshotPayload | null,
  event: AgentStreamEvent | undefined,
  lastMessage: string | null,
  cycle: { armed: boolean; running: boolean },
): void {
  if (!snapshot) {
    buffer.push({ status: "idle", final: null, lastMessage: null, error: null });
    return;
  }
  cycle.running = snapshot.status === "running" || snapshot.status === "initializing";
  if (cycle.running) cycle.armed = true;
  if (event?.type === "permission_resolved") {
    buffer.resolved(event.requestId);
    return;
  }
  if (event?.type === "turn_started") return;
  if (event?.type === "permission_requested") {
    buffer.push({
      status: "permission",
      final: { ...snapshot, pendingPermissions: [event.request] },
      lastMessage,
      error: null,
    });
    return;
  }
  const terminal = projectTerminal({ snapshot, event, lastMessage, cycle });
  if (terminal) buffer.push(terminal);
}

function projectTerminal(input: {
  snapshot: AgentSnapshotPayload;
  event: AgentStreamEvent | undefined;
  lastMessage: string | null;
  cycle: { armed: boolean };
}) {
  const { snapshot, event, lastMessage, cycle } = input;
  if (!isTerminal(snapshot, event)) return null;
  if (!cycle.armed && snapshot.status !== "closed") return null;
  const silent = !cycle.armed;
  cycle.armed = false;
  return {
    ...(silent ? { silent: true } : {}),
    status: snapshot.status === "error" ? ("error" as const) : ("idle" as const),
    final: snapshot,
    lastMessage,
    error: snapshot.lastError ?? null,
    ...(event?.type === "turn_canceled" ? { reason: "was canceled" as const } : {}),
  };
}

/** One continuous source feeds a bounded buffer while the caller awaits dispatch. */
export async function openFinishObservation(
  resolver: ObservationScope,
  record: FinishSubscription,
  signal: AbortSignal,
): Promise<FinishObservationSession> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const lifetime = AbortSignal.any([signal, controller.signal]);
  const buffer = createObservationBuffer(lifetime);
  const cycle = { armed: true, running: false };
  let observedWork = false;
  function alreadyAcknowledged(snapshot: AgentSnapshotPayload | null): boolean {
    return (
      snapshot !== null &&
      record.acknowledgedActivityAt !== undefined &&
      (snapshot.lastActivityAt ?? snapshot.updatedAt) === record.acknowledgedActivityAt &&
      (snapshot.status === "idle" || snapshot.status === "closed" || snapshot.status === "error")
    );
  }
  let opened!: () => void;
  let failed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    opened = resolve;
    failed = reject;
  });
  const route = resolver
    .use(
      record.serverId,
      async (host) => {
        const release = await host.observe(
          record.childAgentId,
          (snapshot, event, lastMessage, initial) => {
            if (initial && alreadyAcknowledged(snapshot)) {
              if (!observedWork) cycle.armed = false;
              return;
            }
            if (
              snapshot?.status === "running" ||
              snapshot?.status === "initializing" ||
              (!initial && event?.type === "turn_started")
            )
              observedWork = true;
            observeState(buffer, snapshot, event, lastMessage ?? null, cycle);
          },
          lifetime,
          (error) => buffer.fail(error),
        );
        opened();
        // The ordinary wait supplies the initial settled snapshot and covers queued admission.
        // Continuous observation buffers checkpoints and terminal events throughout delivery.
        void host
          .wait(record.childAgentId, lifetime)
          .then((result) => {
            const skip = result.status !== "permission" && alreadyAcknowledged(result.final);
            if ((buffer.pushInitial(result, skip) || skip) && !cycle.running) cycle.armed = false;
            return undefined;
          })
          .catch((error) => buffer.fail(error));
        try {
          if (!lifetime.aborted)
            await new Promise<void>((resolve) =>
              lifetime.addEventListener("abort", () => resolve(), { once: true }),
            );
        } finally {
          await release();
        }
      },
      lifetime,
    )
    .catch((error) => {
      failed(error);
      buffer.fail(error);
    });
  try {
    await ready;
  } catch (error) {
    controller.abort();
    buffer.dispose();
    await route;
    throw error;
  }
  return {
    next: () => buffer.next(),
    async close() {
      controller.abort();
      buffer.dispose();
      await route;
    },
  };
}
