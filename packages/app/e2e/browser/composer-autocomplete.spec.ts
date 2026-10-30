import { mkdir, writeFile } from "node:fs/promises";
import type { Locator } from "@playwright/test";
import { expectFileTabOpen } from "../support/helpers/file-explorer";
import { seedAgentProfiles } from "../support/helpers/agent-profiles";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { expectWorkspaceAgentConfiguration } from "../support/helpers/command-center-agent-controls";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { expect, test, type Page } from "../support/fixtures";
import {
  composerLocator,
  expectComposerDraft,
  expectComposerVisible,
  selectComposerDraftRange,
} from "../support/helpers/composer";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import {
  clickSessionRow,
  expectWorkspaceTabVisible,
  openSessions,
} from "../support/helpers/archive-tab";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { switchWorkspaceViaSidebar } from "../support/helpers/workspace-ui";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
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

async function expectSelectedSuggestionVisible(rows: Locator, index: number, color: string) {
  await expect(rows.nth(index)).toHaveCSS("background-color", color);
  await expect(rows.nth(index)).toBeInViewport({ ratio: 1 });
}

async function exerciseSuggestionWrap(input: Locator, rows: Locator): Promise<string> {
  const count = await rows.count();
  expect(count).toBeGreaterThan(6);
  await expect(rows.last()).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const color = await rows.last().evaluate((element) => getComputedStyle(element).backgroundColor);
  await expectSelectedSuggestionVisible(rows, count - 1, color);
  await input.press("ArrowDown");
  await expectSelectedSuggestionVisible(rows, 0, color);
  await input.press("ArrowUp");
  await expectSelectedSuggestionVisible(rows, count - 1, color);
  for (let index = count - 2; index >= 0; index -= 1) {
    await input.press("ArrowUp");
    await expectSelectedSuggestionVisible(rows, index, color);
  }
  await input.press("ArrowUp");
  await expectSelectedSuggestionVisible(rows, count - 1, color);
  await input.press("ArrowDown");
  await expectSelectedSuggestionVisible(rows, 0, color);
  for (let index = 0; index < count + 3; index += 1) await input.press("ArrowDown");
  await expectSelectedSuggestionVisible(rows, 3, color);
  for (let index = 0; index < count + 5; index += 1) await input.press("ArrowUp");
  await expectSelectedSuggestionVisible(rows, count - 2, color);
  return color;
}

