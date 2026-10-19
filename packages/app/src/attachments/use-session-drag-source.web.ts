import { useCallback, useEffect, useState, type RefCallback } from "react";
import type { Text } from "react-native";
import {
  SESSION_DRAG_MIME,
  createSessionDragPayload,
  type SessionDragSourceInput,
} from "./session-drag";
import { useSessionStore } from "@/stores/session-store";
import {
  useWorkspaceLayoutStore,
  collectAllTabs,
  findPaneById,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export function useSessionDragSource({
  serverId,
  workspaceId,
  target: explicitTarget,
  title,
}: SessionDragSourceInput): RefCallback<Text> {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: Text | null) => {
    setElement(node as unknown as HTMLElement | null);
  }, []);
  useEffect(() => {
    if (!element) return;
    const target = element;
    target.draggable = true;
    function handlePointerDown(event: Event) {
      // Keep native drag gestures out of the reorder sensor and RN mouse responder.
      event.stopPropagation();
    }
    function handleDragStart(event: DragEvent) {
      const session = useSessionStore.getState().sessions[serverId];
      const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
      const layout = workspaceKey
        ? useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]
        : undefined;
      const pane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
      const tab = layout
        ? collectAllTabs(layout.root).find((entry) => entry.tabId === pane?.focusedTabId)
        : null;
      const selectedTarget = explicitTarget ?? tab?.target;
      let agentId = session?.workspaceAgentActivity.get(workspaceId)?.agentId;
      if (selectedTarget?.kind === "provider_subagent") agentId = selectedTarget.parentAgentId;
      else if (selectedTarget?.kind === "agent") agentId = selectedTarget.agentId;
      const agent = agentId
        ? (session?.agents.get(agentId) ?? session?.agentDetails.get(agentId))
        : null;
      if (!agent || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      const payload = createSessionDragPayload({
        serverId,
        workspaceId,
        agent,
        target: explicitTarget,
        title,
      });
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(SESSION_DRAG_MIME, JSON.stringify(payload));
      event.stopPropagation();
    }
    target.addEventListener("pointerdown", handlePointerDown);
    target.addEventListener("mousedown", handlePointerDown);
    target.addEventListener("dragstart", handleDragStart);
    return () => {
      target.draggable = false;
      target.removeEventListener("pointerdown", handlePointerDown);
      target.removeEventListener("mousedown", handlePointerDown);
      target.removeEventListener("dragstart", handleDragStart);
    };
  }, [element, serverId, workspaceId, explicitTarget, title]);
  return ref;
}
