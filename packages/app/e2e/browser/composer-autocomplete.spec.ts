import { seedAgentProfiles } from "../support/helpers/agent-profiles";
import { expectWorkspaceAgentConfiguration } from "../support/helpers/command-center-agent-controls";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { expect, test, type Page } from "../support/fixtures";
import { composerLocator, expectComposerVisible } from "../support/helpers/composer";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { expectWorkspaceTabVisible, openSessions } from "../support/helpers/archive-tab";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { switchWorkspaceViaSidebar } from "../support/helpers/workspace-ui";
import {
  closeMobileAgentSidebar,
  expectMobileAgentSidebarHidden,
  expectMobileAgentSidebarVisible,
  openMobileAgentSidebar,
} from "../support/helpers/sidebar";
import { expectNewWorkspaceProjectSelected } from "../support/helpers/new-workspace";

const TEST_COMMANDS = [
  {
    name: "tdd",
    description: "Write a red test, verify it fails for the right reason, implement to green",
    argumentHint: "",
  },
  {
    name: "help",
    description: "Show help for the current agent session and available slash commands",
    argumentHint: "",
  },
  {
    name: "hello",
    description: "Insert a friendly greeting prompt into the current composer",
    argumentHint: "",
  },
  {
    name: "heapdump",
    description: "Dump the JavaScript heap for local desktop debugging",
    argumentHint: "",
  },
  {
    name: "health",
    description: "Show runtime health checks and connection diagnostics",
    argumentHint: "",
  },
  {
    name: "history",
    description: "Summarize recent session history",
    argumentHint: "",
  },
  {
    name: "handoff",
    description: "Prepare a complete handoff note for another agent",
    argumentHint: "[agent]",
  },
  {
    name: "hover",
    description: "Audit hover behavior in desktop web surfaces",
    argumentHint: "",
  },
  {
    name: "harness",
    description: "Inspect the local test harness configuration",
    argumentHint: "",
  },
  {
    name: "hydrate",
    description: "Refresh persisted state used by the current workspace",
    argumentHint: "",
  },
  {
    name: "highlight",
    description: "Highlight important changes in the active diff",
    argumentHint: "",
  },
  {
    name: "home",
    description: "Navigate back to the workspace home surface",
    argumentHint: "",
  },
  {
    name: "host",
    description: "Inspect host connection metadata",
    argumentHint: "",
  },
] as const;

interface PopoverFrame {
  exists: boolean;
  top: number;
  bottom: number;
  height: number;
  opacity: number;
  display: string;
  visibility: string;
  timestamp: number;
}

interface PopoverFrameRecorderWindow extends Window {
  __composerAutocompleteFrames?: PopoverFrame[];
  __stopComposerAutocompleteFrameRecorder?: () => void;
}

async function installListCommandsStub(page: Page): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      server.send(message);
    });

    server.onMessage((message) => {
      if (typeof message !== "string") {
        ws.send(message);
        return;
      }

      try {
        const parsed = JSON.parse(message) as {
          type?: string;
          message?: {
            type?: string;
            payload?: {
              commands?: unknown;
              error?: string | null;
            };
          };
        };
        if (
          parsed.type === "session" &&
          parsed.message?.type === "list_commands_response" &&
          parsed.message.payload
        ) {
          parsed.message.payload.commands = TEST_COMMANDS;
          parsed.message.payload.error = null;
          ws.send(JSON.stringify(parsed));
          return;
        }
      } catch {
        // Forward non-JSON frames unchanged.
      }

      ws.send(message);
    });
  });
}

async function openAppWideNewWorkspace(page: Page): Promise<void> {
  await page.getByTestId("sidebar-global-new-workspace").first().click();
  await page.waitForURL((url) => url.pathname === "/new", { timeout: 30_000 });
}

async function openSettingsThenBackToWorkspace(page: Page): Promise<void> {
  await page.getByTestId("sidebar-settings").filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/settings\/general$/, { timeout: 30_000 });
  await page.getByTestId("settings-back-to-workspace").click();
  await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 30_000 });
}

