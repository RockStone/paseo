import { loadPersistedConfig, savePersistedConfig } from "@getpaseo/server/configuration";
import path from "node:path";

export function resolveCustomBuildPaths(input: {
  appData: string;
  home: string;
  daemonHome?: string;
  userData?: string;
}): { daemonHome: string; userData: string } {
  return {
    daemonHome: input.daemonHome ?? path.join(input.home, ".paseo"),
    userData: input.userData?.trim() || path.join(input.appData, "Paseoi"),
  };
}

export function ensureCustomDaemonConfig(home: string): void {
  const config = loadPersistedConfig(home);
  const listen = config.daemon?.listen;
  if (listen && listen !== "127.0.0.1:6767") return;
  // Managed launches discard PASEO_LISTEN. Migrate the previous custom build's
  // generated default in its own home, preserving every other setting.
  savePersistedConfig(home, {
    ...config,
    daemon: { ...config.daemon, listen: "127.0.0.1:6770" },
  });
}
