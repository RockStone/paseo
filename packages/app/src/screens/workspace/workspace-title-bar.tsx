import { createContext, useContext, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarMenuToggle } from "@/components/headers/sidebar-menu-toggle";

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

/**
 * The header row's leading content in the title bar. Paseoi keeps only the sidebar toggle: the
 * project name and workspace menu cost tab space and stay reachable from the sidebar.
 */
export function WorkspaceTitleBarLeading() {
  return (
    <View style={styles.leading} testID="workspace-title-bar-leading">
      <SidebarMenuToggle />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  leading: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[2],
    flexShrink: 0,
  },
}));
