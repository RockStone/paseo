import { buildHostAgentDetailRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { createIdleAgent, createMockIdleAgent } from "../support/helpers/archive-tab";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { expectComposerVisible } from "../support/helpers/composer";
import { clickNewTerminal, terminalSurfaceLocator } from "../support/helpers/launcher";
import { renameModalInput } from "../support/helpers/rename";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { clickSettingsBackToWorkspace, openCompactSettings } from "../support/helpers/settings";
import { openSettings } from "../support/helpers/app";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import {
  clickFirstTerminalTab,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";
import { expectTerminalSurfaceVisible } from "../support/helpers/terminal-perf";

async function captureRenderedNode(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  const node = await locator.elementHandle();
  if (!node) {
    throw new Error("Expected rendered node");
  }
  return node;
}

async function expectSameRenderedNode(
  original: Awaited<ReturnType<typeof captureRenderedNode>>,
  locator: Locator,
) {
  const current = await captureRenderedNode(locator);
  await expect(original.evaluate((node, candidate) => node === candidate, current)).resolves.toBe(
    true,
  );
}

async function expectNodeConnected(node: Awaited<ReturnType<typeof captureRenderedNode>>) {
  expect(await node.evaluate((candidate) => candidate.isConnected)).toBe(true);
}

async function getSettingsShortcut(page: Page) {
  return page.evaluate(() =>
    navigator.platform.toLowerCase().includes("mac") ? "Meta+," : "Control+,",
  );
}

async function waitForWorkspaceRoute(page: Page, route: string) {
  await page.waitForURL((url) => url.pathname === route);
}

test.describe("Workspace pane mounting", () => {
  for (const direction of ["right", "down"] as const) {
    test(`splitting ${direction} moves the active tab when its pane has multiple tabs`, async ({
      page,
    }, testInfo) => {
      const workspace = await seedWorkspace({ repoPrefix: "split-active-tab-" });
      const paneTabRows = page
        .locator('[data-testid^="workspace-pane-"]')
        .getByTestId("workspace-tabs-row");
      try {
        const first = await createMockIdleAgent(workspace.client, {
          cwd: workspace.repoPath,
          workspaceId: workspace.workspaceId,
          title: "First split tab",
        });
        const second = await createMockIdleAgent(workspace.client, {
          cwd: workspace.repoPath,
          workspaceId: workspace.workspaceId,
          title: "Second split tab",
        });
        await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: first.id });
        await waitForWorkspaceTabsVisible(page);
        await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: second.id });
        const firstTab = page.getByTestId(`workspace-tab-agent_${first.id}`);
        const secondTab = page.getByTestId(`workspace-tab-agent_${second.id}`);
        await firstTab.click();
        await expect(paneTabRows).toHaveCount(1);
        await page.getByTestId("workspace-split-pane-menu").click();
        await page.getByTestId(`workspace-split-pane-${direction}`).click();

        await expect(paneTabRows).toHaveCount(2);
        await expect(page.getByTestId("workspace-new-tab-panel")).toHaveCount(0);
        await expect(firstTab).toHaveCount(1);
        await expect(secondTab).toHaveCount(1);
        await expect
          .poll(async () => {
            const moved = await firstTab.boundingBox();
            const remaining = await secondTab.boundingBox();
            if (!moved || !remaining) throw new Error("Expected both split tabs to be visible");
            return direction === "right" ? moved.x > remaining.x : moved.y > remaining.y;
          })
          .toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`split-active-tab-${direction}.png`) });

        // Each pane now has one tab, even though the workspace has two.
        await page.getByTestId("workspace-split-pane-menu").last().click();
        await page.getByTestId(`workspace-split-pane-${direction}`).click();
        await expect(paneTabRows).toHaveCount(3);
        await expect(page.getByTestId("workspace-new-tab-panel")).toHaveCount(1);
        await expect(firstTab).toHaveCount(1);
        await expect(secondTab).toHaveCount(1);
      } finally {
        await workspace.cleanup();
      }
    });
  }

  test("workspace navigation keeps the existing agent composer mounted", async ({ page }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();

    const workspace = await seedWorkspace({ repoPrefix: "pane-remount-" });

    try {
      const agent = await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `pane-remount-${Date.now()}`,
      });

      await page.goto(buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId));
      await page.waitForURL(
        (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
        { timeout: 60_000 },
      );
      await waitForWorkspaceTabsVisible(page);
      await expectComposerVisible(page);

      const originalComposer = await page
        .getByTestId("message-input-root")
        .filter({ visible: true })
        .first()
        .elementHandle();
      expect(originalComposer).not.toBeNull();
      await test.step("opening the first split pane preserves the composer", async () => {
        const emptyPanesBeforeSplit = await page.getByTestId("workspace-new-tab-panel").count();

        await runWorkspaceActionFromCommandCenter(page, "Split pane right");
        await expect(page.getByTestId("workspace-new-tab-panel")).toHaveCount(
          emptyPanesBeforeSplit + 1,
          { timeout: 30_000 },
        );
        await expect(page.getByTestId("message-input-root").filter({ visible: true })).toHaveCount(
          1,
        );
        await expectNodeConnected(originalComposer!);
      });

      const composer = page.getByTestId("message-input-root").filter({ visible: true }).first();
      await test.step("desktop Settings closes overlays and preserves the composer", async () => {
        const tab = page.getByTestId(`workspace-tab-agent_${agent.id}`).first();
        await tab.click({ button: "right" });
        await page.getByTestId(`workspace-tab-context-agent_${agent.id}-rename`).click();
        const renameInput = renameModalInput(page, `workspace-tab-rename-modal-agent-${agent.id}`);
        await expect(renameInput).toBeVisible();

        const settingsShortcut = await getSettingsShortcut(page);
        await page.keyboard.press(settingsShortcut);
        await expect(page).toHaveURL(/\/settings\/general$/);
        await expect(renameInput).not.toBeVisible();
        await clickSettingsBackToWorkspace(page);
        await expectSameRenderedNode(originalComposer!, composer);
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("opening Settings on a compact layout keeps the agent composer mounted", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 480, height: 900 });
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "compact-settings-pane-retention-" });

    try {
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `compact-settings-pane-retention-${Date.now()}`,
      });
      const agentRoute = buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId);

      await page.goto(agentRoute);
      await expectComposerVisible(page);
      const composer = page.getByTestId("message-input-root").filter({ visible: true }).first();
      const originalComposer = await captureRenderedNode(composer);

      const workspaceRoute = buildHostWorkspaceRoute(serverId, workspace.workspaceId);
      await openCompactSettings(page, workspaceRoute);
      await page.goBack();
      await waitForWorkspaceRoute(page, workspaceRoute);
      await expectSameRenderedNode(originalComposer, composer);
    } finally {
      await workspace.cleanup();
    }
  });

  test("workspace navigation keeps the terminal emulator mounted", async ({ page }) => {
    test.setTimeout(90_000);
    const serverId = getServerId();
    const workspace = await seedWorkspace({ repoPrefix: "terminal-pane-retention-" });

    try {
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: `terminal-pane-retention-${Date.now()}`,
      });

      await page.goto(buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId));
      await waitForWorkspaceTabsVisible(page);
      await clickNewTerminal(page);
      await expectTerminalSurfaceVisible(page);
      const terminalSurface = terminalSurfaceLocator(page);
      const originalTerminal = await captureRenderedNode(terminalSurface);

      await test.step("switching tabs preserves the terminal", async () => {
        await page.getByTestId(`workspace-tab-agent_${agent.id}`).click();
        await expectComposerVisible(page);
        await expectNodeConnected(originalTerminal);

        await clickFirstTerminalTab(page);
        await expectSameRenderedNode(originalTerminal, terminalSurface);
      });

      await test.step("opening Settings preserves the terminal", async () => {
        await openSettings(page);
        await clickSettingsBackToWorkspace(page);
        await expectSameRenderedNode(originalTerminal, terminalSurface);
      });
    } finally {
      await workspace.cleanup();
    }
  });
});