for (const width of [1280, 494]) {
  test(`profile mention keyboard wrap follows variable-height rows after filtering at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const profiles = await seedAgentProfiles(
      Array.from({ length: 24 }, (_, index) => ({
        id: `scroll-profile-${index}`,
        name: `scroll-profile-${String(index).padStart(2, "0")}`,
        provider: "claude" as const,
        model: "opus-5.5",
        notes: index % 2 ? "A profile with an extra description row" : undefined,
      })),
    );
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "profile-scroll-wrap-",
      title: "Profile scrolling",
    });
    try {
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await page.mouse.move(1, 1);
      const input = composerLocator(page);
      const rows = page.locator('[data-testid^="autocomplete-option-profile:scroll-profile-"]');
      await input.fill("@@scroll-profile-");
      await expect(rows).toHaveCount(24);
      await exerciseSuggestionWrap(input, rows);
      await input.fill("@@scroll-profile-0");
      await expect(rows).toHaveCount(10);
      await exerciseSuggestionWrap(input, rows);
      await page.screenshot({ path: testInfo.outputPath("profile-scroll-wrap.png") });
    } finally {
      await workspace.cleanup();
      await profiles.restore();
    }
  });

  test(`session mention keyboard wrap follows selection through directory updates at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "session-scroll-wrap-",
      title: "Session scrolling",
    });
    try {
      const peers: string[] = [];
      for (let index = 0; index < 24; index += 1) {
        const peer = await workspace.client.createAgent({
          provider: "mock",
          cwd: workspace.cwd,
          workspaceId: workspace.workspaceId,
          title: `scroll-peer-${String(index).padStart(2, "0")}`,
          model: "e2e-fast-stream",
          modeId: "load-test",
        });
        peers.push(peer.id);
      }
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await page.mouse.move(1, 1);
      const input = composerLocator(page);
      const rows = page.locator('[data-testid^="autocomplete-option-session:thread:"]');
      await input.fill("##scroll-peer-");
      await expect(rows).toHaveCount(24);
      const color = await exerciseSuggestionWrap(input, rows);
      await input.press("ArrowDown");
      await input.press("ArrowDown");
      await expectSelectedSuggestionVisible(rows, 0, color);
      await workspace.client.updateAgent(peers.at(-1)!, {
        name: "scroll-peer-23!",
      });
      await expect(rows.first()).toContainText("scroll-peer-23!");
      await expectSelectedSuggestionVisible(rows, 0, color);
      await input.fill("##scroll-peer-0");
      await expect(rows).toHaveCount(10);
      await exerciseSuggestionWrap(input, rows);
      await page.screenshot({ path: testInfo.outputPath("session-scroll-wrap.png") });
    } finally {
      await workspace.cleanup();
    }
  });

  test(`slash command keyboard wrap stays visible after filtering at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installListCommandsStub(page);
    const session = await openReadyMockAgent(page, { expectWorkspaceTab: false });
    try {
      await page.mouse.move(1, 1);
      const input = composerLocator(page);
      const popover = page.getByTestId("composer-autocomplete-popover");
      const rows = popover.locator('[data-testid^="autocomplete-option-"]');
      await input.fill("/");
      await expect(popover.getByText("/help", { exact: true }).first()).toBeVisible();
      await exerciseSuggestionWrap(input, rows);
      await input.fill("/h");
      await expect(popover.getByText("/tdd", { exact: true })).toHaveCount(0);
      await exerciseSuggestionWrap(input, rows);
      await page.screenshot({ path: testInfo.outputPath("slash-scroll-wrap.png") });
    } finally {
      await session.cleanup();
    }
  });
}

test.describe("Composer autocomplete", () => {
  test("file mention keyboard wrap keeps the selected row inside the scroll viewport", async ({
    page,
  }, testInfo) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "autocomplete-scroll-wrap-",
      title: "Autocomplete scroll wrap",
      repo: {
        files: Array.from({ length: 24 }, (_, index) => ({
          path: `scroll-wrap-${String(index).padStart(2, "0")}.md`,
          content: "scroll fixture\n",
        })),
      },
    });
    try {
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      await page.mouse.move(1, 1);
      const input = composerLocator(page);
      await input.fill("@scroll-wrap-");
      const rows = page.locator('[data-testid^="autocomplete-option-file:scroll-wrap-"]');
      await expect(rows).toHaveCount(24);
      await expect(rows.last()).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const selectedColor = await rows
        .last()
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      await expect(rows.last()).toBeInViewport({ ratio: 1 });
      await input.press("ArrowDown");
      await expect(rows.first()).toHaveCSS("background-color", selectedColor);
      await page.screenshot({ path: testInfo.outputPath("wrapped-to-first.png") });
      await expect(rows.first()).toBeInViewport({ ratio: 1 });
      await input.press("ArrowUp");
      await expect(rows.last()).toHaveCSS("background-color", selectedColor);
      await expect(rows.last()).toBeInViewport({ ratio: 1 });
      for (let index = 22; index >= 0; index -= 1) {
        await input.press("ArrowUp");
        await expect(rows.nth(index)).toHaveCSS("background-color", selectedColor);
        await expect(rows.nth(index)).toBeInViewport({ ratio: 1 });
      }
      await input.fill("@scroll-wrap-0");
      await expect(rows).toHaveCount(12);
      await expect(rows.last()).toHaveCSS("background-color", selectedColor);
      await expect(rows.last()).toBeInViewport({ ratio: 1 });
      await input.press("ArrowDown");
      await expect(rows.first()).toHaveCSS("background-color", selectedColor);
      await page.screenshot({ path: testInfo.outputPath("filtered-wrap-to-first.png") });
      await expect(rows.first()).toBeInViewport({ ratio: 1 });
    } finally {
      await workspace.cleanup();
    }
  });

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
      await expect(input).toHaveAttribute("data-markdown", "/h");
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

      await input.press("Home");
      await input.press("Tab");
      await expect(input).toHaveAttribute("data-markdown", "/tdd");
      await expect(input).toHaveAttribute("data-selection-start", "0");
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

      await input.fill("/tdd suffix");
      await input.press("Home");
      await input.press("ArrowRight");
      await input.press("ArrowRight");
      await input.press("ArrowRight");
      await input.press("ArrowRight");
      await option.click();

      await expect(input).toHaveAttribute("data-markdown", "/tdd suffix");
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
      await expect(input).toHaveAttribute("data-markdown", `Delegate ${mention} `);
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
      await expect(input).toHaveAttribute(
        "data-markdown",
        `Please delegate ${mention} the review.`,
      );
      await Promise.all([
        workspace.client.waitForAgentUpsert(
          workspace.agentId,
          (agent) => agent.status === "running",
        ),
        input.press("Enter"),
      ]);
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
      const sent = page.getByTestId("user-message").filter({ hasText: "Please delegate" }).last();
      const reference = sent.getByRole("link", { name: "@Opus delegate", exact: true });
      await expect(reference).toBeVisible();
      await expect(sent).not.toContainText("Agent profile ·");
      // Transcript auto-scroll legitimately closes its hover cards while the mock streams.
      await workspace.client.waitForFinish(workspace.agentId, 20_000);
      await expectAgentIdle(page);
      await reference.hover();
      await expect(page.getByText(/Referenced Paseo agent profile: Opus delegate/)).toBeVisible();
      await expect(page.getByText(/Profile notes:.*Use a separate worktree/s)).toBeVisible();
      const detail = page.getByTestId("message-reference-details");
      await detail.hover();
      await expect(detail).toBeVisible();
      await detail.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await detail.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
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
      const text = element.firstChild?.firstChild;
      if (!text) throw new Error("Missing editor text");
      const range = document.createRange();
      range.setStart(text, 11);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(page.getByTestId("autocomplete-option-profile:delegate-codex")).toBeVisible();
    await input.press("Tab");
    const mention = `[@Codex delegate](agent-profile://delegate-codex?hostId=${getServerId()})`;
    await expect(input).toHaveAttribute("data-markdown", `Ask ${mention}  to review`);
    await input.press("x");
    await expect(input).toHaveAttribute("data-markdown", `Ask ${mention} x to review`);
    const pill = page.getByTestId("composer-agent-profile-pill");
    await expect(pill).toHaveCount(0);
    await input.fill("Ask to review");
    await expect(pill).toHaveCount(0);
    await expect(input).toHaveAttribute("data-markdown", "Ask to review");
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
      await expect(input).toHaveAttribute("data-markdown", "Inspect ##");

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
      await expect(input).toHaveAttribute("data-markdown", `Inspect ${terminalMention} `);
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
      await expect(input).toHaveAttribute("data-markdown", message);
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
        const textNode = element.firstChild?.firstChild;
        if (!textNode) throw new Error("Missing editor text");
        const range = document.createRange();
        range.setStart(textNode, position);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      }, text.indexOf(" after"));
      await page.getByTestId(`autocomplete-option-session:terminal:${terminalId}`).click();
      await expect(input).toHaveAttribute(
        "data-markdown",
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

test("composer hyperlinks stay editable and open with a modifier click", async ({
  page,
  context,
}, testInfo) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "composer-hyperlinks-",
    title: "Composer hyperlinks",
  });
  try {
    await context.route("https://www.example.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<p>Link opened</p>" }),
    );
    await openAgentRoute(page, workspace);
    await expectComposerVisible(page);
    const input = composerLocator(page);
    const markdown =
      "See https://www.example.com/docs?q=preview#section and [guide](https://www.example.com/guide). `https://code.example.com`";
    await input.fill(markdown);
    const url = input.locator(".composer-url");
    await expect(url).toHaveText("https://www.example.com/docs?q=preview#section");
    await expect(url).toHaveCSS("text-decoration-line", "underline");
    await expect(input.locator(".composer-reference[data-composer-url]")).toHaveText("guide");
    await expect(input.locator(".composer-code")).toHaveText("https://code.example.com");
    await url.click();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("data-markdown", markdown);
    const opened = context.waitForEvent("page");
    await url.click({ modifiers: ["ControlOrMeta"] });
    const popup = await opened;
    await expect(popup).toHaveURL("https://www.example.com/docs?q=preview#section");
    await popup.close();
    await input.fill("See https://www.example.com/new");
    await input.press("End");
    await input.press("Backspace");
    await expect(url).toHaveText("https://www.example.com/ne");
    await expect(input).toHaveAttribute("data-markdown", "See https://www.example.com/ne");
    await input.press("ControlOrMeta+z");
    await expect(url).toHaveText("https://www.example.com/new");
    await input.fill("See (https://www.example.com/a_(b)).\n```\nhttps://code.example.com\n```");
    await expect(url).toHaveText("https://www.example.com/a_(b)");
    await expect(url).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("composer-hyperlinks.png") });
  } finally {
    await workspace.cleanup();
  }
});

