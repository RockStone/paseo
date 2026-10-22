import { SidebarAgentMenu } from "./sidebar-agent-menu";
import { memo, useCallback, useMemo, useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { StatusRing } from "@/components/status-ring";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { useSessionStore, selectAgentTurnPresentation, type Agent } from "@/stores/session-store";
import { useSessionDragSource } from "@/attachments/use-session-drag-source";
import { useProviderSubagentStore, providerSubagentKey } from "@/subagents/provider-store";
import { useSubagentsForParent } from "@/subagents";
import {
  buildSidebarThreadTree,
  createSidebarActivityOrderSelector,
  sidebarThreadKeys,
  sidebarWorkspaceTarget,
  workspaceRootAgentIds,
  type SidebarThreadNode,
} from "@/subagents/sidebar-tree";
import {
  useWorkspaceLayoutStore,
  findPaneById,
  collectAllTabs,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSidebarModel } from "./sidebar-model";
import { density } from "@/styles/density";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const EMPTY_AGENTS = new Map<string, Agent>();
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedMessage = withUnistyles(MessageSquare);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function useSidebarAgentTree({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const { nestedWorkspaceParents } = useSidebarModel();
  const nestedWorkspaceIds = useMemo(
    () =>
      new Set(
        [...nestedWorkspaceParents.keys()]
          .filter((key) => key.startsWith(`${serverId}:`))
          .map((key) => key.slice(serverId.length + 1)),
      ),
    [nestedWorkspaceParents, serverId],
  );
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents ?? EMPTY_AGENTS);
  const providerSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const nestingSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerSubagentNesting === true,
  );
  const descriptors = useProviderSubagentStore((state) => state.descriptors);
  const hiddenProviderKeys = useProviderSubagentStore((state) => state.hiddenFromTrack);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const activityCutoff = now - 6 * 60 * 60 * 1000;
  // Subscribe to order and cutoff membership, so output chunks only redraw the
  // tree when they move a row or bring it back into the recent list.
  const selectActivityOrder = useMemo(
    () => createSidebarActivityOrderSelector({ serverId, agents, descriptors, activityCutoff }),
    [serverId, agents, descriptors, activityCutoff],
  );
  const activityOrder = useSessionStore(useShallow(selectActivityOrder));
  const roots = useMemo(() => workspaceRootAgentIds(agents, workspaceId), [agents, workspaceId]);
  const tree = useMemo(
    () =>
      buildSidebarThreadTree({
        serverId,
        workspaceId,
        nestedWorkspaceIds,
        agents,
        descriptors,
        hiddenProviderKeys,
        providerSupported,
        nestingSupported,
        activityCutoff,
        activity: useSessionStore.getState().agentLastActivity,
        activityOrder,
      }),
    [
      serverId,
      workspaceId,
      nestedWorkspaceIds,
      agents,
      descriptors,
      hiddenProviderKeys,
      providerSupported,
      nestingSupported,
      activityCutoff,
      activityOrder,
    ],
  );
  // The workspace row represents its original coordinator, even after another root
  // appears. Other independent roots keep their own named groups.
  const primary = sidebarWorkspaceTarget(agents, workspaceId);
  const visibleTree = tree.flatMap((node) =>
    node.target.kind === "agent" && node.target.agentId === primary?.agentId
      ? node.children
      : [node],
  );
  return { roots, visibleTree, providerSupported };
}

