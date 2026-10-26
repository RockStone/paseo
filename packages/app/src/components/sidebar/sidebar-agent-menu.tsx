import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore, collectAllTabs } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useAgentMenuActions } from "@/screens/workspace/use-agent-menu-actions";
import {
  useWorkspaceTabRename,
  WorkspaceTabRenameModal,
} from "@/screens/workspace/use-workspace-tab-rename";
import {
  buildAgentRowMenuEntries,
  buildProviderSubagentMenuEntries,
} from "@/screens/workspace/workspace-tab-menu";
import { WorkspaceTabContextMenuItem } from "@/screens/workspace/workspace-tab-context-menu-item";
import { confirmDialog } from "@/utils/confirm-dialog";
import { isWeb } from "@/constants/platform";
import type { SidebarThreadNode } from "@/subagents/sidebar-tree";

const NO_TERMINALS_QUERY_KEY: readonly unknown[] = [];

export function SidebarAgentMenu({
  node,
  ...props
}: {
  node: SidebarThreadNode;
  serverId: string;
  workspaceId: string;
  children: ReactNode;
}) {
  if (node.target.kind === "provider_subagent")
    return <ProviderSubagentMenu target={node.target} {...props} />;
  return <ManagedAgentMenu agentId={node.target.agentId} {...props} />;
}

function ProviderSubagentMenu({
  target,
  serverId,
  children,
}: {
  target: Extract<SidebarThreadNode["target"], { kind: "provider_subagent" }>;
  serverId: string;
  children: ReactNode;
}) {
  const { handleCopyAgentId } = useAgentMenuActions(serverId);
  const menuTestIDBase = `sidebar-provider-subagent-menu-${target.parentAgentId}-${target.subagentId}`;
  const entries = buildProviderSubagentMenuEntries({
    ...target,
    menuTestIDBase,
    onCopyAgentId: handleCopyAgentId,
  });
  return (
    <ContextMenu>
      <ContextMenuTrigger contextOnly={isWeb} enabledOnMobile={false}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent width={220} testID={menuTestIDBase}>
        {entries.map((entry) =>
          entry.kind === "item" ? (
            <WorkspaceTabContextMenuItem key={entry.key} entry={entry} />
          ) : null,
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ManagedAgentMenu({
  agentId,
  serverId,
  workspaceId,
  children,
}: {
  agentId: string;
  serverId: string;
  workspaceId: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const { archiveAgent, isArchivingAgent } = useArchiveAgent();
  const {
    handleCopyResumeCommand,
    handleCopyAgentId,
    handleReloadAgent,
    prepareCloseAgentTab,
    reloadingAgentIds,
  } = useAgentMenuActions(serverId);
  const rename = useWorkspaceTabRename({
    client,
    normalizedServerId: serverId,
    queryClient,
    terminalsData: undefined,
    terminalsQueryKey: NO_TERMINALS_QUERY_KEY,
  });
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId })!;
  const openTabId = useWorkspaceLayoutStore((state) => {
    const layout = state.layoutByWorkspace[workspaceKey];
    const tabs = [
      ...(layout ? collectAllTabs(layout.root) : []),
      ...(state.sheetsByWorkspace[workspaceKey] ?? []).map((sheet) => sheet.tab),
    ];
    return (
      tabs.find((tab) => tab.target.kind === "agent" && tab.target.agentId === agentId)?.tabId ??
      null
    );
  });
  const closing = useRef(false);
  const [isClosing, setClosing] = useState(false);
  const close = useCallback(async () => {
    if (!openTabId || closing.current) return;
    closing.current = true;
    setClosing(true);
    try {
      await prepareCloseAgentTab(agentId);
      const layout = useWorkspaceLayoutStore.getState();
      layout.unpinAgent(workspaceKey, agentId);
      layout.hideAgent(workspaceKey, agentId);
      layout.closeTab(workspaceKey, openTabId);
    } catch {
      toast.error(t("workspace.tabs.toasts.failedToCloseAgent"));
    } finally {
      closing.current = false;
      setClosing(false);
    }
  }, [prepareCloseAgentTab, agentId, openTabId, workspaceKey, toast, t]);
  const archive = useCallback(async () => {
    const agent = useSessionStore.getState().sessions[serverId]?.agents.get(agentId);
    if (
      agent?.status === "running" &&
      !(await confirmDialog({
        title: t("workspace.tabs.confirmations.archiveRunningAgentTitle"),
        message: t("workspace.tabs.confirmations.archiveRunningAgentMessage"),
        confirmLabel: t("workspace.tabs.confirmations.archive"),
        cancelLabel: t("workspace.tabs.confirmations.cancel"),
        destructive: true,
      }))
    )
      return;
    try {
      await archiveAgent({ serverId, agentId });
    } catch {
      toast.error(t("workspace.tabs.toasts.failedToArchiveAgent"));
    }
  }, [agentId, serverId, archiveAgent, t, toast]);
  const archiving = isArchivingAgent({ serverId, agentId });
  const reloading = reloadingAgentIds.has(agentId);
  const entries = useMemo(
    () =>
      buildAgentRowMenuEntries({
        agentId,
        menuTestIDBase: `sidebar-agent-menu-${agentId}`,
        canClose: openTabId !== null && !isClosing,
        reloading,
        archiving,
        onCopyResumeCommand: handleCopyResumeCommand,
        onCopyAgentId: handleCopyAgentId,
        onReloadAgent: handleReloadAgent,
        onArchiveAgent: archive,
        onRenameTab: rename.handleRenameTab,
        onCloseTab: close,
      }),
    [
      agentId,
      openTabId,
      isClosing,
      reloading,
      archiving,
      handleCopyResumeCommand,
      handleCopyAgentId,
      handleReloadAgent,
      archive,
      rename.handleRenameTab,
      close,
    ],
  );
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger contextOnly={isWeb} enabledOnMobile={false}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent width={220} testID={`sidebar-agent-context-menu-${agentId}`}>
          {entries.map((entry) => {
            if (entry.kind === "separator") return <ContextMenuSeparator key={entry.key} />;
            if (entry.kind === "item")
              return <WorkspaceTabContextMenuItem key={entry.key} entry={entry} />;
            return null;
          })}
        </ContextMenuContent>
      </ContextMenu>
      <WorkspaceTabRenameModal
        renamingTab={rename.renamingTab}
        onClose={rename.handleRenameModalClose}
        onSubmit={rename.handleRenameModalSubmit}
      />
    </>
  );
}
