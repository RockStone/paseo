import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { scrollChatAwayFromBottom } from "../support/helpers/agent-bottom-anchor";
import { gateSecondToolCall } from "../support/helpers/tool-call-gate";
import { expectComposerVisible } from "../support/helpers/composer";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  readReactRenders,
  recordReactRenders,
  resetReactRenders,
} from "../support/helpers/react-renders";

type WebSocketMessage = string | Buffer;

const COMPACT_VIEWPORT = { width: 390, height: 520 };

function parseSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { type?: unknown; message?: unknown };
    return envelope.type === "session" && envelope.message && typeof envelope.message === "object"
      ? (envelope.message as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getToolCallStatus(
  message: WebSocketMessage,
  agentId: string,
): { callId: string; status: string } | null {
  const sessionMessage = parseSessionMessage(message);
  if (sessionMessage?.type !== "agent_stream") {
    return null;
  }
  const payload = sessionMessage.payload as Record<string, unknown> | undefined;
  if (payload?.agentId !== agentId) {
    return null;
  }
  const event = payload.event as Record<string, unknown> | undefined;
  const item = event?.item as Record<string, unknown> | undefined;
  return event?.type === "timeline" &&
    item?.type === "tool_call" &&
    typeof item.callId === "string" &&
    typeof item.status === "string"
    ? { callId: item.callId, status: item.status }
    : null;
}

function cloneToolCallWithId(
  message: WebSocketMessage,
  callId: string,
  sequenceOffset: number,
): string {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  const envelope = JSON.parse(raw) as {
    message?: { payload?: { seq?: number; event?: { item?: { callId?: string } } } };
  };
  const payload = envelope.message?.payload;
  const item = payload?.event?.item;
  if (!payload || !item?.callId || typeof payload.seq !== "number") {
    throw new Error("Expected a tool-call session message");
  }
  item.callId = callId;
  payload.seq += sequenceOffset;
  return JSON.stringify(envelope);
}

function shiftTimelineSequence(
  message: WebSocketMessage,
  sequenceOffset: number,
): WebSocketMessage {
  if (sequenceOffset === 0) {
    return message;
  }
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { message?: { payload?: { seq?: number } } };
    const payload = envelope.message?.payload;
    if (typeof payload?.seq !== "number") {
      return message;
    }
    payload.seq += sequenceOffset;
    return JSON.stringify(envelope);
  } catch {
    return message;
  }
}

async function holdStreamAfterFirstCompletedToolCall(page: Page, agentId: string) {
  let firstCallId: string | null = null;
  let firstCompletedMessage: WebSocketMessage | null = null;
  let isHolding = false;
  let sequenceOffset = 0;
  const heldMessages: WebSocketMessage[] = [];
  let sendToPage: ((message: WebSocketMessage) => void) | null = null;
  let resolveFirstCompleted!: () => void;
  const firstCompleted = new Promise<void>((resolve) => {
    resolveFirstCompleted = resolve;
  });

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    sendToPage = (message) => ws.send(message);
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (isHolding) {
        heldMessages.push(message);
        return;
      }

      ws.send(shiftTimelineSequence(message, sequenceOffset));
      const toolCall = getToolCallStatus(message, agentId);
      firstCallId ??= toolCall?.callId ?? null;
      if (toolCall?.callId === firstCallId && toolCall.status === "completed") {
        firstCompletedMessage = message;
        isHolding = true;
        resolveFirstCompleted();
      }
    });
  });

  function appendCompletedCalls(extraCompletedCalls: number) {
    if (extraCompletedCalls > 0 && (!firstCallId || !firstCompletedMessage)) {
      throw new Error("Expected the first completed tool call before release");
    }
    for (let index = 0; index < extraCompletedCalls; index += 1) {
      sendToPage?.(
        cloneToolCallWithId(
          firstCompletedMessage as WebSocketMessage,
          `${firstCallId}:${sequenceOffset + index}`,
          sequenceOffset + index + 1,
        ),
      );
    }
    sequenceOffset += extraCompletedCalls;
  }
  return {
    waitForFirstCompleted: () => firstCompleted,
    appendCompletedCalls,
    release(extraCompletedCalls = 0) {
      isHolding = false;
      appendCompletedCalls(extraCompletedCalls);
      for (const message of heldMessages.splice(0)) {
        sendToPage?.(shiftTimelineSequence(message, sequenceOffset));
      }
    },
  };
}

