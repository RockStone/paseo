import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { useToast } from "@/contexts/toast-context";
import { requireWorkspaceDirectory } from "@/utils/workspace-directory";
import { isWeb } from "@/constants/platform";

// Everything the copy actions actually need. Kept narrower than SidebarWorkspaceEntry so the
// command center can build one from the active route selection without a sidebar row.
export interface CopyableWorkspace {
  workspaceId: string;
  workspaceDirectory: string | null | undefined;
  currentBranch: string | null | undefined;
}

export interface WorkspaceClipboardActions {
  copyPath: (workspace: CopyableWorkspace) => void;
  copyBranchName: (workspace: CopyableWorkspace) => void;
  copyWorkspaceId: (workspaceId: string) => Promise<void>;
}

export function useWorkspaceClipboardActions(): WorkspaceClipboardActions {
  const { t } = useTranslation();
  const toast = useToast();

  const copyPath = useCallback(
    (workspace: CopyableWorkspace) => {
      let copyTargetDirectory: string;
      try {
        copyTargetDirectory = requireWorkspaceDirectory({
          workspaceId: workspace.workspaceId,
          workspaceDirectory: workspace.workspaceDirectory,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("sidebar.workspace.toasts.workspacePathUnavailable"),
        );
        return;
      }
      void Clipboard.setStringAsync(copyTargetDirectory);
      toast.copied(t("sidebar.workspace.toasts.pathCopied"));
    },
    [t, toast],
  );

  const copyBranchName = useCallback(
    (workspace: CopyableWorkspace) => {
      if (!workspace.currentBranch) {
        return;
      }
      void Clipboard.setStringAsync(workspace.currentBranch);
      toast.copied(t("sidebar.workspace.toasts.branchNameCopied"));
    },
    [t, toast],
  );

  const copyWorkspaceId = useCallback(
    async (workspaceId: string) => {
      try {
        if (isWeb) {
          await navigator.clipboard.writeText(workspaceId);
        } else if (!(await Clipboard.setStringAsync(workspaceId))) {
          throw new Error("Clipboard copy failed");
        }
        toast.copied();
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [t, toast],
  );

  return useMemo(
    () => ({ copyPath, copyBranchName, copyWorkspaceId }),
    [copyBranchName, copyPath, copyWorkspaceId],
  );
}
