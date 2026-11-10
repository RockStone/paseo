import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarMenuToggle } from "@/components/headers/sidebar-menu-toggle";
import {
  WorkspaceHeaderMenuDesktop,
  type WorkspaceHeaderWorkspaceActions,
} from "@/screens/workspace/workspace-header-menu";

/**
 * Paseoi's merged title bar: a desktop workspace drops its header row and shows the header's
 * leading and trailing content inside the tab rows along the top edge, like browser tabs.
 *
 * The split container assigns the leading side to the leftmost top pane and the trailing side to
 * the rightmost one (the same pane when only one reaches the top), and only while the merged bar
 * applies (the setting is on and focus mode is off). Each pane republishes its share as plain
 * slots, so the tab row renders them without knowing why. The explorer sidebar's tab row sits
 * outside the provider and never gets them.
 */
export interface WorkspaceTitleBarSlots {
  leading: ReactNode | null;
  trailing: ReactNode | null;
}

export interface WorkspaceTitleBarAssignment {
  slots: WorkspaceTitleBarSlots;
  leadingPaneId: string | null;
  trailingPaneId: string | null;
}

const WorkspaceTitleBarAssignmentContext = createContext<WorkspaceTitleBarAssignment | null>(null);
const WorkspaceTitleBarSlotsContext = createContext<WorkspaceTitleBarSlots | null>(null);

export const WorkspaceTitleBarAssignmentProvider = WorkspaceTitleBarAssignmentContext.Provider;

export function useWorkspaceTitleBarSlots(): WorkspaceTitleBarSlots | null {
  return useContext(WorkspaceTitleBarSlotsContext);
}

/** Publishes the slots assigned to one pane to the tab row inside it. */
export function PaneTitleBarSlots({ paneId, children }: { paneId: string; children: ReactNode }) {
  const assignment = useContext(WorkspaceTitleBarAssignmentContext);
  const slots = useMemo(() => resolvePaneTitleBarSlots(assignment, paneId), [assignment, paneId]);
  return (
    <WorkspaceTitleBarSlotsContext.Provider value={slots}>
      {children}
    </WorkspaceTitleBarSlotsContext.Provider>
  );
}

function resolvePaneTitleBarSlots(
  assignment: WorkspaceTitleBarAssignment | null,
  paneId: string,
): WorkspaceTitleBarSlots | null {
  if (!assignment) return null;
  const leading = assignment.leadingPaneId === paneId ? assignment.slots.leading : null;
  const trailing = assignment.trailingPaneId === paneId ? assignment.slots.trailing : null;
  return leading === null && trailing === null ? null : { leading, trailing };
}

/** The sidebar toggle, the project name, and the workspace menu the header row used to hold. */
export function WorkspaceTitleBarLeading({
  projectLabel,
  workspaceTitle,
  ...menu
}: WorkspaceHeaderWorkspaceActions & { projectLabel: string; workspaceTitle: string }) {
  return (
    <View style={styles.leading}>
      <SidebarMenuToggle />
      {projectLabel ? (
        <Text
          testID="workspace-title-bar-project"
          accessibilityLabel={workspaceTitle}
          style={styles.project}
          numberOfLines={1}
        >
          {projectLabel}
        </Text>
      ) : null}
      <WorkspaceHeaderMenuDesktop {...menu} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  leading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    flexShrink: 0,
  },
  project: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    maxWidth: 160,
  },
}));
