import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket } from "./sidebar-agent-state";

/** The workspace clock includes delegated descendants even when they own another workspace. */
export function selectWorkspaceLastActivity(input: {
  serverId: string;
  workspaceId: string;
  agents: ReadonlyMap<string, Agent>;
  activity: ReadonlyMap<string, Date>;
  providerSubagents?: ReadonlyMap<string, { parentAgentId: string; updatedAt: string }>;
}): number | null {
  let latest: number | null = null;
  const contributes = (agentId: string): boolean => {
    const visited = new Set<string>();
    let agent = input.agents.get(agentId);
    while (agent && !agent.archivedAt && !visited.has(agent.id)) {
      if (agent.workspaceId === input.workspaceId) return true;
      visited.add(agent.id);
      agent = agent.parentAgentId ? input.agents.get(agent.parentAgentId) : undefined;
    }
    return false;
  };
  const include = (timestamp: number) => {
    if (Number.isFinite(timestamp)) latest = Math.max(latest ?? timestamp, timestamp);
  };
  for (const agent of input.agents.values()) {
    if (!contributes(agent.id)) continue;
    include(agent.lastActivityAt.getTime());
    const streamed = input.activity.get(agent.id);
    if (streamed) include(streamed.getTime());
  }
  const prefix = `${input.serverId}\0`;
  for (const [key, child] of input.providerSubagents ?? []) {
    if (key.startsWith(prefix) && contributes(child.parentAgentId))
      include(Date.parse(child.updatedAt));
  }
  return latest;
}

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
}

function workspaceAgentStatus(agent: Agent): Agent["status"] {
  if (agent.turn.phase === "open") return "running";
  return agent.status === "running" ? "idle" : agent.status;
}

export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const activityByWorkspaceId = new Map<string, WorkspaceAgentActivity>();
  const latestActivityAtByWorkspaceId = new Map<string, Date>();

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    const enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    const latestActivityAt = latestActivityAtByWorkspaceId.get(agent.workspaceId);
    if (latestActivityAt && enteredAt <= latestActivityAt) {
      continue;
    }
    latestActivityAtByWorkspaceId.set(agent.workspaceId, enteredAt);

    const status = deriveSidebarStateBucket({
      status: workspaceAgentStatus(agent),
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    activityByWorkspaceId.set(agent.workspaceId, {
      agentId: agent.id,
      status,
      enteredAt,
    });
  }

  for (const [workspaceId, activity] of activityByWorkspaceId) {
    const previousActivity = previous?.get(workspaceId);
    if (
      previousActivity?.agentId === activity.agentId &&
      previousActivity.status === activity.status
    ) {
      activityByWorkspaceId.set(workspaceId, previousActivity);
    }
  }

  if (previous && areWorkspaceAgentActivityIndexesIdentical(previous, activityByWorkspaceId)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return activityByWorkspaceId;
}

function areWorkspaceAgentActivityIndexesIdentical(
  previous: ReadonlyMap<string, WorkspaceAgentActivity>,
  next: ReadonlyMap<string, WorkspaceAgentActivity>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, activity] of next) {
    if (previous.get(workspaceId) !== activity) {
      return false;
    }
  }
  return true;
}
