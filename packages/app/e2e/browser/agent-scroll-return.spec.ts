import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import {
  readScrollMetrics,
  scrollChatAwayFromBottom,
} from "../support/helpers/agent-bottom-anchor";
import { getServerId } from "../support/helpers/server-id";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import {
  continueToNextQuestion,
  fillQuestionAnswer,
  submitQuestionAnswers,
  waitForQuestionPrompt,
} from "../support/helpers/questions";
import { openMobileAgentSidebar } from "../support/helpers/sidebar";
import {
  expectTimelinePromptVisible,
  openAgentTimeline,
  seedLongMockAgentTimeline,
  userScrollsTimelineToHistoryStart,
} from "../support/helpers/timeline-pagination";
import { switchWorkspaceViaSidebar } from "../support/helpers/workspace-ui";

async function expectChatAtBottom(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readScrollMetrics(page)).distanceFromBottom, {
      timeout: 10_000,
    })
    .toBeLessThanOrEqual(72);
}

async function openCompactWorkspace(
  page: Page,
  workspace: Pick<MockAgentWorkspace, "workspaceId">,
): Promise<void> {
  await openMobileAgentSidebar(page);
  await switchWorkspaceViaSidebar({
    page,
    serverId: getServerId(),
    workspaceId: workspace.workspaceId,
  });
}

function armDelayedScrollForHiddenChat(page: Page): Promise<void> {
  return page
    .locator('[data-testid="agent-chat-scroll"]:visible')
    .first()
    .evaluate((root) => {
      const scroll = root as HTMLElement;
      return new Promise<void>((resolve) => {
        const observer = new ResizeObserver(() => {
          if (scroll.getClientRects().length > 0) return;
          observer.disconnect();
          scroll.dispatchEvent(new Event("scroll"));
          resolve();
        });
        observer.observe(scroll);
      });
    });
}

for (const landing of [
  "exact bottom",
  "near bottom",
  "already at bottom after selection",
  "older history",
] as const) {
  test(
    landing === "older history"
      ? "downward wheel keeps an older reading position away from the bottom"
      : `downward wheel resumes following from ${landing}`,
    async ({ page }) => {
      const response = Array.from(
        { length: 24 },
        (_, index) => `Paragraph ${index + 1}: A long response for testing wheel scrolling.`,
      ).join("\n\n");
      const agent = await seedMockAgentWorkspace({
        repoPrefix: "wheel-resume-",
        title: `Wheel resume: ${landing}`,
        initialPrompt: "Render a long response",
        featureValues: { mockAssistantResponse: response },
      });
      try {
        await agent.client.waitForFinish(agent.agentId, 15_000);
        await openAgentRoute(page, agent);
        await expect
          .poll(async () => (await readScrollMetrics(page)).distanceFromBottom)
          .toBeLessThanOrEqual(1);
        const chat = page.getByTestId("agent-chat-scroll").filter({ visible: true });
        if (landing === "already at bottom after selection") {
          await page
            .getByTestId("assistant-message")
            .last()
            .evaluate((element) => {
              const selection = document.getSelection()!;
              const range = document.createRange();
              range.selectNodeContents(element.lastElementChild ?? element);
              selection.removeAllRanges();
              selection.addRange(range);
              document.dispatchEvent(new Event("selectionchange"));
              selection.removeAllRanges();
              document.dispatchEvent(new Event("selectionchange"));
            });
        } else {
          await scrollChatAwayFromBottom(page, { deltaY: -500, minDistanceFromBottom: 300 });
        }
        const before = await readScrollMetrics(page);
        const box = await chat.boundingBox();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        let wheelDistance = 10_000;
        if (landing === "older history") wheelDistance = 50;
        else if (landing === "near bottom") wheelDistance = before.distanceFromBottom - 24;
        await page.mouse.wheel(0, wheelDistance);
        if (landing === "older history") {
          await expect
            .poll(async () => (await readScrollMetrics(page)).offsetY)
            .toBeGreaterThan(before.offsetY + 40);
          expect((await readScrollMetrics(page)).distanceFromBottom).toBeGreaterThan(200);
        } else {
          await expect
            .poll(async () => (await readScrollMetrics(page)).distanceFromBottom)
            .toBeLessThanOrEqual(24);
        }
        const readingOffset = (await readScrollMetrics(page)).offsetY;
        await agent.client.sendAgentMessage(agent.agentId, "Continue with another long response");
        await agent.client.waitForFinish(agent.agentId, 15_000);
        if (landing === "older history") {
          await expect
            .poll(async () => Math.abs((await readScrollMetrics(page)).offsetY - readingOffset))
            .toBeLessThanOrEqual(1);
        } else {
          await expect
            .poll(async () => (await readScrollMetrics(page)).distanceFromBottom)
            .toBeLessThanOrEqual(1);
        }
      } finally {
        await agent.cleanup();
      }
    },
  );
}

