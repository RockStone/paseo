import { useMemo } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DiffStat } from "@/components/diff-stat";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import type { SidebarWorkspaceTrailing } from "@/hooks/use-settings";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useProviderSubagentStore } from "@/subagents/provider-store";
import { selectWorkspaceLastActivity } from "@/utils/workspace-agent-activity";

const EMPTY_AGENTS = new Map<string, Agent>();

export type { SidebarWorkspaceTrailing };

/**
 * The slot to the right of a workspace title. Three renderers behind one preference, so
 * every row renderer asks the same question and the kebab overlay geometry stays identical
 * no matter which one is showing.
 *
 * "none" exists because the slot is the only thing competing with the title for width, and
 * a user who never reads the diff would rather have the characters.
 */
export function useSidebarWorkspaceTrailing(): SidebarWorkspaceTrailing {
  const {
    settings: { sidebarWorkspaceTrailing },
  } = useAppSettings();
  return sidebarWorkspaceTrailing;
}

/** Whether the slot has anything to draw for this workspace under the current preference. */
export function hasSidebarWorkspaceTrailing({
  workspace,
  trailing,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
}): boolean {
  if (trailing === "diff") return workspace.diffStat !== null;
  if (trailing === "timestamp") return true;
  return false;
}

export function SidebarWorkspaceTrailingContent({
  workspace,
  trailing,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
}) {
  if (trailing === "diff" && workspace.diffStat) {
    return (
      <DiffStat additions={workspace.diffStat.additions} deletions={workspace.diffStat.deletions} />
    );
  }
  if (trailing === "timestamp") {
    return <WorkspaceTimestamp serverId={workspace.serverId} workspaceId={workspace.workspaceId} />;
  }
  return null;
}

/**
 * Its own component so the clock stops here. `useCompactTimeAgo` holds state, and state
 * re-renders the component that owns it — keeping that component down to a single `<Text>` is
 * what stops a minute tick from reaching the row, the list, or the diff stat next door.
 */
function WorkspaceTimestamp({ serverId, workspaceId }: { serverId: string; workspaceId: string }) {
  const providerSubagents = useProviderSubagentStore((state) => state.descriptors);
  const lastActivityAt = useSessionStore((state) =>
    selectWorkspaceLastActivity({
      serverId,
      workspaceId,
      agents: state.sessions[serverId]?.agents ?? EMPTY_AGENTS,
      activity: state.agentLastActivity,
      providerSubagents,
    }),
  );
  const label = useCompactTimeAgo(lastActivityAt === null ? null : new Date(lastActivityAt));
  const dataSet = useMemo(
    () => ({
      activityAt: lastActivityAt === null ? undefined : new Date(lastActivityAt).toISOString(),
    }),
    [lastActivityAt],
  );
  if (lastActivityAt === null) return null;
  return (
    <Text
      style={styles.timestamp}
      numberOfLines={1}
      testID="sidebar-workspace-timestamp"
      dataSet={dataSet}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  // A step below the project title it shares the row with. The timestamp is the one thing here
  // you never came looking for, so it sits at the bottom of the muted ramp rather than tying
  // with the label naming the group.
  timestamp: {
    height: 20,
    lineHeight: 20,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 0,
  },
}));
