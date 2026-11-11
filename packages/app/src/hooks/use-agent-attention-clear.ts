import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { DaemonConnectionError, type DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createAgentAttentionController } from "@/utils/agent-attention";
import { getIsAppActivelyVisible } from "@/utils/app-visibility";
import { isWeb } from "@/constants/platform";
import { useStableEvent } from "@/hooks/use-stable-event";

type AttentionReason = "finished" | "error" | "permission" | null | undefined;

interface UseAgentAttentionClearParams {
  agentId: string | null | undefined;
  workspaceId: string;
  workspaceHasFinishedAttention: boolean;
  client: DaemonClient | null;
  isConnected: boolean;
  isAgentDataReady: boolean;
  requiresAttention: boolean;
  attentionReason: AttentionReason;
  isScreenFocused: boolean;
  focusRequest: object | null;
  onError: (error: unknown) => void;
}

interface AgentAttentionClearController {
  clearOnInteraction: () => void;
  clearOnInputFocus: () => void;
  clearOnPromptSend: () => void;
}

export function useAgentAttentionClear({
  agentId,
  workspaceId,
  workspaceHasFinishedAttention,
  client,
  isConnected,
  isAgentDataReady,
  requiresAttention,
  attentionReason,
  isScreenFocused,
  focusRequest,
  onError,
}: UseAgentAttentionClearParams): AgentAttentionClearController {
  const [isAppVisible, setIsAppVisible] = useState<boolean>(() => getIsAppActivelyVisible());
  const clearAttention = useStableEvent(async (id: string) => {
    // Paseoi: the sidebar badge aggregates the owning workspace, including stored-only closed
    // agents, so reading one chat reads its workspace.
    if (client) await client.clearWorkspaceAttention(id);
  });
  const reportError = useStableEvent((error: unknown) => {
    // The timeline's reconnect status already explains a lost connection.
    if (error instanceof DaemonConnectionError && error.code === "DAEMON_CONNECTION_LOST") return;
    onError(error);
  });
  const resolvedWorkspaceId = workspaceId.trim();
  const controller = useMemo(
    () =>
      createAgentAttentionController({
        clear: async () => {
          if (resolvedWorkspaceId) await clearAttention(resolvedWorkspaceId);
        },
        onError: reportError,
      }),
    [resolvedWorkspaceId, clearAttention, reportError],
  );

  useEffect(() => {
    const updateVisibility = () => {
      setIsAppVisible(getIsAppActivelyVisible());
    };

    const appStateSubscription = AppState.addEventListener("change", updateVisibility);

    if (isWeb && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", updateVisibility);
      window.addEventListener("focus", updateVisibility);
      window.addEventListener("blur", updateVisibility);

      return () => {
        appStateSubscription.remove();
        document.removeEventListener("visibilitychange", updateVisibility);
        window.removeEventListener("focus", updateVisibility);
        window.removeEventListener("blur", updateVisibility);
      };
    }

    return () => {
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    controller.update({
      focused: isScreenFocused && isAppVisible,
      ready: Boolean(client && agentId && resolvedWorkspaceId && isConnected && isAgentDataReady),
      requiresAttention,
      workspaceHasFinishedAttention,
      attentionReason,
      focusRequest,
    });
  }, [
    controller,
    client,
    agentId,
    resolvedWorkspaceId,
    isConnected,
    isAgentDataReady,
    isScreenFocused,
    isAppVisible,
    requiresAttention,
    workspaceHasFinishedAttention,
    attentionReason,
    focusRequest,
  ]);

  return {
    clearOnInteraction: controller.interaction,
    clearOnInputFocus: controller.focus,
    clearOnPromptSend: controller.focus,
  };
}