test("composer formats fenced code only after its closing backticks and preserves editable source", async ({
  page,
}, testInfo) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "composer-code-fence-",
    title: "Fenced composer code",
  });
  const gate = await installDaemonWebSocketGate(page);
  try {
    await openAgentRoute(page, workspace);
    await expectComposerVisible(page);
    const input = composerLocator(page);
    const source = "Before\n\n```typescript\nconst one = 1;\n\nconst two = 2;\n```";
    const body = input.locator(".composer-code-block:not(.composer-code-fence)");
    await input.fill(source.slice(0, -1));
    await expect(body).toHaveCount(0);
    await expect(input).toContainText("```typescript");
    await input.press("End");
    await input.press("`");
    await expect(body).toHaveText(["const one = 1;", "", "const two = 2;"]);
    await expect(body.first()).toHaveCSS("font-family", "monospace");
    await expect(input).not.toContainText("```");
    await expect(input).not.toContainText("typescript");
    await expect(input).toHaveAttribute("data-markdown", source);
    // Hidden delimiters remain one keyboard step; moving the caret separates this edit for undo.
    await input.press("ArrowLeft");
    await expect(input).toHaveAttribute("data-selection-start", String(source.length - 3));
    await input.press("ArrowRight");
    await expect(input).toHaveAttribute("data-selection-start", String(source.length));
    await input.press("Backspace");
    await expect(body).toHaveCount(0);
    await expect(input).toContainText("```typescript");
    await input.press("ControlOrMeta+z");
    await expect(body).toHaveCount(3);
    await expect(input).toHaveAttribute("data-markdown", source);
    await body.last().click();
    await input.press("End");
    await input.pressSequentially(" // edited");
    const edited = source.replace("const two = 2;", "const two = 2; // edited");
    await expect(input).toHaveAttribute("data-markdown", edited);
    await expect(body.last()).toHaveText("const two = 2; // edited");
    await page.screenshot({ path: testInfo.outputPath("composer-fenced-code.png") });
    await input.press("Enter");
    await expect.poll(() => gate.getClientRequests("send_agent_message_request").length).toBe(1);
    expect(gate.getClientRequests("send_agent_message_request")[0]!.text).toBe(edited);
  } finally {
    await workspace.cleanup();
  }
});

