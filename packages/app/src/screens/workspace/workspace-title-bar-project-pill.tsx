import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ProjectLeadingVisual } from "@/components/sidebar/project-leading-visual";
import { useProjectIcons } from "@/projects/icons";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { resolveSidebarProjectIconTargets } from "@/utils/sidebar-project-row-model";
import { buildSidebarProjectsFromStructure } from "@/hooks/use-sidebar-workspaces-list";
import { useHosts } from "@/runtime/host-runtime";
import { useWorkspaceStructure } from "@/stores/session-store-hooks";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";

export const PROJECT_PILL_HEIGHT = 24;
export const PROJECT_PILL_MAX_WIDTH = 160;

/**
 * The pill answers "which project is this?" when the sidebar that normally says so is not pinned
 * open. `agentListOpen` is the pin: false covers both collapsed and auto-hide.
 */
export function shouldShowProjectPill(input: {
  isSidebarPinnedOpen: boolean;
  hasProject: boolean;
}): boolean {
  return input.hasProject && !input.isSidebarPinnedOpen;
}

export function findProjectForWorkspace(
  projects: readonly WorkspaceStructureProject[],
  serverId: string,
  workspaceId: string,
): WorkspaceStructureProject | null {
  const workspaceKey = `${serverId}:${workspaceId}`;
  return projects.find((project) => project.workspaceKeys.includes(workspaceKey)) ?? null;
}

export function WorkspaceTitleBarProjectPill({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  // The same structure the sidebar builds its project headers from, so name, icon and color match.
  const { projects: structureProjects } = useWorkspaceStructure(serverIds);
  const isSidebarPinnedOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: false }),
  );
  const toggleAgentListForLayout = usePanelStore((state) => state.toggleAgentListForLayout);
  const [isHovered, setIsHovered] = useState(false);

  const project = useMemo(() => {
    const found = findProjectForWorkspace(structureProjects, serverId, workspaceId);
    return found ? (buildSidebarProjectsFromStructure({ projects: [found] })[0] ?? null) : null;
  }, [structureProjects, serverId, workspaceId]);
  const iconTargets = useMemo(
    () => (project ? resolveSidebarProjectIconTargets([project]) : []),
    [project],
  );
  const iconByViewKey = useProjectIcons({ projects: iconTargets });

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => {
    toggleAgentListForLayout({ isCompact: false });
  }, [toggleAgentListForLayout]);

  if (!project || !shouldShowProjectPill({ isSidebarPinnedOpen, hasProject: true })) {
    return null;
  }

  return (
    <View
      style={styles.hoverTarget}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <PressHighlight
        onPress={handlePress}
        style={styles.pill}
        accessibilityRole="button"
        accessibilityLabel={t("shell.menu.open")}
        testID="workspace-title-bar-project-pill"
      >
        <ProjectLeadingVisual
          displayName={project.projectName}
          iconDataUri={iconByViewKey.get(project.viewKey) ?? null}
          statusBucket={null}
          projectViewKey={project.viewKey}
          backdrop="surface2"
        />
        <Text
          numberOfLines={1}
          style={[styles.label, isHovered && styles.labelHovered]}
          ellipsizeMode="tail"
        >
          {project.projectName}
        </Text>
      </PressHighlight>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  hoverTarget: {
    flexShrink: 0,
    position: "relative",
  },
  // Fixed height and max width so the title-bar slot measures to a stable size and the tabs
  // shrink first. borderRadius is half the height: a full pill.
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    height: PROJECT_PILL_HEIGHT,
    maxWidth: PROJECT_PILL_MAX_WIDTH,
    paddingLeft: theme.spacing[1.5],
    paddingRight: theme.spacing[2],
    borderRadius: PROJECT_PILL_HEIGHT / 2,
    backgroundColor: theme.colors.surface2,
    userSelect: "none",
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  labelHovered: {
    color: theme.colors.foreground,
  },
}));
