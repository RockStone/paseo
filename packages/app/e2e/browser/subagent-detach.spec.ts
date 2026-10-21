import { composerLocator, expectComposerVisible } from "../support/helpers/composer";
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
  seedParentWithCrossWorkspaceSubagent,
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
    const sibling = await seedSubagent(workspace, {
      parentId: pair.parent.id,
      title: "More recent sibling",
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
    const siblingRow = page.getByTestId(`sidebar-agent-tree-row-agent:${sibling.id}`);
    await expect(siblingRow).toBeVisible();
    expect((await siblingRow.boundingBox())!.y).toBeLessThan((await child.boundingBox())!.y);

    const serverId = getServerId();
    const workspaceRow = page.getByTestId(`sidebar-workspace-row-${serverId}:${pair.workspaceId}`);
    const workspaceToggle = page.getByTestId(
      `sidebar-workspace-agents-toggle-${serverId}:${pair.workspaceId}`,
    );
    await workspaceRow.hover();
    await expect(workspaceToggle).toHaveAttribute("aria-expanded", "true");
    await expect(workspaceToggle.getByTestId("workspace-status-indicator-done")).toHaveCount(0);
    await page.screenshot({ path: "/tmp/paseoi-r50-workspace-agents-expanded.png" });
    await workspaceToggle.click();
    await expect(child).toHaveCount(0);
    await expect(nested).toHaveCount(0);
    await page.mouse.move(1300, 800);
    await expect(workspaceToggle).toHaveAttribute("aria-expanded", "false");
    await expect(workspaceToggle.getByTestId("workspace-status-indicator-done")).toBeVisible();
    await workspaceRow.hover();
    await expect(workspaceToggle.getByTestId("workspace-status-indicator-done")).toHaveCount(0);
    await page.screenshot({ path: "/tmp/paseoi-r50-workspace-agents-collapsed.png" });
    await workspaceToggle.click();
    await expect(child).toBeVisible();
    await expect(nested).toBeVisible();
    const running = page.getByTestId(`sidebar-agent-tree-running-agent:${pair.child.id}`);
    await expect(running).toHaveCount(0);
    await workspace.client.sendAgentMessage(pair.child.id, "Show the sidebar running indicator.");
    await expect(running).toBeVisible();
    await expect
      .poll(async () => (await child.boundingBox())!.y < (await siblingRow.boundingBox())!.y)
      .toBe(true);

    await workspace.client.waitForFinish(pair.child.id, 30_000);
    await expect(running).toHaveCount(0);
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
    // Both coordinators still own children, so each now has a distinct root group.
    await expect(root).toBeVisible();
    await expect(siblingRow).toBeVisible();
    await expect(child).toBeVisible();
    await expect(nested).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});

test("sidebar nests cross-workspace subagents under the parent without parallel workspace rows", async ({
  page,
}) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-cross-workspace-dedup-" });
  try {
    const pair = await seedParentWithCrossWorkspaceSubagent(workspace, {
      parentTitle: "Audit coordinator",
      childTitle: "Isolated implementation",
    });
    const nested = await seedSubagent(
      {
        ...workspace,
        workspaceId: pair.child.workspaceId,
      },
      { parentId: pair.child.id, title: "Implementation critic" },
    );
    const local = await seedSubagent(workspace, { parentId: pair.parent.id, title: "Local audit" });
    await page.setViewportSize({ width: 1400, height: 1000 });
    await openAgentRoute(page, { workspaceId: pair.parent.workspaceId, agentId: pair.parent.id });
    const serverId = getServerId();
    const parentTree = page.getByTestId(
      `sidebar-agent-tree-${serverId}:${pair.parent.workspaceId}`,
    );
    const childWorkspaceRow = page.getByTestId(
      `sidebar-workspace-row-${serverId}:${pair.child.workspaceId}`,
    );
    const critic = page.getByTestId(`sidebar-agent-tree-row-agent:${nested.id}`);
    await expect(parentTree.getByTestId(`sidebar-agent-tree-row-agent:${local.id}`)).toBeVisible();
    await expect(
      parentTree.getByTestId(`sidebar-agent-tree-row-agent:${pair.child.id}`),
    ).toBeVisible();
    await expect(parentTree.getByTestId(`sidebar-agent-tree-row-agent:${nested.id}`)).toBeVisible();
    await expect(childWorkspaceRow).toHaveCount(0);
    await expect(critic).toHaveCount(1);
    await expect(critic).toBeVisible();
    const childRow = parentTree.getByTestId(`sidebar-agent-tree-row-agent:${pair.child.id}`);
    await childRow.click();
    await expectAgentTabActive(page, pair.child.id);
    await expect(childRow).toHaveAttribute("aria-selected", "true");
    await critic.click();
    await expectAgentTabActive(page, nested.id);
    await page.reload();
    await expect(critic).toHaveCount(1);
    await expect(childWorkspaceRow).toHaveCount(0);
    await expect(childRow).toHaveCount(1);
    await expect(critic).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: "/tmp/paseoi-r57-sidebar-parent-grouping.png" });
    const child = await workspace.client.fetchAgent({ agentId: pair.child.id });
    expect(child).toMatchObject({
      agent: { id: pair.child.id, labels: { "paseo.parent-agent-id": pair.parent.id } },
    });
  } finally {
    await workspace.cleanup();
  }
});

