import { isProviderAuthenticationFailure } from "@getpaseo/protocol/authentication-failure";
import type { Agent } from "@/stores/session-store";

export interface AuthenticationFailureGroup {
  serverId: string;
  provider: "claude" | "codex";
  count: number;
}

type AuthenticationAgent = Pick<
  Agent,
  "serverId" | "provider" | "status" | "archivedAt" | "lastError"
>;

export function groupAuthenticationFailures(
  agents: Iterable<AuthenticationAgent>,
): AuthenticationFailureGroup[] {
  const groups = new Map<string, AuthenticationFailureGroup>();
  for (const agent of agents) {
    if (agent.archivedAt || agent.status === "closed") continue;
    if (agent.provider !== "claude" && agent.provider !== "codex") continue;
    if (!isProviderAuthenticationFailure(agent.provider, agent.lastError)) continue;
    const key = JSON.stringify([agent.serverId, agent.provider]);
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { serverId: agent.serverId, provider: agent.provider, count: 1 });
  }
  return [...groups.values()];
}
