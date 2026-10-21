import { expect, test } from "../support/fixtures";
import { trackPromptJumpRequests } from "../support/helpers/agent-timeline-gate";
import {
  clickChatOutlineRowEdge,
  disableChatOutlineFromAppearance,
  expectActiveChatOutlinePrompt,
  expectActiveChatOutlinePromptMovedFrom,
  expectChatOutlinePreview,
  expectChatOutlinePrompts,
  expectChatOutlinePromptToRemainBare,
  expectLiveTurnPromptAboveFoldAndActive,
  expectNoChatOutlinePreviewWhileCrossingToSidebar,
  expectNoChatOutline,
  expectNoChatOutlinePreview,
  expectOneActiveChatOutlinePrompt,
  focusChatOutlinePrompt,
  hoverChatOutlinePrompt,
  chatOutlineRail,
  movePointerOffChatOutline,
  observePromptIndexRequests,
  pointAtChatOutlineRowEdge,
  pressEnterOnFocusedPrompt,
  splitCurrentPanelRight,
  withStreamingMarkdownOutline,
  expectReadingStreamedMarkdown,
} from "../support/helpers/chat-outline";
import { createCreationScenario } from "../support/helpers/creation";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  attachPromptTimelineEvidence,
  expectPromptsDrawnByPlugin,
  expectVirtualizedPluginPromptVisible,
  withPromptTimelinePlugin,
} from "../support/helpers/plugin-timeline";
import {
  expectTimelineAtMaximumScrollWithPromptVisible,
  expectTimelinePromptNotMounted,
  expectTimelinePromptLandedBelowTop,
  expectTimelinePromptVisible,
  holdOlderHistoryPages,
  openAgentTimeline,
  scrollThroughOlderHistoryPages,
  scrollTimelineToNewestLoadedEdge,
  seedLongMockAgentTimeline,
  type LongTimelineAgent,
} from "../support/helpers/timeline-pagination";

// Wide enough that the timeline panel clears the rail's MIN_PANEL_WIDTH with room
// to spare. At 1280 the panel measures 960, which sits too close to the threshold
// for chrome-width changes elsewhere to stay out of these tests.
const WIDE_VIEWPORT = { width: 1440, height: 900 };
const LOADED_TURNS = 16;

function withCompactionIntro(raw: string | Buffer, agentId: string, intro: string) {
  const envelope = JSON.parse(raw.toString());
  const payload = envelope.message?.payload;
  if (payload?.agentId !== agentId || !payload.entries) return raw;
  const lastReply = payload.entries.findLast(
    (entry: { item?: { type?: string } }) => entry.item?.type === "assistant_message",
  );
  if (lastReply) lastReply.item.text = intro;
  return JSON.stringify(envelope);
}

test("folds restored compaction text after tool rows and allows expansion", async ({ page }) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "compaction-intro-",
    title: "Compaction intro",
    model: "ten-second-stream",
  });
  const intro =
    "Attribution for git commits and pull requests you create from here on.\n\n" +
    "Restored tools and context. ".repeat(70);
  try {
    await agent.client.sendAgentMessage(agent.agentId, "Restore the previous context.");
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => server.send(message));
      server.onMessage((raw) => ws.send(withCompactionIntro(raw, agent.agentId, intro)));
    });
    await page.setViewportSize(WIDE_VIEWPORT);
    await openAgentTimeline(page, agent);
    const summary = page.getByRole("button", { name: "Compaction summary", exact: true }).last();
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText(intro, { exact: true })).toHaveCount(0);
    await summary.click();
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(/Restored tools and context/)).toBeVisible();
    await page.getByTestId("agent-chat-scroll").first().hover();
    await page.mouse.wheel(0, -20_000);
    await summary.click();
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText(/Restored tools and context/)).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

function historyRowsDoNotOverlap(element: HTMLElement): boolean {
  const rows = [...element.querySelectorAll<HTMLElement>("[data-history-row-id]")]
    .map((row) => row.getBoundingClientRect())
    .filter((rect) => rect.height > 0)
    .sort((a, b) => a.top - b.top);
  return (
    rows.length > 0 &&
    rows.every((row, index) => index === 0 || rows[index - 1]!.bottom <= row.top + 2)
  );
}