test("workspace subagent lists show ten rows including nested children and toggle more or less", async ({
  page,
}) => {
  const workspace = await seedWorkspace({ repoPrefix: "sidebar-ten-subagents-" });
  try {
    const parent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Coordinator",
      modeId: "load-test",
      model: "ten-second-stream",
    });
    const children = [];
    for (let index = 0; index < 11; index++) {
      const created = await workspace.client.createWorkspace({
        source: { kind: "directory", path: workspace.repoPath, projectId: workspace.projectId },
        title: `Child workspace ${index + 1}`,
      });
      if (!created.workspace) throw new Error(created.error ?? "Missing child workspace");
      const childWorkspaceId = created.workspace.id;
      const child = await seedSubagent(
        { ...workspace, workspaceId: childWorkspaceId },
        { parentId: parent.id, title: `Child ${index + 1}` },
      );
      children.push({ ...child, workspaceId: childWorkspaceId });
    }
    const nested = await seedSubagent(
      { ...workspace, workspaceId: children[10]!.workspaceId },
      {
        parentId: children[10]!.id,
        title: "Nested critic",
      },
    );
    await page.setViewportSize({ width: 1400, height: 1100 });
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parent.id });
    const serverId = getServerId();
    const tree = page.getByTestId(`sidebar-agent-tree-${serverId}:${workspace.workspaceId}`);
    const rows = tree.locator('[data-testid^="sidebar-agent-tree-row-"]');
    const more = page.getByTestId(
      `sidebar-agent-tree-show-more-${serverId}:${workspace.workspaceId}`,
    );
    await expect(rows).toHaveCount(10);
    await expect(page.getByTestId(`sidebar-agent-tree-row-agent:${nested.id}`)).toBeVisible();
    await expect(page.getByTestId(`sidebar-agent-tree-row-agent:${children[0]!.id}`)).toHaveCount(
      0,
    );
    await expect(more).toHaveText("Show more");
    await more.click();
    await expect(rows).toHaveCount(12);
    await expect(more).toHaveText("Show less");
    await page.getByTestId(`sidebar-agent-tree-row-agent:${children[0]!.id}`).click();
    await expectAgentTabActive(page, children[0]!.id);
    await expect(
      page.getByTestId(`sidebar-agent-tree-row-agent:${children[0]!.id}`),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByTestId(`sidebar-workspace-row-${serverId}:${children[0]!.workspaceId}`),
    ).toHaveCount(0);
    await expect(rows).toHaveCount(12);
    await more.click();
    await expect(rows).toHaveCount(10);
    await expect(more).toHaveText("Show more");
    await page.screenshot({ path: "/tmp/paseoi-r57-subagent-show-more.png" });
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
    let childRunning = true;
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
        const timestamp = new Date().toISOString();
        if (eventType === "agent.provider_subagents.list.request") {
          // Protocol fixtures exercise native-child presentation without launching a paid provider.
          const descriptor = {
            parentAgentId: parent.id,
            provider: "claude",
            title: "Explore",
            status: childRunning ? "running" : "completed",
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
                      id: "old-native-child",
                      status: "completed",
                      parentSubagentId: null,
                      description: "Inactive native child",
                      updatedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
                    },
                    {
                      ...descriptor,
                      id: "native-child",
                      parentSubagentId: null,
                      description: "Native implementation",
                    },
                    {
                      ...descriptor,
                      id: "native-grandchild",
                      status: "completed",
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
    await expect(child).toBeVisible();
    await expect(
      page.getByTestId(`sidebar-agent-tree-row-provider:${parent.id}:old-native-child`),
    ).toHaveCount(0);

    const nested = page.getByTestId(
      `sidebar-agent-tree-row-provider:${parent.id}:native-grandchild`,
    );
    await expect(child).toBeVisible({ timeout: 30_000 });
    await expect(nested).toBeVisible();
    const tree = page.getByTestId(`sidebar-agent-tree-${getServerId()}:${workspace.workspaceId}`);
    await expect(tree.locator('[data-testid^="sidebar-agent-tree-row-"]')).toHaveCount(2);
    await expect(
      page.getByTestId(`sidebar-agent-tree-show-more-${getServerId()}:${workspace.workspaceId}`),
    ).toHaveCount(0);
    const running = page.getByTestId(
      `sidebar-agent-tree-running-provider:${parent.id}:native-child`,
    );
    await expect(running).toBeVisible();
    const toggle = page.getByTestId(`sidebar-agent-tree-toggle-provider:${parent.id}:native-child`);
    await toggle.click();
    await expect(nested).toHaveCount(0);
    await toggle.click();
    await expect(nested).toBeVisible();
    childRunning = false;
    await expectComposerVisible(page);
    const input = composerLocator(page);
    await input.fill("Check ##native-child");
    const option = page.getByTestId(
      `autocomplete-option-session:subagent:${parent.id}/native-child`,
    );
    await expect(option).toBeVisible();
    await expect(running).toHaveCount(0);
    await option.click();
    const mention = `[#Native implementation](subagent://${encodeURIComponent(`${parent.id}/native-child`)}?hostId=${getServerId()})`;
    await expect(input).toHaveAttribute("data-markdown", `Check ${mention} `);
    await page.reload();
    await expectComposerVisible(page);
    await expect(input).toHaveAttribute("data-markdown", `Check ${mention} `);
    await input.fill("Review ");
    const title = nested.getByText("Native verification", { exact: true });
    await expect(title).toHaveAttribute("draggable", "true");
    await title.dragTo(input);
    await expect(input).toHaveAttribute(
      "data-markdown",
      new RegExp(`subagent://${encodeURIComponent(`${parent.id}/native-grandchild`)}`),
    );
    await expect(page.getByTestId("composer-session-reference-pill")).toHaveCount(0);
    await page.screenshot({ path: "/tmp/paseoi-r40-subagent-reference.png" });
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