test("composer code fences require matching closers and keep monospace with a custom UI font", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ uiFontFamily: "serif" }));
  });
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "composer-code-boundaries-",
    title: "Code fence boundaries",
  });
  try {
    await openAgentRoute(page, workspace);
    await expectComposerVisible(page);
    const input = composerLocator(page);
    const body = input.locator(".composer-code-block:not(.composer-code-fence)");
    const source = "Prose\n\n````markdown\n```js\nconst embedded = true;\n```\n````";
    await input.fill(source.slice(0, -1));
    await expect(body).toHaveCount(0);
    await input.press("End");
    await input.press("`");
    await expect(body).toHaveText(["```js", "const embedded = true;", "```"]);
    await expect(body.first()).toHaveCSS("font-family", "monospace");
    await expect(input.locator(".cm-line").first()).toHaveCSS("font-family", "serif");
    await input.press("ControlOrMeta+End");
    await input.press("Shift+Enter");
    await input.pressSequentially("Then `inline` ");
    await expect(input.locator(".composer-code")).toHaveText("inline");
    await expect(input.locator(".composer-code")).toHaveCSS("font-family", "monospace");
    await expect(body).toHaveCount(3);
    await expect(input).toHaveAttribute("data-markdown", `${source}\nThen \`inline\` `);
    await input.fill("```\ntext\n``` trailing text");
    await expect(input.locator(".composer-code-block")).toHaveCount(0);
    await input.fill("```\n```");
    await expect(input.locator(".composer-code-fence")).toHaveCount(2);
    await expect(input).toHaveAttribute("data-markdown", "```\n```");
    await input.press("ControlOrMeta+a");
    await input.press("Backspace");
    await expect(input).toHaveAttribute("data-markdown", "");
    await expect(input.locator(".composer-code-block")).toHaveCount(0);
  } finally {
    await workspace.cleanup();
  }
});

