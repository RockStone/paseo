import { loadPersistedConfig, savePersistedConfig } from "@getpaseo/server/configuration";

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
