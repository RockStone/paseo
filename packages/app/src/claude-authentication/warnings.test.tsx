/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { ClaudeAuthenticationWarnings } from "./warnings";

const state = vi.hoisted(() => ({
  warning: "authentication_failed" as string | null,
  unregister: vi.fn(),
  show: vi.fn(),
  open: vi.fn(),
}));
vi.mock("./use-status", () => ({
  useClaudeAuthentication: () => ({
    supported: true,
    connected: true,
    status: { isError: false, data: { warning: state.warning, affectedAgents: 2, renewBy: null } },
  }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "affected-host", label: "Local Mac" }],
}));
vi.mock("@/contexts/sidebar-callout-context", () => ({
  useSidebarCallouts: () => ({ show: state.show }),
}));
vi.mock("@/stores/provider-settings-store", () => ({
  useProviderSettingsStore: (select: (value: { open: typeof state.open }) => unknown) =>
    select({ open: state.open }),
}));
Object.assign(globalThis, { React });

test("host failures expose one warning with the right settings target and clear on recovery", () => {
  state.show.mockReturnValue(state.unregister);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() => root.render(<ClaudeAuthenticationWarnings />));
    expect(state.show).toHaveBeenCalledTimes(1);
    const warning = state.show.mock.calls[0]?.[0];
    expect(warning).toMatchObject({
      id: "claude-authentication:affected-host",
      title: "Claude authentication failed",
      dismissible: false,
    });
    expect(warning.description).toContain("2 agent(s)");
    warning.actions[0].onPress();
    expect(state.open).toHaveBeenCalledWith({ serverId: "affected-host", provider: "claude" });
    state.warning = null;
    act(() => root.render(<ClaudeAuthenticationWarnings />));
    expect(state.unregister).toHaveBeenCalledTimes(1);
    expect(state.show).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