async function expectSingleCurrentWorkspaceDeckEntry(
  page: Page,
  input: { expectedDeckEntryCount: number; serverId: string; workspaceId: string },
): Promise<void> {
  const summary = await page
    .locator('[data-testid^="workspace-deck-entry-"]')
    .evaluateAll((elements, target) => {
      const currentTestId = `workspace-deck-entry-${target.serverId}:${target.workspaceId}`;
      const entries = elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          testId: element.getAttribute("data-testid"),
          hasLayout: rect.width > 0 && rect.height > 0,
        };
      });
      const currentEntries = entries.filter((entry) => entry.testId === currentTestId);
      return {
        totalDeckEntryCount: entries.length,
        currentWorkspaceEntryCount: currentEntries.length,
        visibleCurrentWorkspaceEntryCount: currentEntries.filter((entry) => entry.hasLayout).length,
        hiddenCurrentWorkspaceEntryCount: currentEntries.filter((entry) => !entry.hasLayout).length,
      };
    }, input);

  expect(summary).toEqual({
    totalDeckEntryCount: input.expectedDeckEntryCount,
    currentWorkspaceEntryCount: 1,
    visibleCurrentWorkspaceEntryCount: 1,
    hiddenCurrentWorkspaceEntryCount: 0,
  });
}

async function openReadyMockAgent(
  page: Page,
  options?: { expectWorkspaceTab?: boolean },
): Promise<{
  cleanup: () => Promise<void>;
}> {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "autocomplete-popover-",
    title: "Autocomplete popover regression",
  });

  try {
    await openAgentRoute(page, session);
    if (options?.expectWorkspaceTab !== false) {
      await expectWorkspaceTabVisible(page, session.agentId);
    }
    await expectComposerVisible(page);
    return { cleanup: session.cleanup };
  } catch (error) {
    await session.cleanup();
    throw error;
  }
}

async function visiblePopoverBox(
  page: Page,
): Promise<{ top: number; bottom: number; height: number }> {
  const popover = page.getByTestId("composer-autocomplete-popover");
  await expect(popover).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        popover.evaluate((element) => {
          const style = window.getComputedStyle(element);
          return Number(style.opacity);
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0.95);
  const box = await popover.boundingBox();
  if (!box) {
    throw new Error("Autocomplete popover did not produce a bounding box.");
  }
  return {
    top: box.y,
    bottom: box.y + box.height,
    height: box.height,
  };
}

async function startPopoverFrameRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as PopoverFrameRecorderWindow;
    win.__composerAutocompleteFrames = [];
    let active = true;

    const record = () => {
      if (!active) return;

      const element = document.querySelector('[data-testid="composer-autocomplete-popover"]');
      if (element instanceof HTMLElement) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        win.__composerAutocompleteFrames?.push({
          exists: true,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          opacity: Number(style.opacity),
          display: style.display,
          visibility: style.visibility,
          timestamp: performance.now(),
        });
      } else {
        win.__composerAutocompleteFrames?.push({
          exists: false,
          top: 0,
          bottom: 0,
          height: 0,
          opacity: 0,
          display: "none",
          visibility: "hidden",
          timestamp: performance.now(),
        });
      }

      window.requestAnimationFrame(record);
    };

    win.__stopComposerAutocompleteFrameRecorder = () => {
      active = false;
    };
    window.requestAnimationFrame(record);
  });
}

async function stopPopoverFrameRecorder(page: Page): Promise<PopoverFrame[]> {
  return page.evaluate(() => {
    const win = window as PopoverFrameRecorderWindow;
    win.__stopComposerAutocompleteFrameRecorder?.();
    return win.__composerAutocompleteFrames ?? [];
  });
}

function visiblePopoverFrames(frames: PopoverFrame[]): PopoverFrame[] {
  return frames.filter(
    (frame) =>
      frame.exists &&
      frame.height > 0 &&
      frame.opacity > 0.95 &&
      frame.display !== "none" &&
      frame.visibility !== "hidden",
  );
}

function formatFrame(frame: PopoverFrame | undefined): string {
  if (!frame) return "none";
  return JSON.stringify({
    top: Math.round(frame.top),
    bottom: Math.round(frame.bottom),
    height: Math.round(frame.height),
    opacity: frame.opacity,
  });
}

