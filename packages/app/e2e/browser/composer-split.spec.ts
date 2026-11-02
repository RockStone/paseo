import { expect, test, type Page } from "../support/fixtures";
import {
  composerLocator,
  expectComposerDraft,
  expectComposerDraftSelection,
  expectComposerFocused,
  expectComposerVisible,
  selectComposerDraftRange,
} from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const SCREENSHOT_DIR = process.env.PASEO_COMPOSER_SPLIT_SCREENSHOT_DIR;
const LONG_DRAFT = Array.from(
  { length: 30 },
  (_, index) => `Line ${index + 1} of a long plan`,
).join("\n");

function splitToggle(page: Page, name: "Expand composer" | "Collapse composer") {
  return page.getByRole("button", { name, exact: true });
}

function splitColumn(page: Page) {
  return page.getByTestId("composer-split-column");
}

async function screenshot(
  page: Page,
  name: string,
  testInfo: { outputPath(name: string): string },
) {
  const path = SCREENSHOT_DIR ? `${SCREENSHOT_DIR}/${name}` : testInfo.outputPath(name);
  await page.screenshot({ path });
}

async function openMockAgent(page: Page, title: string, initialPrompt?: string) {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "composer-split-",
    title,
    initialPrompt,
  });
  await openAgentRoute(page, agent);
  await expectComposerVisible(page);
  await expect(composerLocator(page)).toBeEditable({ timeout: 30_000 });
  if (initialPrompt) {
    await expect(
      page.getByTestId("user-message").filter({ hasText: initialPrompt }).first(),
    ).toBeVisible({ timeout: 30_000 });
  }
  return agent;
}

/** The scrolling editor box and the chat area it shares with the transcript. */
async function readComposerGeometry(page: Page) {
  const editor = await composerLocator(page)
    .locator("xpath=ancestor::*[contains(@class,'cm-editor')][1]")
    .boundingBox();
  const dock = await page.getByTestId("composer-dock").filter({ visible: true }).boundingBox();
  if (!editor || !dock) throw new Error("composer geometry is not laid out");
  return { editor, dock };
}

