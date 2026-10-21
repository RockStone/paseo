import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "../support/fixtures";
import { seedWorkspace, type SeedDaemonClient } from "../support/helpers/seed-client";
import { createMockIdleAgent, expectWorkspaceTabVisible } from "../support/helpers/archive-tab";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { renameModalInput, renameModalSubmit, renameModalError } from "../support/helpers/rename";
import { getServerId } from "../support/helpers/server-id";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { seedSubagent } from "../support/helpers/subagents";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import type { SessionInboundMessage } from "@getpaseo/protocol/messages";

async function rejectFirstWorkspaceRename(page: Page, workspaceId: string) {
  let rejected = false;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (typeof message === "string" && !rejected) {
        const envelope = JSON.parse(message) as { message?: SessionInboundMessage };
        const request = envelope.message;
        if (
          request?.type === "workspace.title.set.request" &&
          request.workspaceId === workspaceId
        ) {
          rejected = true;
          ws.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "workspace.title.set.response",
                payload: {
                  requestId: request.requestId,
                  workspaceId,
                  accepted: false,
                  title: null,
                  error: "Rename unavailable; please retry.",
                },
              },
            }),
          );
          return;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
}

async function openAgentInWorkspace(page: Page, agent: { id: string; workspaceId: string }) {
  await page.goto(buildHostAgentDetailRoute(getServerId(), agent.id, agent.workspaceId));
  await page.waitForURL(
    (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
    { timeout: 60_000 },
  );
  await waitForWorkspaceTabsVisible(page);
  await expectWorkspaceTabVisible(page, agent.id);
}

async function fetchAgentTitle(client: SeedDaemonClient, agentId: string): Promise<string | null> {
  const result = await client.fetchAgents({ scope: "active" });
  return result.entries.find((entry) => entry.agent.id === agentId)?.agent.title ?? null;
}

async function fetchWorkspaceName(client: SeedDaemonClient, workspaceId: string) {
  return (await client.fetchWorkspaces()).entries.find((entry) => entry.id === workspaceId)?.name;
}

test.describe("Workspace agent tab rename", () => {
  test("the direct agent follows workspace renames while subagents keep their names", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({
      repoPrefix: "workspace-linked-agent-",
      title: "Evaluate preview packages",
    });
    const client = workspace.client as SeedDaemonClient & Pick<DaemonClient, "setWorkspaceTitle">;
    try {
      const agent = await createMockIdleAgent(client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "what's the difference between these packages?",
      });
      const child = await seedSubagent(workspace, {
        parentId: agent.id,
        title: "Compare dependencies",
      });
      await rejectFirstWorkspaceRename(page, workspace.workspaceId);
      await openAgentInWorkspace(page, agent);
      const tab = page.getByTestId(`workspace-tab-agent_${agent.id}`).first();
      await expect(tab).toContainText("Evaluate preview packages");
      await expect.poll(() => fetchAgentTitle(client, agent.id)).toBe("Evaluate preview packages");
      await client.setWorkspaceTitle(workspace.workspaceId, "Choose the preview package");
      await expect(tab).toContainText("Choose the preview package");
      await expect.poll(() => fetchAgentTitle(client, agent.id)).toBe("Choose the preview package");
      await expect.poll(() => fetchAgentTitle(client, child.id)).toBe("Compare dependencies");
      await page.reload();
      await expect(tab).toContainText("Choose the preview package");
      await tab.click({ button: "right" });
      await page.getByTestId(`workspace-tab-context-agent_${agent.id}-rename`).click();
      const modalPrefix = `workspace-tab-rename-modal-agent-${agent.id}`;
      await renameModalInput(page, modalPrefix).fill("Preview package decision");
      await renameModalSubmit(page, modalPrefix).click();
      await expect(renameModalError(page, modalPrefix)).toHaveText(
        "Rename unavailable; please retry.",
      );
      await expect(renameModalInput(page, modalPrefix)).toHaveValue("Preview package decision");
      await expect(renameModalSubmit(page, modalPrefix)).toBeEnabled();
      await expect(tab).toContainText("Choose the preview package");
      await renameModalSubmit(page, modalPrefix).click();
      await expect(renameModalInput(page, modalPrefix)).toHaveCount(0);
      await expect(tab).toContainText("Preview package decision");
      await expect
        .poll(() => fetchWorkspaceName(client, workspace.workspaceId))
        .toBe("Preview package decision");
      await expect.poll(() => fetchAgentTitle(client, agent.id)).toBe("Preview package decision");
      await expect.poll(() => fetchAgentTitle(client, child.id)).toBe("Compare dependencies");
    } finally {
      await workspace.cleanup();
    }
  });

  test("right-click rename persists the agent title and updates the tab label", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const workspace = await seedWorkspace({ repoPrefix: "workspace-agent-rename-" });

    try {
      const initialTitle = `agent-rename-${randomUUID().slice(0, 8)}`;
      const agent = await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: initialTitle,
      });

      await openAgentInWorkspace(page, agent);

      const tab = page.getByTestId(`workspace-tab-agent_${agent.id}`).first();
      await expect(tab).toContainText(initialTitle, { timeout: 15_000 });

      await tab.click({ button: "right" });
      await expect(page.getByTestId(`workspace-tab-context-agent_${agent.id}`)).toBeVisible({
        timeout: 10_000,
      });
      const renameItem = page.getByTestId(`workspace-tab-context-agent_${agent.id}-rename`);
      await expect(renameItem).toBeVisible({ timeout: 10_000 });
      await renameItem.click();

      const modalPrefix = `workspace-tab-rename-modal-agent-${agent.id}`;
      const input = renameModalInput(page, modalPrefix);
      await expect(input).toBeVisible({ timeout: 10_000 });
      await expect(input).toHaveValue(initialTitle);

      const renamed = "My Renamed Agent";
      await input.fill(renamed);
      await renameModalSubmit(page, modalPrefix).click();

      await expect(input).toHaveCount(0, { timeout: 15_000 });
      await expect(tab).toContainText(renamed, { timeout: 15_000 });
      await expect.poll(() => fetchAgentTitle(workspace.client, agent.id)).toBe(renamed);
    } finally {
      await workspace.cleanup();
    }
  });
});
