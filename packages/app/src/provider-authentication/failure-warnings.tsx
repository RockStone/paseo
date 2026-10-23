import { memo, useEffect, useMemo } from "react";
import { useHosts, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { useSessionStore } from "@/stores/session-store";
import { groupAuthenticationFailures, type AuthenticationFailureGroup } from "./failures";

interface FailureWarningProps extends AuthenticationFailureGroup {
  label: string;
}

const FailureWarning = memo(function FailureWarning({
  serverId,
  provider,
  count,
  label,
}: FailureWarningProps) {
  const connected = useHostRuntimeIsConnected(serverId);
  const { show } = useSidebarCallouts();
  const open = useProviderSettingsStore((state) => state.open);
  useEffect(() => {
    if (!connected) return;
    const name = provider === "codex" ? "Codex" : "Claude";
    const recovery =
      provider === "codex"
        ? "Restore Codex authentication on this host, then retry affected conversations. For ChatGPT login, run codex login."
        : "Restore authentication or replace the stored token, then retry affected conversations.";
    return show({
      id: `provider-authentication:${serverId}:${provider}`,
      title: `${name} authentication failed`,
      description: `${label} · ${count} agent(s) reported an authentication failure. ${recovery}`,
      priority: 110,
      dismissible: false,
      variant: "error",
      actions: [{ label: `${name} settings`, onPress: () => open({ serverId, provider }) }],
      testID: `${provider}-authentication-failure-warning`,
    });
  }, [connected, count, label, open, provider, serverId, show]);
  return null;
});

function HostAuthenticationFailures({ serverId, label }: { serverId: string; label: string }) {
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const groups = useMemo(
    () => (agents ? groupAuthenticationFailures(agents.values()) : []),
    [agents],
  );
  return (
    <>
      {groups.map((group) => (
        <FailureWarning key={group.provider} {...group} label={label} />
      ))}
    </>
  );
}

export function AgentAuthenticationWarnings() {
  const hosts = useHosts();
  return (
    <>
      {hosts.map((host) => (
        <HostAuthenticationFailures
          key={host.serverId}
          serverId={host.serverId}
          label={host.label}
        />
      ))}
    </>
  );
}
