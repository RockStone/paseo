import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPersistedConfig, savePersistedConfig } from "@getpaseo/server/configuration";
import { ensureCustomDaemonConfig, resolveCustomBuildPaths } from "./custom-build";

describe("custom desktop storage", () => {
  const defaults = { appData: "/user/Library/Application Support", home: "/user" };

  it("uses Paseoi preferences and the shared host home", () => {
    expect(resolveCustomBuildPaths(defaults)).toEqual({
      userData: "/user/Library/Application Support/Paseoi",
      daemonHome: "/user/.paseo",
    });
  });

  it("honors isolated daemon and desktop overrides", () => {
    expect(
      resolveCustomBuildPaths({
        ...defaults,
        daemonHome: "/tmp/isolated-host",
        userData: " /tmp/isolated-desktop ",
      }),
    ).toEqual({
      userData: "/tmp/isolated-desktop",
      daemonHome: "/tmp/isolated-host",
    });
  });

  it("ignores a blank desktop override", () => {
    expect(resolveCustomBuildPaths({ ...defaults, userData: " " }).userData).toBe(
      "/user/Library/Application Support/Paseoi",
    );
  });
});

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
