import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { expectAgentIdle, expectAgentReadyToInterrupt } from "../support/helpers/agent-stream";
import {
  cancelAgent,
  fillComposerDraft,
  expectComposerDraft,
  expectComposerVisible,
  submitMessage,
  attachFileFromMenu,
  pasteComposerTestImage,
  sendComposerWithButton,
  composerLocator,
} from "../support/helpers/composer";
import {
  expectNearBottom,
  scrollChatAwayFromBottom,
  scrollAgentChatToBottom,
} from "../support/helpers/agent-bottom-anchor";
import { holdRewindCompletion } from "../support/helpers/agent-timeline-gate";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

async function completeSubmittedTurn(
  page: Page,
  agent: Awaited<ReturnType<typeof seedMockAgentWorkspace>>,
  prompt: string,
): Promise<Locator> {
  await submitMessage(page, prompt);
  const userMessage = page.getByTestId("user-message").filter({ hasText: prompt });
  await expect(userMessage).toBeVisible();

  // Observe this run starting so a cached idle snapshot from the previous turn cannot satisfy the wait.
  await expectAgentReadyToInterrupt(page);
  const finish = await agent.client.waitForFinish(agent.agentId, 30_000);
  expect(finish.status).toBe("idle");
  await expectAgentIdle(page);
  await expect(page.getByText("(end of synthetic stream)", { exact: true }).last()).toBeVisible();
  await expect(userMessage).toHaveAttribute("aria-busy", "false");
  return userMessage;
}

