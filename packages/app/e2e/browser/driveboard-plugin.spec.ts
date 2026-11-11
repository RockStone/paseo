import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";

const DRIVEBOARD_DIRECTORY = path.resolve(__dirname, "../../../../paseoi-plugins/driveboard");
const SCREENSHOT_DIR = process.env.PASEOI_DRIVEBOARD_SCREENSHOTS;

const OWNER_TODO = `# Owner to-do

- [ ] **OT-1 Pick the release name.** Choose between **Atlas** and **Birch**. <!-- priority:3 -->
- [~] **OT-2 Check the build on your phone.** See https://example.com/build/7 first. <!-- priority:2 -->
- [x] **OT-3 Approve the budget.** Approved. <!-- priority:1 -->
`;

const DRIVE = `# Drive

- [x] D-1 Ship the parser. <!-- priority:3 -->
- [~] D-2 Build the drawer. <!-- priority:2 -->
- [ ] D-3 Write the docs. <!-- priority:1 -->
- [ ] D-4 Retire the old board. <!-- priority:2 -->
`;

// Paseoi's Driveboard plugin lives outside the workspace packages; this proves its header button
// and drawer render against a real daemon: owner to-dos with replies, progress and notes.
test("the Driveboard shows owner to-dos, progress and notes from the header", async ({ page }) => {
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
    repoPrefix: "driveboard-",
    title: "Board demo",
    initialPrompt: "Open the board",
  });
  await mkdir(path.join(agent.cwd, "docs"), { recursive: true });
  await writeFile(path.join(agent.cwd, "docs", "owner-todo.md"), OWNER_TODO);
  await writeFile(path.join(agent.cwd, "docs", "drive.md"), DRIVE);

  try {
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(DRIVEBOARD_DIRECTORY);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAgentRoute(page, agent);

    const button = page
      .getByRole("toolbar", { name: "Workspace actions" })
      .getByRole("button", { name: "Driveboard" })
      .filter({ visible: true });
    await expect(button).toBeVisible({ timeout: 30_000 });
    await expect(button.getByTestId("plugin-button-chevron")).toHaveCount(0);
    await button.click();

    // Wide layouts open the board as a full-height drawer flush with the window's right edge.
    const drawer = page.getByTestId("plugin-button-drawer");
    await expect(drawer).toBeVisible();
    await expect
      .poll(async () => {
        const box = await drawer.boundingBox();
        return box ? Math.round(box.x + box.width) : null;
      })
      .toBe(1440);
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox ? Math.round(drawerBox.y + drawerBox.height) : null).toBe(900);

    // Owner to-dos are the default tab: open items by rank, done ones folded away.
    await expect(drawer.getByRole("tab", { name: "Owner todo", selected: true })).toBeVisible();
    await expect(drawer.getByText("Pick the release name.")).toBeVisible();
    await expect(drawer.getByText("Check the build on your phone.")).toBeVisible();
    await expect(drawer.getByText("Approve the budget.")).toHaveCount(0);
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/driveboard-owner.png` });

    // Reply in place with ⌘↵ (Ctrl+↵ off macOS); the reply lands in docs/owner-todo.md.
    await drawer.getByRole("button", { name: "OT-1 Pick the release name." }).click();
    await expect(drawer.getByText("Atlas", { exact: false })).toBeVisible();
    const reply = drawer.getByRole("textbox", { name: "Reply to OT-1" });
    await reply.fill("Go with Atlas");
    await reply.press("ControlOrMeta+Enter");
    await expect(drawer.getByText("Go with Atlas", { exact: true })).toBeVisible();
    await expect(reply).toHaveValue("");
    const saved = await readFile(path.join(agent.cwd, "docs", "owner-todo.md"), "utf8");
    expect(saved).toMatch(/ {2}> Owner reply \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\): Go with Atlas/);

    // The new reply goes to the workspace's agent without picking one.
    await expect(drawer.getByText("1 new reply for Board demo.")).toBeVisible();
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/driveboard-reply.png` });
    await drawer.getByRole("button", { name: "Send replies to Board demo" }).click();
    await expect(drawer.getByText("Sent your replies to Board demo.")).toBeVisible();

    // Progress: the share of done tasks, then tasks by status.
    await drawer.getByRole("tab", { name: "Progress" }).click();
    await expect(drawer.getByText("1 of 4 tasks done")).toBeVisible();
    await expect(drawer.getByText("Build the drawer.")).toBeVisible();
    if (SCREENSHOT_DIR)
      await page.screenshot({ path: `${SCREENSHOT_DIR}/driveboard-progress.png` });

    // Notes: the workspace's sticky notes, added with ⌘↵.
    await drawer.getByRole("tab", { name: "Notes" }).click();
    const note = drawer.getByRole("textbox", { name: "New sticky note" });
    await note.fill("Review https://example.com/pr/42 before merging");
    await note.press("ControlOrMeta+Enter");
    await expect(drawer.getByText("https://example.com/pr/42")).toBeVisible();
    await expect(note).toHaveValue("");
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/driveboard-notes.png` });

    // Escape slides the drawer out; ⌥⌘N (Ctrl+Alt+N off macOS) brings it back on the last tab.
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Alt+KeyN");
    await expect(drawer.getByRole("tab", { name: "Notes", selected: true })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Alt+KeyN");
    await expect(drawer).toHaveCount(0);

    // The button toggles the drawer, and a press outside it closes it.
    await button.click();
    await expect(drawer).toBeVisible();
    await page.mouse.click(400, 500);
    await expect(drawer).toHaveCount(0);
  } finally {
    await client.removePlugin("driveboard").catch(() => undefined);
    await client.patchDaemonConfig({
      pluginsEnabled: previousConfig.config.pluginsEnabled ?? false,
    });
    await client.close();
    await agent.cleanup();
  }
});
