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

    // Wide layouts open the notes as a drawer flush with the window's right edge, hanging from
    // the bottom of the tab row the button sits in.
    const drawer = page.getByTestId("plugin-button-drawer");
    await expect(drawer).toBeVisible();
    await expect
      .poll(async () => {
        const box = await drawer.boundingBox();
        return box ? Math.round(box.x + box.width) : null;
      })
      .toBe(1440);
    const tabRow = page
      .getByTestId("workspace-tabs-row")
      .filter({ has: page.getByRole("button", { name: "Sticky notes" }) });
    const rowBox = await tabRow.boundingBox();
    const drawerBox = await drawer.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(drawerBox).not.toBeNull();
    if (rowBox && drawerBox) {
      expect(drawerBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 0.5);
      // Full height: the notes list grows long quickly.
      expect(Math.round(drawerBox.y + drawerBox.height)).toBe(900);
    }
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/sticky-drawer.png` });

    const input = page.getByRole("textbox", { name: "New sticky note" });
    await input.fill(note);
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(drawer.getByText("https://example.com/pr/42")).toBeVisible();

    // ⌘↵ (Ctrl+↵ off macOS) adds the draft without inserting a newline.
    const shortcutNote = "Added from the keyboard";
    await input.fill(shortcutNote);
    await input.press("ControlOrMeta+Enter");
    await expect(drawer.getByText(shortcutNote, { exact: true })).toBeVisible();
    await expect(input).toHaveValue("");
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/sticky-popover.png` });

    // Escape slides the drawer out, then unmounts it.
    await page.keyboard.press("Escape");
    if (SCREENSHOT_DIR) {
      await page.waitForTimeout(80);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/sticky-drawer-closing.png` });
    }
    await expect(drawer).toHaveCount(0);

    // The button toggles the drawer, and a press outside it closes it.
    await button.click();
    await expect(drawer.getByText("https://example.com/pr/42")).toBeVisible();
    await button.click();
    await expect(drawer).toHaveCount(0);
    await button.click();
    await expect(drawer).toBeVisible();
    await page.mouse.click(400, 500);
    await expect(drawer).toHaveCount(0);

    // ⌥⌘N (Ctrl+Alt+N off macOS) toggles the same drawer from the keyboard.
    await page.keyboard.press("ControlOrMeta+Alt+KeyN");
    await expect(drawer.getByText("https://example.com/pr/42")).toBeVisible();
    await expect
      .poll(async () => {
        const box = await drawer.boundingBox();
        return box ? Math.round(box.x + box.width) : null;
      })
      .toBe(1440);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/sticky-shortcut.png` });
    await page.keyboard.press("ControlOrMeta+Alt+KeyN");
    await expect(drawer).toHaveCount(0);
  } finally {
    await client.removePlugin("sticky-notes").catch(() => undefined);
    await client.patchDaemonConfig({
      pluginsEnabled: previousConfig.config.pluginsEnabled ?? false,
    });
    await client.close();
    await agent.cleanup();
  }
});
