import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { clickNewChat } from "../support/helpers/launcher";
import {
  expectComposerVisible,
  composerLocator,
  selectComposerDraftRange,
  pasteComposerTestImage,
} from "../support/helpers/composer";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import {
  openAttachmentMenu,
  expectAttachmentSheetRowsOnTitleRail,
  openGithubPickerFromMenu,
  attachImageFromMenu,
  expectAttachmentPill,
  removeAttachmentPill,
  openImageLightbox,
  closeImageLightbox,
  pressInterruptShortcut,
  expectComposerDraft,
  expectComposerDisabled,
  expectComposerEditable,
  expectAttachButtonDisabled,
  fillComposerDraft,
  dropFileOnComposer,
  sendDraftToQueue,
  sendComposerWithButton,
  expectQueuedMessageButton,
  startRunningMockAgent,
  selectGithubOption,
  expectGithubAttachmentPill,
  openGithubWorkspace,
} from "../support/helpers/composer";
import {
  delayBrowserAgentCreatedStatus,
  openNewWorkspaceComposer,
} from "../support/helpers/new-workspace";
import { gotoAppShell } from "../support/helpers/app";
import {
  waitForSidebarHydration,
  switchWorkspaceViaSidebar,
} from "../support/helpers/workspace-ui";
import { seedWorkspace } from "../support/helpers/seed-client";
import { hasGithubAuth, createTempGithubRepo } from "../support/helpers/github-fixtures";
import { getServerId } from "../support/helpers/server-id";
import { openFileExplorer } from "../support/helpers/file-explorer";
import { attachFileFromMenu, controlFileUploadCompletion } from "../support/helpers/composer";

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const TEST_IMAGE = { name: "test.png", mimeType: "image/png", buffer: MINIMAL_PNG };
const TEST_JSON = {
  name: "config.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ composer: "drop" })),
};

