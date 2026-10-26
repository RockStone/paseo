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

async function gateSecondToolCall(page: Page, agentId: string, shell = false) {
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
      if (shell && toolCall) {
        const envelope = JSON.parse(message.toString());
        envelope.message.payload.event.item.detail = {
          type: "shell",
          command: `shell-${toolCall.callId}`,
          output: "",
        };
        message = JSON.stringify(envelope);
      }
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
    await page
      .getByTestId("workspace-tabs-row")
      .getByRole("button", { name: "Tool tones", exact: true })
      .hover();
    const collapse = page.getByTestId(`workspace-tab-sections-${agent.agentId}`);
    await expect(collapse).toHaveAttribute("aria-label", "Collapse all sections");
    await collapse.click();
    await expect(shell.getByRole("button").first()).toHaveAttribute("aria-expanded", "false");
    await expect(notification.getByRole("button").first()).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(thinking.getByRole("button").first()).toHaveAttribute("aria-expanded", "false");
    await shell.getByRole("button").first().click();
    await page
      .getByTestId("workspace-tabs-row")
      .getByRole("button", { name: "Tool tones", exact: true })
      .hover();
    await expect(collapse).toHaveAttribute("aria-label", "Collapse all sections");
    await collapse.click();
    await expect(shell.getByRole("button").first()).toHaveAttribute("aria-expanded", "false");
    await expect(collapse).toHaveAttribute("aria-label", "Expand thinking");
    await collapse.click();
    await expect(thinking.getByRole("button").first()).toHaveAttribute("aria-expanded", "true");
    await expect(shell.getByRole("button").first()).toHaveAttribute("aria-expanded", "false");
    await expect(notification.getByRole("button").first()).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  } finally {
    await agent.cleanup();
  }
});

test("running foreground Shell shimmers while completed Shell stays static", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ toolCallDetailLevel: "detailed" }),
    );
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "foreground-shell-shimmer-",
    title: "Foreground Shell shimmer",
    model: "ten-second-stream",
  });
  try {
    const gate = await gateSecondToolCall(page, agent.agentId, true);
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    await agent.client.sendAgentMessage(agent.agentId, "Check foreground Shell animation.");
    await gate.waitForFirstCompleted();
    const shells = page.getByTestId("tool-call-badge").filter({ hasText: "Shell" });
    await expect(shells).toHaveCount(1);
    await expect(shells.first().locator('[style*="paseo-toolcall-shimmer"]')).toHaveCount(0);
    await gate.waitForSecondRunning();
    gate.releaseSecondRunning();
    await expect(shells).toHaveCount(2);
    await expect(shells.last().locator('[style*="paseo-toolcall-shimmer"]').first()).toBeVisible();
    await expect(shells.first().locator('[style*="paseo-toolcall-shimmer"]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("foreground-shell-shimmer.png") });
  } finally {
    await agent.cleanup();
  }
});

