import {
  resolveWorkspaceDisplayName,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "./workspace-registry.js";

// Moving a workspace changes only its `projectId`. Agents and terminals are keyed by
// workspaceId, so nothing on disk is touched and no agent is interrupted or archived.
// Running services keep the hostname they registered with (it embeds the old project's
// slug) until their script restarts; the result reports those hostnames.

export type WorkspaceProjectMoveErrorCode =
  | "workspace_not_found"
  | "project_not_found"
  | "project_archived"
  | "same_project";

export class WorkspaceProjectMoveError extends Error {
  constructor(
    public readonly code: WorkspaceProjectMoveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceProjectMoveError";
  }
}

export interface WorkspaceProjectMoveDependencies {
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "listAll" | "update">;
  projectRegistry: Pick<ProjectRegistry, "get" | "update">;
  /** Hostnames of the workspace's running services that are registered with the service proxy. */
  listWorkspaceServiceHostnames?: (workspaceId: string) => string[];
  now?: () => string;
}

export interface WorkspaceProjectMoveResult {
  workspace: PersistedWorkspaceRecord;
  previousProjectId: string;
  /** False when the workspace already belonged to the target project. */
  changed: boolean;
  retainedServiceHostnames: string[];
  /** The source project, when this move left it with no active workspaces. */
  emptiedProject: PersistedProjectRecord | null;
}

export interface ProjectMergeDependencies extends WorkspaceProjectMoveDependencies {
  projectRegistry: Pick<ProjectRegistry, "get" | "update" | "remove">;
  /** Best-effort cleanup of the removed source project's custom icon. */
  removeProjectIcon?: (projectId: string) => Promise<void>;
}

export interface ProjectMergeWorkspaceSummary {
  workspaceId: string;
  name: string;
  cwd: string;
  archived: boolean;
}

export type ProjectMergeSourceKeptReason = "keep_source" | "workspaces_remain";

export interface ProjectMergeResult {
  dryRun: boolean;
  /** Workspaces moved into the target, or that would move in a dry run. */
  workspaces: ProjectMergeWorkspaceSummary[];
  /** Whether the source was removed, or would be removed in a dry run. */
  sourceRemoved: boolean;
  sourceKeptReason: ProjectMergeSourceKeptReason | null;
  retainedServiceHostnames: string[];
  /** The kept source project, when the merge left it with no active workspaces. */
  emptiedProject: PersistedProjectRecord | null;
}

async function requireActiveProject(
  projectRegistry: Pick<ProjectRegistry, "get">,
  projectId: string,
): Promise<PersistedProjectRecord> {
  const project = await projectRegistry.get(projectId);
  if (!project) {
    throw new WorkspaceProjectMoveError("project_not_found", `Project not found: ${projectId}`);
  }
  if (project.archivedAt) {
    throw new WorkspaceProjectMoveError("project_archived", `Project is archived: ${projectId}`);
  }
  return project;
}

function hasActiveWorkspace(workspaces: PersistedWorkspaceRecord[], projectId: string): boolean {
  return workspaces.some((workspace) => workspace.projectId === projectId && !workspace.archivedAt);
}

export async function moveWorkspaceToProject(
  deps: WorkspaceProjectMoveDependencies,
  input: { workspaceId: string; projectId: string },
): Promise<WorkspaceProjectMoveResult> {
  const existing = await deps.workspaceRegistry.get(input.workspaceId);
  if (!existing) {
    throw new WorkspaceProjectMoveError(
      "workspace_not_found",
      `Workspace not found: ${input.workspaceId}`,
    );
  }
  const target = await requireActiveProject(deps.projectRegistry, input.projectId);
  const previousProjectId = existing.projectId;
  if (previousProjectId === target.projectId) {
    return {
      workspace: existing,
      previousProjectId,
      changed: false,
      retainedServiceHostnames: [],
      emptiedProject: null,
    };
  }

  const now = deps.now?.() ?? new Date().toISOString();
  const moved = await deps.workspaceRegistry.update(input.workspaceId, (record) => ({
    ...record,
    projectId: target.projectId,
    updatedAt: now,
  }));
  if (!moved) {
    throw new WorkspaceProjectMoveError(
      "workspace_not_found",
      `Workspace not found: ${input.workspaceId}`,
    );
  }

  // Touching the emptied source publishes a project update through the registry, so
  // clients keep showing it as a project with no workspaces.
  let emptiedProject: PersistedProjectRecord | null = null;
  if (
    !moved.archivedAt &&
    !hasActiveWorkspace(await deps.workspaceRegistry.listAll(), previousProjectId)
  ) {
    const source = await deps.projectRegistry.get(previousProjectId);
    if (source && !source.archivedAt) {
      emptiedProject = await deps.projectRegistry.update(previousProjectId, (record) => ({
        ...record,
        updatedAt: now,
      }));
    }
  }

  return {
    workspace: moved,
    previousProjectId,
    changed: true,
    retainedServiceHostnames: deps.listWorkspaceServiceHostnames?.(moved.workspaceId) ?? [],
    emptiedProject,
  };
}

function summarizeWorkspace(workspace: PersistedWorkspaceRecord): ProjectMergeWorkspaceSummary {
  return {
    workspaceId: workspace.workspaceId,
    name: resolveWorkspaceDisplayName(workspace),
    cwd: workspace.cwd,
    archived: Boolean(workspace.archivedAt),
  };
}

/**
 * Moves every workspace of the source project, active and archived, into the target. The
 * source is removed only when no workspace of any kind is left in it, and removal deletes
 * the project record alone: it never archives a workspace or touches an agent.
 */
export async function mergeProjects(
  deps: ProjectMergeDependencies,
  input: {
    sourceProjectId: string;
    targetProjectId: string;
    keepSource?: boolean;
    dryRun?: boolean;
  },
): Promise<ProjectMergeResult> {
  if (input.sourceProjectId === input.targetProjectId) {
    throw new WorkspaceProjectMoveError(
      "same_project",
      "Source and target project must be different",
    );
  }
  const source = await deps.projectRegistry.get(input.sourceProjectId);
  if (!source) {
    throw new WorkspaceProjectMoveError(
      "project_not_found",
      `Project not found: ${input.sourceProjectId}`,
    );
  }
  await requireActiveProject(deps.projectRegistry, input.targetProjectId);

  const members = (await deps.workspaceRegistry.listAll()).filter(
    (workspace) => workspace.projectId === source.projectId,
  );
  const workspaces = members.map(summarizeWorkspace);

  if (input.dryRun) {
    return {
      dryRun: true,
      workspaces,
      sourceRemoved: !input.keepSource,
      sourceKeptReason: input.keepSource ? "keep_source" : null,
      retainedServiceHostnames: members.flatMap(
        (workspace) => deps.listWorkspaceServiceHostnames?.(workspace.workspaceId) ?? [],
      ),
      emptiedProject: null,
    };
  }

  const retainedServiceHostnames: string[] = [];
  for (const workspace of members) {
    const moved = await moveWorkspaceToProject(deps, {
      workspaceId: workspace.workspaceId,
      projectId: input.targetProjectId,
    });
    retainedServiceHostnames.push(...moved.retainedServiceHostnames);
  }

  // Re-read after the moves: a workspace created in the source meanwhile keeps it alive.
  const remaining = (await deps.workspaceRegistry.listAll()).filter(
    (workspace) => workspace.projectId === source.projectId,
  );
  if (input.keepSource || remaining.length > 0) {
    const emptied = !hasActiveWorkspace(remaining, source.projectId);
    return {
      dryRun: false,
      workspaces,
      sourceRemoved: false,
      sourceKeptReason: input.keepSource ? "keep_source" : "workspaces_remain",
      retainedServiceHostnames,
      emptiedProject: emptied ? await deps.projectRegistry.get(source.projectId) : null,
    };
  }

  await deps.projectRegistry.remove(source.projectId);
  await deps.removeProjectIcon?.(source.projectId);
  return {
    dryRun: false,
    workspaces,
    sourceRemoved: true,
    sourceKeptReason: null,
    retainedServiceHostnames,
    emptiedProject: null,
  };
}