test.describe("Composer attachments", () => {
  test("selected file shows a loading attachment until upload is acknowledged", async ({
    page,
    withWorkspace,
  }) => {
    const upload = await controlFileUploadCompletion(page);
    const workspace = await withWorkspace({ prefix: "attach-upload-pending-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    upload.hold();
    await attachFileFromMenu(page, TEST_JSON);
    await upload.waitForUpload();

    const pending = page.getByTestId("composer-pending-file-attachment");
    await expect(pending).toContainText(TEST_JSON.name);
    await expect(pending.getByRole("progressbar")).toBeVisible();
    await expect(page.getByTestId("composer-file-attachment-pill")).toHaveCount(0);

    upload.complete();
    await expect(pending).toHaveCount(0);
    await expect(page.getByTestId("composer-file-attachment-pill")).toContainText(TEST_JSON.name);
    await expectComposerEditable(page);
  });

  test("compact Plus menu aligns attachment rows with its sheet title", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);
    const workspace = await withWorkspace({ prefix: "attach-sheet-rails-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await openAttachmentMenu(page);

    await expectAttachmentSheetRowsOnTitleRail(page);
  });

  test("GitHub combobox does not render until the picker is opened", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);
    const workspace = await withWorkspace({ prefix: "attach-gh-lazy-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    await expect(page.getByTestId("combobox-desktop-container")).not.toBeVisible();

    await openGithubPickerFromMenu(page);

    await expect(page.getByPlaceholder("Search issues and PRs...")).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByTestId("combobox-empty-text").or(page.getByText("Searching...")),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("attaches an issue and a pull request from the repository picker", async ({ page }) => {
    test.setTimeout(120_000);
    if (!hasGithubAuth()) {
      test.skip(true, "GitHub auth not available in this environment");
    }
    const ghRepo = await createTempGithubRepo({
      category: "attachments",
      issues: [{ title: "fix: attachment issue" }],
      prs: [{ title: "feat: attachment pull request", state: "open" }],
    });
    const handle = await openGithubWorkspace(page, ghRepo.prs[0].localPath);
    try {
      await clickNewChat(page);
      await expectComposerVisible(page);
      // Choose from the repository list. Newly created repositories are not
      // necessarily available in GitHub's separate text-search index yet.
      await selectGithubOption(page, "", `issue:${ghRepo.issues[0].number}`);
      await expectGithubAttachmentPill(page, ghRepo.issues[0]);
      await selectGithubOption(page, "", `change_request:${ghRepo.prs[0].number}`);
      await expectGithubAttachmentPill(page, ghRepo.prs[0]);
      await expectGithubAttachmentPill(page, ghRepo.issues[0]);
    } finally {
      await handle.cleanup();
      await ghRepo.cleanup();
    }
  });

  test.fixme("workspace-review pill suppresses on X-click and reappears after send", async () => {
    // The review attachment is created via InlineReviewEditor in surface.tsx (addComment action).
    // Automating this requires: a workspace with staged changes, navigating to the diff panel,
    // hovering the gutter "+" button, typing a comment, and submitting. A dedicated
    // helpers/review.ts with addInlineReviewComment(page, filePath, lineNumber, comment) is
    // needed before this can be exercised end-to-end.
  });

  test("attaches, previews, and removes an image before dropping a file", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);
    const workspace = await withWorkspace({ prefix: "attach-lightbox-" });
    await workspace.navigateTo();
    await clickNewChat(page);
    await expectComposerVisible(page);

    await test.step("open the available attachment choices", async () => {
      await openAttachmentMenu(page);
      await expect(page.getByTestId("message-input-attachment-menu-item-image")).toBeVisible();
      await expect(page.getByTestId("message-input-attachment-menu-item-github")).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await attachImageFromMenu(page, TEST_IMAGE);
    await expectAttachmentPill(page, "composer-image-attachment-pill");
    const preview = page.getByTestId("composer-image-attachment-pill");
    const remove = page.getByRole("button", { name: "Remove image attachment" });
    await page.mouse.move(0, 0);
    await expect(remove).toBeVisible();
    await expect(remove).toHaveCSS("opacity", "0");
    await expect(page.getByTestId("composer-image-hover-highlight")).toHaveCount(0);
    await preview.hover();
    await expect(remove).toHaveCSS("opacity", "1");
    await expect(page.getByTestId("composer-image-hover-highlight")).toBeVisible();
    const previewBox = await preview.boundingBox();
    const removeBox = await remove.boundingBox();
    if (!previewBox || !removeBox)
      throw new Error("Image attachment controls could not be measured");
    expect(previewBox.width).toBeGreaterThanOrEqual(120);
    expect(previewBox.height).toBeGreaterThanOrEqual(120);
    expect(removeBox.x).toBeGreaterThan(previewBox.x + previewBox.width / 2);
    expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(previewBox.x + previewBox.width);
    expect(removeBox.y).toBeGreaterThanOrEqual(previewBox.y);
    expect(removeBox.y + removeBox.height).toBeLessThan(previewBox.y + previewBox.height / 2);
    await attachImageFromMenu(page, { ...TEST_IMAGE, name: "second.png" });
    await expect(preview).toHaveCount(2);
    await openImageLightbox(page);
    await expect(page.getByTestId("attachment-lightbox-position")).toHaveText("1 / 2");
    await expect(page.getByTestId("attachment-lightbox-previous")).toBeDisabled();
    await page.getByTestId("attachment-lightbox-next").click();
    await expect(page.getByTestId("attachment-lightbox-position")).toHaveText("2 / 2");
    await expect(page.getByTestId("attachment-lightbox-next")).toBeDisabled();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("attachment-lightbox-position")).toHaveText("1 / 2");
    await page.screenshot({ path: "/tmp/paseoi-image-gallery.png" });
    await closeImageLightbox(page);
    await preview.first().hover();
    await remove.first().click();
    await expect(preview).toHaveCount(1);
    await page.screenshot({ path: "/tmp/paseoi-large-image-preview.png" });

    await openImageLightbox(page);
    await closeImageLightbox(page);

    await test.step("remove the image and attach a dropped file", async () => {
      await removeAttachmentPill(page, "composer-image-attachment-pill", "Remove image attachment");
      await expect(page.getByTestId("composer-image-attachment-pill")).toHaveCount(0);
      await dropFileOnComposer(page, TEST_JSON);
      await expectAttachmentPill(page, "composer-file-attachment-pill");
    });
  });

  test("browses all images in one sent message without including another message", async ({
    page,
  }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "message-gallery-",
      title: "Image gallery",
    });
    try {
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await attachImageFromMenu(page, TEST_IMAGE);
      await attachImageFromMenu(page, { ...TEST_IMAGE, name: "second.png" });
      await fillComposerDraft(page, "First image group");
      await sendComposerWithButton(page);
      const first = page.getByTestId("user-message").filter({ hasText: "First image group" });
      const images = first.getByRole("button", { name: "Open image attachment" });
      await expect(images).toHaveCount(2);
      await expectAgentIdle(page);
      await attachImageFromMenu(page, { ...TEST_IMAGE, name: "other-message.png" });
      await fillComposerDraft(page, "Separate image group");
      await sendComposerWithButton(page);
      await expect(
        page.getByTestId("user-message").filter({ hasText: "Separate image group" }),
      ).toBeVisible();
      await expectAgentIdle(page);
      await images.nth(1).click();
      await page.screenshot({ path: "/tmp/paseoi-sent-image-gallery.png" });
      await expect(page.getByTestId("attachment-lightbox-position")).toHaveText("2 / 2");
      // Sample actual painted-frame geometry while changing images, not just the final state.
      await page.evaluate(() => {
        interface Frame {
          images: Array<{ width: number; height: number }>;
          error: boolean;
        }
        const trace = window as Window & { __paseoiGalleryFrames?: Frame[] };
        const frames: Frame[] = [];
        trace.__paseoiGalleryFrames = frames;
        const sample = () => {
          const visibleImages: Array<{ width: number; height: number }> = [];
          for (const image of document.querySelectorAll(
            '[data-testid="attachment-lightbox-image"]',
          )) {
            const layer = image.closest('[data-testid="attachment-lightbox-layer"]');
            if (layer && getComputedStyle(layer).opacity === "1") {
              const rect = image.getBoundingClientRect();
              visibleImages.push({ width: rect.width, height: rect.height });
            }
          }
          frames.push({
            images: visibleImages,
            error: document.body.textContent?.includes("Couldn't load image") ?? false,
          });
          if (frames.length < 30) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.getByTestId("attachment-lightbox-previous").click();
      await expect(page.getByTestId("attachment-lightbox-position")).toHaveText("1 / 2");
      await page.waitForFunction(
        () =>
          ((window as Window & { __paseoiGalleryFrames?: unknown[] }).__paseoiGalleryFrames
            ?.length ?? 0) >= 15,
      );
      const frames = await page.evaluate(
        () =>
          (
            window as Window & {
              __paseoiGalleryFrames?: Array<{
                images: Array<{ width: number; height: number }>;
                error: boolean;
              }>;
            }
          ).__paseoiGalleryFrames ?? [],
      );
      expect(frames.length).toBeGreaterThanOrEqual(15);
      for (const frame of frames) {
        expect(frame.error).toBe(false);
        expect(frame.images).toHaveLength(1);
        expect(frame.images[0].width).toBeGreaterThan(0);
        expect(frame.images[0].height).toBeGreaterThan(0);
        expect(frame.images[0].width).toBeLessThanOrEqual(961);
        expect(frame.images[0].height).toBeLessThanOrEqual(641);
      }
      await page.keyboard.press("ArrowRight");
      await expect(page.getByTestId("attachment-lightbox-position")).toHaveText("2 / 2");
      await closeImageLightbox(page);
      await page.reload();
      await expect(images).toHaveCount(2, { timeout: 30_000 });
      await images.first().click();
      await expect(page.getByTestId("attachment-lightbox-position")).toHaveText("1 / 2");
      await expect(page.getByTestId("attachment-lightbox-image")).toBeVisible();
      await closeImageLightbox(page);
      await expect(first).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("dropped JSON file renders as a file attachment in New Workspace", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedWorkspace({ repoPrefix: "attach-drop-new-workspace-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({
        page,
        serverId: getServerId(),
        workspaceId: workspace.workspaceId,
      });

      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });

      await dropFileOnComposer(page, TEST_JSON);

      await expectAttachmentPill(page, "composer-file-attachment-pill");
    } finally {
      await workspace.cleanup();
    }
  });

  test("submitting while agent is running queues the message and clears the draft", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "attach-queue-",
      model: "one-minute-stream",
      prompt: "Stay running for queue test.",
    });
    try {
      await fillComposerDraft(page, "queued draft text");
      await sendDraftToQueue(page);

      await expectQueuedMessageButton(page);
      await expectComposerDraft(page, "");
    } finally {
      await agent.cleanup();
    }
  });

  test("Escape interrupt cancels the running agent and preserves composer draft", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "attach-interrupt-",
      model: "ten-second-stream",
      prompt: "Stay running for interrupt test.",
    });
    try {
      await fillComposerDraft(page, "preserve me");
      await pressInterruptShortcut(page);

      await expectAgentIdle(page, 15_000);
      await expectComposerDraft(page, "preserve me");
    } finally {
      await agent.cleanup();
    }
  });

  test("Escape cancels file creation without interrupting the running agent", async ({ page }) => {
    test.setTimeout(120_000);
    const agent = await startRunningMockAgent(page, {
      prefix: "file-create-escape-",
      model: "one-minute-stream",
      prompt: "Stay running while a file draft is cancelled.",
    });
    try {
      await openFileExplorer(page);
      await page.getByTestId("files-new-file").click();
      const nameInput = page.getByTestId("file-explorer-name-input");
      await expect(nameInput).toBeVisible();

      await nameInput.press("Escape");

      await expect(nameInput).toBeHidden();
      await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });

  test("composer is locked while new workspace agent is being created", async ({ page }) => {
    test.setTimeout(120_000);
    const serverId = getServerId();

    const agentCreatedDelay = await delayBrowserAgentCreatedStatus(page);
    const workspace = await seedWorkspace({ repoPrefix: "attach-lock-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchWorkspaceViaSidebar({
        page,
        serverId,
        workspaceId: workspace.workspaceId,
      });

      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await fillComposerDraft(page, "lock test prompt");
      const createButton = page
        .getByTestId("message-input-root")
        .getByRole("button", { name: "Create" });
      await expect(createButton).toBeVisible({ timeout: 30_000 });
      await createButton.click();

      await agentCreatedDelay.waitForCreateRequest();
      await agentCreatedDelay.waitForDelayedCreatedStatus();

      await expectComposerDisabled(page);
      await expectAttachButtonDisabled(page);

      agentCreatedDelay.release();

      await expectComposerEditable(page);
    } finally {
      agentCreatedDelay.release();
      await workspace.cleanup();
    }
  });
});