function expectPopoverFramesStable(frames: PopoverFrame[]): void {
  const visibleFrames = visiblePopoverFrames(frames);
  expect(visibleFrames.length).toBeGreaterThan(0);

  const finalFrame = visibleFrames[visibleFrames.length - 1];
  const jumpingFrame = visibleFrames.find(
    (frame) =>
      Math.abs(frame.top - finalFrame.top) > 4 ||
      Math.abs(frame.bottom - finalFrame.bottom) > 4 ||
      Math.abs(frame.height - finalFrame.height) > 4,
  );

  expect(
    jumpingFrame,
    `expected first visible popover paint to be stable; first=${formatFrame(
      visibleFrames[0],
    )} jumping=${formatFrame(jumpingFrame)} final=${formatFrame(finalFrame)}`,
  ).toBeUndefined();
}

function recordCommandRequestsByAgentId(page: Page): string[] {
  const requests: string[] = [];
  const record = ({ payload }: { payload: string | Buffer }) => {
    if (typeof payload !== "string" || !payload.includes("list_commands_request")) return;
    if (!payload.includes("draftConfig")) requests.push(payload);
  };
  page.on("websocket", (socket) => socket.on("framesent", record));
  return requests;
}

function expectPopoverDoesNotDisappearAfterFirstVisible(frames: PopoverFrame[]): void {
  const firstVisibleIndex = frames.findIndex(
    (frame) =>
      frame.exists &&
      frame.height > 0 &&
      frame.opacity > 0.95 &&
      frame.display !== "none" &&
      frame.visibility !== "hidden",
  );
  expect(firstVisibleIndex).toBeGreaterThanOrEqual(0);

  const hiddenFrame = frames
    .slice(firstVisibleIndex)
    .find((frame) => !frame.exists || frame.opacity < 0.95);
  expect(
    hiddenFrame,
    `expected mounted popover to stay visible while filtering; hidden=${formatFrame(hiddenFrame)}`,
  ).toBeUndefined();
}