export const SidebarAgentTree = memo(function SidebarAgentTree({
  serverId,
  workspaceId,
  active,
  collapsed,
  model,
}: {
  serverId: string;
  workspaceId: string;
  active: boolean;
  collapsed: boolean;
  model: ReturnType<typeof useSidebarAgentTree>;
}) {
  const { roots, visibleTree, providerSupported } = model;
  const keys = useMemo(() => sidebarThreadKeys(visibleTree), [visibleTree]);
  const { visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(keys, 10);
  const visibleKeys = useMemo(() => new Set(visibleItems), [visibleItems]);
  return (
    <>
      {active && providerSupported
        ? roots.map((parentAgentId) => (
            <DiscoverProviderChildren
              key={parentAgentId}
              serverId={serverId}
              parentAgentId={parentAgentId}
            />
          ))
        : null}
      {!collapsed && visibleTree.length > 0 ? (
        <View style={styles.tree} testID={`sidebar-agent-tree-${serverId}:${workspaceId}`}>
          {visibleTree
            .filter((node) => visibleKeys.has(node.key))
            .map((node) => (
              <ThreadBranch
                key={node.key}
                node={node}
                serverId={serverId}
                workspaceId={workspaceId}
                visibleKeys={visibleKeys}
              />
            ))}
          {canToggle ? (
            <SidebarGroupToggleRow
              compact
              expanded={expanded}
              onPress={toggleExpanded}
              testID={`sidebar-agent-tree-show-more-${serverId}:${workspaceId}`}
            />
          ) : null}
        </View>
      ) : null}
    </>
  );
});

function DiscoverProviderChildren({
  serverId,
  parentAgentId,
}: {
  serverId: string;
  parentAgentId: string;
}) {
  useSubagentsForParent({ serverId, parentAgentId });
  return null;
}

function ThreadBranch({
  node,
  serverId,
  workspaceId,
  visibleKeys,
}: {
  node: SidebarThreadNode;
  serverId: string;
  workspaceId: string;
  visibleKeys: ReadonlySet<string>;
}) {
  const managedRunning = useSessionStore((state) => {
    if (node.target.kind !== "agent") return false;
    const session = state.sessions[serverId];
    const agent =
      session?.agents.get(node.target.agentId) ?? session?.agentDetails.get(node.target.agentId);
    if (!agent) return false;
    const turn = selectAgentTurnPresentation(session, agent.id);
    return (
      deriveSidebarStateBucket({
        status: turn.isActive ? "running" : agent.status,
        pendingPermissionCount: agent.pendingPermissions.length,
        requiresAttention: agent.requiresAttention,
        attentionReason: agent.attentionReason,
      }) === "running"
    );
  });
  const providerRunning = useProviderSubagentStore(
    (state) =>
      node.target.kind === "provider_subagent" &&
      state.descriptors.get(
        providerSubagentKey(serverId, node.target.parentAgentId, node.target.subagentId),
      )?.status === "running",
  );
  const running = managedRunning || providerRunning;
  const nodeWorkspaceId = useSessionStore((state) =>
    node.target.kind === "agent"
      ? (state.sessions[serverId]?.agents.get(node.target.agentId)?.workspaceId ?? workspaceId)
      : node.target.workspaceId,
  );
  const { activeWorkspaceSelection: selection } = useSidebarModel();
  const nodeActive = selection?.serverId === serverId && selection.workspaceId === nodeWorkspaceId;
  const dragRef = useSessionDragSource({
    serverId,
    workspaceId: nodeWorkspaceId,
    target: node.target,
    title: node.title || undefined,
  });
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId: nodeWorkspaceId })!;
  const selected = useWorkspaceLayoutStore((state) => {
    if (!nodeActive) return false;
    const sheet = state.sheetsByWorkspace[workspaceKey]?.at(-1);
    const layout = state.layoutByWorkspace[workspaceKey];
    const pane = layout ? findPaneById(layout.root, layout.focusedPaneId) : null;
    const target =
      sheet?.tab.target ??
      (layout && pane
        ? collectAllTabs(layout.root).find((tab) => tab.tabId === pane.focusedTabId)?.target
        : undefined);
    return target ? workspaceTabTargetsEqual(target, node.target) : false;
  });
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const title = node.title || t("agentList.fallbackTitle");
  const hasChildren = node.children.length > 0;
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const hoverHandlers = useMemo(
    () => (isWeb ? { onMouseEnter: handleHoverIn, onMouseLeave: handleHoverOut } : undefined),
    [handleHoverIn, handleHoverOut],
  );
  const rowStyle = useMemo(
    () => [styles.row, hovered && styles.rowHovered, selected && styles.rowSelected],
    [hovered, selected],
  );
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const open = useCallback(() => {
    if (node.target.kind === "agent") {
      navigateToAgent({ serverId, agentId: node.target.agentId });
    } else {
      const { workspaceId: targetWorkspaceId, ...target } = node.target;
      navigateToWorkspace({ serverId, workspaceId: targetWorkspaceId, target });
    }
  }, [node.target, serverId]);
  const ToggleIcon = expanded ? ThemedChevronDown : ThemedChevronRight;
  const toggleLabel = expanded
    ? t("agentTree.collapse", { title })
    : t("agentTree.expand", { title });
  return (
    <View>
      <SidebarAgentMenu node={node} serverId={serverId} workspaceId={nodeWorkspaceId}>
        <View style={rowStyle} {...hoverHandlers}>
          {hasChildren ? (
            <Pressable
              onPress={toggle}
              accessibilityRole="button"
              accessibilityLabel={toggleLabel}
              accessibilityState={accessibilityState}
              aria-expanded={expanded}
              style={styles.toggle}
              testID={`sidebar-agent-tree-toggle-${node.key}`}
            >
              {running ? (
                <View testID={`sidebar-agent-tree-running-${node.key}`}>
                  <StatusRing />
                </View>
              ) : (
                <ToggleIcon size={12} uniProps={iconColor} />
              )}
            </Pressable>
          ) : (
            <View style={styles.toggle}>
              {running ? (
                <View testID={`sidebar-agent-tree-running-${node.key}`}>
                  <StatusRing />
                </View>
              ) : (
                <ThemedMessage size={10} uniProps={iconColor} />
              )}
            </View>
          )}
          <Pressable
            onPress={open}
            accessibilityRole="button"
            accessibilityLabel={t("agentTree.open", { title })}
            style={styles.thread}
            aria-selected={selected}
            testID={`sidebar-agent-tree-row-${node.key}`}
          >
            <Text ref={dragRef} style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </Pressable>
        </View>
      </SidebarAgentMenu>
      {hasChildren && expanded ? (
        <View style={styles.children}>
          {node.children
            .filter((child) => visibleKeys.has(child.key))
            .map((child) => (
              <ThreadBranch
                key={child.key}
                node={child}
                serverId={serverId}
                workspaceId={workspaceId}
                visibleKeys={visibleKeys}
              />
            ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  tree: { marginLeft: theme.spacing[4], marginBottom: theme.spacing[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.md,
    minHeight: density.tightRowHeight,
  },
  rowSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
  rowHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  toggle: {
    width: { xs: 32, md: 24 },
    minHeight: density.tightRowHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  thread: {
    flex: 1,
    minWidth: 0,
    minHeight: density.tightRowHeight,
    justifyContent: "center",
    paddingRight: theme.spacing[2],
  },
  title: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  children: {
    marginLeft: 12,
    paddingLeft: theme.spacing[2],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
}));
