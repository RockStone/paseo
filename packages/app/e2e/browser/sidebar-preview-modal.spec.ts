import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { installLocalDesktopHost } from "../support/helpers/local-desktop-host";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// A modal opened from the revealed sidebar (the Command Center) is not an outside interaction:
// dismissing it leaves the sidebar revealed.
for (const dismissal of ["Escape", "outside click"] as const) {
  test(`edge sidebar stays revealed after the Command Center closes by ${dismissal}`, async ({
    page,
  }) => {
    await installLocalDesktopHost(page, "/tmp");
    await page.addInitScript(() => {
      window.paseoDesktop!.platform = "darwin";
    });
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "sidebar-preview-modal-",
      title: "Sidebar modal",
    });
    try {
      await openAgentRoute(page, agent);
      await page.getByTestId("menu-button").filter({ visible: true }).first().click();
      await page.getByTestId("sidebar-edge-trigger").hover();
      const preview = page.getByTestId("sidebar-edge-preview");
      await expect(preview).toBeVisible();

      await preview.getByTestId("sidebar-search").click();
      const panel = page.getByTestId("command-center-panel");
      await expect(panel).toBeVisible();

      // Move over the dialog, well outside the sidebar's hover margin.
      await page.mouse.move(700, 300, { steps: 10 });
      await page.waitForTimeout(400);
      await expect(preview).toBeVisible();

      if (dismissal === "Escape") await page.keyboard.press("Escape");
      else await page.mouse.click(1100, 700);
      await expect(panel).toBeHidden();
      await page.waitForTimeout(400);
      await expect(preview).toBeVisible();

      // A real outside press still dismisses it.
      await page.mouse.click(1100, 700);
      await expect(page.getByTestId("sidebar-edge-trigger")).toBeVisible();
      await expect(preview).toBeHidden();
    } finally {
      await agent.cleanup();
    }
  });
}