type OverviewChatDisplay = "collapseToolCalls" | "collapseTurns";

// Expand thinking keeps reasoning out of tool call runs, so the first tool call starts alone.
async function configureOverviewToolCalls(page: Page, chatDisplay: OverviewChatDisplay) {
  await page.addInitScript((display) => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ chatDisplay: display, autoExpandReasoning: true }),
    );
  }, chatDisplay);
}

async function createOverviewAgent(
  page: Page,
  title: string,
  chatDisplay: OverviewChatDisplay = "collapseToolCalls",
) {
  await configureOverviewToolCalls(page, chatDisplay);
  return seedMockAgentWorkspace({
    repoPrefix: "tool-call-overview-sheet-",
    title,
    model: "ten-second-stream",
  });
}

async function openOverviewAgent(
  page: Page,
  agent: Awaited<ReturnType<typeof seedMockAgentWorkspace>>,
): Promise<void> {
  await openAgentRoute(page, {
    workspaceId: agent.workspaceId,
    agentId: agent.agentId,
  });
  await expectComposerVisible(page);
}

function hasScrolledToLatest(root: HTMLElement): boolean {
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.scrollHeight <= node.clientHeight) {
      continue;
    }
    const maximumScrollTop = node.scrollHeight - node.clientHeight;
    return maximumScrollTop > 0 && Math.abs(node.scrollTop - maximumScrollTop) <= 1;
  }
  return false;
}

function readScrollMetrics(root: HTMLElement) {
  const badgeElements = root.querySelectorAll<HTMLElement>("[data-testid=tool-call-badge]");
  const latestBadge = badgeElements.item(badgeElements.length - 1);
  const scrollables = [];
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.scrollHeight <= node.clientHeight) {
      continue;
    }
    scrollables.push({
      className: node.className,
      clientHeight: node.clientHeight,
      rect: node.getBoundingClientRect().toJSON(),
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
      tagName: node.tagName,
    });
  }
  return {
    latestBadgeRect: latestBadge?.getBoundingClientRect().toJSON(),
    rootRect: root.getBoundingClientRect().toJSON(),
    scrollables,
    viewport: { height: window.innerHeight, width: window.innerWidth },
  };
}

const FIRST_CALL_DETAILS = "export function ConversationList()";

function firstToolCall(page: Page): Locator {
  return page.getByTestId("tool-call-badge").filter({ hasText: "conversation-list.tsx" }).first();
}

async function openToolDetails(badge: Locator): Promise<void> {
  await badge.getByRole("button").first().click();
}

async function timelineRowOf(locator: Locator) {
  const row = await locator.locator("xpath=ancestor::*[@data-history-row-id][1]").elementHandle();
  if (!row) throw new Error("Expected the locator inside a timeline row");
  return row;
}

/** Whether the locator renders inside this exact row node, i.e. the row was not remounted. */
async function isInsideRow(
  locator: Locator,
  row: Awaited<ReturnType<typeof timelineRowOf>>,
): Promise<boolean> {
  return locator.evaluate((node, previousRow) => previousRow.contains(node), row);
}

async function topOf(row: Locator): Promise<number> {
  const box = await row.boundingBox();
  if (!box) throw new Error("Expected a visible timeline row");
  return box.y;
}