test("desktop workspaces keep independent bottom and reading positions", async ({ page }) => {
  test.setTimeout(240_000);
  const first = await seedLongMockAgentTimeline({ turns: 30 });
  const second = await seedLongMockAgentTimeline({ turns: 30 });
  const switchTo = (workspace: MockAgentWorkspace) =>
    switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: workspace.workspaceId,
    });

  try {
    await page.addInitScript(() => {
      Object.assign(globalThis, {
        __PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD: 10,
        __PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS: 6,
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAgentTimeline(page, first);
    await expectTimelinePromptVisible(page, first.newestPrompt);
    await userScrollsTimelineToHistoryStart(page);
    await expect(page.locator("#agent-chat-scroll-web-dom-virtualized:visible")).toBeVisible();
    await page.getByTestId("scroll-to-bottom-button").filter({ visible: true }).click();
    await expectChatAtBottom(page);
    await switchTo(second);
    await expectTimelinePromptVisible(page, second.newestPrompt);
    await userScrollsTimelineToHistoryStart(page);
    await page.getByTestId("scroll-to-bottom-button").filter({ visible: true }).click();
    await expectChatAtBottom(page);
    const secondPosition = await scrollChatAwayFromBottom(page, {
      deltaY: -900,
      minDistanceFromBottom: 300,
    });

    await switchTo(first);
    await expectChatAtBottom(page);
    const firstPosition = await scrollChatAwayFromBottom(page, {
      deltaY: -600,
      minDistanceFromBottom: 300,
    });
    await switchTo(second);
    await expect
      .poll(async () => Math.abs((await readScrollMetrics(page)).offsetY - secondPosition.offsetY))
      .toBeLessThanOrEqual(24);
    await switchTo(first);
    await expect
      .poll(async () => Math.abs((await readScrollMetrics(page)).offsetY - firstPosition.offsetY))
      .toBeLessThanOrEqual(24);
  } finally {
    await Promise.allSettled([first.cleanup(), second.cleanup()]);
  }
});

test("pointer jitter cannot turn geometry changes into scroll intent", async ({ page }) => {
  test.setTimeout(240_000);
  const longChat = await seedLongMockAgentTimeline({ turns: 30 });
  const backgroundPrompt = "Continue after a pointer is released outside the chat";

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentTimeline(page, longChat);
    await expectTimelinePromptVisible(page, longChat.newestPrompt);
    await expectChatAtBottom(page);

    const scroll = page.locator('[data-testid="agent-chat-scroll"]:visible').first();
    // Selection intentionally pauses following; this gesture tests geometry changes alone.
    await page.addStyleTag({
      content:
        '[data-testid="agent-chat-scroll"], [data-testid="agent-chat-scroll"] * { user-select: none !important; }',
    });
    const bounds = await scroll.boundingBox();
    expect(bounds, "Expected visible chat scroll bounds").not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2 - 3);
    await page.setViewportSize({ width: 390, height: 1124 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.mouse.move(410, bounds!.y + bounds!.height / 2 - 3);
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

    await longChat.client.sendAgentMessage(longChat.agentId, backgroundPrompt);
    await longChat.client.waitForFinish(longChat.agentId, 20_000);
    await expectTimelinePromptVisible(page, backgroundPrompt);
    await expectChatAtBottom(page);
  } finally {
    await longChat.cleanup();
  }
});

test("a retained chat ignores delayed scroll delivery while hidden", async ({ page }) => {
  test.setTimeout(240_000);
  const longChat = await seedLongMockAgentTimeline({ turns: 30 });
  const otherWorkspace = await seedMockAgentWorkspace({
    repoPrefix: "scroll-return-hidden-other-",
    title: "Other workspace",
    initialPrompt: "Open the other workspace",
  });
  const backgroundPrompt = "emit 500 coalesced agent stream updates";

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentTimeline(page, longChat);
    await expectTimelinePromptVisible(page, longChat.newestPrompt);
    await expectChatAtBottom(page);

    const delayedScrollDelivered = armDelayedScrollForHiddenChat(page);
    await openCompactWorkspace(page, otherWorkspace);
    await delayedScrollDelivered;
    await longChat.client.sendAgentMessage(longChat.agentId, backgroundPrompt);
    await longChat.client.waitForFinish(longChat.agentId, 20_000);

    await openCompactWorkspace(page, longChat);
    await expectTimelinePromptVisible(page, backgroundPrompt);
    await expectChatAtBottom(page);
  } finally {
    await Promise.allSettled([longChat.cleanup(), otherWorkspace.cleanup()]);
  }
});

test("a retained streaming chat returns to the bottom and continues following", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const longChat = await seedLongMockAgentTimeline({ turns: 30 });
  const otherWorkspace = await seedMockAgentWorkspace({
    repoPrefix: "scroll-return-streaming-other-",
    title: "Other workspace",
    initialPrompt: "Open the other workspace",
  });
  const streamingPrompt = "Continue streaming while this workspace is hidden";

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentTimeline(page, longChat);
    await expectTimelinePromptVisible(page, longChat.newestPrompt);
    await expectChatAtBottom(page);

    await longChat.client.sendAgentMessage(longChat.agentId, streamingPrompt);
    await longChat.client.waitForAgentUpsert(
      longChat.agentId,
      (snapshot) => snapshot.status === "running",
      15_000,
    );
    await openCompactWorkspace(page, otherWorkspace);
    await openCompactWorkspace(page, longChat);

    await expectTimelinePromptVisible(page, streamingPrompt);
    await expectChatAtBottom(page);
    await longChat.client.waitForFinish(longChat.agentId, 20_000);
    await expectChatAtBottom(page);
  } finally {
    await Promise.allSettled([longChat.cleanup(), otherWorkspace.cleanup()]);
  }
});

