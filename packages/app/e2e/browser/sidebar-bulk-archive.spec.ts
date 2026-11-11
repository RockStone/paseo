import { writeFile } from "node:fs/promises";
import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

function workspaceKey(workspace: SeededWorkspace): string {
  return `${getServerId()}:${workspace.workspaceId}`;
}

function workspaceRow(page: Page, workspace: SeededWorkspace) {
  return page.getByTestId(`sidebar-workspace-row-${workspaceKey(workspace)}`);
}

async function seedWorkspaces(titles: readonly string[]): Promise<SeededWorkspace[]> {
  const seeded: SeededWorkspace[] = [];
  for (const title of titles) {
    seeded.push(await seedWorkspace({ repoPrefix: "sidebar-bulk-archive-", title }));
  }
  return seeded;
}

/** `window.confirm` blocks the page, so the dialog is answered from a handler, not awaited. */
function answerNextDialog(page: Page, answer: "accept" | "dismiss"): Promise<string> {
  return new Promise((resolve) => {
    page.once("dialog", async (dialog) => {
      const message = dialog.message();
      if (answer === "accept") await dialog.accept();
      else await dialog.dismiss();
      resolve(message);
    });
  });
}

async function expectChecked(page: Page, workspace: SeededWorkspace, checked: boolean) {
  await expect(workspaceRow(page, workspace)).toHaveAttribute("aria-checked", String(checked));
}

test.describe("Sidebar bulk archive", () => {
  test("archives the checked workspaces and keeps the rest", async ({ page }, testInfo) => {
    const seeded = await seedWorkspaces(["Bulk alpha", "Bulk beta", "Bulk gamma", "Bulk delta"]);
    const [alpha, beta, gamma, delta] = seeded;
    try {
      await gotoAppShell(page);
      for (const workspace of seeded) {
        await expect(workspaceRow(page, workspace)).toBeVisible({ timeout: 30_000 });
      }

      await page.getByTestId("sidebar-display-preferences-menu").click();
      await page.getByTestId("sidebar-display-select-workspaces").click();
      const bar = page.getByTestId("sidebar-workspace-selection-bar");
      const archive = page.getByTestId("sidebar-workspace-selection-archive");
      await expect(bar).toBeVisible();
      await expect(archive).toBeDisabled();

      // A press toggles instead of navigating; gamma is checked and unchecked again.
      const urlBefore = page.url();
      for (const workspace of [alpha, beta, gamma]) await workspaceRow(page, workspace).click();
      await workspaceRow(page, gamma).click();
      expect(page.url()).toBe(urlBefore);
      await expectChecked(page, alpha, true);
      await expectChecked(page, beta, true);
      await expectChecked(page, gamma, false);
      await expectChecked(page, delta, false);
      await expect(archive).toBeEnabled();
      await expect(archive).toContainText("Archive 2");
      await page.screenshot({ path: testInfo.outputPath("select-mode.png") });

      const confirmMessage = answerNextDialog(page, "accept");
      await archive.click();
      const message = await confirmMessage;
      // The confirm is the browser's native dialog, which a page screenshot cannot capture.
      await writeFile(testInfo.outputPath("confirm-dialog.txt"), message);
      expect(message).toContain("Archive selected workspaces (2)?");
      expect(message).toContain("Bulk alpha");
      expect(message).toContain("Bulk beta");
      expect(message).not.toContain("Bulk gamma");

      await expect(workspaceRow(page, alpha)).toHaveCount(0, { timeout: 30_000 });
      await expect(workspaceRow(page, beta)).toHaveCount(0, { timeout: 30_000 });
      await expect(workspaceRow(page, gamma)).toBeVisible();
      await expect(workspaceRow(page, delta)).toBeVisible();
      await expect(bar).toHaveCount(0);
      await expect(page.getByText("Archived workspaces: 2")).toBeVisible();
      // Leaving select mode puts the rows back to navigating.
      await expect(workspaceRow(page, gamma)).not.toHaveAttribute("aria-checked", /.*/);
    } finally {
      for (const workspace of seeded) await workspace.cleanup();
    }
  });

  test("starts from a row's context menu in the status grouping, and Escape cancels", async ({
    page,
  }, testInfo) => {
    const seeded = await seedWorkspaces(["Bulk context one", "Bulk context two"]);
    const [first, second] = seeded;
    try {
      await gotoAppShell(page);
      await expect(workspaceRow(page, first)).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("sidebar-display-preferences-menu").click();
      await page.getByTestId("sidebar-display-grouping").click();
      await page.getByTestId("sidebar-grouping-status").click();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("sidebar-display-preferences-content")).toHaveCount(0);

      await workspaceRow(page, first).click({ button: "right" });
      await page.getByTestId(`sidebar-workspace-menu-select-${workspaceKey(first)}`).click();
      await expect(page.getByTestId("sidebar-workspace-selection-bar")).toBeVisible();
      await expectChecked(page, first, true);
      await expectChecked(page, second, false);
      await workspaceRow(page, second).click();
      await expectChecked(page, second, true);
      await page.screenshot({ path: testInfo.outputPath("select-mode-status-grouping.png") });

      const dismissed = answerNextDialog(page, "dismiss");
      await page.getByTestId("sidebar-workspace-selection-archive").click();
      await dismissed;
      // Declining the confirm keeps the selection.
      await expectChecked(page, first, true);

      // An open hover card takes the first Escape, as any overlay does, so move off the row.
      await page.mouse.move(800, 600);
      await expect(page.getByTestId("workspace-hover-card")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("sidebar-workspace-selection-bar")).toHaveCount(0);
      await expect(workspaceRow(page, first)).not.toHaveAttribute("aria-checked", /.*/);
      await expect(workspaceRow(page, first)).toBeVisible();
    } finally {
      for (const workspace of seeded) await workspace.cleanup();
    }
  });
});
