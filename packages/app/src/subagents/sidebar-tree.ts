import type { Agent } from "@/stores/session-store";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { isWorkspaceRootAgent } from "./workspace-root-policy";

export type SidebarThreadTarget =
  | Extract<WorkspaceTabTarget, { kind: "agent" }>
  | (Extract<WorkspaceTabTarget, { kind: "provider_subagent" }> & { workspaceId: string });

export interface SidebarThreadNode {
  key: string;
  title: string | null;
  target: SidebarThreadTarget;
  children: SidebarThreadNode[];
}

interface ThreadGraphNode extends Omit<SidebarThreadNode, "children"> {
  childKeys: string[];
  recent: boolean;
  lastActivityAt: number;
}

interface SidebarThreadTreeInput {
  serverId: string;
  workspaceId: string;
  agents: ReadonlyMap<string, Agent>;
  descriptors: ReadonlyMap<string, ProviderSubagentDescriptorPayload>;
  hiddenProviderKeys: ReadonlySet<string>;
  providerSupported: boolean;
  nestingSupported: boolean;
  activityCutoff?: number;
  activity?: ReadonlyMap<string, Date>;
  // Order-only subscriptions can reuse timestamps while streaming continues in the same row.
  activityOrder?: readonly string[];
  nestedWorkspaceIds?: ReadonlySet<string>;
}

export function workspaceRootAgentIds(
  agents: ReadonlyMap<string, Agent>,
  workspaceId: string,
): string[] {
  const ids: string[] = [];
  for (const agent of agents.values()) {
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (
      !agent.archivedAt &&
      agent.workspaceId === workspaceId &&
      isWorkspaceRootAgent(agent, parent)
    )
      ids.push(agent.id);
  }
  return ids;
}

// Session-store selectors run on every stream tick. Activity timestamps are coalesced
// into a new map, so reuse the last order until that map is replaced.
export function createSidebarActivityOrderSelector(input: {
  serverId: string;
  agents: ReadonlyMap<string, Agent>;
  descriptors: ReadonlyMap<string, ProviderSubagentDescriptorPayload>;
  activityCutoff: number;
}): (state: { agentLastActivity: ReadonlyMap<string, Date> }) => string[] {
  let previousActivity: ReadonlyMap<string, Date> | undefined;
  let previousOrder: string[] = [];
  return ({ agentLastActivity }) => {
    if (agentLastActivity === previousActivity) return previousOrder;
    previousActivity = agentLastActivity;
    const timestamps = Array.from(input.agents.values()).map((agent) => ({
      key: `agent:${agent.id}`,
      timestamp: (agentLastActivity.get(agent.id) ?? agent.lastActivityAt).getTime(),
    }));
    for (const [key, descriptor] of input.descriptors) {
      if (key.startsWith(`${input.serverId}\0`))
        timestamps.push({
          key: `provider:${descriptor.parentAgentId}:${descriptor.id}`,
          timestamp: Date.parse(descriptor.updatedAt),
        });
    }
    previousOrder = timestamps
      .filter((entry) => entry.timestamp >= input.activityCutoff)
      .sort((left, right) => right.timestamp - left.timestamp)
      .map((entry) => entry.key);
    return previousOrder;
  };
}

export function buildSidebarThreadTree(input: SidebarThreadTreeInput): SidebarThreadNode[] {
  const graph = new Map<string, ThreadGraphNode>();
  for (const agent of input.agents.values()) {
    if (agent.archivedAt) continue;
    const key = `agent:${agent.id}`;
    const lastActivityAt = (input.activity?.get(agent.id) ?? agent.lastActivityAt).getTime();
    graph.set(key, {
      key,
      title: agent.title,
      lastActivityAt,
      recent:
        input.activityCutoff === undefined ||
        lastActivityAt >= input.activityCutoff ||
        agent.turn.phase === "open" ||
        agent.status === "running" ||
        agent.status === "initializing" ||
        agent.pendingPermissions.length > 0 ||
        agent.attentionReason === "permission",
      target: { kind: "agent", agentId: agent.id },
      childKeys: [],
    });
  }
  addManagedChildLinks(input, graph);
  if (input.providerSupported) addProviderNodes(input, graph);
  const activityRank = new Map(input.activityOrder?.map((key, index) => [key, index]));
  const compareActivity = (left: string, right: string) => {
    const rank = (activityRank.get(left) ?? Infinity) - (activityRank.get(right) ?? Infinity);
    return (
      (Number.isNaN(rank) ? 0 : rank) ||
      graph.get(right)!.lastActivityAt - graph.get(left)!.lastActivityAt
    );
  };
  const roots: SidebarThreadNode[] = [];
  const primary = sidebarWorkspaceTarget(input.agents, input.workspaceId);
  for (const id of workspaceRootAgentIds(input.agents, input.workspaceId)) {
    const node = materializeThread(graph, `agent:${id}`, new Set(), compareActivity);
    // The workspace row already represents the primary agent. Other sessions need their own
    // row even when they have no children, as with imports into an existing workspace.
    if (node && (node.children.length > 0 || id !== primary?.agentId)) roots.push(node);
  }
  return roots.sort((left, right) => compareActivity(left.key, right.key));
}