async function rewindConversation(page: Page, userMessage: Locator, prompt: string): Promise<void> {
  await userMessage.getByText(prompt, { exact: false }).first().hover();
  await userMessage.getByRole("button", { name: "Rewind to this message", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rewind conversation", exact: true }).click();
}

async function expectTurnCompletesNormally(
  page: Page,
  agent: Awaited<ReturnType<typeof seedMockAgentWorkspace>>,
): Promise<void> {
  // Observe this run starting so a cached idle snapshot from the previous turn cannot satisfy the wait.
  await expectAgentReadyToInterrupt(page);
  const finish = await agent.client.waitForFinish(agent.agentId, 30_000);
  expect(finish.status).toBe("idle");
  await expect(page.getByText("(end of synthetic stream)", { exact: true }).last()).toBeVisible();
  await expectAgentIdle(page);
}

test.describe("Agent message rewind", () => {
  test("rewinds a submitted prompt without replaying history and preserves a human draft", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const retainedPrompt = "Keep this completed turn after rewind.";
    const rewoundPrompt = "Remove this completed turn after rewind.";
    const preservedDraft = "Keep this human draft after rewind.";
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "message-rewind-roundtrip-",
      title: "Message rewind roundtrip",
      model: "ten-second-stream",
    });

    try {
      const rewindCompletion = await holdRewindCompletion(page, agent.agentId);
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      await completeSubmittedTurn(page, agent, retainedPrompt);
      const userMessage = await completeSubmittedTurn(page, agent, rewoundPrompt);
      await scrollChatAwayFromBottom(page, {
        deltaY: -900,
        minDistanceFromBottom: 300,
      });
      await fillComposerDraft(page, preservedDraft);
      await attachFileFromMenu(page, {
        name: "current-draft.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Keep this current draft file."),
      });
      await expect(page.getByTestId("composer-file-attachment-pill")).toContainText(
        "current-draft.txt",
      );
      await fillComposerDraft(page, preservedDraft);
      rewindCompletion.clearTimelineStreamCount();

      const rewind = rewindConversation(page, userMessage, rewoundPrompt);
      await rewindCompletion.waitForDelayedResponse();
      await expect(page.getByTestId("rewind-menu-conversation")).toBeDisabled();
      expect(rewindCompletion.timelineStreamCount()).toBe(0);
      rewindCompletion.release();
      await rewind;

      await expect(page.getByTestId("user-message").filter({ hasText: rewoundPrompt })).toHaveCount(
        0,
      );
      await expectComposerDraft(page, preservedDraft);
      await expect(page.getByTestId("composer-file-attachment-pill")).toContainText(
        "current-draft.txt",
      );
      await expectNearBottom(page);
    } finally {
      await agent.cleanup();
    }
  });

  test("rewinds replayed images and uploaded files into the composer and sends them again", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "rewind-attachments-",
      title: "Attachment rewind",
      model: "ten-second-stream",
    });
    const prompt = "Keep this image and log after rewind.";
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      await completeSubmittedTurn(page, agent, "Retain this earlier message.");
      await fillComposerDraft(page, prompt);
      await pasteComposerTestImage(page);
      await attachFileFromMenu(page, {
        name: "rewind-log.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Rewind attachment proof."),
      });
      await expect(page.getByTestId("composer-image-attachment-pill")).toBeVisible();
      await expect(page.getByTestId("composer-file-attachment-pill")).toContainText(
        "rewind-log.txt",
      );
      await sendComposerWithButton(page);
      await expectTurnCompletesNormally(page, agent);
      const timelineClient = agent.client as typeof agent.client &
        Pick<DaemonClient, "fetchAgentTimeline">;
      const saved = await timelineClient.fetchAgentTimeline(agent.agentId, {
        direction: "tail",
        limit: 0,
        projection: "projected",
      });
      expect(
        saved.entries.find(
          (entry) => entry.item.type === "user_message" && entry.item.text.includes(prompt),
        )?.item,
      ).toMatchObject({
        attachments: [
          expect.objectContaining({ type: "uploaded_file", fileName: "rewind-log.txt" }),
        ],
      });
      await page.reload({ waitUntil: "commit" });
      await expectComposerVisible(page);
      await scrollAgentChatToBottom(page);
      const userMessage = page.getByTestId("user-message").filter({ hasText: prompt });
      await userMessage.scrollIntoViewIfNeeded();
      await expect(userMessage.locator("img").first()).toBeVisible({ timeout: 30_000 });
      await rewindConversation(page, userMessage, prompt);
      await expect(page.getByTestId("composer-image-attachment-pill")).toBeVisible();
      await expect(page.getByTestId("composer-file-attachment-pill")).toContainText(
        "rewind-log.txt",
      );
      await expect(composerLocator(page)).toHaveAttribute(
        "data-markdown",
        /Keep this image and log.*@Image 1.*@File 1/s,
      );
      const rewoundHistory = await timelineClient.fetchAgentTimeline(agent.agentId, {
        direction: "tail",
        limit: 0,
        projection: "projected",
      });
      expect(
        rewoundHistory.entries.filter((entry) => entry.item.type === "user_message"),
      ).toMatchObject([{ item: { type: "user_message", text: "Retain this earlier message." } }]);
      await expect(userMessage).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("rewound-attachments.png") });
      await sendComposerWithButton(page);
      await expectTurnCompletesNormally(page, agent);
      const restored = page.getByTestId("user-message").filter({ hasText: prompt });
      await expect(restored).toHaveCount(1);
      await expect(restored.locator("img").first()).toBeVisible();
      await expect(restored).toContainText("rewind-log.txt");
    } finally {
      await agent.cleanup();
    }
  });

  test("keeps a pre-acknowledgement turn running after rewind is rejected", async ({ page }) => {
    test.setTimeout(90_000);
    const prompt = "Delay synthetic user message by 2000ms.";
    const rewindError = "Cannot rewind before the provider acknowledges the submitted prompt";
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "message-rewind-pre-echo-",
      title: "Message rewind pre-echo",
      model: "ten-second-stream",
    });

    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      await submitMessage(page, prompt);
      const userMessage = page.getByTestId("user-message").filter({ hasText: prompt });
      await expect(userMessage).toBeVisible();
      await expectAgentReadyToInterrupt(page);

      await rewindConversation(page, userMessage, prompt);

      await expect(page.getByText(rewindError, { exact: true })).toBeVisible();
      await expectAgentReadyToInterrupt(page);
      await expectTurnCompletesNormally(page, agent);
    } finally {
      await agent.cleanup();
    }
  });

  test("does not offer rewind for daemon-handled prompts", async ({ page }) => {
    const commandPrompt = "/mock handled-command";
    const providerPrompt = "Keep this provider-bound prompt rewindable.";
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "message-rewind-daemon-command-",
      title: "Message rewind daemon command",
      model: "ten-second-stream",
    });

    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      await expectAgentIdle(page);

      await submitMessage(page, commandPrompt);
      const commandMessage = page.getByTestId("user-message").filter({ hasText: commandPrompt });
      await expect(commandMessage).toBeVisible();
      await expect(page.getByText("Mock command handled", { exact: true })).toBeVisible();
      await commandMessage.getByText(commandPrompt, { exact: true }).hover();
      await expect(
        commandMessage.getByRole("button", { name: "Rewind to this message", exact: true }),
      ).toHaveCount(0);

      await submitMessage(page, providerPrompt);
      const providerMessage = page.getByTestId("user-message").filter({ hasText: providerPrompt });
      await expect(providerMessage).toBeVisible();
      await expectAgentReadyToInterrupt(page);
      await providerMessage.getByText(providerPrompt, { exact: true }).hover();
      await expect(
        providerMessage.getByRole("button", { name: "Rewind to this message", exact: true }),
      ).toBeVisible();
      await cancelAgent(page);
      await expectAgentIdle(page);
    } finally {
      await agent.cleanup();
    }
  });
});
