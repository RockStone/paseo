import type {
  PluginButton,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { badgeLabel, badgeSummaryRpc } from "../shared/board";
import { createDriveboard } from "./drawer";

const POLL_INTERVAL_MS = 10_000;
const BUTTON_ID = "driveboard";

/**
 * Registers one header button per workspace by following the workspace directory, and keeps
 * each button's count current by polling the summary RPC: owner to-dos that are new to the owner
 * plus unseen agent notes.
 */
export function contributeHeaderButtons(client: PluginClientContext) {
  const lifetime = new AbortController();
  const buttons = new Map<string, { registration: PluginButtonRegistration; label?: string }>();
  let summary: Record<string, number> = {};

  const applyLabels = () => {
    for (const [workspaceId, entry] of buttons) {
      const label = badgeLabel(summary[workspaceId]);
      if (label === entry.label) continue;
      entry.label = label;
      entry.registration.update({ label });
    }
  };

  // Every call issues a fresh request so a refresh after a mutation never reuses an older
  // in-flight poll; only the newest response is applied.
  let latestRequest = 0;
  const refreshBadges = async (): Promise<void> => {
    const request = ++latestRequest;
    try {
      const next = await client.rpc(badgeSummaryRpc, {});
      if (lifetime.signal.aborted || request !== latestRequest) return;
      summary = next.workspaces;
      applyLabels();
    } catch (error) {
      if (!lifetime.signal.aborted) console.warn("[driveboard] Summary failed", error);
    }
  };

  const Content = createDriveboard(refreshBadges);

  const register = (workspaceId: string) => {
    if (lifetime.signal.aborted || buttons.has(workspaceId)) return;
    const label = badgeLabel(summary[workspaceId]);
    const button: PluginButton = {
      title: "Driveboard",
      icon: "ListTodo",
      label,
      behavior: { kind: "popover", Content },
    };
    buttons.set(workspaceId, {
      registration: client.addHeaderButton({ id: BUTTON_ID, workspaceId, button }),
      label,
    });
  };
  const unregister = (workspaceId: string) => {
    buttons.get(workspaceId)?.registration.remove();
    buttons.delete(workspaceId);
  };
  const unregisterAll = () => {
    for (const entry of buttons.values()) entry.registration.remove();
    buttons.clear();
  };

  // An owned list subscription delivers existing workspaces, then updates, and a fresh snapshot
  // after a reconnect. workspaces.list takes no abort signal, so a bootstrap that resolves after
  // cleanup releases its subscription immediately.
  let release: (() => Promise<void>) | null = null;
  void client.paseo.workspaces
    .list({ subscribe: {}, page: { limit: 200 } })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) {
        void subscription.release();
        return undefined;
      }
      release = () => subscription.release();
      subscription.subscribe({
        snapshot: ({ entries }) => {
          // Reconcile instead of replacing everything so an open popover survives a reconnect.
          const current = new Set(entries.map((workspace) => workspace.id));
          for (const workspaceId of buttons.keys()) {
            if (!current.has(workspaceId)) unregister(workspaceId);
          }
          for (const workspaceId of current) register(workspaceId);
          void refreshBadges();
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          if (update.kind === "remove") unregister(update.id);
          else register(update.workspace.id);
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted)
        console.error("[driveboard] Workspace observation failed", error);
    });

  const timer = setInterval(() => void refreshBadges(), POLL_INTERVAL_MS);

  return () => {
    lifetime.abort();
    clearInterval(timer);
    void release?.().catch(() => undefined);
    unregisterAll();
  };
}