test("pasted images renumber remaining references without changing attachment IDs", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "claude" })),
  );
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "image-inline-ids-",
    title: "Image IDs",
  });
  const gate = await installDaemonWebSocketGate(page);
  try {
    await openAgentRoute(page, workspace);
    await expectComposerVisible(page);
    const input = composerLocator(page);
    await input.fill("Compare  please");
    await selectComposerDraftRange(page, 8, 8);
    expect(await pasteComposerTestImage(page)).toBe(true);
    await expect(input.locator(".composer-reference")).toHaveText("@Image 1");
    const firstText = await input.getAttribute("data-markdown");
    expect(firstText).toContain("Compare [@Image 1](attachment://");
    expect(firstText).toContain("please");
    expect(await pasteComposerTestImage(page)).toBe(true);
    await expect(input.locator(".composer-reference")).toHaveText(["@Image 1", "@Image 2"]);
    expect(await pasteComposerTestImage(page)).toBe(true);
    await expect(input.locator(".composer-reference")).toHaveText([
      "@Image 1",
      "@Image 2",
      "@Image 3",
    ]);
    const original = (await input.getAttribute("data-markdown")) ?? "";
    const originalIds = [...original.matchAll(/attachment:\/\/([^)]*)\)/g)].map(
      (match) => match[1],
    );
    const thumbnails = page.getByTestId("composer-image-attachment-pill");
    await expect(thumbnails).toHaveCount(3);
    await thumbnails.first().hover();
    await page.getByRole("button", { name: "Remove image attachment" }).first().click();
    await expect(thumbnails).toHaveCount(2);
    await expect(input.locator(".composer-reference")).toHaveText(["@Image 1", "@Image 2"]);
    const remaining = (await input.getAttribute("data-markdown")) ?? "";
    expect([...remaining.matchAll(/attachment:\/\/([^)]*)\)/g)].map((match) => match[1])).toEqual(
      originalIds.slice(1),
    );
    await page.reload();
    await expectComposerVisible(page);
    await expect(input.locator(".composer-reference")).toHaveText(["@Image 1", "@Image 2"]);
    await input.press("End");
    await input.pressSequentially(" `hello` ");
    const code = input.locator(".composer-code");
    await expect(code).toHaveCSS("color", "rgb(232, 154, 127)");
    await expect(code).toHaveCSS("background-color", "rgb(47, 45, 43)");
    await expect(code).toHaveCSS("border-top-color", "rgb(54, 51, 47)");
    await page.screenshot({ path: "/tmp/paseoi-r42-renumbered-images.png" });
    await input.press("Enter");
    await expect.poll(() => gate.getClientRequests("send_agent_message_request").length).toBe(1);
    const request = gate.getClientRequests("send_agent_message_request")[0]!;
    expect(request.images).toHaveLength(2);
    expect(request.attachments).toEqual([
      expect.objectContaining({
        type: "text",
        title: "Image 1",
        text: `Attached image 1: attachment://${originalIds[1]}`,
      }),
      expect.objectContaining({
        type: "text",
        title: "Image 2",
        text: `Attached image 2: attachment://${originalIds[2]}`,
      }),
    ]);
    const sent = page.getByTestId("user-message").filter({ hasText: "Compare" }).last();
    await expect(sent.locator("code")).toHaveCSS("color", "rgb(232, 154, 127)");
    await expect(sent.locator("code")).toHaveCSS("border-top-color", "rgb(54, 51, 47)");
    await expect(sent).not.toContainText("Referenced Paseo image:");
    await expect(sent).not.toContainText("Attached image 1:");
    await sent.getByRole("link", { name: "@Image 2", exact: true }).click();
    await expect(page.getByTestId("attachment-lightbox-close")).toBeVisible();
  } finally {
    await workspace.cleanup();
  }
});
