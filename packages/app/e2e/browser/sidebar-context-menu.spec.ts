import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  closeProjectContextMenu,
  closeWorkspaceContextMenu,
  expectProjectContextMenuActions,
  expectWorkspaceContextMenuActions,
  expectWorkspaceContextMenuOwnsAttention,
  expectWorkspaceRowHoverCleared,
  openProjectContextMenu,
  openWorkspaceContextMenu,
  showWorkspaceHoverCard,
  selectSidebarStatusGrouping,
} from "../support/helpers/sidebar";

async function openIdentityMenu(input: {
  page: Page;
  workspaceId: string;
  surface: "context" | "dropdown";
}) {
  const { page, workspaceId, surface } = input;
  if (surface === "context") {
    await openWorkspaceContextMenu(page, workspaceId);
    return;
  }
  const key = `${getServerId()}:${workspaceId}`;
  await page.getByTestId(`sidebar-workspace-row-${key}`).hover();
  await page.getByTestId(`sidebar-workspace-kebab-${key}`).click();
}

function readClipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

function denyClipboardUntilAllowed(page: Page) {
  return page.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    let denied = true;
    window.addEventListener("allow-test-clipboard", () => {
      denied = false;
    });
    navigator.clipboard.writeText = (text) =>
      denied ? Promise.reject(new DOMException("Denied", "NotAllowedError")) : write(text);
  });
}

test.describe("Sidebar context menus", () => {
  test("right-clicking workspace and project rows opens their actions at the pointer", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-context-menu-" });

    try {
      await gotoAppShell(page);

      await showWorkspaceHoverCard(page, workspace.workspaceId);
      await openWorkspaceContextMenu(page, workspace.workspaceId);
      await expectWorkspaceContextMenuActions(page, workspace.workspaceId);
      await expect(page.getByRole("menuitem", { name: "Copy workspace id" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Copy agent id" })).toHaveCount(0);
      await expectWorkspaceContextMenuOwnsAttention(page);

      await closeWorkspaceContextMenu(page, workspace.workspaceId);
      await expectWorkspaceRowHoverCleared(page, workspace.workspaceId);
      await openProjectContextMenu(page, workspace.projectKey);
      await expectProjectContextMenuActions(page, workspace.projectKey);

      await closeProjectContextMenu(page, workspace.projectKey);
    } finally {
      await workspace.cleanup();
    }
  });
  for (const grouping of ["project", "status"] as const) {
    test(`${grouping} workspace menus copy full IDs of the primary agent despite a different active tab`, async ({
      page,
    }, testInfo) => {
      const workspace = await seedWorkspace({ repoPrefix: "sidebar-copy-ids-" });
      try {
        const primary = await workspace.client.createAgent({
          provider: "mock",
          cwd: workspace.repoPath,
          workspaceId: workspace.workspaceId,
          title: "Primary agent",
          modeId: "load-test",
          model: "e2e-fast-stream",
        });
        const second = await workspace.client.createAgent({
          provider: "mock",
          cwd: workspace.repoPath,
          workspaceId: workspace.workspaceId,
          title: "Second agent",
          modeId: "load-test",
          model: "e2e-fast-stream",
        });
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: second.id });
        if (grouping === "status") await selectSidebarStatusGrouping(page);
        for (const surface of ["context", "dropdown"] as const) {
          await openIdentityMenu({ page, workspaceId: workspace.workspaceId, surface });
          await expect(page.getByRole("menuitem", { name: "Copy agent id" })).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`${grouping}-${surface}-ids.png`) });
          await page.getByRole("menuitem", { name: "Copy workspace id" }).click();
          await expect.poll(() => readClipboard(page)).toBe(workspace.workspaceId);
          await openIdentityMenu({ page, workspaceId: workspace.workspaceId, surface });
          await page.getByRole("menuitem", { name: "Copy agent id" }).click();
          await expect.poll(() => readClipboard(page)).toBe(primary.id);
        }
      } finally {
        await workspace.cleanup();
      }
    });
  }

  test("workspace ID copy reports clipboard denial and allows retry", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-copy-denied-" });
    try {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await gotoAppShell(page);
      await denyClipboardUntilAllowed(page);
      await openIdentityMenu({ page, workspaceId: workspace.workspaceId, surface: "context" });
      await page.getByRole("menuitem", { name: "Copy workspace id" }).click();
      await expect(page.getByText("Copy failed", { exact: true })).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event("allow-test-clipboard")));
      await openIdentityMenu({ page, workspaceId: workspace.workspaceId, surface: "dropdown" });
      await page.getByRole("menuitem", { name: "Copy workspace id" }).click();
      await expect.poll(() => readClipboard(page)).toBe(workspace.workspaceId);
    } finally {
      await workspace.cleanup();
    }
  });
});