test.describe("Composer autocomplete", () => {
  test("keeps New workspace off the running-agent command list before a project is chosen", async ({
    page,
  }) => {
    const commandRequestsByAgentId = recordCommandRequestsByAgentId(page);

    await page.goto("/new");
    await expectNewWorkspaceProjectSelected(page, "Choose project");
    await composerLocator(page).fill("/");

    const popover = page
      .getByTestId("composer-autocomplete-popover")
      .filter({ visible: true })
      .first();
    await expect(popover).toContainText("Choose a project to see commands", { timeout: 30_000 });
    await expect(popover).not.toContainText("/clear");
    await expect(popover).not.toContainText("/exit");
    expect(commandRequestsByAgentId).toEqual([]);
  });

  test("stays visible after returning from app-wide routes", async ({ page }) => {
    await installListCommandsStub(page);
    const serverId = getServerId();
    const sessions: MockAgentWorkspace[] = [];

    try {
      sessions.push(
        await seedMockAgentWorkspace({
          repoPrefix: "autocomplete-new-route-a-",
          title: "Autocomplete new route A",
        }),
      );
      sessions.push(
        await seedMockAgentWorkspace({
          repoPrefix: "autocomplete-new-route-b-",
          title: "Autocomplete new route B",
        }),
      );
      sessions.push(
        await seedMockAgentWorkspace({
          repoPrefix: "autocomplete-new-route-c-",
          title: "Autocomplete new route C",
        }),
      );

      const [first, second, third] = sessions;

      await openAgentRoute(page, first);
      await expectComposerVisible(page, { timeout: 30_000 });

      await openAppWideNewWorkspace(page);
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: second.workspaceId });
      await expectComposerVisible(page, { timeout: 30_000 });
      await expectSingleCurrentWorkspaceDeckEntry(page, {
        expectedDeckEntryCount: 2,
        serverId,
        workspaceId: second.workspaceId,
      });

      await openSettingsThenBackToWorkspace(page);
      await expectComposerVisible(page, { timeout: 30_000 });
      await expectSingleCurrentWorkspaceDeckEntry(page, {
        expectedDeckEntryCount: 2,
        serverId,
        workspaceId: second.workspaceId,
      });

      await openSessions(page);
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: third.workspaceId });
      await expectComposerVisible(page, { timeout: 30_000 });
      await expectSingleCurrentWorkspaceDeckEntry(page, {
        expectedDeckEntryCount: sessions.length,
        serverId,
        workspaceId: third.workspaceId,
      });

      await openAppWideNewWorkspace(page);
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: first.workspaceId });
      await expectComposerVisible(page, { timeout: 30_000 });
      await expectSingleCurrentWorkspaceDeckEntry(page, {
        expectedDeckEntryCount: sessions.length,
        serverId,
        workspaceId: first.workspaceId,
      });

      await composerLocator(page).fill("/");
      const popover = page
        .getByTestId("composer-autocomplete-popover")
        .filter({ hasText: "/help", visible: true })
        .first();
      await expect(popover).toBeInViewport({ timeout: 30_000 });
    } finally {
      await Promise.allSettled(sessions.map((session) => session.cleanup()));
    }
  });

  test("does not flash at the wrong position on the first slash command paint", async ({
    page,
  }) => {
    await installListCommandsStub(page);
    const agent = await openReadyMockAgent(page);

    try {
      const input = composerLocator(page);
      await expect(input).toBeEditable({ timeout: 30_000 });
      await input.click();

      await startPopoverFrameRecorder(page);
      await page.keyboard.type("/");
      await expect(page.getByText("/help", { exact: true })).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(250);
      const frames = await stopPopoverFrameRecorder(page);

      expectPopoverFramesStable(frames);
    } finally {
      await agent.cleanup();
    }
  });

  test("does not jump when deleting a slash command search", async ({ page }) => {
    await installListCommandsStub(page);
    const agent = await openReadyMockAgent(page);

    try {
      const input = composerLocator(page);
      await expect(input).toBeEditable({ timeout: 30_000 });

      await input.fill("/he");
      const popover = page.getByTestId("composer-autocomplete-popover");
      await expect(popover.getByText("/help", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      const beforeDelete = await visiblePopoverBox(page);

      await input.press("Backspace");
      await expect(input).toHaveValue("/h");
      await expect(popover.getByText("/history", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      const afterDelete = await visiblePopoverBox(page);

      expect(Math.abs(afterDelete.bottom - beforeDelete.bottom)).toBeLessThanOrEqual(4);
      expect(afterDelete.height).toBeGreaterThan(beforeDelete.height);
    } finally {
      await agent.cleanup();
    }
  });

  test("shrinks to filtered slash command results without moving the bottom edge", async ({
    page,
  }) => {
    await installListCommandsStub(page);
    const agent = await openReadyMockAgent(page);

    try {
      const input = composerLocator(page);
      await expect(input).toBeEditable({ timeout: 30_000 });

      await input.fill("/");
      const popover = page.getByTestId("composer-autocomplete-popover");
      await expect(popover.getByText("/help", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      const allCommands = await visiblePopoverBox(page);

      await input.fill("/tdd");
      await expect(popover.getByText("/tdd", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      const oneCommand = await visiblePopoverBox(page);

      expect(Math.abs(oneCommand.bottom - allCommands.bottom)).toBeLessThanOrEqual(4);
      expect(oneCommand.height).toBeLessThan(allCommands.height - 40);
    } finally {
      await agent.cleanup();
    }
  });

  test("stays visible while filtering slash command results", async ({ page }) => {
    await installListCommandsStub(page);
    const agent = await openReadyMockAgent(page);

    try {
      const input = composerLocator(page);
      await expect(input).toBeEditable({ timeout: 30_000 });

      await input.fill("/");
      const popover = page.getByTestId("composer-autocomplete-popover");
      await expect(popover.getByText("/help", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });

      await startPopoverFrameRecorder(page);
      await page.keyboard.type("tdd", { delay: 40 });
      await expect(popover.getByText("/tdd", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await page.waitForTimeout(250);
      const frames = await stopPopoverFrameRecorder(page);

      expectPopoverDoesNotDisappearAfterFirstVisible(frames);
    } finally {
      await agent.cleanup();
    }
  });

  test("uses the live cursor when accepting a slash command", async ({ page }) => {
    await installListCommandsStub(page);
    const agent = await openReadyMockAgent(page);

    try {
      const input = composerLocator(page);
      await expect(input).toBeEditable({ timeout: 30_000 });
      await input.fill("/tdd");
      await expect(
        page
          .getByTestId("composer-autocomplete-popover")
          .getByText("/tdd", { exact: true })
          .first(),
      ).toBeVisible({ timeout: 30_000 });

      await input.evaluate((element) => {
        if (!(element instanceof HTMLTextAreaElement)) {
          throw new Error("Composer input is not a textarea");
        }
        element.setSelectionRange(0, 0);
        element.dispatchEvent(new Event("select", { bubbles: true }));
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            bubbles: true,
            cancelable: true,
          }),
        );
      });

      await expect(input).toHaveValue("/tdd");
      const selectionStart = await input.evaluate(
        (element) => (element as HTMLTextAreaElement).selectionStart,
      );
      expect(selectionStart).toBe(0);
    } finally {
      await agent.cleanup();
    }
  });

  test("uses the live input when clicking a slash command", async ({ page }) => {
    await installListCommandsStub(page);
    const agent = await openReadyMockAgent(page);

    try {
      const input = composerLocator(page);
      await expect(input).toBeEditable({ timeout: 30_000 });
      await input.fill("/td");
      const option = page
        .getByTestId("composer-autocomplete-popover")
        .getByText("/tdd", { exact: true })
        .first();
      await expect(option).toBeVisible({ timeout: 30_000 });

      await option.evaluate((element) => {
        const textarea = document.querySelector('textarea[aria-label="Message agent..."]');
        if (!(textarea instanceof HTMLTextAreaElement)) {
          throw new Error("Composer input is not a textarea");
        }
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        if (!valueSetter) throw new Error("Textarea value setter is unavailable");
        valueSetter.call(textarea, "/tdd suffix");
        textarea.setSelectionRange(4, 4);
        textarea.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: "d suffix",
            inputType: "insertText",
          }),
        );
        (element as HTMLElement).click();
      });

      await expect(input).toHaveValue("/tdd suffix");
    } finally {
      await agent.cleanup();
    }
  });

  test("stays anchored to the composer when the desktop sidebar is open", async ({ page }) => {
    await installListCommandsStub(page);
    const agent = await openReadyMockAgent(page);

    try {
      await expect(page.getByTestId("sidebar-sessions")).toBeVisible({ timeout: 30_000 });
      const input = composerLocator(page);
      await expect(input).toBeEditable({ timeout: 30_000 });

      await input.fill("/");
      const popover = page.getByTestId("composer-autocomplete-popover");
      await expect(popover.getByText("/help", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });

      const composerBox = await page.getByTestId("message-input-root").boundingBox();
      const popoverBox = await popover.boundingBox();
      expect(composerBox).not.toBeNull();
      expect(popoverBox).not.toBeNull();

      expect(Math.abs(popoverBox!.x - composerBox!.x)).toBeLessThanOrEqual(4);
      expect(Math.abs(popoverBox!.width - composerBox!.width)).toBeLessThanOrEqual(4);
    } finally {
      await agent.cleanup();
    }
  });

  test.describe("compact sidebar layering", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test("keeps the mobile agent sidebar above autocomplete", async ({ page }) => {
      await installListCommandsStub(page);
      const agent = await openReadyMockAgent(page, { expectWorkspaceTab: false });

      try {
        const input = composerLocator(page);
        await expect(input).toBeEditable({ timeout: 30_000 });

        await input.fill("/");
        const popover = page.getByTestId("composer-autocomplete-popover");
        await expect(popover.getByText("/help", { exact: true }).first()).toBeVisible({
          timeout: 30_000,
        });

        // The sidebar covers the composer, so the composer gives up its popover while the
        // sidebar is open and brings it back once the sidebar closes.
        await openMobileAgentSidebar(page);
        await expectMobileAgentSidebarVisible(page);
        await expect(popover).toHaveCount(0);

        await closeMobileAgentSidebar(page);
        await expectMobileAgentSidebarHidden(page);
        await expect(popover.getByText("/help", { exact: true }).first()).toBeVisible();
      } finally {
        await agent.cleanup();
      }
    });
  });
});

test.describe("Composer profile references", () => {
  test("@@ selects a saved profile as persistent delegation context without applying it", async ({
    page,
  }) => {
    const profile = {
      id: "delegate-opus",
      name: "Opus delegate",
      provider: "claude",
      model: "opus-5.5",
      modeId: "auto",
      thinkingOptionId: "medium",
      notes: "Use a separate worktree from origin/dev.",
    };
    const profiles = await seedAgentProfiles([
      profile,
      { id: "delegate-codex", name: "Codex delegate", provider: "codex", model: "gpt-6.1-sol" },
    ]);
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "profile-reference-",
      title: "Profile reference test",
      model: "ten-second-stream",
      modeId: "load-test",
    });
    const gate = await installDaemonWebSocketGate(page);
    try {
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      const input = composerLocator(page);
      await input.fill("Delegate @@Opus");
      const option = page.getByTestId("autocomplete-option-profile:delegate-opus");
      await expect(option).toBeVisible();
      await expect(page.getByTestId("autocomplete-option-profile:delegate-codex")).toHaveCount(0);
      await input.press("Enter");
      const pill = page.getByTestId("composer-agent-profile-pill");
      const mention = `[@Opus delegate](agent-profile://delegate-opus?hostId=${getServerId()})`;
      await expect(pill).toHaveCount(0);
      await expect(input).toHaveValue(`Delegate ${mention} `);
      await expect(input).toBeFocused();
      await expectWorkspaceAgentConfiguration(workspace, {
        provider: "mock",
        model: "ten-second-stream",
        modeId: "load-test",
      });
      await input.fill("@@Opus");
      await expect(option).toBeVisible();
      await option.click();
      await expect(pill).toHaveCount(0);
      await input.fill(`Please delegate ${mention} the review.`);
      await page.reload();
      await expectComposerVisible(page);
      await expect(pill).toHaveCount(0);
      await expect(input).toHaveValue(`Please delegate ${mention} the review.`);
      await input.press("Enter");
      await expect.poll(() => gate.getClientRequests("send_agent_message_request").length).toBe(1);
      const request = gate.getClientRequests("send_agent_message_request")[0]!;
      expect(request.text).toBe(`Please delegate ${mention} the review.`);
      expect(request.attachments).toEqual([
        expect.objectContaining({
          type: "text",
          title: "Agent profile · Opus delegate",
          text: expect.stringContaining('"model": "opus-5.5"'),
        }),
      ]);
      expect(gate.getClientRequestCount("create_agent_request")).toBe(0);
    } finally {
      await workspace.cleanup();
      await profiles.restore();
    }
  });
});

