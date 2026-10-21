import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import type { Logger } from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";

/** A named workspace owns the name of its sole independent agent. */
export async function attachWorkspaceAgentNames(input: {
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "list" | "subscribeToMutations">;
  agentStorage: Pick<AgentStorage, "listByWorkspace">;
  agentManager: Pick<AgentManager, "subscribe" | "updateAgentMetadata">;
  logger: Logger;
}): Promise<() => Promise<void>> {
  const pending = new Map<string, Promise<void>>();
  const sync = async (workspaceId: string) => {
    const workspace = await input.workspaceRegistry.get(workspaceId);
    const title = workspace?.title?.trim();
    if (!workspace || workspace.archivedAt || !title) return;
    const direct = (await input.agentStorage.listByWorkspace(workspaceId)).filter(
      (agent) => !agent.internal && !agent.archivedAt && !getParentAgentIdFromLabels(agent.labels),
    );
    // Multiple independent agents need their own names; children never inherit this title.
    if (direct.length !== 1 || direct[0].title === title) return;
    await input.agentManager.updateAgentMetadata(direct[0].id, { title });
  };
  const enqueue = (workspaceId: string): Promise<void> => {
    const previous = pending.get(workspaceId) ?? Promise.resolve();
    const next = previous
      .then(() => sync(workspaceId))
      .catch((error: unknown) => {
        input.logger.error(
          { err: error, workspaceId },
          "Failed to synchronize workspace agent name",
        );
      });
    pending.set(workspaceId, next);
    void next.then(() => {
      if (pending.get(workspaceId) === next) pending.delete(workspaceId);
      return undefined;
    });
    return next;
  };
  const unsubscribeWorkspaces = input.workspaceRegistry.subscribeToMutations?.((mutation) =>
    enqueue(mutation.workspaceId),
  );
  const unsubscribeAgents = input.agentManager.subscribe(
    (event) => {
      if (event.type === "agent_state" && event.agent.workspaceId && !event.agent.internal)
        void enqueue(event.agent.workspaceId);
    },
    { replayState: false },
  );
  // Repair existing names without loading or resuming their provider sessions.
  await Promise.all(
    (await input.workspaceRegistry.list()).map((workspace) => enqueue(workspace.workspaceId)),
  );
  return async () => {
    unsubscribeWorkspaces?.();
    unsubscribeAgents();
    await Promise.all(pending.values());
  };
}