for (const width of [1280, 494]) {
  test(`numbered composer lists renumber insertions and deletions with one-step undo at ${width}px`, async ({
    page,
  }, testInfo) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "numbered-composer-",
      title: "Numbered composer",
    });
    const gate = await installDaemonWebSocketGate(page);
    try {
      await page.setViewportSize({ width, height: 900 });
      await openAgentRoute(page, workspace);
      await expectComposerVisible(page);
      const input = composerLocator(page);
      const before = "1. first\n2. second\n3. third";
      const caret = before.indexOf("\n3.");
      await input.fill(before);
      await selectComposerDraftRange(page, caret, caret);
      await input.press("Shift+Enter");
      await expectComposerDraft(page, "1. first\n2. second\n3. \n4. third");
      await expect(input).toHaveAttribute("data-selection-start", String(caret + 4));
      await input.press("ControlOrMeta+z");
      await expectComposerDraft(page, before);
      await input.press("ControlOrMeta+Shift+z");
      await expectComposerDraft(page, "1. first\n2. second\n3. \n4. third");
      await selectComposerDraftRange(page, caret + 4, caret + 4);
      await input.pressSequentially("inserted");
      const inserted = "1. first\n2. second\n3. inserted\n4. third";
      await expectComposerDraft(page, inserted);
      await page.screenshot({ path: testInfo.outputPath("renumbered-insertion.png") });
      await selectComposerDraftRange(
        page,
        inserted.indexOf("3. inserted"),
        inserted.indexOf("4. third"),
      );
      await input.press("Backspace");
      await expectComposerDraft(page, before);
      await input.press("ControlOrMeta+z");
      await expectComposerDraft(page, inserted);
      await selectComposerDraftRange(page, 0, "1. first\n".length);
      await input.press("Backspace");
      await expectComposerDraft(page, "1. second\n2. inserted\n3. third");

      await input.fill(before);
      await selectComposerDraftRange(page, caret, caret);
      await input.press("ArrowRight");
      await page.keyboard.insertText("3. extra\n4. extra\n");
      await expectComposerDraft(page, "1. first\n2. second\n3. extra\n4. extra\n5. third");

      const nested = "1. parent\n   1. child\n   2. next\n2. sibling";
      await input.fill(nested);
      const nestedCaret = nested.indexOf("\n   2.");
      await selectComposerDraftRange(page, nestedCaret, nestedCaret);
      await input.press("Shift+Enter");
      await expectComposerDraft(page, "1. parent\n   1. child\n   2. \n   3. next\n2. sibling");

      const code = "```\n1. literal\n3. literal\n```";
      await input.fill(code);
      const codeCaret = code.indexOf("\n3.");
      await input.locator(".composer-code-block").first().click();
      await input.press("End");
      await expect(input).toHaveAttribute("data-selection-start", String(codeCaret));
      await input.press("Shift+Enter");
      await expectComposerDraft(page, "```\n1. literal\n\n3. literal\n```");
      expect(gate.getClientRequests("send_agent_message_request")).toHaveLength(0);
    } finally {
      await workspace.cleanup();
    }
  });
}

