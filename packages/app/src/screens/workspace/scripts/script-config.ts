import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function useScriptConfig(serverId: string, configRoot: string) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  return useFetchQuery({
    queryKey: ["project-script-options", serverId, configRoot],
    dataShape: "value",
    staleTimeMs: 0,
    enabled: Boolean(client) && connected,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected");
      const project = await client.readProjectConfig(configRoot);
      if (!project.ok) return project;
      if (!project.sharedScriptsRoot) return { ...project, sharedScriptNames: [] as string[] };
      const shared = await client.readProjectConfig(project.sharedScriptsRoot);
      if (!shared.ok) return shared;
      return {
        ...project,
        sharedScriptNames: Object.keys(shared.config?.scripts ?? {}).filter(
          (name) => !Object.hasOwn(project.config?.scripts ?? {}, name),
        ),
        config: {
          ...project.config,
          scripts: { ...shared.config?.scripts, ...project.config?.scripts },
        },
      };
    },
  });
}
