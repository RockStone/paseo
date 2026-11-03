import type { WorkspaceTitleSource } from "@/hooks/use-settings/storage";
import type { ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import { projectDisplayNameFromProjectId } from "@/utils/project-display-name";

export interface WorkspaceStructureHostPlacement {
  serverId: string;
  projectId: string;
  iconWorkingDir: string;
  worktreeSupport: "supported" | "unsupported" | "unknown";
  customIconRevision?: string | null;
  iconRevision?: string;
}

export interface WorkspaceStructureProject {
  viewKey: string;
  projectKey: string | null;
  projectName: string;
  projectKind: WorkspaceDescriptor["projectKind"] | "unknown";
  iconWorkingDir: string;
  hosts: WorkspaceStructureHostPlacement[];
  workspaceKeys: string[];
}

export interface WorkspaceStructure {
  projects: WorkspaceStructureProject[];
}

interface WorkspaceStructureSession {
  serverId: string;
  projects: Iterable<ProjectDescriptor>;
  workspaces: Iterable<WorkspaceDescriptor>;
}

export type WorkspaceSort = "manual" | "created" | "lastPrompt" | "name";

/**
 * Read literally for every sort: ascending is A→Z and oldest→newest, descending is Z→A and
 * newest→oldest. Descending is the default because it is what the time sorts always did.
 */
export type WorkspaceSortDirection = "descending" | "ascending";

export const DEFAULT_WORKSPACE_SORT_DIRECTION: WorkspaceSortDirection = "descending";

/** What the automatic sorts read besides the sort itself. Manual reads neither. */
export interface WorkspaceSortOptions {
  direction?: WorkspaceSortDirection;
  titleSource?: WorkspaceTitleSource;
}

interface WorkspaceSortItem {
  workspaceName: string;
  /** The title the row shows, which Name sorts by. Outside the Name sort it is just the name. */
  displayTitle: string;
  workspaceKey: string;
  sortTime: number;
}

interface ProjectDraft {
  viewKey: string;
  projectKey: string | null;
  projectName: string;
  hasCustomName: boolean;
  projectKind: WorkspaceDescriptor["projectKind"];
  iconWorkingDir: string;
  hosts: Map<string, WorkspaceStructureHostPlacement>;
  workspaces: WorkspaceSortItem[];
}

/** The single app boundary that turns host-local projects into grouped display projects. */
export function buildWorkspaceStructureProjects(input: {
  sessions: WorkspaceStructureSession[];
  workspaceSort?: WorkspaceSort;
  workspaceSortDirection?: WorkspaceSortDirection;
  /** Name sorts by what the row shows, and the row shows the branch when this says so. */
  workspaceTitleSource?: WorkspaceTitleSource;
}): WorkspaceStructureProject[] {
  const compareWorkspaces = workspaceComparator(
    input.workspaceSort,
    input.workspaceSortDirection ?? DEFAULT_WORKSPACE_SORT_DIRECTION,
  );
  const byProject = new Map<string, ProjectDraft>();
  const projectEntries: Array<{ serverId: string; project: ProjectDescriptor }> = [];
  const keyCountsByServer = new Map<string, Map<string, number>>();
  const viewKeyByServerProjectId = new Map<string, Map<string, string>>();

  for (const session of input.sessions) {
    for (const project of session.projects) {
      projectEntries.push({ serverId: session.serverId, project });
      const sharedKey = project.projectKey ?? null;
      if (sharedKey) {
        const counts = getOrCreate(keyCountsByServer, session.serverId, () => new Map());
        counts.set(sharedKey, (counts.get(sharedKey) ?? 0) + 1);
      }
    }
  }

  const allocatedViewKeys = new Set(
    projectEntries.flatMap(({ project }) => (project.projectKey ? [project.projectKey] : [])),
  );

  for (const { serverId, project } of projectEntries) {
    const viewKey = addProjectToView({
      byProject,
      keyCountsByServer,
      allocatedViewKeys,
      serverId,
      project,
    });
    getOrCreate(viewKeyByServerProjectId, serverId, () => new Map()).set(
      project.projectId,
      viewKey,
    );
  }

  for (const session of input.sessions) {
    for (const workspace of session.workspaces) {
      const viewKey = viewKeyByServerProjectId.get(session.serverId)?.get(workspace.projectId);
      if (!viewKey) continue;
      byProject.get(viewKey)?.workspaces.push({
        sortTime: workspaceSortTime(workspace, input.workspaceSort),
        workspaceName: workspace.name,
        displayTitle:
          input.workspaceSort === "name"
            ? resolveSidebarWorkspacePrimaryLabel({
                workspace: {
                  name: workspace.name,
                  currentBranch: normalizeCurrentBranch(workspace.gitRuntime?.currentBranch),
                },
                workspaceTitleSource: input.workspaceTitleSource ?? "title",
              })
            : workspace.name,
        workspaceKey: `${session.serverId}:${workspace.id}`,
      });
    }
  }

  return Array.from(byProject.values())
    .map((draft) => ({
      viewKey: draft.viewKey,
      projectKey: draft.projectKey,
      projectName: draft.projectName,
      projectKind: draft.projectKind,
      iconWorkingDir: draft.iconWorkingDir,
      hosts: Array.from(draft.hosts.values()),
      workspaceKeys: draft.workspaces
        .sort(compareWorkspaces)
        .map((workspace) => workspace.workspaceKey),
    }))
    .sort(
      (left, right) =>
        left.projectName.localeCompare(right.projectName, undefined, {
          numeric: true,
          sensitivity: "base",
        }) || left.viewKey.localeCompare(right.viewKey),
    );
}

export function createProjectViewKey(
  identity:
    | { kind: "equivalence"; projectKey: string }
    | { kind: "placement"; serverId: string; projectId: string },
): string {
  return identity.kind === "equivalence"
    ? identity.projectKey
    : JSON.stringify([identity.serverId, identity.projectId]);
}

function allocatePlacementViewKey(
  allocatedViewKeys: Set<string>,
  serverId: string,
  projectId: string,
): string {
  const legacyKey = createProjectViewKey({ kind: "placement", serverId, projectId });
  if (!allocatedViewKeys.has(legacyKey)) {
    allocatedViewKeys.add(legacyKey);
    return legacyKey;
  }

  for (let suffix = 0; ; suffix += 1) {
    const collisionKey = JSON.stringify(["placement", serverId, projectId, suffix]);
    if (allocatedViewKeys.has(collisionKey)) continue;
    allocatedViewKeys.add(collisionKey);
    return collisionKey;
  }
}

function addProjectToView(input: {
  byProject: Map<string, ProjectDraft>;
  keyCountsByServer: Map<string, Map<string, number>>;
  allocatedViewKeys: Set<string>;
  serverId: string;
  project: ProjectDescriptor;
}): string {
  const { byProject, keyCountsByServer, serverId, project } = input;
  const sharedKey = project.projectKey ?? null;
  const canUseSharedKey =
    sharedKey !== null && keyCountsByServer.get(serverId)?.get(sharedKey) === 1;
  const viewKey = canUseSharedKey
    ? createProjectViewKey({ kind: "equivalence", projectKey: sharedKey })
    : allocatePlacementViewKey(input.allocatedViewKeys, serverId, project.projectId);
  const placement: WorkspaceStructureHostPlacement = {
    serverId,
    projectId: project.projectId,
    iconWorkingDir: project.projectRootPath,
    worktreeSupport: project.projectKind === "git" ? "supported" : "unsupported",
    customIconRevision: project.projectCustomIconRevision,
    iconRevision: project.projectIconRevision,
  };
  const draft = byProject.get(viewKey);
  if (!draft) {
    byProject.set(viewKey, {
      viewKey,
      projectKey: sharedKey,
      projectName:
        project.projectCustomName ??
        project.projectDisplayName ??
        projectDisplayNameFromProjectId(project.projectId),
      hasCustomName: Boolean(project.projectCustomName),
      projectKind: project.projectKind,
      iconWorkingDir: project.projectRootPath,
      hosts: new Map([[serverId, placement]]),
      workspaces: [],
    });
  } else {
    if (project.projectCustomName && !draft.hasCustomName) {
      draft.projectName = project.projectCustomName;
      draft.hasCustomName = true;
    }
    draft.hosts.set(serverId, placement);
  }
  return viewKey;
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const value = create();
  map.set(key, value);
  return value;
}

/**
 * The title a workspace row shows. Name sorting reads the same answer the row renders, so the two
 * cannot disagree about where a workspace belongs.
 */
export function resolveSidebarWorkspacePrimaryLabel(input: {
  workspace: { name: string; currentBranch: string | null };
  workspaceTitleSource: WorkspaceTitleSource;
}): string {
  if (input.workspaceTitleSource === "branch") {
    return input.workspace.currentBranch ?? input.workspace.name;
  }
  return input.workspace.name;
}

/** A detached or blank checkout has no branch to show. */
export function normalizeCurrentBranch(currentBranch: string | null | undefined): string | null {
  if (!currentBranch) {
    return null;
  }
  const trimmed = currentBranch.trim();
  return trimmed.length === 0 || trimmed === "HEAD" ? null : trimmed;
}

type WorkspaceComparator = (left: WorkspaceSortItem, right: WorkspaceSortItem) => number;

function workspaceComparator(
  sort: WorkspaceSort | undefined,
  direction: WorkspaceSortDirection,
): WorkspaceComparator {
  // No sort is the picker's alphabetical order.
  if (!sort) return compareWorkspaceStructureItems;
  // Manual's stored order is applied on top of newest-first, which places workspaces the stored
  // order has not seen yet. The direction setting is not Manual's to read.
  const sign = sort !== "manual" && direction === "ascending" ? 1 : -1;
  // Ties fall back to identity in the same direction either way, so flipping the direction never
  // reshuffles rows that compare equal.
  if (sort === "name") {
    return (left, right) =>
      sign * compareTitles(left.displayTitle, right.displayTitle) ||
      left.workspaceKey.localeCompare(right.workspaceKey);
  }
  return (left, right) =>
    sign * (left.sortTime - right.sortTime) || left.workspaceKey.localeCompare(right.workspaceKey);
}

function compareTitles(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function compareWorkspaceStructureItems(left: WorkspaceSortItem, right: WorkspaceSortItem): number {
  return (
    compareTitles(left.workspaceName, right.workspaceName) ||
    left.workspaceKey.localeCompare(right.workspaceKey)
  );
}

function workspaceSortTime(
  workspace: WorkspaceDescriptor,
  sort: WorkspaceSort | undefined,
): number {
  if (!sort || sort === "name") return 0;
  const time =
    sort === "lastPrompt"
      ? (workspace.lastUserMessageAt ?? workspace.createdAt)
      : workspace.createdAt;
  return time?.getTime() ?? 0;
}
