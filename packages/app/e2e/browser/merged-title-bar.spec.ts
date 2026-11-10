import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const SCREENSHOT_DIR = process.env.PASEOI_MERGED_TITLE_BAR_SCREENSHOTS;

test("a desktop workspace shows its header inside the top tab rows", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ chatDisplay: "full", mergedTitleBar: true }),
    );
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "merged-title-bar-",
    title: "Merged title bar",
    initialPrompt: "Show the merged title bar",
  });
  const tabsRow = page.getByTestId("workspace-tabs-row").filter({ visible: true });
  const headerTitle = page.getByTestId("workspace-header-title").filter({ visible: true });

  try {
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAgentRoute(page, agent);

    await expect(tabsRow).toHaveCount(1);
    await expect(headerTitle).toHaveCount(0);
    await expect(tabsRow.getByTestId("workspace-title-bar-project")).toBeVisible();
    await expect(tabsRow.getByTestId("workspace-header-menu-trigger")).toBeVisible();
    await expect(tabsRow.getByTestId("workspace-explorer-toggle")).toBeVisible();
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/merged-single-pane.png` });

    // A side-by-side split keeps one title bar: the left pane's row leads, the right pane's trails.
    await runWorkspaceActionFromCommandCenter(page, "Split pane right");
    await expect(tabsRow).toHaveCount(2);
    await expect(headerTitle).toHaveCount(0);
    await expect(tabsRow.first().getByTestId("workspace-title-bar-project")).toBeVisible();
    await expect(tabsRow.first().getByTestId("workspace-explorer-toggle")).toHaveCount(0);
    await expect(tabsRow.last().getByTestId("workspace-explorer-toggle")).toBeVisible();
    await expect(tabsRow.last().getByTestId("workspace-title-bar-project")).toHaveCount(0);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/merged-split.png` });
  } finally {
    await agent.cleanup();
  }
});