test("decorated composer hides reference targets, formats closed Markdown and continues numbered lists", async ({
  page,
}) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "decorated-composer-",
    title: "Decorated composer",
  });
  const gate = await installDaemonWebSocketGate(page);
  try {
    await openAgentRoute(page, workspace);
    await expectComposerVisible(page);
    const input = composerLocator(page);
    const markdown = "the `quick` **fox** *lazy* [thread](thread://agent-id?hostId=host)";
    await input.fill(markdown);
    await expect(input.locator(".composer-code")).toHaveText("quick");
    await expect(input.locator(".composer-code")).toHaveCSS("font-family", "monospace");
    await expect(input.locator(".composer-bold")).toHaveText("fox");
    await expect(input.locator(".composer-italic")).toHaveText("lazy");
    await expect(input.locator(".composer-reference")).toHaveText("thread");
    await expect(input).not.toContainText("thread://");
    await expect(input).not.toContainText("**");
    await page.screenshot({ path: "/tmp/paseoi-r30-decorated-composer.png" });
    await input.fill("> A quoted **remark** \n> A second line\n\nMy reply");
    await expect(input.locator(".composer-quote")).toHaveCount(2);
    await expect(input.locator(".composer-quote").first()).toHaveText("A quoted remark ");
    await expect(input).toHaveAttribute(
      "data-markdown",
      "> A quoted **remark** \n> A second line\n\nMy reply",
    );
    await expect(input.locator(".composer-quote").first()).toHaveCSS("border-left-width", "2px");
    await page.screenshot({ path: "/tmp/paseoi-r45-quoted-draft.png" });
    await input.fill("```\n> literal code\n```");
    await expect(input.locator(".composer-quote")).toHaveCount(0);
    await input.fill("Use [thread](thread://agent-id?hostId=host)");
    await input.press("End");
    await input.press("Backspace");
    await expect(input).toHaveAttribute("data-markdown", "Use ");
    await input.press("ControlOrMeta+z");
    await expect(input.locator(".composer-reference")).toHaveText("thread");
    await input.fill("**fox*");
    await expect(input.locator(".composer-italic")).toHaveCount(0);
    await input.press("End");
    await input.press("*");
    await expect(input.locator(".composer-bold")).toHaveCount(0);
    await input.press("Space");
    await expect(input.locator(".composer-bold")).toHaveText("fox");
    await input.fill("the `quick");
    await expect(input.locator(".composer-code")).toHaveCount(0);
    await input.press("End");
    await input.press("`");
    await expect(input.locator(".composer-code")).toHaveText("quick");
    await input.press(".");
    await expect(input.locator(".composer-code")).toHaveText("quick");
    await expect(input).toHaveAttribute("data-markdown", "the `quick`.");
    await input.press("Backspace");
    await input.press("ControlOrMeta+z");
    await input.fill("the `quick");
    await expect(input.locator(".composer-code")).toHaveCount(0);
    await input.fill("1. hello");
    await input.press("End");
    await input.press("Shift+Enter");
    await expect(input).toHaveAttribute("data-markdown", "1. hello\n2. ");
    await input.pressSequentially("world");
    await input.press("Shift+Enter");
    await expect(input).toHaveAttribute("data-markdown", "1. hello\n2. world\n3. ");
    await input.press("Shift+Enter");
    await expect(input).toHaveAttribute("data-markdown", "1. hello\n2. world\n");
    expect(gate.getClientRequests("send_agent_message_request")).toHaveLength(0);
    const sentMarkdown = `> A quoted remark\n> A second line\n\n${markdown}\n\n1. hello`;
    await input.fill(sentMarkdown);
    await input.press("Enter");
    await expect.poll(() => gate.getClientRequests("send_agent_message_request").length).toBe(1);
    expect(gate.getClientRequests("send_agent_message_request")[0]!.text).toBe(sentMarkdown);
    const sent = page.getByTestId("user-message").filter({ hasText: "quick" }).last();
    await expect(sent.locator("blockquote")).toContainText("A quoted remark");
    await expect(sent.locator("blockquote")).toHaveCSS("border-left-width", "2px");
    await expect(sent.locator("blockquote")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(sent.locator("code")).toHaveText("quick");
    await page.screenshot({ path: "/tmp/paseoi-r45-quoted-message.png" });
    await expect(sent.locator("strong")).toHaveText("fox");
    await expect(sent.getByRole("link", { name: "thread", exact: true })).toBeVisible();
    await expect(sent).not.toContainText("thread://");
  } finally {
    await workspace.cleanup();
  }
});

