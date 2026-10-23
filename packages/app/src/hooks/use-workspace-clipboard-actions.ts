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
  copyBranchName: (workspace: Pick<CopyableWorkspace, "currentBranch">) => Promise<void>;
  copyWorkspaceId: (workspaceId: string) => Promise<void>;
}

async function copyText(text: string): Promise<void> {
  if (isWeb) {
    await navigator.clipboard.writeText(text);
  } else if (!(await Clipboard.setStringAsync(text))) {
    throw new Error("Clipboard copy failed");
  }
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
    async (workspace: Pick<CopyableWorkspace, "currentBranch">) => {
      if (!workspace.currentBranch) return;
      try {
        await copyText(workspace.currentBranch);
        toast.copied();
      } catch {
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      }
    },
    [t, toast],
  );

  const copyWorkspaceId = useCallback(
    async (workspaceId: string) => {
      try {
        await copyText(workspaceId);
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
