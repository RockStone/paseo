import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  clearWorkspaceArchivePending,
  markWorkspaceArchivePending,
} from "@/contexts/session-workspace-upserts";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { i18n } from "@/i18n/i18next";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export interface WorkspaceArchiveTarget {
  serverId: string;
  workspaceId: string;
}

interface WorkspaceArchiveClient {
  archiveWorkspace: (workspaceId: string) => Promise<{ error: string | null }>;
}

interface OptimisticWorkspaceArchiveSnapshot {
  workspace: WorkspaceDescriptor | null;
}

export interface WorkspaceArchiveFailure {
  serverId: string;
  workspaceId: string;
  error: unknown;
}

function hideWorkspaceOptimistically(
  workspace: WorkspaceArchiveTarget,
): OptimisticWorkspaceArchiveSnapshot {
  const workspaces = useSessionStore.getState().sessions[workspace.serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId: workspace.workspaceId,
  });
  const snapshot = workspaceKey ? (workspaces?.get(workspaceKey) ?? null) : null;
  markWorkspaceArchivePending({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  });
  getHostRuntimeStore().removeWorkspaceSnapshot(workspace.serverId, workspace.workspaceId);
  return { workspace: snapshot };
}

function restoreOptimisticallyHiddenWorkspace(input: {
  serverId: string;
  workspaceId: string;
  snapshot: OptimisticWorkspaceArchiveSnapshot;
}): void {
  clearWorkspaceArchivePending({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (input.snapshot.workspace) {
    getHostRuntimeStore().acceptWorkspaceSnapshots(input.serverId, [input.snapshot.workspace]);
  }
}

async function archiveWorkspaceOrThrow(input: {
  client: WorkspaceArchiveClient;
  workspaceId: string;
}): Promise<void> {
  const payload = await input.client.archiveWorkspace(input.workspaceId);
  if (payload.error) {
    throw new Error(payload.error);
  }
}

export async function archiveWorkspaceOptimistically(input: {
  client: WorkspaceArchiveClient;
  workspace: WorkspaceArchiveTarget;
}): Promise<void> {
  const snapshot = hideWorkspaceOptimistically(input.workspace);

  try {
    await archiveWorkspaceOrThrow({
      client: input.client,
      workspaceId: input.workspace.workspaceId,
    });
  } catch (error) {
    restoreOptimisticallyHiddenWorkspace({
      serverId: input.workspace.serverId,
      workspaceId: input.workspace.workspaceId,
      snapshot,
    });
    throw error;
  }
}

/** Drops the archived workspace's tabs and panes; the single and batch archive both finish here. */
export function purgeArchivedWorkspaceState(input: WorkspaceArchiveTarget): void {
  const workspaceKey = buildWorkspaceTabPersistenceKey(input);
  if (workspaceKey) {
    useWorkspaceLayoutStore.getState().purgeWorkspace(workspaceKey);
  }
}

async function archiveWorkspaceTarget(input: {
  getClient: (serverId: string) => WorkspaceArchiveClient | null;
  workspace: WorkspaceArchiveTarget;
}): Promise<WorkspaceArchiveFailure | null> {
  const { serverId, workspaceId } = input.workspace;
  const client = input.getClient(serverId);
  if (!client) {
    return {
      serverId,
      workspaceId,
      error: new Error(i18n.t("sidebar.workspace.toasts.hostDisconnected")),
    };
  }
  try {
    await archiveWorkspaceOptimistically({ client, workspace: input.workspace });
  } catch (error) {
    // The batch reports every failure together instead of stopping at the first.
    return { serverId, workspaceId, error };
  }
  purgeArchivedWorkspaceState(input.workspace);
  return null;
}

export interface ArchiveWorkspacesInput {
  getClient: (serverId: string) => WorkspaceArchiveClient | null;
  workspaces: readonly WorkspaceArchiveTarget[];
  /**
   * How many archives run at once. Each one can remove a worktree on its host, so a large
   * selection is fed through a few at a time rather than all together.
   */
  concurrency: number;
  onSettled?: (workspace: WorkspaceArchiveTarget, failure: WorkspaceArchiveFailure | null) => void;
}

/** Archives each workspace through the single-archive path. Failures come back in input order. */
export async function archiveWorkspacesOptimistically(
  input: ArchiveWorkspacesInput,
): Promise<WorkspaceArchiveFailure[]> {
  const failures: (WorkspaceArchiveFailure | null)[] = input.workspaces.map(() => null);
  // One iterator shared by every worker, so each workspace is taken exactly once.
  const queue = input.workspaces.entries();
  async function drain(): Promise<void> {
    for (const [index, workspace] of queue) {
      const failure = await archiveWorkspaceTarget({ getClient: input.getClient, workspace });
      failures[index] = failure;
      input.onSettled?.(workspace, failure);
    }
  }
  const workerCount = Math.max(1, Math.min(input.concurrency, input.workspaces.length));
  await Promise.all(Array.from({ length: workerCount }, drain));
  return failures.filter((failure): failure is WorkspaceArchiveFailure => failure !== null);
}
