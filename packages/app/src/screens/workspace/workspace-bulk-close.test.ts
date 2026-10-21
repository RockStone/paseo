import { describe, expect, it, vi } from "vitest";
import {
  buildBulkCloseConfirmationMessage,
  classifyBulkClosableTabs,
  closeBulkWorkspaceTabs,
} from "@/screens/workspace/workspace-bulk-close";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function makeAgentTab(id: string): WorkspaceTabDescriptor {
  return {
    key: `agent_${id}`,
    tabId: `agent_${id}`,
    kind: "agent",
    target: { kind: "agent", agentId: id },
  };
}

function makeTerminalTab(id: string): WorkspaceTabDescriptor {
  return {
    key: `terminal_${id}`,
    tabId: `terminal_${id}`,
    kind: "terminal",
    target: { kind: "terminal", terminalId: id },
  };
}

function makeFileTab(path: string): WorkspaceTabDescriptor {
  return {
    key: `file_${path}`,
    tabId: `file_${path}`,
    kind: "file",
    target: { kind: "file", path },
  };
}

describe("workspace bulk close helpers", () => {
  it("classifies agent, terminal, and passive tabs for shared bulk close handling", () => {
    const groups = classifyBulkClosableTabs([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeFileTab("/repo/README.md"),
    ]);

    expect(groups).toEqual({
      agentTabs: [{ tabId: "agent_a1", agentId: "a1" }],
      terminalTabs: [{ tabId: "terminal_t1", terminalId: "t1" }],
      otherTabs: [
        {
          tabId: "file_/repo/README.md",
          target: { kind: "file", path: "/repo/README.md" },
        },
      ],
    });
  });

  it("counts parent and child tabs as layout changes in the confirmation", () => {
    const groups = classifyBulkClosableTabs([makeAgentTab("root"), makeAgentTab("child")]);
    expect(groups.agentTabs).toEqual([
      { tabId: "agent_root", agentId: "root" },
      { tabId: "agent_child", agentId: "child" },
    ]);
    expect(buildBulkCloseConfirmationMessage(groups)).toBe("This will close 2 tab(s).");
  });

  it("describes mixed destructive bulk close operations in the confirmation copy", () => {
    const message = buildBulkCloseConfirmationMessage(
      classifyBulkClosableTabs([
        makeAgentTab("a1"),
        makeAgentTab("a2"),
        makeTerminalTab("t1"),
        makeFileTab("/repo/README.md"),
      ]),
    );

    expect(message).toBe(
      "This will close 1 terminal(s) and close 3 tab(s). Any running process in a closed terminal will be stopped immediately.",
    );
  });

  it("keeps terminal-only confirmations explicit about stopping running processes", () => {
    const message = buildBulkCloseConfirmationMessage(
      classifyBulkClosableTabs([makeTerminalTab("t1")]),
    );

    expect(message).toBe(
      "This will close 1 terminal(s). Any running process in a closed terminal will be stopped immediately.",
    );
  });

  it("closes agent tabs locally and sends only terminals to closeItems", async () => {
    const groups = classifyBulkClosableTabs([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeTerminalTab("t2"),
      makeFileTab("/repo/README.md"),
    ]);
    const closedTabIds: string[] = [];
    const cleanupCalls: Array<{ tabId: string; target?: WorkspaceTabDescriptor["target"] }> = [];
    const closeItems = vi.fn(async () => ({
      agents: [],
      terminals: [
        { terminalId: "t1", success: true },
        { terminalId: "t2", success: false },
      ],
      requestId: "req-1",
    }));

    await closeBulkWorkspaceTabs({
      groups,
      client: { closeItems },
      closeTab: async (tabId, action) => {
        closedTabIds.push(tabId);
        await action();
      },
      closeWorkspaceTabWithCleanup: (input) => {
        cleanupCalls.push(input);
      },
      prepareCloseAgentTab: async () => {},
      logLabel: "all tabs",
    });

    expect(closeItems).toHaveBeenCalledTimes(1);
    expect(closeItems).toHaveBeenCalledWith({
      agentIds: [],
      terminalIds: ["t1", "t2"],
    });
    expect(closedTabIds).toEqual([
      "agent_a1",
      "terminal_t1",
      "terminal_t2",
      "file_/repo/README.md",
    ]);
    expect(cleanupCalls).toEqual([
      { tabId: "agent_a1", target: { kind: "agent", agentId: "a1" } },
      { tabId: "terminal_t1", target: { kind: "terminal", terminalId: "t1" } },
      { tabId: "terminal_t2", target: { kind: "terminal", terminalId: "t2" } },
      { tabId: "file_/repo/README.md", target: { kind: "file", path: "/repo/README.md" } },
    ]);
  });

  it("still closes all tabs when the mixed closeItems RPC fails", async () => {
    const groups = classifyBulkClosableTabs([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeFileTab("/repo/README.md"),
    ]);
    const closedTabIds: string[] = [];
    const cleanupCalls: Array<{ tabId: string; target?: WorkspaceTabDescriptor["target"] }> = [];
    const warn = vi.fn();

    await closeBulkWorkspaceTabs({
      groups,
      client: {
        closeItems: async () => {
          throw new Error("rpc failed");
        },
      },
      closeTab: async (tabId, action) => {
        closedTabIds.push(tabId);
        await action();
      },
      closeWorkspaceTabWithCleanup: (input) => {
        cleanupCalls.push(input);
      },
      prepareCloseAgentTab: async () => {},
      warn,
      logLabel: "others",
    });

    await Promise.resolve();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(closedTabIds).toEqual(["agent_a1", "terminal_t1", "file_/repo/README.md"]);
    expect(cleanupCalls).toEqual([
      { tabId: "agent_a1", target: { kind: "agent", agentId: "a1" } },
      { tabId: "terminal_t1", target: { kind: "terminal", terminalId: "t1" } },
      { tabId: "file_/repo/README.md", target: { kind: "file", path: "/repo/README.md" } },
    ]);
  });

  it("closes parent and child tabs without sending either agent to closeItems", async () => {
    const groups = classifyBulkClosableTabs([makeAgentTab("root"), makeAgentTab("child")]);
    const closeItems = vi.fn(async () => ({ agents: [], terminals: [], requestId: "req-1" }));
    const preparedSubagents: string[] = [];
    const cleanedTabs: string[] = [];

    await closeBulkWorkspaceTabs({
      groups,
      client: { closeItems },
      closeTab: async (_tabId, action) => action(),
      prepareCloseAgentTab: async (agentId) => {
        preparedSubagents.push(agentId);
      },
      closeWorkspaceTabWithCleanup: ({ tabId }) => {
        cleanedTabs.push(tabId);
      },
      logLabel: "others",
    });

    expect(closeItems).not.toHaveBeenCalled();
    expect(preparedSubagents).toEqual(["root", "child"]);
    expect(cleanedTabs).toEqual(["agent_root", "agent_child"]);
  });

  it("keeps an agent tab open if clearing its open-tab label fails", async () => {
    const closeItems = vi.fn();
    const cleanup = vi.fn();
    const warn = vi.fn();
    await closeBulkWorkspaceTabs({
      groups: classifyBulkClosableTabs([makeAgentTab("child"), makeFileTab("/repo/README.md")]),
      client: { closeItems },
      closeTab: async (_tabId, action) => action(),
      prepareCloseAgentTab: async () => {
        throw new Error("Host disconnected");
      },
      closeWorkspaceTabWithCleanup: cleanup,
      logLabel: "others",
      warn,
    });
    expect(closeItems).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledExactlyOnceWith({
      tabId: "file_/repo/README.md",
      target: { kind: "file", path: "/repo/README.md" },
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[WorkspaceScreen] Failed to close agent tab others",
      { agentId: "child", error: expect.objectContaining({ message: "Host disconnected" }) },
    );
  });
});