test("background Shell shimmer follows live task IDs through replacement and completion", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "background-shell-shimmer-",
    title: "Background Shell shimmer",
    model: "ten-second-stream",
  });
  let taskIds = ["job-a"];
  const taskByCall = new Map<string, string>();
  function replaceSnapshot(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(replaceSnapshot);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.id === agent.agentId && record.status === "idle") {
      record.backgroundTaskCount = taskIds.length;
      record.backgroundTaskIds = taskIds;
    }
    Object.values(record).forEach(replaceSnapshot);
  }
  await page.addInitScript(() => {
    localStorage.setItem(
      "@paseo:app-settings",
      JSON.stringify({ toolCallDetailLevel: "detailed" }),
    );
  });
  try {
    await agent.client.sendAgentMessage(agent.agentId, "Check background Shell animation.");
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        const envelope = JSON.parse(message.toString());
        replaceSnapshot(envelope);
        const payload = envelope.message?.payload;
        if (payload?.agentId === agent.agentId && payload.entries) {
          for (const entry of payload.entries) {
            const item = entry.item;
            if (item?.type !== "tool_call") continue;
            if (!taskByCall.has(item.callId))
              taskByCall.set(
                item.callId,
                ["job-a", "job-b"][taskByCall.size] ?? `job-extra-${taskByCall.size}`,
              );
            const taskId = taskByCall.get(item.callId);
            item.name = "Bash";
            item.status = "completed";
            item.detail = {
              type: "shell",
              command: `run-${taskId}`,
              output: `Command running in background with ID: ${taskId}. Output is being written to: /tmp/${taskId}.output.`,
            };
          }
        }
        socket.send(JSON.stringify(envelope));
      });
    });
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    const scroller = page.getByTestId("agent-chat-scroll").first();
    await scroller.hover();
    await page.mouse.wheel(0, -20_000);
    const a = page.getByTestId("tool-call-badge").filter({ hasText: "run-job-a" });
    const b = page.getByTestId("tool-call-badge").filter({ hasText: "run-job-b" });
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();
    await expect(a.locator('[style*="paseo-toolcall-shimmer"]').first()).toBeVisible();
    await expect(b.locator('[style*="paseo-toolcall-shimmer"]')).toHaveCount(0);
    await a.getByRole("button").first().click();
    await expect(a.getByRole("button").first()).toHaveAttribute("aria-expanded", "true");
    await expect(a.getByTestId("shell-command-stop")).toBeVisible();
    await b.getByRole("button").first().click();
    await expect(b.getByTestId("shell-command-stop")).toHaveCount(0);
    await page.reload();
    await scroller.hover();
    await page.mouse.wheel(0, -20_000);
    await expect(a.locator('[style*="paseo-toolcall-shimmer"]').first()).toBeVisible();
    await a.getByRole("button").first().click();
    await b.getByRole("button").first().click();
    taskIds = ["job-b"];
    await agent.client.updateAgent(agent.agentId, { name: "Second background task" });
    await expect(a.locator('[style*="paseo-toolcall-shimmer"]')).toHaveCount(0);
    await expect(b.locator('[style*="paseo-toolcall-shimmer"]').first()).toBeVisible();
    await expect(a.getByTestId("shell-command-stop")).toHaveCount(0);
    await expect(b.getByTestId("shell-command-stop")).toBeVisible();
    await b.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("background-shell-shimmer.png") });
    taskIds = [];
    await agent.client.updateAgent(agent.agentId, { name: "Background tasks finished" });
    await expect(b.locator('[style*="paseo-toolcall-shimmer"]')).toHaveCount(0);
    await expect(b.getByTestId("shell-command-stop")).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 720 },
  { name: "compact", width: 390, height: 844 },
]) {
  test(`expanded Shell can stop its exact command, shows pending and supports retry after failure (${viewport.name})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() => {
      localStorage.setItem(
        "@paseo:app-settings",
        JSON.stringify({ toolCallDetailLevel: "detailed" }),
      );
    });
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "shell-stop-",
      title: "Stop selected Shell",
      model: "ten-second-stream",
    });
    let attempts = 0;
    let held = false;
    const queued: WebSocketMessage[] = [];
    let release = () => {};
    const requests: Record<string, unknown>[] = [];
    await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
      const server = ws.connectToServer();
      release = () => {
        held = false;
        for (const message of queued.splice(0)) ws.send(message);
      };
      ws.onMessage((message) => {
        const request = parseSessionMessage(message);
        if (request?.type === "agent.shell.stop.request") {
          requests.push(request);
          attempts++;
          if (attempts === 1) {
            ws.send(
              JSON.stringify({
                type: "session",
                message: {
                  type: "agent.shell.stop.response",
                  payload: {
                    requestId: request.requestId,
                    agentId: request.agentId,
                    toolCallId: request.toolCallId,
                    ok: false,
                    error: "Provider refused stop. Try again.",
                  },
                },
              }),
            );
            return;
          }
          held = true;
        }
        server.send(message);
      });
      server.onMessage((message) => {
        if (held) queued.push(message);
        else ws.send(message);
      });
    });
    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);
      await agent.client.sendAgentMessage(
        agent.agentId,
        "replay a claude-shaped foreground shell tool call",
      );
      const shell = page.getByTestId("tool-call-badge").filter({ hasText: "Shell" });
      await expect(shell).toBeVisible();
      await expect(page.getByTestId("shell-command-stop")).toHaveCount(0);
      await shell.getByRole("button").first().click();
      const stop = page.getByTestId("shell-command-stop");
      await expect(stop).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("shell-stop-expanded.png") });
      await stop.click();
      await expect(page.getByTestId("shell-command-stop-error")).toHaveText(
        "Provider refused stop. Try again.",
      );
      await expect(stop).toBeEnabled();
      await stop.click();
      await expect(stop).toBeDisabled();
      await expect(stop).toHaveAttribute("aria-busy", "true");
      expect(requests).toHaveLength(2);
      expect(requests[1]).toMatchObject({
        agentId: agent.agentId,
        toolCallId: expect.stringContaining(":steering-replay-shell"),
      });
      expect(requests[0].toolCallId).toBe(requests[1].toolCallId);
      release();
      await expect(page.getByTestId("shell-command-stop-error")).toHaveCount(0);
      await expect(stop).toHaveCount(0);
      await expect(page.getByText("Shell command stopped.", { exact: true })).toBeVisible();
    } finally {
      release();
      await agent.cleanup();
    }
  });
}
