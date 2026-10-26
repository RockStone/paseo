import type { StreamItem } from "@/types/stream";
import { isShellCommandRunning } from "./shell-task";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export interface ShellStopTarget {
  serverId: string;
  agentId: string;
  toolCallId: string;
  backgroundTaskId?: string;
}

export function useShellStop(target?: ShellStopTarget) {
  const { t } = useTranslation();
  const serverId = target?.serverId ?? "";
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore((state) => {
    if (!target) return false;
    const session = state.sessions[target.serverId];
    const agent = session?.agents.get(target.agentId) ?? session?.agentDetails.get(target.agentId);
    // COMPAT(agentShellStop): added in Paseoi r112, remove gate after 2027-04-26.
    if (
      session?.serverInfo?.features?.agentShellStop !== true ||
      agent?.capabilities.supportsShellStop !== true
    )
      return false;
    if (target.backgroundTaskId)
      return agent.backgroundTaskIds?.includes(target.backgroundTaskId) === true;
    // Sheets retain their opening details. Read current source rows so completion
    // withdraws the control there too, without treating a stop acknowledgement as completion.
    const matches = (item: StreamItem) =>
      item.kind === "tool_call" &&
      item.payload.source === "agent" &&
      item.payload.data.callId === target.toolCallId;
    const item =
      session.agentStreamTail.get(target.agentId)?.find(matches) ??
      session.agentStreamHead.get(target.agentId)?.find(matches);
    return isShellCommandRunning(item, agent.backgroundTaskIds);
  });
  const [phase, setPhase] = useState<"idle" | "pending" | "requested">("idle");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function stop() {
    if (!target || !supported || inFlight.current) return;
    if (!connected || !client) {
      setError(t("workspace.terminal.hostDisconnected"));
      return;
    }
    inFlight.current = true;
    setError(null);
    setPhase("pending");
    try {
      await client.stopShellCommand(target.agentId, target.toolCallId);
      // Acknowledgement is not completion. Keep waiting for the provider's task/result event.
      setPhase("requested");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("toolCallDetails.stopFailed"));
      setPhase("idle");
    } finally {
      inFlight.current = false;
    }
  }
  return {
    supported,
    phase: supported ? phase : ("idle" as const),
    error: supported ? error : null,
    stop,
  };
}
