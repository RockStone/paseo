import { switchWorkspaceViaSidebar } from "../support/helpers/workspace-ui";
import { getServerId } from "../support/helpers/server-id";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { expect, test } from "../support/fixtures";
import { expectWorkspaceTabVisible } from "../support/helpers/archive-tab";
import { expectAgentTabActive } from "../support/helpers/launcher";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  detachSubagentFromTrack,
  expectSubagentRowGone,
  expectSubagentRowVisible,
  openSubagentsTrack,
  seedParentWithSubagent,
  seedSubagent,
} from "../support/helpers/subagents";

test.describe("Subagent detach", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "subagent-detach-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("detaching a subagent focuses it as a workspace tab", async ({ page }) => {
    const agents = await seedParentWithSubagent(workspace, {
      parentTitle: "Detach parent",
      childTitle: "Detached child",
    });

    await openAgentRoute(page, {
      workspaceId: agents.workspaceId,
      agentId: agents.parent.id,
    });
    await openSubagentsTrack(page);
    await expectSubagentRowVisible(page, agents.child.id);

    await detachSubagentFromTrack(page, agents.child.id);

    await expectSubagentRowGone(page, agents.child.id);
    await expectWorkspaceTabVisible(page, agents.child.id);
    await expectAgentTabActive(page, agents.child.id);
  });
});

test("sidebar coordinator tree collapses, opens child threads and restores relationships after reload", async ({
  page,
}) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-agent-tree-" });
  try {
    const pair = await seedParentWithSubagent(workspace, {
      parentTitle: "Coordinator thread",
      childTitle: "Implementation child",
    });
    const grandchild = await seedSubagent(workspace, {
      parentId: pair.child.id,
      title: "Verification child",
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await openAgentRoute(page, { workspaceId: pair.workspaceId, agentId: pair.parent.id });
    const root = page.getByTestId(`sidebar-agent-tree-row-agent:${pair.parent.id}`);
    const child = page.getByTestId(`sidebar-agent-tree-row-agent:${pair.child.id}`);
    const nested = page.getByTestId(`sidebar-agent-tree-row-agent:${grandchild.id}`);
    const toggle = page.getByTestId(`sidebar-agent-tree-toggle-agent:${pair.child.id}`);
    await expect(root).toHaveCount(0);
    await expect(child).toBeVisible({ timeout: 30_000 });
    await expect(nested).toBeVisible();
    const childBox = await child.boundingBox();
    const nestedBox = await nested.boundingBox();
    if (!childBox || !nestedBox) throw new Error("Thread tree could not be measured");
    expect(nestedBox.x).toBeGreaterThan(childBox.x);
    await toggle.click();
    await expect(nested).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await child.click();
    await expectAgentTabActive(page, pair.child.id);
    await nested.click();
    await expectAgentTabActive(page, grandchild.id);
    await page.reload();
    await expect(root).toHaveCount(0);
    await expect(nested).toBeVisible();
    await switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: pair.workspaceId,
    });
    await expectAgentTabActive(page, pair.parent.id);
    await page.screenshot({ path: "/tmp/paseoi-sidebar-agent-tree.png" });
    await openSubagentsTrack(page);
    await detachSubagentFromTrack(page, pair.child.id);
    // The detached coordinator still owns its own child, so it becomes a distinct root group.
    await expect(root).toHaveCount(0);
    await expect(child).toBeVisible();
    await expect(nested).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});

test("sidebar provider-native tree opens the correct nested child timeline", async ({ page }) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-native-tree-" });
  try {
    const parent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Native coordinator",
      modeId: "load-test",
      model: "ten-second-stream",
    });
    await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => ws.send(message));
      ws.onMessage((message) => {
        if (typeof message !== "string") {
          server.send(message);
          return;
        }
        const envelope: unknown = JSON.parse(message);
        const value =
          envelope && typeof envelope === "object" ? Reflect.get(envelope, "message") : undefined;
        if (!value || typeof value !== "object") {
          server.send(message);
          return;
        }
        const eventType = Reflect.get(value, "type");
        const requestId = Reflect.get(value, "requestId");
        const parentAgentId = Reflect.get(value, "parentAgentId");
        const subagentId = Reflect.get(value, "subagentId");
        if (parentAgentId !== parent.id || typeof requestId !== "string") {
          server.send(message);
          return;
        }
        const timestamp = "2026-10-17T00:00:00.000Z";
        if (eventType === "agent.provider_subagents.list.request") {
          // Protocol fixtures exercise native-child presentation without launching a paid provider.
          const descriptor = {
            parentAgentId: parent.id,
            provider: "claude",
            title: "Explore",
            status: "completed",
            createdAt: timestamp,
            updatedAt: timestamp,
            toolCallId: null,
          };
          ws.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "agent.provider_subagents.list.response",
                payload: {
                  requestId: requestId,
                  parentAgentId: parent.id,
                  error: null,
                  subagents: [
                    {
                      ...descriptor,
                      id: "native-child",
                      parentSubagentId: null,
                      description: "Native implementation",
                    },
                    {
                      ...descriptor,
                      id: "native-grandchild",
                      parentSubagentId: "native-child",
                      description: "Native verification",
                    },
                  ],
                },
              },
            }),
          );
          return;
        }
        if (
          eventType === "agent.provider_subagents.timeline.get.request" &&
          typeof subagentId === "string"
        ) {
          ws.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "agent.provider_subagents.timeline.get.response",
                payload: {
                  requestId: requestId,
                  parentAgentId: parent.id,
                  subagentId: subagentId,
                  provider: "claude",
                  direction: "tail",
                  epoch: "native-fixture",
                  reset: true,
                  staleCursor: false,
                  gap: false,
                  window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
                  hasOlder: false,
                  hasNewer: false,
                  rows: [
                    {
                      seq: 1,
                      timestamp,
                      item: {
                        type: "assistant_message",
                        text: `Native provider child thread: ${subagentId}`,
                      },
                    },
                  ],
                  error: null,
                },
              },
            }),
          );
          return;
        }
        server.send(message);
      });
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parent.id });
    const child = page.getByTestId(`sidebar-agent-tree-row-provider:${parent.id}:native-child`);
    const nested = page.getByTestId(
      `sidebar-agent-tree-row-provider:${parent.id}:native-grandchild`,
    );
    await expect(child).toBeVisible({ timeout: 30_000 });
    await expect(nested).toBeVisible();
    await nested.click();
    await expect(page.getByTestId("provider-subagent-panel")).toBeVisible();
    await expect(
      page.getByText("Native provider child thread: native-grandchild", { exact: true }),
    ).toBeVisible();
    await child.click();
    await expect(
      page.getByText("Native provider child thread: native-child", { exact: true }),
    ).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});
