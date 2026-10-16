import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPersistedConfig, savePersistedConfig } from "@getpaseo/server/configuration";
import { ensureCustomDaemonConfig } from "./custom-build";

const homes: string[] = [];
function temporaryHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "paseoi-defaults-"));
  homes.push(home);
  return home;
}
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("custom daemon listener", () => {
  it("persists the custom listener on first launch", () => {
    const home = temporaryHome();
    ensureCustomDaemonConfig(home);
    expect(loadPersistedConfig(home).daemon?.listen).toBe("127.0.0.1:6770");
  });
  it("repairs the previous default without losing other configuration", () => {
    const home = temporaryHome();
    const config = loadPersistedConfig(home);
    savePersistedConfig(home, { ...config, pluginsEnabled: false });
    ensureCustomDaemonConfig(home);
    expect(loadPersistedConfig(home)).toEqual({
      ...config,
      pluginsEnabled: false,
      daemon: { ...config.daemon, listen: "127.0.0.1:6770" },
    });
  });
  it("preserves a deliberately configured alternate listener", () => {
    const home = temporaryHome();
    const config = loadPersistedConfig(home);
    savePersistedConfig(home, {
      ...config,
      daemon: { ...config.daemon, listen: "127.0.0.1:6780" },
    });
    ensureCustomDaemonConfig(home);
    expect(loadPersistedConfig(home).daemon?.listen).toBe("127.0.0.1:6780");
  });
});
