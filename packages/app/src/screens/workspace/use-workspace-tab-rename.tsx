import { useCallback, useState } from "react";
import { type QueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ListTerminalsResponse } from "@getpaseo/protocol/messages";
import { useTranslation } from "react-i18next";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

interface RenamingTabState {
  kind: "terminal" | "agent";
  id: string;
  currentTitle: string;
  linkedWorkspaceId?: string;
}

interface UseWorkspaceTabRenameInput {
  client: DaemonClient | null;
  normalizedServerId: string;
  queryClient: QueryClient;
  terminalsData: ListTerminalsResponse["payload"] | undefined;
  terminalsQueryKey: readonly unknown[];
}

interface UseWorkspaceTabRenameResult {
  renamingTab: RenamingTabState | null;
  handleRenameTab: (tab: WorkspaceTabDescriptor) => void;
  handleRenameModalSubmit: (nextTitle: string) => Promise<void>;
  handleRenameModalClose: () => void;
}

function linkedWorkspaceForAgent(serverId: string, agentId: string): string | undefined {
  const session = useSessionStore.getState().sessions[serverId];
  const agent = session?.agents.get(agentId);
  if (!agent?.workspaceId || agent.parentAgentId || agent.archivedAt) return;
  const workspace = session.workspaces.get(agent.workspaceId);
  if (!workspace?.title?.trim()) return;
  const direct = [...session.agents.values()].filter(
    (entry) => entry.workspaceId === workspace.id && !entry.archivedAt && !entry.parentAgentId,
  );
  return direct.length === 1 ? workspace.id : undefined;
}

export function useWorkspaceTabRename(
  input: UseWorkspaceTabRenameInput,
): UseWorkspaceTabRenameResult {
  const { client, normalizedServerId, queryClient, terminalsData, terminalsQueryKey } = input;
  const { t } = useTranslation();
  const [renamingTab, setRenamingTab] = useState<RenamingTabState | null>(null);

  const handleRenameTab = useCallback(
    (tab: WorkspaceTabDescriptor) => {
      if (tab.target.kind === "terminal") {
        const { terminalId } = tab.target;
        const terminal = terminalsData?.terminals.find((entry) => entry.id === terminalId) ?? null;
        const currentTitle = terminal?.title ?? terminal?.name ?? "";
        setRenamingTab({ kind: "terminal", id: terminalId, currentTitle });
        return;
      }
      if (tab.target.kind === "agent") {
        const { agentId } = tab.target;
        const session = useSessionStore.getState().sessions[normalizedServerId];
        const agent = session?.agents.get(agentId) ?? null;
        const currentTitle = agent?.title ?? "";
        setRenamingTab({
          kind: "agent",
          id: agentId,
          currentTitle,
          linkedWorkspaceId: linkedWorkspaceForAgent(normalizedServerId, agentId),
        });
      }
    },
    [normalizedServerId, terminalsData],
  );

  const handleRenameModalSubmit = useCallback(
    async (nextTitle: string) => {
      if (!renamingTab) return;
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const trimmed = nextTitle.trim();
      if (renamingTab.kind === "terminal") {
        const result = await client.renameTerminal({
          terminalId: renamingTab.id,
          title: trimmed,
        });
        if (!result.success) {
          throw new Error(result.error ?? "Failed to rename terminal");
        }
        void queryClient.invalidateQueries({ queryKey: terminalsQueryKey });
        return;
      }
      if (renamingTab.linkedWorkspaceId) {
        await client.setWorkspaceTitle(renamingTab.linkedWorkspaceId, trimmed);
      } else {
        await client.updateAgent(renamingTab.id, { name: trimmed });
      }
      void queryClient.invalidateQueries({
        queryKey: ["sidebarAgentsList", normalizedServerId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["allAgents", normalizedServerId],
      });
    },
    [client, normalizedServerId, queryClient, renamingTab, terminalsQueryKey, t],
  );

  const handleRenameModalClose = useCallback(() => {
    setRenamingTab(null);
  }, []);

  return {
    renamingTab,
    handleRenameTab,
    handleRenameModalSubmit,
    handleRenameModalClose,
  };
}

export interface WorkspaceTabRenameModalProps {
  renamingTab: RenamingTabState | null;
  onClose: () => void;
  onSubmit: (nextTitle: string) => Promise<void>;
}

export function WorkspaceTabRenameModal({
  renamingTab,
  onClose,
  onSubmit,
}: WorkspaceTabRenameModalProps) {
  const { t } = useTranslation();
  const title =
    renamingTab?.kind === "terminal"
      ? t("workspace.tabs.menu.renameTerminal")
      : t("workspace.tabs.menu.renameAgent");
  const initialValue = renamingTab?.currentTitle ?? "";
  const testID = renamingTab
    ? `workspace-tab-rename-modal-${renamingTab.kind}-${renamingTab.id}`
    : undefined;
  return (
    <AdaptiveRenameModal
      visible={renamingTab !== null}
      title={title}
      initialValue={initialValue}
      submitLabel={t("workspace.tabs.menu.rename")}
      maxLength={200}
      onClose={onClose}
      onSubmit={onSubmit}
      testID={testID}
    />
  );
}
