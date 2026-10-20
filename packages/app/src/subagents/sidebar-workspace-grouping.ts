import type { Agent } from "@/stores/session-store";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/sidebar-workspaces-view-model";
import { workspaceRootAgentIds } from "./sidebar-tree";

type SidebarSessions = Readonly<Record<string, { agents: ReadonlyMap<string, Agent> } | undefined>>;

/** Only fold workspaces whose roots all belong to the same visible parent workspace. */
export function nestedSidebarWorkspaceParents(
  projects: readonly SidebarProjectEntry[],
  sessions: SidebarSessions,
): Map<string, string> {
  const parents = new Map<string, string>();
  for (const project of projects) {
    const placements = new Map(
      project.workspaces.map((workspace) => [workspace.workspaceKey, workspace]),
    );
    for (const workspace of project.workspaces) {
      const agents = sessions[workspace.serverId]?.agents;
      if (!agents) continue;
      const parentKey = workspaceParent(workspace, agents, placements);
      if (parentKey) parents.set(workspace.workspaceKey, parentKey);
    }
  }
  // Malformed parent cycles must leave every workspace accessible.
  for (const key of parents.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = key;
    while (current && parents.has(current)) {
      if (visited.has(current)) {
        for (const member of visited) parents.delete(member);
        break;
      }
      visited.add(current);
      current = parents.get(current);
    }
  }
  return parents;
}

// Session-store selectors run on every stream tick, which leaves each agent map untouched.
// Reuse the previous grouping until one of the listed hosts replaces its agent map.
export function createNestedSidebarWorkspaceParentsSelector(
  projects: readonly SidebarProjectEntry[],
): (state: { sessions: SidebarSessions }) => Map<string, string> {
  const serverIds = [
    ...new Set(
      projects.flatMap((project) => project.workspaces.map((workspace) => workspace.serverId)),
    ),
  ];
  let previousAgents: (ReadonlyMap<string, Agent> | undefined)[] | null = null;
  let previousParents = new Map<string, string>();
  return ({ sessions }) => {
    const agents = serverIds.map((serverId) => sessions[serverId]?.agents);
    if (previousAgents?.every((map, index) => map === agents[index])) return previousParents;
    previousAgents = agents;
    previousParents = nestedSidebarWorkspaceParents(projects, sessions);
    return previousParents;
  };
}

function workspaceParent(
  workspace: SidebarWorkspacePlacement,
  agents: ReadonlyMap<string, Agent>,
  placements: ReadonlyMap<string, SidebarWorkspacePlacement>,
): string | null {
  const roots = workspaceRootAgentIds(agents, workspace.workspaceId);
  if (roots.length === 0) return null;
  let owner: string | null = null;
  for (const id of roots) {
    const agent = agents.get(id)!;
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (!parent?.workspaceId || parent.archivedAt) return null;
    const parentKey = `${workspace.serverId}:${parent.workspaceId}`;
    if (!placements.has(parentKey) || parentKey === workspace.workspaceKey) return null;
    if (owner && owner !== parentKey) return null;
    owner = parentKey;
  }
  return owner;
}

export function groupSidebarProjects(
  projects: SidebarProjectEntry[],
  parents: ReadonlyMap<string, string>,
): SidebarProjectEntry[] {
  if (parents.size === 0) return projects;
  return projects.map((project) => {
    const rank = new Map(
      project.workspaces.map((workspace, index) => [workspace.workspaceKey, index]),
    );
    for (const workspace of project.workspaces) {
      let owner = workspace.workspaceKey;
      while (parents.has(owner)) owner = parents.get(owner)!;
      rank.set(owner, Math.min(rank.get(owner) ?? Infinity, rank.get(workspace.workspaceKey)!));
    }
    const workspaces = project.workspaces.filter(
      (workspace) => !parents.has(workspace.workspaceKey),
    );
    workspaces.sort((left, right) => rank.get(left.workspaceKey)! - rank.get(right.workspaceKey)!);
    return { ...project, workspaces };
  });
}