test("active tab icon toggles all thinking rows and preserves the provider icon off hover", async ({
  page,
}) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "thinking-toggle-",
    title: "Thinking toggle",
    model: "ten-second-stream",
  });
  try {
    await agent.client.sendAgentMessage(
      agent.agentId,
      "Explain the implementation and run the checks.",
    );
    await agent.client.waitForFinish(agent.agentId, 30000);
    await page.setViewportSize(WIDE_VIEWPORT);
    await openAgentTimeline(page, agent);
    const tab = page.getByTestId(`workspace-tab-agent_${agent.agentId}`);
    const toggle = page.getByTestId(`workspace-tab-thinking-${agent.agentId}`);
    await page.mouse.move(1200, 700);
    await expect(toggle).toHaveCount(0);
    await tab.hover();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const thinking = page.getByTestId("tool-call-badge").filter({ hasText: "Thinking" });
    await expect(thinking.first()).toContainText("Need to find the scroll container");
    await toggle.click();
    await expect(thinking.first()).not.toContainText("Need to find the scroll container");
    await page.mouse.move(1200, 700);
    await expect(toggle).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

test.describe("desktop chat outline", () => {
  test("keeps the prompt marked while reading split Markdown blocks and after completion", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const prompt = "Explain in several paragraphs.";
    await withStreamingMarkdownOutline(async (agent) => {
      await agent.client.sendAgentMessage(agent.agentId, "Earlier prompt.");
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);
      await agent.client.sendAgentMessage(agent.agentId, prompt);
      await expectChatOutlinePrompts(page, 2);

      await expectReadingStreamedMarkdown(page, prompt);
      await expectActiveChatOutlinePrompt(page, 2);
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await expectActiveChatOutlinePrompt(page, 2);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expectActiveChatOutlinePrompt(page, 2);
      await clickChatOutlineRowEdge(page, 2);
      await expectTimelinePromptLandedBelowTop(page, prompt);
    });
  });

  test("indexes unloaded prompts and jumps with one bounded merged page", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      (
        globalThis as typeof globalThis & {
          __PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD: number;
        }
      ).__PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = 10;
    });
    const agent = await seedLongMockAgentTimeline({ turns: 80 });
    try {
      const jumps = await trackPromptJumpRequests(page, agent.agentId);
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);

      const rail = chatOutlineRail(page);
      await expectChatOutlinePrompts(page, 80);
      await expectTimelinePromptNotMounted(page, agent.oldestPrompt);

      await rail.getByRole("tab").nth(39).click();
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[39]);
      await expect.poll(() => jumps.requests()).toHaveLength(1);
      expect(jumps.requests()[0]).toMatchObject({ limit: 40, mergeWindow: true });

      await page.getByTestId("scroll-to-bottom-button").click();
      await expectTimelinePromptVisible(page, agent.newestPrompt);

      const requestsBeforeLoadedJump = jumps.requests().length;
      await rail.getByRole("tab").last().click();
      await expectTimelinePromptVisible(page, agent.newestPrompt);
      expect(jumps.requests()).toHaveLength(requestsBeforeLoadedJump);

      await rail.getByRole("tab").first().click();
      await expectTimelinePromptVisible(page, agent.oldestPrompt);

      const scroller = page.getByTestId("agent-chat-scroll").first();
      const track = scroller.locator("..").getByTestId("workspace-overlay-scrollbar-track");
      for (const fraction of [0.75, 0.25, 0.9]) {
        const bounds = await track.boundingBox();
        if (!bounds) throw new Error("Conversation scrollbar track is missing");
        await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * fraction);
        await expect.poll(() => scroller.evaluate(historyRowsDoNotOverlap)).toBe(true);
      }
      await rail.getByRole("tab").first().click();
      await expectTimelinePromptVisible(page, agent.oldestPrompt);
      await agent.client.sendAgentMessage(agent.agentId, "live prompt while viewing old history");
      await agent.client.waitForFinish(agent.agentId, 15_000);
      await expectTimelinePromptVisible(page, agent.oldestPrompt);
    } finally {
      await agent.cleanup();
    }
  });

  test("jumps to prompts a timeline plugin draws", async ({ page }) => {
    test.setTimeout(180_000);
    const agent = await seedLongMockAgentTimeline({ turns: 80 });
    try {
      await withPromptTimelinePlugin(async () => {
        await page.setViewportSize(WIDE_VIEWPORT);
        await openAgentTimeline(page, agent);
        await expectChatOutlinePrompts(page, 80);
        await expectPromptsDrawnByPlugin(page);
        await expectTimelinePromptNotMounted(page, agent.prompts[39]);

        // Unloaded, then loaded, then near the newest edge.
        await clickChatOutlineRowEdge(page, 40);
        await expectTimelinePromptLandedBelowTop(page, agent.prompts[39]);
        await attachPromptTimelineEvidence(page, test.info());
        await clickChatOutlineRowEdge(page, 45);
        await expectTimelinePromptLandedBelowTop(page, agent.prompts[44]);
        await clickChatOutlineRowEdge(page, 78);
        await expectTimelineAtMaximumScrollWithPromptVisible(page, agent.prompts[77]);
        await expectPromptsDrawnByPlugin(page);
      });
    } finally {
      await agent.cleanup();
    }
  });

  test("jumps to a loaded virtualized prompt a timeline plugin draws without fetching", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const agent = await seedLongMockAgentTimeline({ turns: 80 });
    const prompt = agent.prompts[29]!;
    try {
      await withPromptTimelinePlugin(async () => {
        const history = await holdOlderHistoryPages(page, agent);
        await page.setViewportSize(WIDE_VIEWPORT);
        await openAgentTimeline(page, agent);
        await expectChatOutlinePrompts(page, 80);
        await scrollThroughOlderHistoryPages(page, 2, history);
        await scrollTimelineToNewestLoadedEdge(page);
        await expectTimelinePromptNotMounted(page, prompt);
        const requestsBeforeJump = history.requestCount();

        await clickChatOutlineRowEdge(page, 30);
        await expectTimelinePromptLandedBelowTop(page, prompt);
        await expectVirtualizedPluginPromptVisible(page, prompt);
        await attachPromptTimelineEvidence(page, test.info());
        expect(history.requestCount()).toBe(requestsBeforeJump);
      }, [prompt]);
    } finally {
      await agent.cleanup();
    }
  });

  test.describe("with the whole conversation loaded", () => {
    let agent: LongTimelineAgent;

    test.beforeAll(async () => {
      test.setTimeout(120_000);
      agent = await seedLongMockAgentTimeline({ turns: LOADED_TURNS });
    });

    test.afterAll(async () => {
      await agent.cleanup();
    });

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);
      await expectChatOutlinePrompts(page, LOADED_TURNS);
    });

    test("previews the prompt under the pointer, anywhere across its row", async ({ page }) => {
      await hoverChatOutlinePrompt(page, 2);
      await expectChatOutlinePreview(page, agent.prompts[1]);

      await pointAtChatOutlineRowEdge(page, 7);
      await expectChatOutlinePreview(page, agent.prompts[6]);

      await movePointerOffChatOutline(page);
      await expectNoChatOutlinePreview(page);
    });

    test("does not preview while crossing the rail toward the sidebar", async ({ page }) => {
      await expectNoChatOutlinePreviewWhileCrossingToSidebar(page);
    });

    test("closes the preview when the pointer leaves after a jump", async ({ page }) => {
      await clickChatOutlineRowEdge(page, 4);
      await movePointerOffChatOutline(page);

      await expectNoChatOutlinePreview(page);
    });

    test("previews and jumps to the focused prompt from the keyboard", async ({ page }) => {
      await focusChatOutlinePrompt(page, 1);
      await expectChatOutlinePreview(page, agent.prompts[0]);
      await expectTimelinePromptNotMounted(page, agent.oldestPrompt);

      await pressEnterOnFocusedPrompt(page);
      await expectTimelinePromptLandedBelowTop(page, agent.oldestPrompt);
      await expectActiveChatOutlinePrompt(page, 1);
    });

    test("moves the active mark as the reader jumps and scrolls", async ({ page }) => {
      await expectOneActiveChatOutlinePrompt(page);

      await clickChatOutlineRowEdge(page, 4);
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[3]);
      await expectActiveChatOutlinePrompt(page, 4);

      await scrollTimelineToNewestLoadedEdge(page);
      await expectTimelinePromptVisible(page, agent.newestPrompt);
      await expectActiveChatOutlinePromptMovedFrom(page, 4);
    });

    test("keeps a clicked prompt free of persistent selection chrome", async ({ page }) => {
      await clickChatOutlineRowEdge(page, 4);

      await expectChatOutlinePromptToRemainBare(page, 4);
    });

    test("clamps the newest prompt at maximum scroll while keeping it visible", async ({
      page,
    }) => {
      await clickChatOutlineRowEdge(page, LOADED_TURNS);

      await expectTimelineAtMaximumScrollWithPromptVisible(page, agent.newestPrompt);
    });

    test("keeps the current prompt active throughout a long live assistant turn", async ({
      page,
    }) => {
      const prompt = "chat outline live turn reading position";
      await agent.client.sendAgentMessage(agent.agentId, prompt);
      try {
        await expectLiveTurnPromptAboveFoldAndActive(page, prompt, LOADED_TURNS + 1);
      } finally {
        await agent.client.waitForFinish(agent.agentId, 15_000);
      }
    });
  });

  test.describe("with virtualized loaded history", () => {
    let agent: LongTimelineAgent;

    test.beforeAll(async () => {
      test.setTimeout(120_000);
      agent = await seedLongMockAgentTimeline({ turns: 80 });
    });

    test.afterAll(async () => {
      await agent.cleanup();
    });

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(WIDE_VIEWPORT);
    });

    test("pins a loaded prompt inside the virtualized block without fetching", async ({ page }) => {
      const history = await holdOlderHistoryPages(page, agent);
      await openAgentTimeline(page, agent);
      await expectChatOutlinePrompts(page, 80);
      await scrollThroughOlderHistoryPages(page, 2, history);
      await scrollTimelineToNewestLoadedEdge(page);
      const requestsBeforeJump = history.requestCount();

      await clickChatOutlineRowEdge(page, 30);
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[29]);

      expect(history.requestCount()).toBe(requestsBeforeJump);
    });

    test("pins a newer loaded prompt when jumping downward from old history", async ({ page }) => {
      const history = await holdOlderHistoryPages(page, agent);
      await openAgentTimeline(page, agent);
      await expectChatOutlinePrompts(page, 80);
      await scrollThroughOlderHistoryPages(page, 2, history);
      await scrollTimelineToNewestLoadedEdge(page);

      await clickChatOutlineRowEdge(page, 30);
      await expectTimelinePromptLandedBelowTop(page, agent.prompts[29]);

      await clickChatOutlineRowEdge(page, 60);

      await expectTimelinePromptLandedBelowTop(page, agent.prompts[59]);
    });
  });

  test("hides the rail when a split makes its panel narrow", async ({ page }) => {
    const agent = await seedLongMockAgentTimeline({ turns: 2 });
    try {
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);

      await splitCurrentPanelRight(page);

      await expectNoChatOutline(page);
    } finally {
      await agent.cleanup();
    }
  });

  test("can be disabled from Appearance settings", async ({ page }) => {
    const agent = await seedLongMockAgentTimeline({ turns: 2 });
    try {
      await page.setViewportSize(WIDE_VIEWPORT);
      await openAgentTimeline(page, agent);

      await disableChatOutlineFromAppearance(page);

      await expectNoChatOutline(page);
    } finally {
      await agent.cleanup();
    }
  });
});

test("indexes a new agent's prompts only once the agent exists", async ({ page }) => {
  const promptIndex = await observePromptIndexRequests(page);
  const creation = await createCreationScenario(page);
  try {
    await page.setViewportSize(WIDE_VIEWPORT);
    await creation.openAgentDraft();
    await creation.submitPrompt("Start an agent with an outline.");
    await creation.expectPromptVisible();

    const agentIds = await creation.agentIds();
    expect(agentIds).toHaveLength(1);
    await promptIndex.waitForRequestFor(agentIds[0]!);
    expect(promptIndex.requestedAgentIds()).toEqual(agentIds);
  } finally {
    await creation.cleanup();
  }
});
