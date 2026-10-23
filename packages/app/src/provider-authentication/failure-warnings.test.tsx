/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { AgentAuthenticationWarnings } from "./failure-warnings";

const fixture = vi.hoisted(() => ({
  agents: new Map<
    string,
    { serverId: string; provider: string; status: "error"; lastError: string }
  >(),
  show: vi.fn(),
  unregister: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (
    select: (value: { sessions: { mac: { agents: typeof fixture.agents } } }) => unknown,
  ) => select({ sessions: { mac: { agents: fixture.agents } } }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "mac", label: "Local Mac" }],
  useHostRuntimeIsConnected: () => true,
}));
vi.mock("@/contexts/sidebar-callout-context", () => ({
  useSidebarCallouts: () => ({ show: fixture.show }),
}));
vi.mock("@/stores/provider-settings-store", () => ({
  useProviderSettingsStore: (select: (value: { open: typeof fixture.open }) => unknown) =>
    select({ open: fixture.open }),
}));
Object.assign(globalThis, { React });
afterEach(() => {
  fixture.agents = new Map();
  vi.clearAllMocks();
});

test.each(["codex", "claude"])(
  "%s failure warnings follow agent updates without polling",
  (provider) => {
    fixture.show.mockReturnValue(fixture.unregister);
    fixture.agents.set("child", {
      serverId: "mac",
      provider,
      status: "error",
      lastError: "401 authentication_error",
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() => root.render(<AgentAuthenticationWarnings />));
      expect(fixture.show).toHaveBeenCalledTimes(1);
      const warning = fixture.show.mock.calls[0]?.[0];
      expect(warning.id).toBe(`provider-authentication:mac:${provider}`);
      expect(warning.description).toContain("Local Mac · 1 agent(s)");
      warning.actions[0].onPress();
      expect(fixture.open).toHaveBeenCalledWith({ serverId: "mac", provider });
      fixture.agents = new Map();
      act(() => root.render(<AgentAuthenticationWarnings />));
      expect(fixture.unregister).toHaveBeenCalledTimes(1);
      expect(fixture.show).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  },
);