test.describe("compact overview tool calls", () => {
  test.use({ viewport: COMPACT_VIEWPORT, hasTouch: true });

  test("keeps a live group sheet current and stacks individual details above it", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const agent = await createOverviewAgent(page, "Compact overview tool calls");

    try {
      const gate = await holdStreamAfterFirstCompletedToolCall(page, agent.agentId);
      await openOverviewAgent(page, agent);
      await agent.client.sendAgentMessage(agent.agentId, "Exercise the overview tool-call sheet.");
      await gate.waitForFirstCompleted();

      const single = firstToolCall(page);
      await expect(single).toBeVisible();
      await expect(page.getByTestId("tool-call-group")).toHaveCount(0);
      await openToolDetails(single);
      await expect(page.getByTestId("tool-call-sheet-close")).toBeVisible();
      await page.getByTestId("tool-call-sheet-close").click();
      gate.appendCompletedCalls(1);
      const group = page.getByTestId("tool-call-group").first();
      await expect(group).toBeVisible();
      await expect(page.getByTestId("tool-call-group-sheet")).toBeHidden();
      await group.click();

      const sheet = page.getByTestId("tool-call-group-sheet");
      const summary = page.getByTestId("tool-call-group-sheet-summary");
      await expect(sheet).toBeVisible();
      const initialSummary = await summary.innerText();

      gate.release(10);
      const badges = sheet.getByTestId("tool-call-badge");
      await expect.poll(() => badges.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(11);
      await expect(summary).not.toHaveText(initialSummary);
      await expect.poll(() => sheet.evaluate(hasScrolledToLatest)).toBe(true);
      const scrollMetrics = await sheet.evaluate(readScrollMetrics);
      await testInfo.attach("compact-overview-scroll-metrics", {
        body: JSON.stringify(scrollMetrics, null, 2),
        contentType: "application/json",
      });

      await badges.last().click();
      const detailClose = page.getByTestId("tool-call-sheet-close");
      await expect(detailClose).toBeVisible();

      await detailClose.click();
      await expect(detailClose).toBeHidden();
      await expect(sheet).toBeVisible();

      await testInfo.attach("compact-overview-tool-call-group", {
        body: await page.screenshot(),
        contentType: "image/png",
      });

      await page.getByTestId("tool-call-group-sheet-close").click();
      await expect(sheet).toBeHidden();
      await expect(group).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });
});

for (const display of ["collapseToolCalls", "collapseTurns"] as const) {
  test(`keeps an opened lone tool call open when it becomes a group (${display})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const agent = await createOverviewAgent(page, "Desktop overview tool calls", display);
    await recordReactRenders(page);
    try {
      const gate = await gateSecondToolCall(page, agent.agentId);
      await openOverviewAgent(page, agent);
      await agent.client.sendAgentMessage(agent.agentId, "Exercise desktop overview tool calls.");
      await gate.waitForFirstCompleted();
      const lone = firstToolCall(page);
      const group = page.getByTestId("tool-call-group").first();
      const details = page.getByText(FIRST_CALL_DETAILS);

      await test.step("a lone tool call shows as itself", async () => {
        await expect(lone).toBeVisible();
        await expect(group).toHaveCount(0);
      });

      await gate.waitForSecondRunning();
      await test.step("opening it re-renders that tool call and nothing else", async () => {
        await resetReactRenders(page);
        await openToolDetails(lone);
        await expect(details).toBeVisible();
        const renders = await readReactRenders(page);
        expect(renders.AgentStreamView ?? 0).toBe(0);
        expect(renders.StreamRowContent ?? 0).toBe(0);
        expect(renders.ToolCall).toBe(1);
      });

      await test.step("the second call forms an open group around the opened call", async () => {
        // Reading above the tail, the row holds still; at the tail the new rows push it up.
        await scrollChatAwayFromBottom(page, { deltaY: -160, minDistanceFromBottom: 72 });
        const loneTop = await topOf(lone);
        const loneRow = await timelineRowOf(lone);
        await resetReactRenders(page);
        gate.releaseSecondRunning();
        await expect(group.getByTestId("tool-call-badge")).toHaveCount(2);
        await expect(group.getByText(FIRST_CALL_DETAILS)).toBeVisible();
        expect(await isInsideRow(group, loneRow)).toBe(true);
        expect(Math.abs((await topOf(group)) - loneTop)).toBeLessThanOrEqual(2);
        expect((await readReactRenders(page)).AgentStreamView).toBeGreaterThan(0);
        await expect(page.getByTestId("tool-call-group-sheet")).toHaveCount(0);
      });

      await test.step("closing and reopening the group keeps the call open", async () => {
        await openToolDetails(group);
        await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);
        await expect(details).toHaveCount(0);
        await openToolDetails(group);
        await expect(group.getByTestId("tool-call-badge")).toHaveCount(2);
        await expect(group.getByText(FIRST_CALL_DETAILS)).toBeVisible();
      });

      await test.step("Collapse all closes the group; Expand thinking keeps tools closed", async () => {
        await page
          .getByTestId("workspace-tabs-row")
          .getByRole("button", { name: "Desktop overview tool calls", exact: true })
          .hover();
        const toggle = page.getByTestId(`workspace-tab-sections-${agent.agentId}`);
        await expect(toggle).toHaveAttribute("aria-label", "Collapse all sections");
        await toggle.click();
        await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);
        await expect(toggle).toHaveAttribute("aria-label", "Expand thinking");
        await toggle.click();
        await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);
      });
    } finally {
      await agent.cleanup();
    }
  });
}

test("forms a closed group when the lone tool call was left closed", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await createOverviewAgent(page, "Closed desktop overview tool calls");
  try {
    const gate = await gateSecondToolCall(page, agent.agentId);
    await openOverviewAgent(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Leave the first tool call closed.");
    await gate.waitForFirstCompleted();
    const lone = firstToolCall(page);
    const group = page.getByTestId("tool-call-group").first();
    await expect(lone).toBeVisible();
    await expect(group).toHaveCount(0);

    await gate.waitForSecondRunning();
    const loneTop = await topOf(lone);
    gate.releaseSecondRunning();
    await expect(group).toBeVisible();
    await expect(group.getByTestId("tool-call-badge")).toHaveCount(0);
    expect(Math.abs((await topOf(group)) - loneTop)).toBeLessThanOrEqual(2);
  } finally {
    await agent.cleanup();
  }
});

test("overlapping native task updates keep each row and its expanded details attached", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ chatDisplay: "full" }));
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "overlapping-native-tasks-",
    title: "Overlapping native tasks",
    model: "ten-second-stream",
  });
  let template: { message: Extract<SessionOutboundMessage, { type: "agent_stream" }> } | null =
    null;
  let send: ((message: string) => void) | null = null;
  let sequence: number | undefined;
  const labels = ["Sound loop", "Visual rebuild", "Driver-view clip"];
  const update = (index: number, progress: number) => {
    if (!template || !send) throw new Error("Expected the mock tool stream");
    const envelope = structuredClone(template);
    if (sequence !== undefined) envelope.message.payload.seq = sequence++;
    envelope.message.payload.event = {
      type: "timeline",
      provider: "claude",
      turnId: index < 2 ? "native-turn-40" : "native-turn-41",
      item: {
        type: "tool_call",
        callId: `native-task-${index}`,
        name: "Agent",
        status: "running",
        error: null,
        detail: {
          type: "sub_agent",
          description: labels[index],
          log: `unique-task-output-${index}-${progress}`,
          actions: [],
        },
      },
    };
    send(JSON.stringify(envelope));
  };
  try {
    await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
      const server = socket.connectToServer();
      send = (message) => socket.send(message);
      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        const session = parseSessionMessage(message);
        if (session?.type === "agent_stream") {
          const payload = session.payload as Extract<
            SessionOutboundMessage,
            { type: "agent_stream" }
          >["payload"];
          if (payload.agentId === agent.agentId) {
            if (template) return;
            if (payload.event.type === "timeline" && payload.event.item.type === "tool_call") {
              template = JSON.parse(message.toString());
              sequence = payload.seq;
              return;
            }
          }
        }
        socket.send(message);
      });
    });
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    await agent.client.sendAgentMessage(agent.agentId, "Exercise native task identity.");
    await expect.poll(() => template !== null, { timeout: 30_000 }).toBe(true);
    labels.forEach((_, index) => update(index, 0));
    const badges = page
      .getByTestId("tool-call-badge")
      .filter({ hasText: /Sound loop|Visual rebuild|Driver-view clip/ });
    await expect(badges).toHaveCount(3);
    for (let progress = 1; progress <= 60; progress += 1) update(progress % 3, progress);
    await expect(badges).toHaveCount(3);
    for (const [index, label] of labels.entries()) {
      const badge = badges.filter({ hasText: label });
      await expect(badge).toHaveCount(1);
      await badge.getByRole("button").first().click();
      const latest = 60 - ((60 - index + 3) % 3);
      await expect(
        badge.getByText(`unique-task-output-${index}-${latest}`, { exact: true }),
      ).toBeVisible();
      await expect(badge).not.toContainText(`unique-task-output-${(index + 1) % 3}-`);
      await badge.getByRole("button").first().click();
    }
    await page.screenshot({ path: testInfo.outputPath("overlapping-native-task-rows.png") });
  } finally {
    await agent.cleanup();
  }
});
