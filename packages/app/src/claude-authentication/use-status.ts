import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function claudeAuthenticationKey(serverId: string) {
  return ["claude-authentication", serverId];
}

export function useClaudeAuthentication(serverId: string, active = true) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "claudeAuthentication");
  const status = useFetchQuery({
    dataShape: "value",
    queryKey: claudeAuthenticationKey(serverId),
    enabled: active && supported && connected && client !== null,
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected");
      return client.getClaudeAuthentication();
    },
    refetchInterval: 3_600_000,
    staleTimeMs: 3_600_000,
    retry: false,
  });
  return { status, client, supported, connected };
}