test("profile references keep @ files intact and support empty results, caret selection and removal", async ({
  page,
}) => {
  const seed = await seedAgentProfiles([
    { id: "delegate-codex", name: "Codex delegate", provider: "codex", model: "gpt-6.1-sol" },
  ]);
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "profile-reference-caret-",
    title: "Profile reference caret",
  });
  const gate = await installDaemonWebSocketGate(page);
  try {
    await openAgentRoute(page, workspace);
    await expectComposerVisible(page);
    const input = composerLocator(page);
    await input.fill("@@nomatch");
    await expect(
      page.getByText("No matching agent profiles. Manage profiles in host settings.", {
        exact: true,
      }),
    ).toBeVisible();
    await input.fill("@README");
    await expect(page.getByTestId("autocomplete-option-file:README.md")).toBeVisible();
    await expect(page.getByTestId("autocomplete-option-profile:delegate-codex")).toHaveCount(0);
    await input.fill("Ask @@Codex to review");
    await input.evaluate((element) => {
      if (!(element instanceof HTMLTextAreaElement)) throw new Error("Expected textarea");
      element.setSelectionRange(11, 11);
      element.dispatchEvent(new Event("select", { bubbles: true }));
      element.dispatchEvent(new Event("keyup", { bubbles: true }));
    });
    await expect(page.getByTestId("autocomplete-option-profile:delegate-codex")).toBeVisible();
    await input.press("Tab");
    const mention = `[@Codex delegate](agent-profile://delegate-codex?hostId=${getServerId()})`;
    await expect(input).toHaveValue(`Ask ${mention}  to review`);
    await input.press("x");
    await expect(input).toHaveValue(`Ask ${mention} x to review`);
    const pill = page.getByTestId("composer-agent-profile-pill");
    await expect(pill).toHaveCount(0);
    await input.fill("Ask to review");
    await expect(pill).toHaveCount(0);
    await expect(input).toHaveValue("Ask to review");
    await input.press("Enter");
    await expect.poll(() => gate.getClientRequests("send_agent_message_request").length).toBe(1);
    const request = gate.getClientRequests("send_agent_message_request")[0]!;
    expect(request.text).toBe("Ask to review");
    expect(request.attachments ?? []).toEqual([]);
  } finally {
    await workspace.cleanup();
    await seed.restore();
  }
});