test("a retained chat preserves an intentional reading position", async ({ page }) => {
  test.setTimeout(240_000);
  const longChat = await seedLongMockAgentTimeline({ turns: 30 });
  const otherWorkspace = await seedMockAgentWorkspace({
    repoPrefix: "scroll-return-reading-position-other-",
    title: "Other workspace",
    initialPrompt: "Open the other workspace",
  });

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentTimeline(page, longChat);
    await expectTimelinePromptVisible(page, longChat.newestPrompt);
    const readingPosition = await scrollChatAwayFromBottom(page, {
      deltaY: -900,
      minDistanceFromBottom: 300,
    });

    await openCompactWorkspace(page, otherWorkspace);
    await openCompactWorkspace(page, longChat);

    await expect
      .poll(async () => Math.abs((await readScrollMetrics(page)).offsetY - readingPosition.offsetY))
      .toBeLessThanOrEqual(24);
  } finally {
    await Promise.allSettled([longChat.cleanup(), otherWorkspace.cleanup()]);
  }
});

test("a retained reading position yields to messages that arrived while away", async ({ page }) => {
  test.setTimeout(240_000);
  const longChat = await seedLongMockAgentTimeline({ turns: 30 });
  const otherWorkspace = await seedMockAgentWorkspace({
    repoPrefix: "scroll-return-new-messages-other-",
    title: "Other workspace",
    initialPrompt: "Open the other workspace",
  });
  const awayPrompt = "Reply while the reader is in another workspace";

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentTimeline(page, longChat);
    await expectTimelinePromptVisible(page, longChat.newestPrompt);
    await scrollChatAwayFromBottom(page, { deltaY: -900, minDistanceFromBottom: 300 });

    await openCompactWorkspace(page, otherWorkspace);
    await longChat.client.sendAgentMessage(longChat.agentId, awayPrompt);
    await longChat.client.waitForFinish(longChat.agentId, 20_000);
    await openCompactWorkspace(page, longChat);

    await expectTimelinePromptVisible(page, awayPrompt);
    await expectChatAtBottom(page);
  } finally {
    await Promise.allSettled([longChat.cleanup(), otherWorkspace.cleanup()]);
  }
});

test("editing keys in an embedded question keep output following", async ({ page }) => {
  test.setTimeout(240_000);
  const longChat = await seedLongMockAgentTimeline({ turns: 30 });
  const questionPrompt = "Emit synthetic questions: two free-write questions.";
  const firstQuestion = "What is the GitHub private repo URL to push to?";
  const secondQuestion = "What should the first commit message be?";

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAgentTimeline(page, longChat);
    await expectTimelinePromptVisible(page, longChat.newestPrompt);
    await expectChatAtBottom(page);

    await longChat.client.sendAgentMessage(longChat.agentId, questionPrompt);
    await waitForQuestionPrompt(page, 30_000);
    await fillQuestionAnswer(page, {
      question: firstQuestion,
      answer: "git@github.com:user/private-repo.git",
    });
    const firstInput = page
      .getByTestId("question-form-card")
      .first()
      .getByRole("textbox", { name: firstQuestion });
    const inputBounds = await firstInput.boundingBox();
    expect(inputBounds, "Expected embedded question input bounds").not.toBeNull();
    await page.mouse.move(
      inputBounds!.x + inputBounds!.width / 2,
      inputBounds!.y + inputBounds!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      inputBounds!.x + inputBounds!.width / 2 + 20,
      inputBounds!.y + inputBounds!.height / 2 - 3,
    );
    await page.mouse.up();
    await firstInput.press("Home");
    await firstInput.press("ArrowUp");
    await continueToNextQuestion(page);
    await fillQuestionAnswer(page, {
      question: secondQuestion,
      answer: "Initialize private repo",
    });
    await submitQuestionAnswers(page);
    await longChat.client.waitForFinish(longChat.agentId, 20_000);

    await expectChatAtBottom(page);
  } finally {
    await longChat.cleanup();
  }
});
