import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

type WebSocketMessage = string | Buffer;

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

function replaceToolCallStatus(message: WebSocketMessage, status: string): string {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  const envelope = JSON.parse(raw) as {
    message?: { payload?: { event?: { item?: { status?: string } } } };
  };
  const item = envelope.message?.payload?.event?.item;
  if (!item) {
    throw new Error("Expected a tool-call session message");
  }
  item.status = status;
  return JSON.stringify(envelope);
}

async function gateSecondToolCall(page: Page, agentId: string) {
  let firstCallId: string | null = null;
  let secondCallId: string | null = null;
  let secondRunningMessage: WebSocketMessage | null = null;
  let pauseAfterSecondRunning = false;
  let releaseSecondRequested = false;
  let forwardSecondRunning: (() => void) | null = null;
  let resolveFirstCompleted!: () => void;
  let resolveSecondRunning!: () => void;
  const firstCompleted = new Promise<void>((resolve) => {
    resolveFirstCompleted = resolve;
  });
  const secondRunning = new Promise<void>((resolve) => {
    resolveSecondRunning = resolve;
  });

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    forwardSecondRunning = () => {
      if (secondRunningMessage) {
        ws.send(secondRunningMessage);
        secondRunningMessage = null;
      }
    };
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (pauseAfterSecondRunning) {
        return;
      }

      const toolCall = getToolCallStatus(message, agentId);
      if (!toolCall) {
        ws.send(message);
        return;
      }

      if (!firstCallId) {
        firstCallId = toolCall.callId;
      }
      if (toolCall.callId === firstCallId) {
        ws.send(message);
        if (toolCall.status === "completed") {
          resolveFirstCompleted();
        }
        return;
      }

      secondCallId ??= toolCall.callId;
      if (toolCall.callId === secondCallId) {
        const transformedMessage =
          toolCall.status === "completed" ? replaceToolCallStatus(message, "running") : message;
        secondRunningMessage = transformedMessage;
        pauseAfterSecondRunning = true;
        resolveSecondRunning();
        if (releaseSecondRequested) {
          forwardSecondRunning?.();
        }
        return;
      }

      ws.send(message);
    });
  });

  return {
    waitForFirstCompleted: () => firstCompleted,
    waitForSecondRunning: () => secondRunning,
    releaseSecondRunning() {
      releaseSecondRequested = true;
      forwardSecondRunning?.();
    },
  };
}

test("overview labels stay muted when a retained group becomes loading", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ toolCallDetailLevel: "overview" }),
    );
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "tool-call-shimmer-",
    title: "Tool-call shimmer",
    model: "ten-second-stream",
  });

  try {
    const gate = await gateSecondToolCall(page, agent.agentId);
    await openAgentRoute(page, {
      workspaceId: agent.workspaceId,
      agentId: agent.agentId,
    });
    await expectComposerVisible(page);
    await agent.client.sendAgentMessage(agent.agentId, "Prove the overview shimmer lifecycle.");

    await gate.waitForFirstCompleted();
    const group = page.getByTestId("tool-call-group").first();
    await expect(group).toBeVisible();
    const idleGroupHandle = await group.elementHandle();
    if (!idleGroupHandle) {
      throw new Error("Expected the idle tool-call group to be mounted");
    }
    await expect(group.locator('[style*="paseo-toolcall-shimmer"]')).toHaveCount(0);

    await gate.waitForSecondRunning();
    gate.releaseSecondRunning();
    await expect(group.locator('[style*="paseo-toolcall-shimmer"]')).toHaveCount(0);
    const sameGroupNode = await group.evaluate(
      (node, previous) => node === previous,
      idleGroupHandle,
    );

    await group.click();
    const runningChild = page.getByTestId("tool-call-badge").last();
    await expect(runningChild).toBeVisible();
    const header = group.locator('[dir="auto"]').first();
    const color = await header.evaluate((element) => getComputedStyle(element).color);
    await expect(runningChild.locator('[dir="auto"]').first()).toHaveCSS("color", color);
    await expect(runningChild.locator('[style*="paseo-toolcall-shimmer"]')).toHaveCount(0);
    expect(sameGroupNode).toBe(true);
  } finally {
    await agent.cleanup();
  }
});