test.describe("composer split view", () => {
  test("caps a long draft and expands it beside the transcript without losing the draft or caret", async ({
    page,
  }, testInfo) => {
    const agent = await openMockAgent(
      page,
      "Composer split layout",
      "Summarize the plan before we start",
    );
    try {
      const input = composerLocator(page);
      await input.fill("A short draft");
      await expect(splitToggle(page, "Expand composer")).toHaveCount(0);

      await input.fill(LONG_DRAFT);
      const expand = splitToggle(page, "Expand composer");
      await expect(expand).toBeVisible();
      const capped = await readComposerGeometry(page);
      const cap = Math.max(140, Math.floor(capped.dock.height * 0.3));
      expect(capped.editor.height).toBeLessThanOrEqual(cap + 1);
      expect(capped.editor.height).toBeGreaterThan(cap - 30);
      // The control sits in the reserved band at the top right, beside the text.
      const expandBox = await expand.boundingBox();
      expect(expandBox).not.toBeNull();
      expect(expandBox!.x).toBeGreaterThan(capped.editor.x + capped.editor.width - 8);
      await screenshot(page, "composer-normal.png", testInfo);

      await selectComposerDraftRange(page, 5, 9);
      await expand.click();
      await expect(splitColumn(page)).toBeVisible();
      const collapse = splitToggle(page, "Collapse composer");
      await expect(collapse).toBeVisible();
      await expectComposerFocused(page);
      await expectComposerDraft(page, LONG_DRAFT);
      await expectComposerDraftSelection(page, 5, 9);

      const split = await readComposerGeometry(page);
      const column = await splitColumn(page).boundingBox();
      const transcript = await page
        .getByTestId("agent-chat-scroll")
        .filter({ visible: true })
        .boundingBox();
      expect(column).not.toBeNull();
      expect(transcript).not.toBeNull();
      expect(transcript!.x + transcript!.width).toBeLessThanOrEqual(column!.x + 1);
      expect(Math.abs(column!.width - split.dock.width / 2)).toBeLessThan(2);
      expect(split.editor.height).toBeGreaterThan(split.dock.height * 0.6);
      await expect(page.getByTestId("composer-expanded-send-hint")).toBeVisible();
      // The branch and history pills head the composer column instead of floating over the
      // transcript.
      const branchPill = splitColumn(page).getByTestId("composer-branch-pill");
      await expect(branchPill).toBeVisible();
      expect((await branchPill.boundingBox())!.y).toBeLessThan(split.editor.y);
      await screenshot(page, "composer-split.png", testInfo);

      await collapse.click();
      await expect(splitColumn(page)).toHaveCount(0);
      await expectComposerFocused(page);
      await expectComposerDraft(page, LONG_DRAFT);
      await expectComposerDraftSelection(page, 5, 9);

      await splitToggle(page, "Expand composer").click();
      await expect(splitColumn(page)).toBeVisible();
      await input.press("Escape");
      await expect(splitColumn(page)).toHaveCount(0);
      await expectComposerFocused(page);
      await expectComposerDraft(page, LONG_DRAFT);
    } finally {
      await agent.cleanup();
    }
  });

  test("edits like a document while expanded and sends with Cmd/Ctrl+Enter", async ({ page }) => {
    const agent = await openMockAgent(page, "Composer split keys");
    try {
      const input = composerLocator(page);
      await input.fill(LONG_DRAFT);
      await splitToggle(page, "Expand composer").click();
      await expect(splitColumn(page)).toBeVisible();

      await input.fill("1. one");
      await input.press("End");
      await input.press("Enter");
      await expect(input).toHaveAttribute("data-markdown", "1. one\n2. ");
      await input.press("Tab");
      await expect(input).toHaveAttribute("data-markdown", "1. one\n  2. ");
      await input.press("Shift+Tab");
      await expect(input).toHaveAttribute("data-markdown", "1. one\n2. ");
      await input.press("Enter");
      await expect(input).toHaveAttribute("data-markdown", "1. one\n");
      await input.pressSequentially("Plain text");
      await input.press("Enter");
      await expect(input).toHaveAttribute("data-markdown", "1. one\nPlain text\n");
      await expect(page.getByTestId("user-message")).toHaveCount(0);
      await expect(splitColumn(page)).toBeVisible();

      await input.fill("Sent from the expanded composer");
      await input.press("ControlOrMeta+Enter");
      await expect(
        page.getByTestId("user-message").filter({ hasText: "Sent from the expanded composer" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(splitColumn(page)).toHaveCount(0);
      await expectComposerDraft(page, "");

      await input.fill("Sent from the normal composer");
      await input.press("Enter");
      await expect(
        page.getByTestId("user-message").filter({ hasText: "Sent from the normal composer" }),
      ).toBeVisible({ timeout: 30_000 });
      await expectComposerDraft(page, "");
    } finally {
      await agent.cleanup();
    }
  });

  test("lets an open suggestion take Enter and Escape while expanded", async ({ page }) => {
    const agent = await openMockAgent(page, "Composer split suggestions");
    try {
      const input = composerLocator(page);
      await input.fill(LONG_DRAFT);
      await splitToggle(page, "Expand composer").click();
      await expect(splitColumn(page)).toBeVisible();

      const popover = page.getByTestId("composer-autocomplete-popover");
      await input.fill("/moc");
      await expect(popover.getByText("/mock", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      // The list floats inside the full-height composer, not above the pane.
      const popoverBox = await popover.boundingBox();
      const columnBox = await splitColumn(page).boundingBox();
      expect(popoverBox!.y).toBeGreaterThanOrEqual(columnBox!.y);
      await input.press("Enter");
      await expect(input).toHaveAttribute("data-markdown", /^\/mock /);
      await expect(splitColumn(page)).toBeVisible();

      await input.fill("/moc");
      await expect(popover.getByText("/mock", { exact: true }).first()).toBeVisible();
      await input.press("Escape");
      await expect(popover.filter({ visible: true })).toHaveCount(0);
      await expect(splitColumn(page)).toBeVisible();
      await input.press("Escape");
      await expect(splitColumn(page)).toHaveCount(0);
    } finally {
      await agent.cleanup();
    }
  });
});
