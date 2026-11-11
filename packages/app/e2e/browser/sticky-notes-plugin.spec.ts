import path from "node:path";
import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";

const STICKY_NOTES_DIRECTORY = path.resolve(__dirname, "../../../../paseoi-plugins/sticky-notes");
const SCREENSHOT_DIR = process.env.PASEOI_STICKY_NOTES_SCREENSHOTS;

// Paseoi's sticky-notes plugin lives outside the workspace packages; this proves its header
// button and popover render against a real daemon.
test("the sticky-notes plugin adds a workspace note from the header", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ chatDisplay: "full", mergedTitleBar: true }),
    );
  });
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previousConfig = await client.getDaemonConfig();
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "sticky-notes-",
    title: "Notes demo",
    initialPrompt: "Open the sticky note",
  });
  const note = "Review the preview at https://example.com/pr/42 before merging";

  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(STICKY_NOTES_DIRECTORY);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAgentRoute(page, agent);

    const button = page
      .getByRole("toolbar", { name: "Workspace actions" })
      .getByRole("button", { name: "Sticky notes" })
      .filter({ visible: true });
    await expect(button).toBeVisible({ timeout: 30_000 });
    await expect(button.getByTestId("plugin-button-chevron")).toHaveCount(0);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/sticky-button.png` });
    await button.click();

    const input = page.getByRole("textbox", { name: "New sticky note" });
    await input.fill(note);
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(
      page.getByText("https://example.com/pr/42").filter({ visible: true }),
    ).toBeVisible();
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/sticky-popover.png` });
  } finally {
    await client.removePlugin("sticky-notes").catch(() => undefined);
    await client.patchDaemonConfig({
      pluginsEnabled: previousConfig.config.pluginsEnabled ?? false,
    });
    await client.close();
    await agent.cleanup();
  }
});
