import { useCallback, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { getOpenAgentTabLabel } from "@getpaseo/protocol/agent-labels";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import {
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  getHostRuntimeStore,
} from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { buildProviderCommand } from "@/utils/provider-command-templates";
import { getOrCreateClientId } from "@/utils/client-id";
import { isWeb } from "@/constants/platform";

async function copyAgentText(text: string): Promise<void> {
  // Expo's legacy web fallback can report success after a denied clipboard write.
  if (isWeb) {
    await navigator.clipboard.writeText(text);
  } else if (!(await Clipboard.setStringAsync(text))) {
    throw new Error("Clipboard copy failed");
  }
}

/** Actions shared by agent tabs and sidebar rows. Tab placement belongs to the caller. */
export function useAgentMenuActions(normalizedServerId: string) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const pendingReloads = useRef(new Set<string>());
  const [reloadingAgentIds, setReloadingAgentIds] = useState<ReadonlySet<string>>(new Set());
  const handleCopyAgentId = useCallback(
    async (agentId: string) => {
      if (!agentId) return;
      try {
        await copyAgentText(agentId);
        toast.copied(t("workspace.tabs.toasts.agentIdCopiedLabel"));
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [toast, t],
  );

  const handleCopyResumeCommand = useCallback(
    async (agentId: string) => {
      if (!agentId) return;
      const agent =
        useSessionStore.getState().sessions[normalizedServerId]?.agents?.get(agentId) ?? null;
      const providerSessionId =
        agent?.runtimeInfo?.sessionId ?? agent?.persistence?.sessionId ?? null;
      if (!agent || !providerSessionId) {
        toast.error(t("workspace.tabs.toasts.resumeIdUnavailable"));
        return;
      }

      const command =
        buildProviderCommand({
          provider: agent.provider,
          id: "resume",
          sessionId: providerSessionId,
        }) ?? null;
      if (!command) {
        toast.error(t("workspace.tabs.toasts.resumeCommandUnavailable"));
        return;
      }
      try {
        await copyAgentText(command);
        toast.copied(t("workspace.tabs.toasts.resumeCommandCopiedLabel"));
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [normalizedServerId, toast, t],
  );

  const handleReloadAgent = useCallback(
    async (agentId: string) => {
      if (!client || !isConnected) {
        toast.error(t("workspace.terminal.hostDisconnected"));
        return;
      }

      if (pendingReloads.current.has(agentId)) return;
      pendingReloads.current.add(agentId);
      setReloadingAgentIds(new Set(pendingReloads.current));
      toast.show(t("workspace.tabs.toasts.reloadingAgent"), { durationMs: null });
      try {
        await client.refreshAgent(agentId);
        // Send the existing cursor so the server detects the new epoch and
        // returns reset:true. Without a cursor, the server returns reset:false
        // and the client takes the incremental path, where new-epoch rows are
        // dropped against the stale cursor.
        const sessionState = useSessionStore.getState().sessions[normalizedServerId];
        const currentCursor = sessionState?.agentTimelineCursor.get(agentId);
        await getHostRuntimeStore().fetchAgentTimeline(normalizedServerId, agentId, {
          direction: "tail",
          projection: "projected",
          ...(currentCursor
            ? { cursor: { epoch: currentCursor.epoch, seq: currentCursor.endSeq } }
            : {}),
        });
        toast.show(t("workspace.tabs.toasts.reloadedAgent"), { variant: "success" });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("workspace.tabs.toasts.failedToReloadAgent"),
        );
      } finally {
        pendingReloads.current.delete(agentId);
        setReloadingAgentIds(new Set(pendingReloads.current));
      }
    },
    [client, isConnected, normalizedServerId, toast, t],
  );

  const prepareCloseAgentTab = useCallback(
    async (agentId: string) => {
      const session = useSessionStore.getState().sessions[normalizedServerId];
      const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
      if (!agent?.parentAgentId) return;
      if (!session?.client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const clientId = await getOrCreateClientId();
      await session.client.updateAgent(agentId, {
        labels: { [getOpenAgentTabLabel(clientId)]: "false" },
      });
    },
    [normalizedServerId, t],
  );

  return {
    handleCopyAgentId,
    handleCopyResumeCommand,
    handleReloadAgent,
    prepareCloseAgentTab,
    reloadingAgentIds,
  };
}
