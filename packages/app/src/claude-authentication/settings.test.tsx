/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { ClaudeAuthenticationSettings } from "./settings";

const api = vi.hoisted(() => ({ save: vi.fn(async () => ({ acknowledged: true })) }));
vi.mock("./use-status", () => ({
  claudeAuthenticationKey: (id: string) => ["claude-authentication", id],
  useClaudeAuthentication: () => ({
    supported: true,
    connected: true,
    status: { isError: false, data: { tokenStored: false } },
    client: { setClaudeAuthentication: api.save },
  }),
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));

Object.assign(globalThis, { React });

test("the token input is masked, saves only to the chosen host, and clears after saving", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ClaudeAuthenticationSettings serverId="test-host" />
        </QueryClientProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Claude subscription token"]',
    );
    if (!input) throw new Error("Token input missing");
    expect(input.type).toBe("password");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setValue) throw new Error("Input setter missing");
    act(() => {
      setValue.call(input, "sk-ant-oat01-SYNTHETIC_UI_TOKEN");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = container.querySelector<HTMLElement>('[data-testid="claude-authentication-save"]');
    if (!save) throw new Error("Save action missing");
    await act(async () => save.click());
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "save", token: "sk-ant-oat01-SYNTHETIC_UI_TOKEN" }),
    );
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="Claude subscription token"]')?.value,
    ).toBe("");
    expect(container.textContent).toContain("Saved to Keychain");
    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain(
      "SYNTHETIC_UI_TOKEN",
    );
  } finally {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
  }
});
