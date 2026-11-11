import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import { densityIconBox } from "@/styles/density";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS } from "@/git/worktree-archive-warning";
import { archiveWorkspacesOptimistically } from "@/workspace/workspace-archive";
import {
  BULK_ARCHIVE_CONCURRENCY,
  buildBulkArchiveConfirmation,
  resolveBulkArchiveCandidates,
} from "./archive";
import {
  abortConfirm,
  applyWorkspaceSelection,
  beginArchive,
  beginConfirm,
  finishArchive,
  recordSettled,
  selectionCheckedFor,
  startSelection,
  toggleAllSelected,
  toggleSelected,
  useWorkspaceSelectionStore,
  WORKSPACE_SELECTION_OFF,
} from "./model";

const CheckIcon = withUnistyles(Check);
const checkColor = (theme: Theme) => ({ color: theme.colors.accentForeground });

/**
 * Escape leaves select mode ahead of the unfocused composer (100) but behind a focused one (200),
 * so while you type, Escape still interrupts the agent. The composer also passes on Escape when
 * nothing is running, which lands here.
 */
const CANCEL_ON_ESCAPE_PRIORITY = 150;

/** Whether a row is checked, or `null` while select mode is off and the row navigates. */
export function useWorkspaceSelectionChecked(workspaceKey: string): boolean | null {
  return useWorkspaceSelectionStore((store) => selectionCheckedFor(store.state, workspaceKey));
}

export function useWorkspaceSelectionActive(): boolean {
  return useWorkspaceSelectionStore((store) => store.state.mode !== "off");
}

export function startWorkspaceSelection(initial: readonly string[] = []): void {
  applyWorkspaceSelection(() => startSelection(initial));
}

export function toggleWorkspaceSelected(workspaceKey: string): void {
  applyWorkspaceSelection((state) => toggleSelected(state, workspaceKey));
}

/** "Select all in project": enters select mode with the project checked, or toggles it. */
export function selectAllWorkspaces(workspaceKeys: readonly string[]): void {
  applyWorkspaceSelection((state) =>
    state.mode === "off" ? startSelection(workspaceKeys) : toggleAllSelected(state, workspaceKeys),
  );
}

function cancelWorkspaceSelection(): void {
  applyWorkspaceSelection((state) =>
    state.mode === "selecting" ? WORKSPACE_SELECTION_OFF : state,
  );
}

/**
 * Takes the status dot's slot so the title stays where it was. The row itself is the control —
 * this box only draws its state.
 */
export function WorkspaceSelectionCheckbox({
  checked,
  testID,
}: {
  checked: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.slot} testID={testID}>
      <View style={[styles.checkbox, checked && styles.checked]}>
        {checked ? <CheckIcon size={14} uniProps={checkColor} /> : null}
      </View>
    </View>
  );
}

export function SidebarWorkspaceSelectionBar() {
  const state = useWorkspaceSelectionStore((store) => store.state);
  const { workspaceEntriesByKey, activeWorkspaceSelection } = useSidebarModel();
  const { t } = useTranslation();
  const toast = useToast();

  useKeyboardActionHandler({
    handlerId: "sidebar-workspace-selection-cancel",
    actions: ["agent.interrupt"],
    enabled: state.mode === "selecting",
    priority: CANCEL_ON_ESCAPE_PRIORITY,
    handle: () => {
      cancelWorkspaceSelection();
      return true;
    },
  });

  const selectedCount = useMemo(() => {
    if (state.mode === "off") return 0;
    let count = 0;
    for (const key of state.selected) if (workspaceEntriesByKey.has(key)) count += 1;
    return count;
  }, [state, workspaceEntriesByKey]);

  const archive = useCallback(async () => {
    const current = useWorkspaceSelectionStore.getState().state;
    if (current.mode !== "selecting") return;
    const candidates = resolveBulkArchiveCandidates({
      selected: current.selected,
      entries: workspaceEntriesByKey,
      warningLabels: DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
    });
    if (candidates.length === 0) return;

    applyWorkspaceSelection(beginConfirm);
    const confirmed = await confirmDialog({
      ...buildBulkArchiveConfirmation({ candidates, t }),
      confirmLabel: t("workspace.git.actions.archiveWarning.confirm"),
      cancelLabel: t("workspace.git.actions.archiveWarning.cancel"),
      destructive: true,
    });
    if (!confirmed) {
      applyWorkspaceSelection(abortConfirm);
      return;
    }

    applyWorkspaceSelection((next) => beginArchive(next, candidates.length));
    const open = candidates.find(
      (candidate) =>
        candidate.serverId === activeWorkspaceSelection?.serverId &&
        candidate.workspaceId === activeWorkspaceSelection.workspaceId,
    );
    // The redirect reads the workspace's project, so it runs before the archive hides the row.
    if (open) {
      redirectIfArchivingActiveWorkspace({
        serverId: open.serverId,
        workspaceId: open.workspaceId,
        activeWorkspaceSelection,
      });
    }
    const failures = await archiveWorkspacesOptimistically({
      getClient: (serverId) => getHostRuntimeStore().getClient(serverId),
      workspaces: candidates,
      concurrency: BULK_ARCHIVE_CONCURRENCY,
      onSettled: () => applyWorkspaceSelection(recordSettled),
    });

    const failed = candidates.filter((candidate) =>
      failures.some(
        (failure) =>
          failure.serverId === candidate.serverId && failure.workspaceId === candidate.workspaceId,
      ),
    );
    applyWorkspaceSelection((next) =>
      finishArchive(
        next,
        failed.map((candidate) => candidate.key),
      ),
    );
    if (failed.length === 0) {
      toast.show(t("sidebar.workspace.selection.archived", { count: candidates.length }), {
        variant: "success",
      });
      return;
    }
    toast.error(
      t("sidebar.workspace.selection.failed", {
        names: failed.map((candidate) => candidate.name).join(", "),
      }),
    );
  }, [activeWorkspaceSelection, t, toast, workspaceEntriesByKey]);

  const handleArchive = useCallback(() => {
    void archive();
  }, [archive]);

  if (state.mode === "off") return null;
  const isArchiving = state.mode === "archiving";
  const archiveLabel = isArchiving
    ? t("sidebar.workspace.selection.archiving", { settled: state.settled, total: state.total })
    : t("sidebar.workspace.selection.archive", { count: selectedCount });

  return (
    <View style={styles.bar} testID="sidebar-workspace-selection-bar">
      <Text style={styles.hint} numberOfLines={1}>
        {t("sidebar.workspace.selection.start")}
      </Text>
      <Button
        size="sm"
        variant="ghost"
        onPress={cancelWorkspaceSelection}
        disabled={state.mode !== "selecting"}
        testID="sidebar-workspace-selection-cancel"
      >
        {t("sidebar.workspace.selection.cancel")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onPress={handleArchive}
        loading={isArchiving}
        disabled={state.mode !== "selecting" || selectedCount === 0}
        testID="sidebar-workspace-selection-archive"
      >
        {archiveLabel}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  slot: {
    width: densityIconBox("md"),
    // The title's first line, which the status dot this replaces centres on.
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  hint: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
