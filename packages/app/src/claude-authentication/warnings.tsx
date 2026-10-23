import { useEffect } from "react";
import { useHosts } from "@/runtime/host-runtime";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { useClaudeAuthentication } from "./use-status";

function HostAuthenticationWarning({ serverId, label }: { serverId: string; label: string }) {
  const { status, supported, connected } = useClaudeAuthentication(serverId);
  const { show } = useSidebarCallouts();
  const open = useProviderSettingsStore((state) => state.open);
  const warning = status.data?.warning;
  const renewBy = status.data?.renewBy?.slice(0, 10);
  useEffect(() => {
    const reminderDue = warning === "renew_soon" || warning === "renewal_due";
    if (!supported || !connected || (!reminderDue && !status.isError)) return;
    let description = `${label} · Renew the stored token by ${renewBy}`;
    if (status.isError)
      description = `${label} · Unable to check macOS Keychain. Unlock the host’s login keychain and retry.`;
    return show({
      id: `claude-authentication-reminder:${serverId}`,
      title: "Claude authentication needs attention",
      description,
      variant: "error",
      priority: 100,
      dismissible: false,
      actions: [
        { label: "Claude settings", onPress: () => open({ serverId, provider: "claude" }) },
      ],
      testID: "claude-authentication-warning",
    });
  }, [connected, label, open, renewBy, serverId, show, status.isError, supported, warning]);
  return null;
}

export function ClaudeAuthenticationWarnings() {
  const hosts = useHosts();
  return (
    <>
      {hosts.map((host) => (
        <HostAuthenticationWarning
          key={host.serverId}
          serverId={host.serverId}
          label={host.label}
        />
      ))}
    </>
  );
}
