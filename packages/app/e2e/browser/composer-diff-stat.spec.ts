import type { Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { gateNextAgentMessage } from "../support/helpers/agent-message-gate";
import {
  fillComposerDraft,
  expectComposerDraft,
  expectComposerFocused,
  attachFileFromMenu,
} from "../support/helpers/composer";
import { ensureExplorerSidebar, openFilesPanel } from "../support/helpers/workspace-tabs";

const APP_SETTINGS_KEY = "@paseo:app-settings";

function visibleMainPane(page: Page) {
  return page.getByTestId("workspace-pane-main").filter({ visible: true });
}

function composerChangesPill(page: Page) {
  return page.getByTestId("composer-diff-stat-pill");
}

async function revealComposerChangesInExplorer(page: Page) {
  await composerChangesPill(page).click();

  const explorer = await ensureExplorerSidebar(page);
  await expect(explorer.getByTestId("changes-tree-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(0);
}

async function openComposerDiff(page: Page) {
  await composerChangesPill(page).click();
}

async function seedChangedAgent(
  repoPrefix: string,
  featureValues?: Record<string, unknown>,
  files: Array<{ path: string; content: string }> = [],
) {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix,
    featureValues,
    title: "Composer diff stat",
    repo: {
      withRemote: true,
      // Exclude the local remote before the daemon starts observing this checkout.
      files: [{ path: ".gitignore", content: "/remote.git/\n" }, ...files],
    },
  });
  try {
    await writeFile(
      path.join(workspace.cwd, "README.md"),
      "# Temp Repo\nexport const one = 1;\nexport const two = 2;\n",
    );
    await workspace.client.checkoutRefresh(workspace.cwd);
    await expect
      .poll(async () => {
        const workspaces = await workspace.client.fetchWorkspaces();
        return (
          workspaces.entries.find((entry) => entry.id === workspace.workspaceId)?.diffStat ?? null
        );
      })
      .toEqual({ additions: 2, deletions: 0 });
    return workspace;
  } catch (error) {
    await workspace.cleanup();
    throw error;
  }
}

test("composer diff stat reveals Changes, then opens the diff in the configured side pane", async ({
  page,
}) => {
  await page.addInitScript((settingsKey) => {
    localStorage.setItem(settingsKey, JSON.stringify({ openInSidePane: { diffs: true } }));
  }, APP_SETTINGS_KEY);
  const workspace = await seedChangedAgent("composer-diff-stat-side-");

  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    const pill = composerChangesPill(page);
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await expect(pill).toContainText("+2");
    await expect(pill).toContainText("-0");
    await revealComposerChangesInExplorer(page);
    await openComposerDiff(page);

    const sidePane = page
      .locator('[data-testid^="workspace-pane-"]')
      .filter({ visible: true })
      .filter({ has: page.getByTestId("working-diff-panel") });
    await expect(sidePane.getByTestId("workspace-tab-working_diff")).toBeVisible({
      timeout: 30_000,
    });
    await expect(sidePane.getByTestId("working-diff-panel")).toBeVisible({ timeout: 30_000 });
    await expect(visibleMainPane(page).getByTestId("working-diff-panel")).toHaveCount(0);

    await test.step("Explorer navigation does not replace the side pane", async () => {
      await openFilesPanel(page);
      await expect(page.getByTestId("workspace-explorer-sidebar")).toContainText("Files");

      await pill.click();
      await expect(sidePane.getByTestId("working-diff-panel")).toBeVisible();
      await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(1);
    });
  } finally {
    await workspace.cleanup();
  }
});

test("composer diff stat opens the compact explorer instead of a Changes tab", async ({ page }) => {
  const workspace = await seedChangedAgent("composer-diff-stat-compact-");

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    const closeExplorer = page
      .getByTestId("explorer-header")
      .getByRole("button", { name: "Close Explorer sidebar" });
    await expect(closeExplorer).not.toBeInViewport();

    await page.getByTestId("composer-diff-stat-pill").click();

    await expect(closeExplorer).toBeInViewport({ timeout: 30_000 });
    await expect(page.getByTestId("changes-header").filter({ visible: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("workspace-tab-working_diff")).toHaveCount(0);
  } finally {
    await workspace.cleanup();
  }
});

test("composer diff stat reveals Changes, then opens the diff in the focused pane by default", async ({
  page,
}) => {
  const workspace = await seedChangedAgent("composer-diff-stat-tab-");

  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, {
      workspaceId: workspace.workspaceId,
      agentId: workspace.agentId,
    });

    await revealComposerChangesInExplorer(page);
    await openComposerDiff(page);

    const mainPane = visibleMainPane(page);
    await expect(mainPane.getByTestId("workspace-tab-working_diff")).toBeVisible({
      timeout: 30_000,
    });
    await expect(mainPane.getByTestId("working-diff-panel")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator('[data-testid^="workspace-pane-"]').filter({ visible: true }),
    ).toHaveCount(1);
  } finally {
    await workspace.cleanup();
  }
});

async function tapFirstAddedDiffLine(
  page: Page,
  surface: Locator = page.getByTestId("working-diff-panel"),
) {
  const body = surface.getByTestId("diff-file-0-body");
  await expect(body).toBeVisible({ timeout: 30000 });
  const bounds = await body.boundingBox();
  if (!bounds) throw new Error("Expanded diff body has no bounds");
  const fontSize = await surface
    .getByTestId("git-diff-canvas")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  await page.touchscreen.tap(bounds.x + 120, bounds.y + Math.round(fontSize * 1.5) * 2.5);
}