test("file references use at-sign links and open the workspace file", async ({ page }) => {
  const workspace = await seedMockAgentWorkspace({
    repoPrefix: "inline-file-reference-",
    title: "File reference",
  });
  try {
    await mkdir(`${workspace.cwd}/reference-folder`);
    await writeFile(`${workspace.cwd}/reference-folder/inside.txt`, "Folder reference contents\n");
    await openAgentRoute(page, workspace);
    await expectComposerVisible(page);
    const input = composerLocator(page);
    await input.fill("Open @README");
    await page.getByTestId("autocomplete-option-file:README.md").click();
    await expect(input.locator(".composer-reference")).toHaveText("@README.md");
    await expectComposerDraft(page, "Open [@README.md](README.md) ");
    await input.pressSequentially("and @reference-folder");
    await page.getByTestId("autocomplete-option-directory:reference-folder").click();
    await expect(input.locator(".composer-reference")).toHaveText([
      "@README.md",
      "@reference-folder/",
    ]);
    await expectComposerDraft(
      page,
      "Open [@README.md](README.md) and [@reference-folder/](reference-folder/) ",
    );
    await input.pressSequentially("next");
    await expectComposerDraft(
      page,
      "Open [@README.md](README.md) and [@reference-folder/](reference-folder/) next",
    );
    await input.press("Enter");
    const message = page.getByTestId("user-message").filter({ hasText: "Open @README.md" }).last();
    const link = message.getByRole("link", { name: "@README.md", exact: true });
    await expect(link).toBeVisible();
    await message.getByRole("link", { name: "@reference-folder/", exact: true }).click();
    await expect(page.getByTestId("file-explorer-tree-scroll")).toContainText("inside.txt");
    await link.click();
    await expect(page.getByTestId("workspace-file-pane").filter({ visible: true })).toBeVisible();
    await expectFileTabOpen(page, "README.md");
  } finally {
    await workspace.cleanup();
  }
});

test("Escape dismisses every suggestion trigger without clearing the draft or losing focus", async ({
  page,
}) => {
  await installListCommandsStub(page);
  const session = await openReadyMockAgent(page);
  try {
    const input = composerLocator(page);
    const popover = page.getByTestId("composer-autocomplete-popover");
    for (const trigger of ["/he", "@READ", "@@", "##"]) {
      await input.fill(trigger);
      await expect(popover).toBeVisible();
      await input.press("Escape");
      await expect(popover).not.toBeVisible();
      await expectComposerDraft(page, trigger);
      await expect(input).toBeFocused();
      await input.press("x");
      await expectComposerDraft(page, `${trigger}x`);
      await expect(popover).not.toBeVisible();
      await input.fill("");
      await input.fill(trigger);
      await expect(popover).toBeVisible();
      await input.press("Escape");
      await input.fill("");
    }
  } finally {
    await session.cleanup();
  }
});