test.describe("Composer session references", () => {
  test("## scopes terminals and threads by project, hides workspaces, and preserves references through send", async ({
    page,
  }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "session-reference-",
      title: "Session reference coordinator",
    });
    const other = await seedMockAgentWorkspace({
      repoPrefix: "session-reference-other-",
      title: "Flutter debug thread",
    });
    const gate = await installDaemonWebSocketGate(page);
    try {
      const created = await workspace.client.createTerminal(
        workspace.cwd,
        "Flutter dev",
        undefined,
        { workspaceId: workspace.workspaceId, command: "sh", args: ["-c", "cat"] },
      );
      if (!created.terminal || created.error)
        throw new Error(created.error ?? "Terminal creation failed");
      const terminalId = created.terminal.id;
      const siblingWorkspace = await workspace.client.createWorkspace({
        source: { kind: "directory", path: workspace.cwd },
        title: "Same project workspace",
      });
      if (!siblingWorkspace.workspace || siblingWorkspace.error)
        throw new Error(siblingWorkspace.error ?? "Workspace creation failed");
      const sibling = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.cwd,
        workspaceId: siblingWorkspace.workspace.id,
        title: "Same project worker",
        model: "e2e-fast-stream",
        modeId: "load-test",
      });

      await workspace.client.renameTerminal({ terminalId, title: "Renamed Flutter terminal" });
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      const input = composerLocator(page);
      await input.fill("Inspect ##");

      await expect(page.getByTestId("session-reference-scope-current")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(
        page.getByTestId(`autocomplete-option-session:thread:${sibling.id}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`autocomplete-option-session:thread:${other.agentId}`),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-testid^="autocomplete-option-session:workspace:"]'),
      ).toHaveCount(0);
      await page.getByTestId("session-reference-scope-all").click();
      await expect(input).toHaveValue("Inspect ##");

      await expect(
        page.getByTestId(`autocomplete-option-session:terminal:${terminalId}`),
      ).toContainText("Renamed Flutter terminal");
      await expect(
        page.getByTestId(`autocomplete-option-session:terminal:${terminalId}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`autocomplete-option-session:thread:${other.agentId}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`autocomplete-option-session:thread:${workspace.agentId}`),
      ).toHaveCount(0);
      await page.getByTestId("session-reference-scope-current").click();
      await input.fill(`Inspect ##${terminalId.slice(0, 12)}`);
      await expect(
        page.getByTestId(`autocomplete-option-session:terminal:${terminalId}`),
      ).toBeVisible();
      await input.press("Enter");
      const pills = page.getByTestId("composer-session-reference-pill");
      const terminalMention = `[#Renamed Flutter terminal](terminal://${terminalId}?hostId=${getServerId()})`;
      const threadMention = `[#Flutter debug thread](thread://${other.agentId}?hostId=${getServerId()})`;
      await expect(pills).toHaveCount(0);
      await expect(input).toHaveValue(`Inspect ${terminalMention} `);
      await expect(input).toBeFocused();
      await input.fill(`##${terminalId}`);
      await page.getByTestId(`autocomplete-option-session:terminal:${terminalId}`).click();
      await expect(pills).toHaveCount(0);
      await input.fill("##thread:Flutter");
      await expect(
        page.getByTestId(`autocomplete-option-session:thread:${other.agentId}`),
      ).toHaveCount(0);
      await page.getByTestId("session-reference-scope-all").click();
      await expect(input).toBeFocused();

      await page.getByTestId(`autocomplete-option-session:thread:${other.agentId}`).click();
      await expect(pills).toHaveCount(0);
      const message = `Check ${terminalMention} using ${threadMention}.`;
      await input.fill(message);
      await page.reload();
      await expectComposerVisible(page);
      await expect(pills).toHaveCount(0);
      await expect(input).toHaveValue(message);
      expect(gate.getClientRequestCount("capture_terminal_request")).toBe(0);
      await input.press("Enter");
      await expect.poll(() => gate.getClientRequests("send_agent_message_request").length).toBe(1);
      const request = gate.getClientRequests("send_agent_message_request")[0]!;
      expect(request.text).toBe(message);
      expect(request.attachments).toEqual([
        expect.objectContaining({
          type: "text",
          title: "terminal · Renamed Flutter terminal",
          text: expect.stringContaining(`"id":"${terminalId}"`),
        }),
        expect.objectContaining({
          type: "text",
          title: "thread · Flutter debug thread",
          text: expect.stringContaining(`"id":"${other.agentId}"`),
        }),
      ]);
      expect(gate.getClientRequestCount("create_agent_request")).toBe(0);
    } finally {
      await other.cleanup();
      await workspace.cleanup();
    }
  });

  test("## keeps surrounding text, supports removal and empty results, and recovers after disconnect", async ({
    page,
  }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "session-reference-reconnect-",
      title: "Session reference reconnect",
    });
    const gate = await installDaemonWebSocketGate(page);
    try {
      const created = await workspace.client.createTerminal(
        workspace.cwd,
        "Reconnect terminal",
        undefined,
        { workspaceId: workspace.workspaceId, command: "sh", args: ["-c", "cat"] },
      );
      if (!created.terminal || created.error)
        throw new Error(created.error ?? "Terminal creation failed");
      const terminalId = created.terminal.id;
      await workspace.client.renameTerminal({ terminalId, title: "Reconnect terminal" });
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      const input = composerLocator(page);
      await input.fill("##no-such-reference-xyz");
      await expect(
        page.getByText("No matching terminals or active threads in this project.", {
          exact: true,
        }),
      ).toBeVisible();
      const text = `Inspect ##${terminalId} after reload`;
      await input.fill(text);
      await input.evaluate((element, position) => {
        if (!(element instanceof HTMLTextAreaElement)) throw new Error("Expected textarea");
        element.setSelectionRange(position, position);
        element.dispatchEvent(new Event("select", { bubbles: true }));
        element.dispatchEvent(new Event("keyup", { bubbles: true }));
      }, text.indexOf(" after"));
      await page.getByTestId(`autocomplete-option-session:terminal:${terminalId}`).click();
      await expect(input).toHaveValue(
        `Inspect [#Reconnect terminal](terminal://${terminalId}?hostId=${getServerId()})  after reload`,
      );
      const pill = page.getByTestId("composer-session-reference-pill");
      await expect(pill).toHaveCount(0);
      await input.fill("Inspect after reload");
      await expect(pill).toHaveCount(0);
      await input.fill("##");
      await expect(
        page.getByTestId(`autocomplete-option-session:terminal:${terminalId}`),
      ).toBeVisible();
      await gate.drop();
      await expect(
        page.getByText("Error: Connect to the host to reference its sessions.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByTestId(`autocomplete-option-session:terminal:${terminalId}`),
      ).toHaveCount(0);
      gate.restore();
      await expect(
        page.getByTestId(`autocomplete-option-session:terminal:${terminalId}`),
      ).toBeVisible({ timeout: 30_000 });
      await input.fill("");
    } finally {
      gate.restore();
      await workspace.cleanup();
    }
  });
});
