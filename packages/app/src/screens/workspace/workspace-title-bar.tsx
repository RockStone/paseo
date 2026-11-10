import { createContext, useContext, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarMenuToggle } from "@/components/headers/sidebar-menu-toggle";
import {
  WorkspaceHeaderMenuDesktop,
  type WorkspaceHeaderWorkspaceActions,
} from "@/screens/workspace/workspace-header-menu";

/**
 * Paseoi's merged title bar: a desktop workspace with one pane drops its header row and shows the
 * header's leading and trailing content inside the pane's tab row, like browser tabs.
 *
 * The split container provides the slots only while the merged bar applies (the setting is on,
 * one pane is visible, focus mode is off), so the tab row renders them without knowing why. The
 * explorer sidebar's tab row sits outside the provider and never gets them.
 */
export interface WorkspaceTitleBarSlots {
  leading: ReactNode;
  trailing: ReactNode;
}

const WorkspaceTitleBarSlotsContext = createContext<WorkspaceTitleBarSlots | null>(null);

export const WorkspaceTitleBarSlotsProvider = WorkspaceTitleBarSlotsContext.Provider;

export function useWorkspaceTitleBarSlots(): WorkspaceTitleBarSlots | null {
  return useContext(WorkspaceTitleBarSlotsContext);
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
