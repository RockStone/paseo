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
}

interface SidebarThreadTreeInput {
  serverId: string;
  workspaceId: string;
  agents: ReadonlyMap<string, Agent>;
  descriptors: ReadonlyMap<string, ProviderSubagentDescriptorPayload>;
  hiddenProviderKeys: ReadonlySet<string>;
  providerSupported: boolean;
  nestingSupported: boolean;
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

export function buildSidebarThreadTree(input: SidebarThreadTreeInput): SidebarThreadNode[] {
  const graph = new Map<string, ThreadGraphNode>();
  for (const agent of input.agents.values()) {
    if (agent.archivedAt) continue;
    const key = `agent:${agent.id}`;
    graph.set(key, {
      key,
      title: agent.title,
      target: { kind: "agent", agentId: agent.id },
      childKeys: [],
    });
  }
  for (const agent of input.agents.values()) {
    if (!agent.parentAgentId || agent.archivedAt) continue;
    const parent = graph.get(`agent:${agent.parentAgentId}`);
    parent?.childKeys.push(`agent:${agent.id}`);
  }
  if (input.providerSupported) addProviderNodes(input, graph);
  const roots: SidebarThreadNode[] = [];
  for (const id of workspaceRootAgentIds(input.agents, input.workspaceId)) {
    const node = materializeThread(graph, `agent:${id}`, new Set());
    if (node && node.children.length > 0) roots.push(node);
  }
  return roots;
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
): SidebarThreadNode | null {
  const node = graph.get(key);
  if (!node || ancestors.has(key)) return null;
  const visited = new Set(ancestors);
  visited.add(key);
  const children: SidebarThreadNode[] = [];
  for (const childKey of node.childKeys) {
    const child = materializeThread(graph, childKey, visited);
    if (child) children.push(child);
  }
  return { key, title: node.title, target: node.target, children };
}
