import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  shouldClearAgentAttention,
  type AgentAttentionClearTrigger,
} from "@/utils/agent-attention";
import { getIsAppActivelyVisible } from "@/utils/app-visibility";
import { isWeb } from "@/constants/platform";

type AttentionReason = "finished" | "error" | "permission" | null | undefined;

interface UseAgentAttentionClearParams {
  agentId: string | null | undefined;
  workspaceId: string;
  workspaceHasFinishedAttention: boolean;
  client: DaemonClient | null;
  isConnected: boolean;
  requiresAttention: boolean | null | undefined;
  attentionReason: AttentionReason;
  isScreenFocused: boolean;
}

interface AgentAttentionClearController {
  clearOnInteraction: () => void;
  clearOnInputFocus: () => void;
  clearOnPromptSend: () => void;
  clearOnAgentBlur: () => void;
}

export function useAgentAttentionClear({
  agentId,
  workspaceId,
  workspaceHasFinishedAttention,
  client,
  isConnected,
  requiresAttention,
  attentionReason,
  isScreenFocused,
}: UseAgentAttentionClearParams): AgentAttentionClearController {
  const hasAttention = Boolean(requiresAttention) || workspaceHasFinishedAttention;
  const [isAppVisible, setIsAppVisible] = useState<boolean>(() => getIsAppActivelyVisible());
  const deferredFocusEntryClearRef = useRef(false);
  const prevRequiresAttentionRef = useRef(hasAttention);
  const prevActivelyViewedRef = useRef(isScreenFocused && getIsAppActivelyVisible());
  const prevScreenFocusedRef = useRef(false);
  const prevAppVisibleRef = useRef(getIsAppActivelyVisible());

  const clearAttention = useCallback(
    (trigger: AgentAttentionClearTrigger) => {
      const resolvedAgentId = agentId?.trim();
      const resolvedWorkspaceId = workspaceId.trim();
      if (!client || !resolvedAgentId || !resolvedWorkspaceId) {
        return;
      }
      if (
        !shouldClearAgentAttention({
          agentId: resolvedAgentId,
          isConnected,
          requiresAttention,
          workspaceHasFinishedAttention,
          attentionReason,
          trigger,
          hasDeferredFocusEntryClear: deferredFocusEntryClearRef.current,
        })
      ) {
        return;
      }
      deferredFocusEntryClearRef.current = false;
      // The sidebar badge aggregates the owning workspace, including stored-only closed agents.
      client.clearWorkspaceAttention(resolvedWorkspaceId).catch(() => {});
    },
    [
      agentId,
      attentionReason,
      client,
      isConnected,
      requiresAttention,
      workspaceHasFinishedAttention,
      workspaceId,
    ],
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
    if (!hasAttention) {
      deferredFocusEntryClearRef.current = false;
    }
  }, [hasAttention]);

  useEffect(() => {
    const isActivelyViewed = isScreenFocused && isAppVisible;
    if (
      !prevRequiresAttentionRef.current &&
      hasAttention &&
      prevActivelyViewedRef.current &&
      isActivelyViewed
    ) {
      deferredFocusEntryClearRef.current = true;
    }
    prevRequiresAttentionRef.current = hasAttention;
    prevActivelyViewedRef.current = isActivelyViewed;
  }, [hasAttention, isAppVisible, isScreenFocused]);

  useEffect(() => {
    const enteredScreenFocus = !prevScreenFocusedRef.current && isScreenFocused && isAppVisible;
    const resumedIntoFocusedAgent = !prevAppVisibleRef.current && isAppVisible && isScreenFocused;

    if (enteredScreenFocus || resumedIntoFocusedAgent) {
      clearAttention("focus-entry");
    }

    prevScreenFocusedRef.current = isScreenFocused;
    prevAppVisibleRef.current = isAppVisible;
  }, [clearAttention, isAppVisible, isScreenFocused]);

  return {
    clearOnInteraction: useCallback(() => {
      if (workspaceHasFinishedAttention && isScreenFocused && getIsAppActivelyVisible()) {
        clearAttention("interaction");
      }
    }, [clearAttention, isScreenFocused, workspaceHasFinishedAttention]),
    clearOnInputFocus: useCallback(() => {
      clearAttention("input-focus");
    }, [clearAttention]),
    clearOnPromptSend: useCallback(() => {
      clearAttention("prompt-send");
    }, [clearAttention]),
    clearOnAgentBlur: useCallback(() => {
      clearAttention("agent-blur");
    }, [clearAttention]),
  };
}