test("suggestion popovers remain usable when animation frames stall", async ({ page }) => {
  await installListCommandsStub(page);
  const session = await openReadyMockAgent(page);
  try {
    const input = composerLocator(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            window.requestAnimationFrame = () => 0;
            resolve();
          });
        }),
    );
    for (const trigger of ["/he", "@READ", "@@", "##"]) {
      await input.fill(trigger);
      await expectComposerDraft(page, trigger);
      const popover = page.getByTestId("composer-autocomplete-popover");
      await expect(popover).toBeInViewport();
      await input.fill("");
      await expect(popover).toBeHidden();
    }
  } finally {
    await session.cleanup();
  }
});

test("suggestions survive splitting panes and closing an archived agent tab", async ({ page }) => {
  await installListCommandsStub(page);
  const first = await seedMockAgentWorkspace({
    repoPrefix: "suggestion-split-",
    title: "Split suggestions",
  });
  const second = await seedMockAgentWorkspace({
    repoPrefix: "suggestion-survivor-",
    title: "Surviving suggestions",
  });
  try {
    await openAgentRoute(page, first);
    await expectComposerVisible(page);
    await runWorkspaceActionFromCommandCenter(page, "Split pane right");
    await expect(page.getByTestId("workspace-new-tab-panel")).toBeVisible();
    for (const trigger of ["/he", "@READ", "@@", "##"]) {
      await composerLocator(page).click();
      await composerLocator(page).fill(trigger);
      await expect(page.getByTestId("composer-autocomplete-popover")).toBeInViewport();
      await composerLocator(page).fill("");
    }
    await first.client.archiveAgent(first.agentId);
    await openSessions(page);
    await clickSessionRow(page, "Split suggestions");
    await expectWorkspaceTabVisible(page, first.agentId);
    await page.getByTestId(`workspace-tab-agent_${first.agentId}`).click({ button: "right" });
    await page.getByTestId(`workspace-tab-context-agent_${first.agentId}-close`).click();
    await switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: second.workspaceId,
    });
    for (const trigger of ["/he", "@READ", "@@", "##"]) {
      await composerLocator(page).fill(trigger);
      await expect(page.getByTestId("composer-autocomplete-popover")).toBeInViewport();
      await composerLocator(page).fill("");
    }
  } finally {
    await Promise.allSettled([first.cleanup(), second.cleanup()]);
  }
});

test("suggestions recover when their portal host becomes visible after a zero-size measurement", async ({
  page,
}, testInfo) => {
  await installListCommandsStub(page);
  const session = await seedMockAgentWorkspace({
    repoPrefix: "autocomplete-zero-host-",
    title: "Autocomplete host recovery",
  });
  try {
    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    const host = page
      .getByTestId(`workspace-deck-entry-${getServerId()}:${session.workspaceId}`)
      .getByTestId("floating-panel-portal-host");
    await host.evaluate((element) => {
      element.style.display = "none";
    });
    await page.evaluate(async () => {
      await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    });
    await host.evaluate((element) => {
      const measuredHost = element as HTMLElement & { zeroSizeReads?: number };
      const measure = measuredHost.getBoundingClientRect.bind(measuredHost);
      measuredHost.zeroSizeReads = 0;
      measuredHost.getBoundingClientRect = () => {
        const result = measure();
        if (result.height === 0) measuredHost.zeroSizeReads = (measuredHost.zeroSizeReads ?? 0) + 1;
        return result;
      };
    });
    await composerLocator(page).fill("/he");
    await expect
      .poll(() =>
        host.evaluate(
          (element) => (element as HTMLElement & { zeroSizeReads?: number }).zeroSizeReads ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await host.evaluate((element) => {
      element.style.removeProperty("display");
    });
    await expect(page.getByTestId("composer-autocomplete-popover")).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("autocomplete-host-recovered.png") });
  } finally {
    await session.cleanup();
  }
});
