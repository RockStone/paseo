import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useProviderSubagentStore } from "@/subagents/provider-store";
import { useSubagentsForParent } from "@/subagents";
import {
  buildSidebarThreadTree,
  workspaceRootAgentIds,
  type SidebarThreadNode,
} from "@/subagents/sidebar-tree";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { density } from "@/styles/density";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const EMPTY_AGENTS = new Map<string, Agent>();
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedMessage = withUnistyles(MessageSquare);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const SidebarAgentTree = memo(function SidebarAgentTree({
  serverId,
  workspaceId,
  active,
}: {
  serverId: string;
  workspaceId: string;
  active: boolean;
}) {
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents ?? EMPTY_AGENTS);
  const providerSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const nestingSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerSubagentNesting === true,
  );
  const descriptors = useProviderSubagentStore((state) => state.descriptors);
  const hiddenProviderKeys = useProviderSubagentStore((state) => state.hiddenFromTrack);
  const roots = useMemo(() => workspaceRootAgentIds(agents, workspaceId), [agents, workspaceId]);
  const tree = useMemo(
    () =>
      buildSidebarThreadTree({
        serverId,
        workspaceId,
        agents,
        descriptors,
        hiddenProviderKeys,
        providerSupported,
        nestingSupported,
      }),
    [
      serverId,
      workspaceId,
      agents,
      descriptors,
      hiddenProviderKeys,
      providerSupported,
      nestingSupported,
    ],
  );
  // A single coordinator is already represented by the workspace row. Keep named
  // groups only when multiple independent coordinators would otherwise be ambiguous.
  const visibleTree = roots.length === 1 ? tree.flatMap((node) => node.children) : tree;
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
      {tree.length > 0 ? (
        <View style={styles.tree} testID={`sidebar-agent-tree-${serverId}:${workspaceId}`}>
          {visibleTree.map((node) => (
            <ThreadBranch key={node.key} node={node} serverId={serverId} />
          ))}
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

function ThreadBranch({ node, serverId }: { node: SidebarThreadNode; serverId: string }) {
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
  const rowStyle = useMemo(() => [styles.row, hovered && styles.rowHovered], [hovered]);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const open = useCallback(() => {
    if (node.target.kind === "agent") {
      navigateToAgent({ serverId, agentId: node.target.agentId });
    } else {
      const { workspaceId, ...target } = node.target;
      navigateToWorkspace({ serverId, workspaceId, target });
    }
  }, [node.target, serverId]);
  const ToggleIcon = expanded ? ThemedChevronDown : ThemedChevronRight;
  const toggleLabel = expanded
    ? t("agentTree.collapse", { title })
    : t("agentTree.expand", { title });
  return (
    <View>
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
            <ToggleIcon size={12} uniProps={iconColor} />
          </Pressable>
        ) : (
          <View style={styles.toggle}>
            <ThemedMessage size={10} uniProps={iconColor} />
          </View>
        )}
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={t("agentTree.open", { title })}
          style={styles.thread}
          testID={`sidebar-agent-tree-row-${node.key}`}
        >
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </Pressable>
      </View>
      {hasChildren && expanded ? (
        <View style={styles.children}>
          {node.children.map((child) => (
            <ThreadBranch key={child.key} node={child} serverId={serverId} />
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