test("thinking stays muted and trims trailing blank lines without removing paragraph breaks", async ({
  page,
}) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "thinking-spacing-",
    title: "Thinking spacing",
    model: "ten-second-stream",
  });
  await agent.client.sendAgentMessage(agent.agentId, "Check thinking presentation.");
  await agent.client.waitForFinish(agent.agentId, 30_000);
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ autoExpandReasoning: true }));
  });
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const raw = typeof message === "string" ? message : message.toString("utf8");
      const envelope = JSON.parse(raw);
      const payload = envelope.message?.payload;
      if (payload?.agentId === agent.agentId && payload.entries) {
        for (const entry of payload.entries) {
          if (entry.item?.type === "reasoning") {
            entry.item.text = "First thought.\n\nFinal thought.\n\n";
          }
        }
        ws.send(JSON.stringify(envelope));
      } else ws.send(message);
    });
  });
  try {
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    const badge = page.getByTestId("tool-call-badge").filter({ hasText: "Thinking" }).first();
    await expect(badge).toBeVisible();
    const body = badge.getByText("First thought.\n\nFinal thought.", { exact: true });
    if (!(await body.isVisible())) await badge.getByRole("button").first().click();
    await expect(body).toBeVisible();
    expect(await body.textContent()).toBe("First thought.\n\nFinal thought.");
    const command = page.getByTestId("tool-call-badge").getByText("Read", { exact: true }).first();
    await expect(command).toBeVisible();
    const color = await command.evaluate((element) => getComputedStyle(element).color);
    await expect(body).toHaveCSS("color", color);
    await expect(badge.getByText("Thinking", { exact: true })).toHaveCSS("color", color);
    const bottomGap = await body.evaluate((element) => {
      const thinkingBadge = element.closest('[data-testid="tool-call-badge"]');
      if (!thinkingBadge) throw new Error("Missing thinking badge");
      return thinkingBadge.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom;
    });
    expect(bottomGap).toBeLessThanOrEqual(14);
    await badge.screenshot({ path: "/tmp/paseoi-r55-thinking.png" });
  } finally {
    await agent.cleanup();
  }
});

test("tool labels and expanded shell output stay muted while agent messages stay emphasized", async ({
  page,
}) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "tool-tones-",
    title: "Tool tones",
    model: "ten-second-stream",
  });
  try {
    await agent.client.sendAgentMessage(agent.agentId, "Show the implementation and checks.");
    await agent.client.waitForFinish(agent.agentId, 30000);
    await page.addInitScript(() => {
      localStorage.setItem(
        "@paseo:app-settings",
        JSON.stringify({ toolCallDetailLevel: "detailed" }),
      );
    });
    await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => server.send(message));
      server.onMessage((raw) => {
        const envelope = JSON.parse(raw.toString());
        const payload = envelope.message?.payload;
        if (payload?.agentId === agent.agentId && payload.entries) {
          for (const entry of payload.entries) {
            if (entry.item?.type !== "tool_call") continue;
            if (entry.item.name === "read")
              entry.item.agentMessage = {
                event: "message",
                sender: { id: "peer", title: "Peer agent" },
                text: "Ready for review.",
              };
            if (entry.item.name === "grep") {
              entry.item.name = "mcp__paseo__send_agent_prompt";
              entry.item.detail = {
                type: "unknown",
                input: { agentId: "peer", prompt: "Please review this." },
                output: { status: "idle" },
              };
            }
            if (entry.item.name === "edit") {
              entry.item.name = "task_notification";
              entry.item.provider = "claude";
              entry.item.detail = {
                type: "plain_text",
                text: "Background command completed.",
              };
            }
          }
          ws.send(JSON.stringify(envelope));
        } else ws.send(raw);
      });
    });
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    const scroller = page.getByTestId("agent-chat-scroll").first();
    await scroller.hover();
    await page.mouse.wheel(0, -20_000);
    const badges = page.getByTestId("tool-call-badge");
    const thinking = badges.filter({ has: page.getByText("Thinking", { exact: true }) }).first();
    const muted = await thinking
      .getByText("Thinking", { exact: true })
      .evaluate((element) => getComputedStyle(element).color);
    const received = badges
      .filter({ has: page.getByText("Message received", { exact: true }) })
      .first();
    const foreground = await received
      .getByText("Message received", { exact: true })
      .evaluate((element) => getComputedStyle(element).color);
    expect(foreground).not.toBe(muted);
    await expect(received.getByText("Peer agent", { exact: true })).toHaveCSS("color", foreground);
    await received.getByRole("button").first().click();
    await expect(received.getByText(/Ready for review/)).toHaveCSS("color", foreground);
    await expect(received.getByText("Message received", { exact: true })).toHaveCSS(
      "color",
      foreground,
    );
    await received.getByRole("button").first().click();
    await expect(received.getByText("Message received", { exact: true })).toHaveCSS(
      "color",
      foreground,
    );
    const sent = badges.filter({ has: page.getByText("Send message", { exact: true }) }).first();
    await expect(sent.getByText("Send message", { exact: true })).toHaveCSS("color", foreground);
    const notification = badges
      .filter({ has: page.getByText("Task notification", { exact: true }) })
      .first();
    await expect(notification.getByText("Task notification", { exact: true })).toHaveCSS(
      "color",
      muted,
    );
    await notification.getByRole("button").first().click();
    await expect(
      notification.getByText("Background command completed.", { exact: true }),
    ).toHaveCSS("color", muted);
    const shell = badges.filter({ has: page.getByText("Shell", { exact: true }) }).first();
    await shell.hover();
    await expect(shell.getByText("Shell", { exact: true })).toHaveCSS("color", muted);
    await expect
      .poll(() =>
        shell
          .locator("svg")
          .first()
          .evaluate((element) => getComputedStyle(element).stroke),
      )
      .toBe(foreground);
    await shell.getByRole("button").first().click();
    await expect(shell.getByText(/\[burst\] tick 1/).first()).toHaveCSS("color", muted);
    await expect(shell.getByText("Shell", { exact: true })).toHaveCSS("color", muted);
  } finally {
    await agent.cleanup();
  }
});