function addManagedChildLinks(
  input: SidebarThreadTreeInput,
  graph: Map<string, ThreadGraphNode>,
): void {
  for (const agent of input.agents.values()) {
    if (!agent.parentAgentId || agent.archivedAt) continue;
    // Independent workspaces keep their own row; delegated workspaces join the parent's tree.
    if (
      isWorkspaceRootAgent(agent, input.agents.get(agent.parentAgentId)) &&
      !input.nestedWorkspaceIds?.has(agent.workspaceId ?? "")
    )
      continue;
    graph.get(`agent:${agent.parentAgentId}`)?.childKeys.push(`agent:${agent.id}`);
  }
}

function addProviderNodes(
  input: SidebarThreadTreeInput,
  graph: Map<string, ThreadGraphNode>,
): void {
  const prefix = `${input.serverId}\0`;
  const included = new Map<string, ProviderSubagentDescriptorPayload>();
  for (const [key, descriptor] of input.descriptors) {
    const parent = input.agents.get(descriptor.parentAgentId);
    if (
      !key.startsWith(prefix) ||
      input.hiddenProviderKeys.has(key) ||
      !parent?.workspaceId ||
      parent.archivedAt
    )
      continue;
    const nodeKey = `provider:${descriptor.parentAgentId}:${descriptor.id}`;
    included.set(nodeKey, descriptor);
    graph.set(nodeKey, {
      key: nodeKey,
      title: descriptor.description || descriptor.title,
      lastActivityAt: Date.parse(descriptor.updatedAt),
      recent:
        input.activityCutoff === undefined ||
        Date.parse(descriptor.updatedAt) >= input.activityCutoff ||
        descriptor.status === "running",
      target: {
        kind: "provider_subagent",
        parentAgentId: descriptor.parentAgentId,
        subagentId: descriptor.id,
        workspaceId: parent.workspaceId,
      },
      childKeys: [],
    });
  }
  for (const [key, descriptor] of included) {
    const nested = input.nestingSupported && descriptor.parentSubagentId;
    const parentKey = nested
      ? `provider:${descriptor.parentAgentId}:${descriptor.parentSubagentId}`
      : `agent:${descriptor.parentAgentId}`;
    graph.get(parentKey)?.childKeys.push(key);
  }
}

function materializeThread(
  graph: ReadonlyMap<string, ThreadGraphNode>,
  key: string,
  ancestors: ReadonlySet<string>,
  compareActivity: (left: string, right: string) => number,
): SidebarThreadNode | null {
  const node = graph.get(key);
  if (!node || ancestors.has(key)) return null;
  const visited = new Set(ancestors);
  visited.add(key);
  const children: SidebarThreadNode[] = [];
  for (const childKey of [...node.childKeys].sort(compareActivity)) {
    const child = materializeThread(graph, childKey, visited, compareActivity);
    if (child) children.push(child);
  }
  if (!node.recent && children.length === 0) return null;
  return { key, title: node.title, target: node.target, children };
}

export function sidebarThreadKeys(nodes: readonly SidebarThreadNode[]): string[] {
  return nodes.flatMap((node) => [node.key, ...sidebarThreadKeys(node.children)]);
}

export function sidebarWorkspaceTarget(
  agents: ReadonlyMap<string, Agent>,
  workspaceId: string,
): Extract<WorkspaceTabTarget, { kind: "agent" }> | undefined {
  const roots = workspaceRootAgentIds(agents, workspaceId);
  // Detaching a later agent must not turn the original coordinator into a nested row
  // or change what the workspace itself opens. Creation time survives archive/resume.
  roots.sort(
    (left, right) =>
      agents.get(left)!.createdAt.getTime() - agents.get(right)!.createdAt.getTime() ||
      left.localeCompare(right),
  );
  return roots.length > 0 ? { kind: "agent", agentId: roots[0]! } : undefined;
}
