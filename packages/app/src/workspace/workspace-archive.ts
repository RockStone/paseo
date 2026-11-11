import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  isWorkspaceArchiveIntentCurrent,
  markWorkspaceArchivePending,
  markWorkspaceArchiveUndoPending,
  settleWorkspaceArchiveIntent,
  type WorkspaceArchiveIntent,
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
  archiveWorkspace: (workspaceId: string) => Promise<{ error: string | null; canceled?: boolean }>;
}

interface WorkspaceArchiveUndoClient {
  undoWorkspaceArchive: (workspaceId: string) => Promise<void>;
}

/** `canceled`: an undo stopped the archive on the host before it finished. */
export type WorkspaceArchiveOutcome = "archived" | "canceled";

export interface OptimisticWorkspaceArchive {
  /** The row as it was before the archive hid it, for undo to put back. */
  hidden: WorkspaceDescriptor | null;
  done: Promise<WorkspaceArchiveOutcome>;
}

interface OptimisticWorkspaceArchiveSnapshot {
  workspace: WorkspaceDescriptor | null;
  intent: WorkspaceArchiveIntent;
}

export interface WorkspaceArchiveFailure {
  serverId: string;
  workspaceId: string;
  error: unknown;
}

function findListedWorkspace(workspace: WorkspaceArchiveTarget): WorkspaceDescriptor | null {
  const workspaces = useSessionStore.getState().sessions[workspace.serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId: workspace.workspaceId,
  });
  return workspaceKey ? (workspaces?.get(workspaceKey) ?? null) : null;
}

/** True when the workspace is in this client's list, for example after another client restored it. */
export function isWorkspaceListed(workspace: WorkspaceArchiveTarget): boolean {
  return findListedWorkspace(workspace) !== null;
}

function hideWorkspaceOptimistically(
  workspace: WorkspaceArchiveTarget,
): OptimisticWorkspaceArchiveSnapshot {
  const snapshot = findListedWorkspace(workspace);
  const intent = markWorkspaceArchivePending({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  });
  getHostRuntimeStore().removeWorkspaceSnapshot(workspace.serverId, workspace.workspaceId);
  return { workspace: snapshot, intent };
}

/**
 * Puts back a row whose archive did not happen. Skipped when a newer request on this client
 * (an undo, or another archive) owns the row by now.
 */
function restoreOptimisticallyHiddenWorkspace(input: {
  serverId: string;
  snapshot: OptimisticWorkspaceArchiveSnapshot;
}): void {
  if (!isWorkspaceArchiveIntentCurrent(input.snapshot.intent)) return;
  settleWorkspaceArchiveIntent(input.snapshot.intent);
  if (input.snapshot.workspace) {
    getHostRuntimeStore().acceptWorkspaceSnapshots(input.serverId, [input.snapshot.workspace]);
  }
}

async function archiveWorkspaceOrThrow(input: {
  client: WorkspaceArchiveClient;
  workspaceId: string;
}): Promise<WorkspaceArchiveOutcome> {
  const payload = await input.client.archiveWorkspace(input.workspaceId);
  if (payload.canceled) {
    return "canceled";
  }
  if (payload.error) {
    throw new Error(payload.error);
  }
  return "archived";
}

/**
 * Hides the row now and archives it on the host. A failed archive puts the row back, and so
 * does a canceled one: an undo from another client stopped it, so the workspace stays.
 */
export function beginOptimisticWorkspaceArchive(input: {
  client: WorkspaceArchiveClient;
  workspace: WorkspaceArchiveTarget;
}): OptimisticWorkspaceArchive {
  const snapshot = hideWorkspaceOptimistically(input.workspace);
  const done = (async () => {
    try {
      const outcome = await archiveWorkspaceOrThrow({
        client: input.client,
        workspaceId: input.workspace.workspaceId,
      });
      if (outcome === "canceled") {
        restoreOptimisticallyHiddenWorkspace({ serverId: input.workspace.serverId, snapshot });
      }
      return outcome;
    } catch (error) {
      restoreOptimisticallyHiddenWorkspace({ serverId: input.workspace.serverId, snapshot });
      throw error;
    }
  })();
  return { hidden: snapshot.workspace, done };
}

export async function archiveWorkspaceOptimistically(input: {
  client: WorkspaceArchiveClient;
  workspace: WorkspaceArchiveTarget;
}): Promise<WorkspaceArchiveOutcome> {
  return beginOptimisticWorkspaceArchive(input).done;
}

/**
 * Puts the archived row back now and asks the host to undo the archive, whether it is still
 * running or already finished. A failed undo hides the row again, unless the user archived
 * it again in the meantime.
 */
export async function undoWorkspaceArchiveOptimistically(input: {
  client: WorkspaceArchiveUndoClient;
  workspace: WorkspaceArchiveTarget;
  hidden: WorkspaceDescriptor | null;
}): Promise<void> {
  const { serverId, workspaceId } = input.workspace;
  const intent = markWorkspaceArchiveUndoPending({ serverId, workspaceId });
  if (input.hidden) {
    getHostRuntimeStore().acceptWorkspaceSnapshots(serverId, [input.hidden]);
  }
  try {
    await input.client.undoWorkspaceArchive(workspaceId);
  } catch (error) {
    if (isWorkspaceArchiveIntentCurrent(intent)) {
      getHostRuntimeStore().removeWorkspaceSnapshot(serverId, workspaceId);
    }
    throw error;
  } finally {
    settleWorkspaceArchiveIntent(intent);
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
  let outcome: WorkspaceArchiveOutcome;
  try {
    outcome = await archiveWorkspaceOptimistically({ client, workspace: input.workspace });
  } catch (error) {
    // The batch reports every failure together instead of stopping at the first.
    return { serverId, workspaceId, error };
  }
  // An undo from another client canceled it, so the workspace and its tabs stay.
  if (outcome === "archived") {
    purgeArchivedWorkspaceState(input.workspace);
  }
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