async function openReviewDiff(page: Page, workspace: Awaited<ReturnType<typeof seedChangedAgent>>) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: workspace.agentId });
  await expect(composerChangesPill(page)).toBeVisible({ timeout: 30000 });
  if (await page.getByTestId("workspace-tab-working_diff").count()) {
    await selectDiffTab(page);
  } else {
    await revealComposerChangesInExplorer(page);
    await openComposerDiff(page);
  }
  await expect(page.getByTestId("diff-file-0-body")).toBeVisible();
}

async function saveReviewComment(page: Page, body: string) {
  await page.getByRole("textbox", { name: "Review comment" }).fill(body);
  await page.getByRole("button", { name: "Save review comment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bottom sheet backdrop" })).toHaveCount(0);
}

async function cancelReviewComment(page: Page) {
  await page.getByRole("button", { name: "Cancel review comment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bottom sheet backdrop" })).toHaveCount(0);
}

test.describe("review comments", () => {
  test.use({ hasTouch: true });

  test("compact review comments open a sheet and preserve saved comments through save, edit, cancel and reload", async ({
    page,
  }) => {
    const workspace = await seedChangedAgent("compact-review-comment-");
    try {
      await test.step("Open a compact sheet with reachable input and actions", async () => {
        await openReviewDiff(page, workspace);
        await showCompactLayout(page);
        await tapFirstAddedDiffLine(page);
        await expectCompactCommentSheet(page);
      });
      await test.step("Save, discard an edit, then save an updated comment", async () => {
        await saveReviewComment(page, "  Please simplify this.  ");
        await expectSavedReview(page, "Please simplify this.");
        await editSavedReview(page, "Please simplify this.");
        await fillReviewComment(page, "Discard this edit");
        await cancelReviewComment(page);
        await expectSavedReview(page, "Please simplify this.");
        await editSavedReview(page, "Please simplify this.");
        await saveReviewComment(page, "Updated comment");
        await expectSavedReview(page, "Updated comment");
      });
      await test.step("Discard a new comment and retain the saved one after reload", async () => {
        await tapFirstAddedDiffLine(page);
        await fillReviewComment(page, "Discard new comment");
        await cancelReviewComment(page);
        await expectReviewAbsent(page, "Discard new comment");
        await reloadReview(page);
        await expectSavedReview(page, "Updated comment");
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("wide review comments retain inline editing", async ({ page }) => {
    const workspace = await seedChangedAgent("wide-review-comment-");
    try {
      await test.step("Save and cancel an inline edit on a wide screen", async () => {
        await openReviewDiff(page, workspace);
        await tapFirstAddedDiffLine(page);
        await expectInlineCommentEditor(page);
        await saveReviewComment(page, "Wide comment");
        await expectSavedReview(page, "Wide comment");
        await editSavedReview(page, "Wide comment");
        await expectInlineCommentEditor(page);
        await cancelReviewComment(page);
        await expectSavedReview(page, "Wide comment");
      });
      await test.step("The existing composer still sends the review", async () => {
        await sendReviewThroughComposer(page, workspace.agentId);
        await selectDiffTab(page);
        await expectReviewAbsent(page, "Wide comment");
      });
    } finally {
      await workspace.cleanup();
    }
  });
});

async function sendReviewThroughComposer(page: Page, agentId: string) {
  await page.getByTestId(`workspace-tab-agent_${agentId}`).click();
  await expect(page.getByTestId("composer-review-attachment-pill")).toBeVisible();
  await page.getByRole("textbox", { name: "Message agent..." }).fill("Address this review");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Address this review", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("composer-review-attachment-pill")).toHaveCount(0);
}

async function addSavedReview(
  page: Page,
  body: string,
  surface: Locator = page.getByTestId("working-diff-panel"),
) {
  await tapFirstAddedDiffLine(page, surface);
  await saveReviewComment(page, body);
  await expectSavedReview(page, body, surface);
}

async function expectSavedReview(
  page: Page,
  body: string,
  surface: Locator = page.getByTestId("working-diff-panel"),
) {
  await expect(surface.getByText(body, { exact: true })).toBeVisible();
}

async function editSavedReview(page: Page, expectedBody: string) {
  await page
    .getByTestId("working-diff-panel")
    .getByRole("button", { name: "Edit review comment", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Review comment" })).toHaveValue(expectedBody);
}

async function sendFeedback(page: Page, count: number) {
  await page.getByRole("button", { name: `Send feedback (${count})`, exact: true }).click();
}

async function expectFeedbackSent(page: Page, recipient: string) {
  await expect(page.getByTestId("app-toast")).toHaveText(`Feedback sent to ${recipient}`);
  await expect(page.getByTestId("working-diff-panel")).toBeVisible();
}

test.describe("send review feedback", () => {
  test.use({ hasTouch: true });

  test("compact feedback sends directly to the only workspace agent and preserves its composer draft", async ({
    page,
  }) => {
    const workspace = await seedChangedAgent("review-feedback-single-");
    try {
      await test.step("Save a review without changing the chat draft", async () => {
        await openReviewDiff(page, workspace);
        await selectAgentTab(page, workspace.agentId);
        await fillComposerDraft(page, "Keep this thought");
        await attachFileFromMenu(page, {
          name: "unrelated.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Unrelated draft attachment"),
        });
        await selectDiffTab(page);
        await showCompactLayout(page);
        await addSavedReview(page, "Please simplify this.");
      });
      await test.step("Send directly and stay on the diff", async () => {
        await sendFeedback(page, 1);
        await expectFeedbackSent(page, "Composer diff stat");
        await expectReviewAbsent(page, "Please simplify this.");
        await captureFeedback(page, "single");
        await expect(
          page.getByText("Feedback sent to Composer diff stat", { exact: true }),
        ).toHaveCount(0);
      });
      await test.step("Return to the untouched composer draft", async () => {
        await showWideLayout(page);
        await selectAgentTab(page, workspace.agentId);
        await expectComposerDraft(page, "Keep this thought");
        await expect(page.getByText("unrelated.txt", { exact: true })).toBeVisible();
        await expect(page.getByTestId("composer-review-attachment-pill")).toHaveCount(0);
      });
    } finally {
      await workspace.cleanup();
    }
  });
  test("feedback pending ownership follows the draft across Diff and compact Changes", async ({
    page,
  }) => {
    const workspace = await seedChangedAgent("review-shared-pending-");
    const gate = await gateNextAgentMessage(page);
    try {
      await test.step("Send feedback from the Diff tab and hold its real request", async () => {
        await openReviewDiff(page, workspace);
        await showCompactLayout(page);
        await addSavedReview(page, "One draft across surfaces");
        await sendFeedback(page, 1);
        await gate.waitForRequest();
      });
      await test.step("The compact Changes surface observes the same pending operation", async () => {
        await revealCompactChanges(page);
        await expect(
          compactReviewSurface(page).getByRole("button", {
            name: "Sending feedback (1)",
            exact: true,
          }),
        ).toBeDisabled();
        expect(gate.requestCount()).toBe(1);
        gate.accept();
        await expectFeedbackSent(page, "Composer diff stat");
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("an unsaved review survives presentation changes and acknowledgement before Save", async ({
    page,
  }) => {
    const workspace = await seedChangedAgent("review-editor-ownership-");
    const gate = await gateNextAgentMessage(page);
    try {
      await test.step("Carry unsaved inline text into the compact sheet and back", async () => {
        await openReviewDiff(page, workspace);
        await tapFirstAddedDiffLine(page);
        await fillReviewComment(page, "Body across presentations");
        await showCompactLayout(page);
        await expectReviewEditorBody(page, "Body across presentations");
        await showWideLayout(page);
        await expectReviewEditorBody(page, "Body across presentations");
        await saveReviewComment(page, "Body across presentations");
      });
      await test.step("Keep an open edit saveable after acknowledgement removes its original", async () => {
        await sendFeedback(page, 1);
        await gate.waitForRequest();
        await editSavedReview(page, "Body across presentations");
        await fillReviewComment(page, "Keep this unsaved edit");
        gate.accept();
        await expectFeedbackSent(page, "Composer diff stat");
        await expectReviewEditorBody(page, "Keep this unsaved edit");
        await showCompactLayout(page);
        await expectReviewEditorBody(page, "Keep this unsaved edit");
        await saveReviewComment(page, "Keep this unsaved edit");
        await expectSavedReview(page, "Keep this unsaved edit");
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("saved feedback preserves navigation across multiple diff files", async ({ page }) => {
    const workspace = await seedMultiFileReview();
    try {
      await test.step("Save compact feedback and retain both floating actions", async () => {
        await openCompactReviewExplorer(page, workspace);
        await addSavedReview(page, "Keep file navigation available", compactReviewSurface(page));
        await expectReviewNavigationReachable(page);
      });
      await test.step("Jump to another file without covering the feedback action", async () => {
        await jumpToReviewFile(page, "z-last.ts");
        await scrollReviewToLastLine(page);
        await expectReviewNavigationReachable(page);
        await captureFeedback(page, "navigation-compact");
      });
      await test.step("Wide file navigation and feedback remain reachable", async () => {
        await openReviewDiff(page, workspace);
        await navigateWideReviewFile(page, "README.md");
        await expectFeedbackReachable(page);
        await expectSavedReview(page, "Keep file navigation available");
        await captureFeedback(page, "navigation-wide");
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("feedback sends only matching comments and preserves orphaned comments", async ({
    page,
  }) => {
    const workspace = await seedMultiFileReview();
    try {
      await test.step("A saved comment whose diff disappears has no sendable context", async () => {
        await openReviewDiff(page, workspace);
        await showCompactLayout(page);
        await addSavedReview(page, "Retain this orphan");
        await setReadmeDiff(workspace, false);
        await expectUnmatchedFeedback(page);
      });
      await test.step("Send the matching subset with an accurate count", async () => {
        await addSavedReview(page, "Send this matching comment");
        await sendFeedback(page, 1);
        await expectFeedbackSent(page, "Composer diff stat");
        await expectReviewAbsent(page, "Send this matching comment");
        await expectUnmatchedFeedback(page);
      });
      await test.step("Restoring the missing diff reveals the unsent comment", async () => {
        await setReadmeDiff(workspace, true);
        await expectSavedReview(page, "Retain this orphan");
        await expectFeedbackReachable(page);
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("zero open agent tabs retain feedback with a disabled reason", async ({ page }) => {
    const workspace = await seedChangedAgent("review-feedback-zero-");
    try {
      await test.step("Close the agent tab while keeping the review", async () => {
        await openReviewDiff(page, workspace);
        await addSavedReview(page, "Keep until an agent is opened");
        await closeAgentTab(page, workspace.agentId);
      });
      await test.step("The disabled action explains why in wide and compact layouts", async () => {
        await expectFeedbackUnavailable(page);
        await captureFeedback(page, "zero-wide");
        await showCompactLayout(page);
        await expectFeedbackUnavailable(page);
        await expectSavedReview(page, "Keep until an agent is opened");
        await captureFeedback(page, "zero-compact");
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("only open tabs in this workspace appear in compact and wide recipient menus", async ({
    page,
  }) => {
    const workspace = await seedChangedAgent("review-feedback-multiple-");
    const other = await seedChangedAgent("review-feedback-other-");
    try {
      const second = await createReviewRecipient(workspace, "Second reviewer");
      const historical = await createReviewRecipient(workspace, "Closed historical agent");
      await test.step("Open two local tabs and a tab in another workspace", async () => {
        await openReviewDiff(page, other);
        await addSavedReview(page, "Other workspace review");
        await openReviewDiff(page, workspace);
        await closeAgentTab(page, historical.id);
        await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: second.id });
        await selectDiffTab(page);
        await addSavedReview(page, "Review for second agent");
      });
      await test.step("The wide menu includes only local open agents", async () => {
        await captureWideFeedbackAppearance(page);
      });
      await test.step("Escape returns keyboard focus to feedback so the chooser can reopen", async () => {
        await openFeedbackWithKeyboard(page);
        await dismissRecipientMenu(page);
        await expectFeedbackFocused(page);
        await reopenFeedbackWithKeyboard(page);
        await dismissRecipientMenu(page);
        await expectFeedbackFocused(page);
      });
      await test.step("Choose the second agent in the compact menu and stay on the diff", async () => {
        await showCompactLayout(page);
        await captureFeedback(page, "cta-compact");
        await sendFeedback(page, 1);
        await expectRecipientMenu(page);
        await captureFeedback(page, "menu-compact");
        await chooseFeedbackRecipient(page, "Second reviewer");
        await expectFeedbackSent(page, "Second reviewer");
        await expectReviewAbsent(page, "Review for second agent");
      });
      await test.step("The other workspace's saved review remains", async () => {
        await openReviewDiff(page, other);
        await expectSavedReview(page, "Other workspace review");
      });
    } finally {
      await workspace.cleanup();
      await other.cleanup();
    }
  });

  test("failed feedback remains editable and retries through the real provider", async ({
    page,
  }) => {
    const workspace = await seedChangedAgent("review-feedback-retry-", { mockPromptRejections: 1 });
    try {
      await test.step("A provider rejection retains the saved review", async () => {
        await openReviewDiff(page, workspace);
        await showCompactLayout(page);
        await addSavedReview(page, "Initial feedback");
        await sendFeedback(page, 1);
        await expectFeedbackFailure(page);
        await expectSavedReview(page, "Initial feedback");
        await captureFeedback(page, "failure");
      });
      await test.step("Edit the retained feedback and retry successfully", async () => {
        await editSavedReview(page, "Initial feedback");
        await saveReviewComment(page, "Corrected feedback");
        await sendFeedback(page, 1);
        await expectFeedbackSent(page, "Composer diff stat");
        await expectReviewAbsent(page, "Corrected feedback");
      });
    } finally {
      await workspace.cleanup();
    }
  });

  test("pending feedback blocks repeat submission and preserves edits and additions", async ({
    page,
  }) => {
    const workspace = await seedChangedAgent("review-feedback-pending-");
    const gate = await gateNextAgentMessage(page);
    try {
      await test.step("Hold the real request while feedback is pending", async () => {
        await openReviewDiff(page, workspace);
        await showCompactLayout(page);
        await addSavedReview(page, "Sent version");
        await sendFeedback(page, 1);
        const request = await gate.waitForRequest();
        expect(request.agentId).toBe(workspace.agentId);
        expect(request.text).toBe("Please address this code review.");
        expect(request.attachments).toMatchObject([
          {
            type: "review",
            cwd: workspace.cwd,
            comments: [
              {
                filePath: "README.md",
                lineNumber: 2,
                body: "Sent version",
                context: { targetLine: { content: "export const one = 1;", newLineNumber: 2 } },
              },
            ],
          },
        ]);
        await expectFeedbackPending(page);
      });
      await test.step("Save an edit and another comment before acknowledgement", async () => {
        await editSavedReview(page, "Sent version");
        await saveReviewComment(page, "Edited during send");
        await addSavedReview(page, "Added during send");
        await expectFeedbackPending(page);
        expect(gate.requestCount()).toBe(1);
        await captureFeedback(page, "pending");
      });
      await test.step("A real acknowledgement preserves both new versions", async () => {
        gate.accept();
        await expectFeedbackSent(page, "Composer diff stat");
        await expectSavedReview(page, "Edited during send");
        await expectSavedReview(page, "Added during send");
        await expectReviewAbsent(page, "Sent version");
      });
    } finally {
      await workspace.cleanup();
    }
  });
});

async function showCompactLayout(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
}
async function showWideLayout(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
}
async function selectAgentTab(page: Page, agentId: string) {
  await page.getByTestId(`workspace-tab-agent_${agentId}`).click({ position: { x: 12, y: 13 } });
}
async function selectDiffTab(page: Page) {
  await page.getByTestId("workspace-tab-working_diff").click({ position: { x: 12, y: 13 } });
}
async function fillReviewComment(page: Page, body: string) {
  await page.getByRole("textbox", { name: "Review comment" }).fill(body);
}
async function expectReviewAbsent(page: Page, body: string) {
  await expect(page.getByTestId("working-diff-panel").getByText(body, { exact: true })).toHaveCount(
    0,
  );
}
async function reloadReview(page: Page) {
  await page.reload();
  await expect(page.getByTestId("working-diff-panel")).toBeVisible({ timeout: 30000 });
}
async function expectInlineCommentEditor(page: Page) {
  await expect(page.getByTestId("inline-review-editor")).toBeVisible();
  await expect(page.getByTestId("review-comment-sheet")).toHaveCount(0);
}
async function expectCompactCommentSheet(page: Page) {
  await expect(page.getByTestId("review-comment-sheet")).toBeVisible();
  await expect(page.getByText("README.md · +2", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Review comment" })).toBeInViewport({ ratio: 1 });
  for (const action of ["Save", "Cancel"])
    await expect(
      page.getByRole("button", { name: `${action} review comment`, exact: true }),
    ).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("inline-review-editor")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save review comment", exact: true }),
  ).toBeDisabled();
}
function feedbackButton(page: Page) {
  return page.getByRole("button", { name: "Send feedback (1)", exact: true });
}
async function openFeedbackWithKeyboard(page: Page) {
  await feedbackButton(page).focus();
  await expectFeedbackFocused(page);
  await reopenFeedbackWithKeyboard(page);
}
async function reopenFeedbackWithKeyboard(page: Page) {
  await page.keyboard.press("Enter");
  await expectRecipientMenu(page);
  const recipient = page.getByRole("menuitem", { name: "Composer diff stat", exact: true });
  await recipient.focus();
  await expect(recipient).toBeFocused();
}
async function expectFeedbackFocused(page: Page) {
  await expect(feedbackButton(page)).toBeFocused();
}

async function captureWideFeedbackAppearance(page: Page) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expectSavedReview(page, "Review for second agent");
    await captureFeedback(page, `cta-wide-${colorScheme}-closed`);
    await sendFeedback(page, 1);
    await expectRecipientMenu(page);
    await captureFeedback(page, `cta-wide-${colorScheme}-open`);
    await dismissRecipientMenu(page);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function captureFeedback(page: Page, name: string) {
  await page.screenshot({ path: `/tmp/phase2-feedback-${name}.png` });
}

async function closeAgentTab(page: Page, agentId: string) {
  await page.getByTestId(`workspace-tab-agent_${agentId}`).click({ button: "right" });
  await page.getByTestId(`workspace-tab-context-agent_${agentId}-close`).click();
  await expect(page.getByTestId(`workspace-tab-agent_${agentId}`)).toHaveCount(0);
}
async function expectFeedbackUnavailable(page: Page) {
  await expect(page.getByRole("button", { name: "Send feedback (1)", exact: true })).toBeDisabled();
  await expect(
    page.getByText("Open an agent tab in this workspace to send feedback.", { exact: true }),
  ).toBeVisible();
}
async function createReviewRecipient(
  workspace: Awaited<ReturnType<typeof seedChangedAgent>>,
  title: string,
) {
  return workspace.client.createAgent({
    provider: "mock",
    cwd: workspace.cwd,
    workspaceId: workspace.workspaceId,
    title,
    modeId: "load-test",
    model: "e2e-fast-stream",
  });
}
async function expectRecipientMenu(page: Page) {
  for (const name of ["Composer diff stat", "Second reviewer"]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByRole("menuitem")).toHaveCount(2);
}
async function dismissRecipientMenu(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem")).toHaveCount(0);
}
async function chooseFeedbackRecipient(page: Page, name: string) {
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function expectFeedbackFailure(page: Page) {
  await expect(
    page.getByText("Requested mock prompt rejection", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send feedback (1)", exact: true })).toBeEnabled();
}
async function expectFeedbackPending(page: Page, count = 1) {
  await expect(
    page.getByRole("button", { name: `Sending feedback (${count})`, exact: true }),
  ).toBeDisabled();
}

async function seedMultiFileReview() {
  const workspace = await seedChangedAgent("review-feedback-navigation-", undefined, [
    { path: "z-last.ts", content: "export const final = 0;\n" },
  ]);
  await writeFile(
    path.join(workspace.cwd, "z-last.ts"),
    Array.from({ length: 120 }, (_, index) => `export const value${index} = ${index};`).join("\n") +
      "\n",
  );
  await workspace.client.checkoutRefresh(workspace.cwd);
  return workspace;
}
async function expectFeedbackReachable(page: Page) {
  await expect(page.getByRole("button", { name: "Send feedback (1)", exact: true })).toBeInViewport(
    { ratio: 1 },
  );
}
async function expectReviewNavigationReachable(page: Page) {
  await expectFeedbackReachable(page);
  const jump = page.getByRole("button", { name: "Jump to file", exact: true });
  await expect(jump).toBeInViewport({ ratio: 1 });
  const navigationBounds = await jump.boundingBox();
  const feedbackBounds = await page
    .getByRole("button", { name: "Send feedback (1)", exact: true })
    .boundingBox();
  if (!navigationBounds || !feedbackBounds) throw new Error("Review actions have no bounds");
  expect(feedbackBounds.y + feedbackBounds.height).toBeLessThanOrEqual(navigationBounds.y);
}
async function jumpToReviewFile(page: Page, name: string) {
  await page.getByRole("button", { name: "Jump to file", exact: true }).click();
  const sheet = page.getByTestId("changes-jump-to-file-sheet");
  await page
    .getByTestId("changes-file-tree")
    .filter({ visible: true })
    .getByText(name, { exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
  await expect(reviewFileHeader(compactReviewSurface(page), name)).toBeInViewport();
}
async function navigateWideReviewFile(page: Page, name: string) {
  const explorer = await ensureExplorerSidebar(page);
  await explorer.getByTestId("changes-tree-panel").getByText(name, { exact: true }).click();
  await expect(reviewFileHeader(page.getByTestId("working-diff-panel"), name)).toBeInViewport();
}

async function setReadmeDiff(
  workspace: Awaited<ReturnType<typeof seedChangedAgent>>,
  changed: boolean,
) {
  await writeFile(
    path.join(workspace.cwd, "README.md"),
    changed ? "# Temp Repo\nexport const one = 1;\nexport const two = 2;\n" : "# Temp Repo\n",
  );
  await workspace.client.checkoutRefresh(workspace.cwd);
}
async function expectUnmatchedFeedback(page: Page) {
  await expect(page.getByRole("button", { name: "Send feedback (0)", exact: true })).toBeDisabled();
  await expect(
    page.getByText("Saved comments no longer match this diff.", { exact: true }),
  ).toBeVisible();
}

function compactReviewSurface(page: Page) {
  return page.getByTestId("explorer-content-area").filter({ visible: true });
}
async function openCompactReviewExplorer(
  page: Page,
  workspace: Awaited<ReturnType<typeof seedChangedAgent>>,
) {
  await showWideLayout(page);
  await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: workspace.agentId });
  await selectAgentTab(page, workspace.agentId);
  await showCompactLayout(page);
  await composerChangesPill(page).click();
  await expect(compactReviewSurface(page).getByTestId("diff-file-0-body")).toBeVisible();
}

function reviewFileHeader(surface: Locator, name: string) {
  return surface.locator(`[data-diff-header-path="${name}"]`).getByTestId(/^diff-file-\d+$/);
}

async function scrollReviewToLastLine(page: Page) {
  const surface = compactReviewSurface(page);
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Compact review has no bounds");
  await page.mouse.move(bounds.x + 120, bounds.y + 200);
  await page.mouse.wheel(0, 10000);
  await expect
    .poll(async () => {
      const body = await surface.getByTestId("diff-file-1-body").boundingBox();
      const feedback = await page
        .getByRole("button", { name: "Send feedback (1)", exact: true })
        .boundingBox();
      if (!body || !feedback) return false;
      return body.y + body.height <= feedback.y;
    })
    .toBe(true);
}

async function revealCompactChanges(page: Page) {
  await page.getByTestId("workspace-explorer-toggle").first().click();
  await page.getByTestId("explorer-header").getByText("Changes", { exact: true }).click();
  await expect(compactReviewSurface(page).getByTestId("diff-file-0-body")).toBeVisible();
}
async function expectReviewEditorBody(page: Page, body: string) {
  await expect(page.getByRole("textbox", { name: "Review comment", exact: true })).toHaveValue(
    body,
  );
}

test("uncommitted status pill opens all files in a capped list and clears on commit", async ({
  page,
}, testInfo) => {
  const agent = await seedChangedAgent("composer-git-status-");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: agent.cwd, encoding: "utf8" });
  try {
    await writeFile(path.join(agent.cwd, "committed-only.ts"), "export const committed = true;\n");
    git("add", "committed-only.ts");
    git("commit", "-m", "Local commit awaiting push");
    for (let index = 0; index < 12; index++)
      await writeFile(path.join(agent.cwd, `new-${index}.ts`), "export const fresh = true;\n");
    await agent.client.checkoutRefresh(agent.cwd);
    await openAgentRoute(page, agent);
    const pill = page.getByTestId("composer-git-status-pill");
    await expect(pill).toHaveText("13 uncommitted");
    const total = composerChangesPill(page);
    await expect(total).toBeVisible();
    const left = await total.boundingBox();
    const right = await pill.boundingBox();
    const branch = await page.getByTestId("composer-branch-pill").boundingBox();
    expect(branch!.x + branch!.width).toBeLessThanOrEqual(left!.x);
    expect(right!.x).toBeGreaterThanOrEqual(left!.x + left!.width);
    await pill.hover();
    const preview = page.getByTestId("composer-git-status-pill-panel");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("1 tracked · 12 untracked");
    await expect(preview.getByTestId("composer-git-status-file")).toHaveCount(13);
    await expect(preview).not.toContainText("committed-only.ts");
    // The 440px list cap plus the surface's 1px border on each edge.
    expect((await preview.boundingBox())!.height).toBeLessThanOrEqual(442);
    await page.screenshot({ path: testInfo.outputPath("git-status-pill-list.png") });
    await page.keyboard.press("Escape");
    git("add", ".");
    git("commit", "-m", "Commit working changes without pushing");
    await agent.client.checkoutRefresh(agent.cwd);
    expect((await agent.client.getCheckoutStatus(agent.cwd)).workingTree?.total).toBe(0);
    await expect(pill).toHaveCount(0);
    await expect(total).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});

test("status file undo confirms discard, preserves other files and recovers from a Git error", async ({
  page,
}) => {
  const agent = await seedChangedAgent("composer-discard-file-");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: agent.cwd, encoding: "utf8" }).trim();
  const target = path.join(agent.cwd, "tracked.txt");
  const untracked = path.join(agent.cwd, "new [scratch].txt");
  const lock = path.join(agent.cwd, ".git", "index.lock");
  try {
    await writeFile(target, "baseline\n");
    await writeFile(path.join(agent.cwd, "before-rename.txt"), "original\n");
    git("add", "tracked.txt", "before-rename.txt");
    git("commit", "-m", "Add tracked fixtures");
    await writeFile(target, "staged\n");
    git("add", "tracked.txt");
    await writeFile(target, "staged and unstaged\n");
    await writeFile(untracked, "temporary\n");
    await writeFile(path.join(agent.cwd, "keep.txt"), "keep this\n");
    git("mv", "before-rename.txt", "after-rename.txt");
    await agent.client.checkoutRefresh(agent.cwd);
    await openAgentRoute(page, agent);
    // The status pill opens on hover; a click would race the backdrop the hover puts over it.
    await page.getByTestId("composer-git-status-pill").hover();
    const panel = page.getByTestId("composer-git-status-pill-panel");
    const discardTracked = panel.getByRole("button", {
      name: "Discard changes to tracked.txt",
      exact: true,
    });
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("staged and unstaged");
      await dialog.dismiss();
    });
    await discardTracked.click();
    await expect(discardTracked).toBeEnabled();
    expect(await readFile(target, "utf8")).toBe("staged and unstaged\n");
    expect(git("diff", "--cached", "--", "tracked.txt")).toContain("staged");

    await writeFile(lock, "locked by test\n");
    page.once("dialog", (dialog) => dialog.accept());
    await discardTracked.click();
    await expect(page.getByTestId("composer-discard-error")).toContainText("index.lock");
    expect(await readFile(target, "utf8")).toBe("staged and unstaged\n");
    await rm(lock);
    page.once("dialog", (dialog) => dialog.accept());
    await discardTracked.click();
    await expect(discardTracked).toHaveCount(0);
    expect(await readFile(target, "utf8")).toBe("baseline\n");
    expect(git("diff", "--cached", "--", "tracked.txt")).toBe("");

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Delete untracked file");
      expect(dialog.message()).toContain("cannot be undone");
      await dialog.accept();
    });
    await panel
      .getByRole("button", { name: "Discard changes to new [scratch].txt", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Discard changes to new [scratch].txt", exact: true }),
    ).toHaveCount(0);
    await expect(readFile(untracked)).rejects.toMatchObject({ code: "ENOENT" });

    page.once("dialog", (dialog) => dialog.accept());
    await panel
      .getByRole("button", { name: "Discard changes to after-rename.txt", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Discard changes to after-rename.txt", exact: true }),
    ).toHaveCount(0);
    expect(await readFile(path.join(agent.cwd, "before-rename.txt"), "utf8")).toBe("original\n");
    await expect(readFile(path.join(agent.cwd, "after-rename.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(path.join(agent.cwd, "keep.txt"), "utf8")).toBe("keep this\n");
    expect(await readFile(path.join(agent.cwd, "README.md"), "utf8")).toContain("export const one");
    expect(git("stash", "list")).toBe("");
  } finally {
    await rm(lock, { force: true });
    await agent.cleanup();
  }
});

test("composer branch pill identifies the checkout and switches branches on a clean workspace", async ({
  page,
}, testInfo) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "composer-branch-",
    title: "Branch context",
    repo: { branches: ["main", "dev"] },
  });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: agent.cwd, encoding: "utf8" }).trim();
  try {
    await openAgentRoute(page, agent);
    const pill = page.getByTestId("composer-branch-pill");
    await expect(pill).toHaveText("main");
    await expect(composerChangesPill(page)).toHaveCount(0);
    await pill.hover();
    await expect(page.getByTestId("composer-checkout-path")).toHaveText(
      git("rev-parse", "--show-toplevel"),
    );
    await pill.click();
    const picker = page.getByTestId("combobox-desktop-container");
    await expect(picker).toBeVisible();
    await expect(picker).toContainText(git("rev-parse", "--show-toplevel"));
    await page.getByPlaceholder("Filter branches...").fill("dev");
    await picker.getByText("dev", { exact: true }).click();
    await expect(pill).toHaveText("dev");
    expect(git("branch", "--show-current")).toBe("dev");
    await page.screenshot({ path: testInfo.outputPath("composer-branch-pill.png") });
    await page.reload();
    await expect(pill).toHaveText("dev");
    git("checkout", "--detach");
    await agent.client.checkoutRefresh(agent.cwd);
    await expect(pill).toHaveText("HEAD");
  } finally {
    await agent.cleanup();
  }
});

test("pills above the composer hand typing back to the composer", async ({ page }) => {
  const agent = await seedChangedAgent("composer-pill-typing-");
  try {
    await openAgentRoute(page, agent);
    const statusPill = page.getByTestId("composer-git-status-pill");
    const statusPanel = page.getByTestId("composer-git-status-pill-panel");
    const feed = page.getByTestId("agent-chat-scroll").filter({ visible: true });
    await expect(statusPill).toBeVisible();
    await expectComposerFocused(page);

    // A hover preview leaves the caret in the draft and closes without parking focus on the pill.
    await statusPill.hover();
    await expect(statusPanel).toBeVisible();
    await expectComposerFocused(page);
    // The open panel's backdrop covers the feed, so move the pointer rather than hover a locator.
    const feedBox = (await feed.boundingBox())!;
    await page.mouse.move(feedBox.x + feedBox.width / 2, feedBox.y + feedBox.height / 3);
    await expect(statusPanel).toHaveCount(0);
    await page.keyboard.type("a");
    await expectComposerDraft(page, "a");

    // Clicking away from a clicked-open picker returns focus to its pill; letters still type.
    const branchPill = page.getByTestId("composer-branch-pill");
    await branchPill.click();
    const picker = page.getByTestId("combobox-desktop-container");
    await expect(picker).toBeVisible();
    await page.mouse.click(feedBox.x + feedBox.width / 2, feedBox.y + feedBox.height / 3);
    await expect(picker).toHaveCount(0);
    await page.keyboard.type("b");
    await expectComposerDraft(page, "ab");
    await expectComposerFocused(page);

    await statusPill.focus();
    await page.keyboard.type("c");
    await expectComposerDraft(page, "abc");
    await expectComposerFocused(page);
  } finally {
    await agent.cleanup();
  }
});

test("composer history pill lists twenty-five HEAD commits and refreshes after a commit and branch switch", async ({
  page,
}, testInfo) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "composer-history-",
    title: "Commit history",
    repo: {
      branches: ["main", "dev"],
      withRemote: true,
      files: [{ path: ".gitignore", content: "/remote.git/\n" }],
    },
  });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: agent.cwd, encoding: "utf8" }).trim();
  try {
    for (let index = 1; index <= 27; index++)
      git(
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-m",
        `History entry ${index}`,
        "-m",
        Array.from(
          { length: 45 },
          (_, line) => `Detailed paragraph for history ${index}, line ${line}`,
        ).join("\n"),
      );
    await writeFile(path.join(agent.cwd, "README.md"), "# Temp Repo\nHistory preview test\n");
    await agent.client.checkoutRefresh(agent.cwd);
    await openAgentRoute(page, agent);
    const pill = page.getByTestId("composer-commit-history-pill");
    await expect(pill).toBeVisible();
    const branch = await page.getByTestId("composer-branch-pill").boundingBox();
    const history = await pill.boundingBox();
    const diff = await composerChangesPill(page).boundingBox();
    expect(history!.x).toBeGreaterThanOrEqual(branch!.x + branch!.width);
    expect(history!.x + history!.width).toBeLessThanOrEqual(diff!.x);
    await pill.click();
    const panel = page.getByTestId("composer-commit-history-pill-panel");
    const rows = panel.getByTestId("composer-commit-history-row");
    await expect(rows).toHaveCount(25);
    await expect(rows.first()).toContainText("History entry 27");
    await expect(rows.first()).toContainText(git("rev-parse", "--short", "HEAD"));
    await expect(rows.last()).toContainText("History entry 3");
    await expect(panel.getByText("History entry 1", { exact: true })).toHaveCount(0);
    await rows.first().hover();
    const bubble = page.getByTestId("composer-commit-message");
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText("Detailed paragraph for history");
    const messageScroll = page.getByTestId("composer-commit-message-scroll");
    expect((await messageScroll.boundingBox())!.height).toBeLessThanOrEqual(260);
    await messageScroll.hover();
    await page.mouse.wheel(0, 600);
    await expect
      .poll(() => messageScroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect(bubble).toBeVisible();
    await expect(panel).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("composer-commit-history-message.png") });
    await page.keyboard.press("Escape");
    git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Fresh local commit");
    await agent.client.checkoutRefresh(agent.cwd);
    await expect(rows.first()).toContainText("Fresh local commit");
    await page.keyboard.press("Escape");
    git("checkout", "dev");
    await agent.client.checkoutRefresh(agent.cwd);
    await expect(page.getByTestId("composer-branch-pill")).toHaveText("dev");
    await pill.click();
    await expect(panel).not.toContainText("Fresh local commit");
    await expect(rows.first()).toContainText("Add dev marker");
    expect(git("branch", "--show-current")).toBe("dev");
  } finally {
    await agent.cleanup();
  }
});

test("response changed-files cards retain recorded diffs after completion and reload", async ({
  page,
}, testInfo) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "response-changed-files-",
    title: "Recorded file changes",
    model: "ten-second-stream",
    initialPrompt: "Edit the scroll threshold.",
  });
  try {
    await agent.client.waitForFinish(agent.agentId, 20_000);
    await openAgentRoute(page, agent);
    const card = page.getByTestId("response-changed-files");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("1 file changed");
    await expect(card).toContainText("View changes");
    await expect(card.getByTestId("response-changed-file")).toContainText(
      "packages/app/src/hooks/use-scroll-anchor.ts",
    );
    await expect(composerChangesPill(page)).toHaveCount(0);

    await card.getByTestId("response-changed-file").click();
    await expect(card.getByTestId("response-file-diff")).toBeVisible();
    await expect(card.getByTestId("response-file-diff")).toContainText(
      "const NEAR_BOTTOM_PX = 160;",
    );
    await card.getByTestId("response-changed-file").click();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("response-changed-files-desktop.png") });

    await agent.client.sendAgentMessage(agent.agentId, "emit 1 coalesced agent stream updates");
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await page.reload();
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("1 file changed");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("response-changed-file")).toContainText("use-scroll-anchor.ts");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("response-changed-files-compact.png") });
  } finally {
    await agent.cleanup();
  }
});

test("Commit & Push asks only the current agent and preserves the composer draft", async ({
  page,
}) => {
  const workspace = await seedChangedAgent("composer-commit-push-");
  try {
    const gate = await gateNextAgentMessage(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await openAgentRoute(page, workspace);
    await fillComposerDraft(page, "Keep this unfinished question");
    await page.getByTestId("composer-git-status-pill").hover();
    const button = page.getByTestId("composer-commit-push");
    await expect(button).toBeVisible();
    await button.click();
    const request = await gate.waitForRequest();
    expect(request.agentId).toBe(workspace.agentId);
    expect(request.text).toContain("group the changes for this task by function or feature");
    expect(request.text).toContain("push the current branch");
    expect(request.attachments).toEqual([]);
    await expectComposerDraft(page, "Keep this unfinished question");
    await expect(button).toBeDisabled();
    gate.reject(0, "Host rejected the request; try again.");
    await expect(
      page.getByRole("alert").filter({ hasText: "Host rejected the request" }),
    ).toBeVisible();
    await expect(button).toBeEnabled();
    await expectComposerDraft(page, "Keep this unfinished question");
    await button.click();
    await gate.waitForRequest(2);
    expect(gate.requestCount()).toBe(2);
    gate.accept(1);
    await expect(button).toContainText("Request sent");
    await page.keyboard.press("Escape");
    await page.getByTestId("composer-commit-history-pill").click();
    await expect(page.getByText("Recent 25 commits", { exact: true })).toBeVisible();
    await expect(page.getByTestId("composer-commit-push")).toHaveCount(0);
    await expectComposerDraft(page, "Keep this unfinished question");
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/paseoi-commit-push.png" });
  } finally {
    await workspace.cleanup();
  }
});
