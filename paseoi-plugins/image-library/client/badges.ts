import type {
  PluginButton,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { badgeLabel, countsRpc } from "../shared/images";
import { createLibrary } from "./drawer";

const POLL_INTERVAL_MS = 20_000;
const BUTTON_ID = "image-library";

/**
 * Registers one header button per workspace by following the workspace directory, and keeps each
 * button's count (images added since its drawer was last opened) current by polling the counts RPC.
 */
export function contributeHeaderButtons(client: PluginClientContext) {
  const lifetime = new AbortController();
  const buttons = new Map<string, { registration: PluginButtonRegistration; label?: string }>();
  let counts: Record<string, number> = {};

  const applyLabels = () => {
    for (const [workspaceId, entry] of buttons) {
      const label = badgeLabel(counts[workspaceId]);
      if (label === entry.label) continue;
      entry.label = label;
      entry.registration.update({ label });
    }
  };

  let latestRequest = 0;
  const refreshBadges = async (): Promise<void> => {
    const request = ++latestRequest;
    try {
      const next = await client.rpc(countsRpc, {});
      if (lifetime.signal.aborted || request !== latestRequest) return;
      counts = next.workspaces;
      applyLabels();
    } catch (error) {
      if (!lifetime.signal.aborted) console.warn("[image-library] Counts failed", error);
    }
  };

  const Content = createLibrary(refreshBadges);

  const register = (workspaceId: string) => {
    if (lifetime.signal.aborted || buttons.has(workspaceId)) return;
    const label = badgeLabel(counts[workspaceId]);
    const button: PluginButton = {
      title: "Image library",
      icon: "Images",
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
        console.error("[image-library] Workspace observation failed", error);
    });

  const timer = setInterval(() => void refreshBadges(), POLL_INTERVAL_MS);

  return () => {
    lifetime.abort();
    clearInterval(timer);
    void release?.().catch(() => undefined);
    for (const entry of buttons.values()) entry.registration.remove();
    buttons.clear();
  };
}
