import { expect, test as base } from "../support/fixtures";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import {
  expectChatHistoryAttachment,
  expectInFlightForkAvailable,
  expectLiveAssistantText,
  forkInFlightTurnToNewTab,
  forkMostRecentAssistantTurnToNewTab,
  forkMostRecentAssistantTurnToNewWorkspace,
  observeForkAttachment,
} from "../support/helpers/assistant-fork";
import { gateNextAgentMessage } from "../support/helpers/agent-message-gate";
import {
  expectComposerVisible,
  submitMessage,
  fillComposerDraft,
  selectComposerDraftRange,
  expectComposerDraftSelection,
} from "../support/helpers/composer";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentOptions,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { seedSavedSettingsHosts } from "../support/helpers/settings";
import {
  openGlobalNewWorkspaceComposer,
  submitNewWorkspaceEmpty,
  submitNewWorkspacePrompt,
} from "../support/helpers/new-workspace";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";

const test = base.extend<{
  seedForkWorkspace: (options: MockAgentOptions) => Promise<MockAgentWorkspace>;
}>({
  seedForkWorkspace: async ({ browserName: _browserName }, provide) => {
    const sessions: MockAgentWorkspace[] = [];
    await provide(async (options) => {
      const session = await seedMockAgentWorkspace(options);
      sessions.push(session);
      return session;
    });
    await Promise.allSettled(sessions.map((session) => session.cleanup()));
  },
});

test.describe("Assistant fork menu", () => {
  test.describe.configure({ timeout: 180_000 });

  test("forks a failed assistant turn that has no provider message id", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-failed-turn-",
      title: "Assistant fork failed turn",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await submitMessage(page, "Emit a synthetic turn failure.");
    await expect(page.getByText("[System Error] Requested mock provider failure")).toBeVisible({
      timeout: 30_000,
    });

    await forkMostRecentAssistantTurnToNewTab(page);
    await expectChatHistoryAttachment(page);
  });

  test("forks a streaming assistant turn without interrupting it", async ({
    page,
    seedForkWorkspace,
  }) => {
    const visibleBeforeFork = "where the auto-scroll logic actually lives";
    const visibleAfterFork = "the first useful step is to read the relevant files";
    const sourceAgentTitle = "Assistant fork in flight";
    const forkAttachment = observeForkAttachment(page);

    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-in-flight-",
      title: sourceAgentTitle,
      model: "thirty-minute-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await submitMessage(page, "Walk me through the scroll anchor behavior.");

    await expectInFlightForkAvailable(page);
    await expectLiveAssistantText(page, visibleBeforeFork);

    await forkInFlightTurnToNewTab(page);
    await expectChatHistoryAttachment(page);
    expect(await forkAttachment.waitForText()).toContain(visibleBeforeFork);
    await expect(page.getByRole("button", { name: "Menu backdrop", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: sourceAgentTitle }).click();
    await expectLiveAssistantText(page, visibleAfterFork);
  });

  test("focuses a forked assistant turn in a new workspace draft tab", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-focused-tab-",
      title: "Assistant fork focused tab",
      initialPrompt: "emit 1 coalesced agent stream updates for initial assistant fork turn.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await submitMessage(page, "emit 1 coalesced agent stream updates while this tab is visible.");
    await session.client.waitForFinish(session.agentId, 45_000);
    await awaitAssistantMessage(page);

    const agentTab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
    await expect(agentTab).toHaveAttribute("aria-selected", "true");

    await forkMostRecentAssistantTurnToNewTab(page);

    const selectedTab = page
      .getByTestId("workspace-tabs-row")
      .getByRole("button")
      .and(page.locator('[aria-selected="true"]'));
    await expect(selectedTab).toHaveAttribute("data-testid", /^workspace-tab-draft_/, {
      timeout: 30_000,
    });
    await expect(agentTab).toHaveAttribute("aria-selected", "false");
    await expectChatHistoryAttachment(page);
  });

  test("keeps the fork attachment after submitting an existing-workspace draft tab", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-tab-submit-",
      title: "Assistant fork tab submit",
      initialPrompt: "emit 1 coalesced agent stream updates for assistant fork tab submit.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await forkMostRecentAssistantTurnToNewTab(page);
    await expectChatHistoryAttachment(page);

    await submitMessage(page, "");

    const userMessage = page.getByTestId("user-message").filter({ hasText: "Chat history" }).last();
    await expect(userMessage).toBeVisible({ timeout: 30_000 });
    await expect(userMessage).not.toContainText("Source agent:");
  });

  test("forks an assistant turn into New Workspace and keeps the attachment across host changes", async ({
    page,
    seedForkWorkspace,
  }) => {
    await seedSavedSettingsHosts(page, [
      {
        serverId: getServerId(),
        label: "localhost",
        endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
      },
      {
        serverId: "secondary-assistant-fork-host",
        label: "Secondary host",
        // The host does not need to be reachable; this pins that the draft-scoped
        // attachment survives changing the selected target host.
        endpoint: "127.0.0.1:9",
      },
    ]);

    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-workspace-",
      title: "Assistant fork workspace",
      initialPrompt: "emit 1 coalesced agent stream updates for assistant fork new workspace.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await forkMostRecentAssistantTurnToNewWorkspace(page);

    await expect(page).toHaveURL(/\/new\?.*draftId=/, { timeout: 30_000 });
    await expectChatHistoryAttachment(page);

    await page.getByTestId("host-picker-trigger").click();
    await page
      .getByTestId("new-workspace-host-picker-option-secondary-assistant-fork-host")
      .click();
    await expectChatHistoryAttachment(page);
  });

  test("keeps the fork attachment after the new agent receives its user message", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-submit-",
      title: "Assistant fork submit",
      initialPrompt: "emit 1 coalesced agent stream updates for assistant fork submit.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await forkMostRecentAssistantTurnToNewWorkspace(page);
    await expectChatHistoryAttachment(page);

    await submitNewWorkspaceEmpty(page);

    const userMessage = page.getByTestId("user-message").filter({ hasText: "Chat history" }).last();
    await expect(userMessage).toBeVisible({ timeout: 30_000 });
    await expect(userMessage).not.toContainText("Source agent:");
  });
});

test("dragging another workspace title attaches its conversation and sends it with the current draft", async ({
  page,
  seedForkWorkspace,
}) => {
  const source = await seedForkWorkspace({
    repoPrefix: "conversation-drop-source-",
    title: "Review owner TODO items",
    initialPrompt:
      "emit 1 coalesced agent stream updates about the source conversation secret detail.",
  });
  const target = await seedForkWorkspace({
    repoPrefix: "conversation-drop-target-",
    title: "Use another conversation",
  });
  const secondSource = await seedForkWorkspace({
    repoPrefix: "conversation-drop-second-",
    title: "Second context snapshot",
    initialPrompt: "emit 1 coalesced agent stream updates about the second conversation.",
  });
  await source.client.waitForFinish(source.agentId, 45_000);
  await secondSource.client.waitForFinish(secondSource.agentId, 45_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  const gate = await gateNextAgentMessage(page);
  await openAgentRoute(page, target);
  await expectComposerVisible(page);
  await fillComposerDraft(page, "Use this context please");
  const dragTitle = page.getByTestId(`sidebar-session-drag-${getServerId()}:${source.workspaceId}`);
  await expect(dragTitle).toBeVisible({ timeout: 30_000 });
  await expect(dragTitle).toHaveAttribute("draggable", "true");
  const input = page.getByRole("textbox", { name: "Message agent..." }).first();
  const reference = `[@Context 1](attachment://${encodeURIComponent(`session:${getServerId()}:${source.agentId}`)})`;
  const draft = `Use ${reference} this context please`;
  await selectComposerDraftRange(page, 4, 4);
  await dragTitle.dragTo(input);
  const pill = page.getByTestId("composer-chat-history-attachment-pill");
  await expect(pill).toContainText("Review owner TODO items");
  await expect(input).toHaveAttribute("data-markdown", draft);
  await expect(input.locator(".composer-reference")).toHaveText("@Context 1");
  await expectComposerDraftSelection(page, 4 + reference.length + 1, 4 + reference.length + 1);
  await expect(input).toBeFocused();
  await dragTitle.dragTo(input);
  await expect(pill).toHaveCount(1);
  const secondDrag = page.getByTestId(
    `sidebar-session-drag-${getServerId()}:${secondSource.workspaceId}`,
  );
  await secondDrag.dragTo(input);
  await expect(input.locator(".composer-reference")).toHaveText([
    "@Context 1",
    "@Context 1",
    "@Context 2",
  ]);
  const firstPill = pill.filter({ hasText: "Review owner TODO items" });
  await firstPill.hover();
  await page.getByRole("button", { name: "Remove chat history attachment" }).first().click();
  await expect(pill).toHaveCount(1);
  await expect(input.locator(".composer-reference")).toHaveText("@Context 1");
  await secondDrag.dragTo(input);
  await expect(input.locator(".composer-reference")).toHaveText(["@Context 1", "@Context 1"]);
  await pill.hover();
  await page.getByRole("button", { name: "Remove chat history attachment" }).click();
  await expect(pill).toHaveCount(0);
  await expect(input.locator(".composer-reference")).toHaveCount(0);
  await fillComposerDraft(page, "Use this context please");
  await selectComposerDraftRange(page, 4, 4);
  await dragTitle.dragTo(input);
  await expect(pill).toContainText("Review owner TODO items");
  await page.screenshot({ path: "/tmp/paseoi-session-reference.png" });
  await expect(input).toHaveAttribute("data-markdown", draft);
  await input.press("Enter");
  const request = await gate.waitForRequest();
  expect(request.agentId).toBe(target.agentId);
  expect(request.text).toBe(draft);
  expect(request.attachments).toEqual([
    expect.objectContaining({
      type: "text",
      contextKind: "chat_history",
      title: "Review owner TODO items",
      text: expect.stringContaining(source.agentId),
    }),
  ]);
  expect(JSON.stringify(request.attachments)).toContain("source conversation secret detail");
  gate.accept();
  const sent = page.getByTestId("user-message").filter({ hasText: "Use" }).last();
  await expect(sent.getByText("@Context 1", { exact: true })).toBeVisible();
  await sent.getByText("@Context 1", { exact: true }).hover();
  await expect(page.getByTestId("message-reference-details")).toContainText(
    "source conversation secret detail",
  );
  await expect(pill).toHaveCount(0);
  await dragTitle.click();
  await expect(page.getByTestId(`workspace-tab-agent_${source.agentId}`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("dragging a workspace into a fresh New workspace preserves and submits its conversation context", async ({
  page,
  seedForkWorkspace,
}) => {
  const source = await seedForkWorkspace({
    repoPrefix: "conversation-drop-new-",
    title: "Source conversation for new workspace",
    initialPrompt:
      "emit 1 coalesced agent stream updates about the source conversation secret detail.",
  });
  await source.client.waitForFinish(source.agentId, 45_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  const gate = await installDaemonWebSocketGate(page);
  await openAgentRoute(page, source);
  await expectComposerVisible(page);
  await openGlobalNewWorkspaceComposer(page);
  const input = page.getByRole("textbox", { name: "Message agent..." }).first();
  await expect(input).toHaveAttribute("data-markdown", "");
  const title = page.getByTestId(`sidebar-session-drag-${getServerId()}:${source.workspaceId}`);
  await expect(title).toHaveAttribute("draggable", "true");
  await title.dragTo(input);
  const pill = page.getByTestId("composer-chat-history-attachment-pill");
  await expect(pill).toContainText("Source conversation for new workspace");
  await expect(input).toBeFocused();
  const reference = `[@Context 1](attachment://${encodeURIComponent(`session:${getServerId()}:${source.agentId}`)})`;
  await expect(input).toHaveAttribute("data-markdown", `${reference} `);
  await title.dragTo(input);
  await expect(pill).toHaveCount(1);
  const draft = `Use ${reference} in a new workspace`;
  await fillComposerDraft(page, draft);
  await page.getByTestId(`sidebar-workspace-row-${getServerId()}:${source.workspaceId}`).click();
  await openGlobalNewWorkspaceComposer(page);
  await expect(pill).toContainText("Source conversation for new workspace");
  await expect(input).toHaveAttribute("data-markdown", draft);
  await page.screenshot({ path: "/tmp/paseoi-r58-new-workspace-drop.png" });
  await submitNewWorkspacePrompt(page, draft);
  await expect.poll(() => gate.getClientRequests("workspace.create.request").length).toBe(1);
  expect(gate.getClientRequests("workspace.create.request")[0]).toMatchObject({
    agent: {
      initialPrompt: draft,
      attachments: [
        expect.objectContaining({
          type: "text",
          contextKind: "chat_history",
          title: "Source conversation for new workspace",
          text: expect.stringContaining(source.agentId),
        }),
      ],
    },
  });
  expect(JSON.stringify(gate.getClientRequests("workspace.create.request"))).toContain(
    "source conversation secret detail",
  );
  await expect(page).not.toHaveURL(/\/new(?:\?.*)?$/);
  await openGlobalNewWorkspaceComposer(page);
  await expect(pill).toHaveCount(0);
  await expect(input).toHaveAttribute("data-markdown", "");
});

test("a failed conversation drop preserves the draft without inserting a dangling reference", async ({
  page,
  seedForkWorkspace,
}) => {
  const target = await seedForkWorkspace({
    repoPrefix: "conversation-drop-error-",
    title: "Keep draft after failed context",
  });
  await openAgentRoute(page, target);
  await expectComposerVisible(page);
  await fillComposerDraft(page, "Keep my current draft");
  const input = page.getByRole("textbox", { name: "Message agent..." }).first();
  const dataTransfer = await page.evaluateHandle((serverId) => {
    const data = new DataTransfer();
    data.setData(
      "application/x-paseo-session+json",
      JSON.stringify({
        version: 1,
        serverId,
        agentId: "missing-context-session",
        title: "Deleted conversation",
      }),
    );
    return data;
  }, getServerId());
  await input.dispatchEvent("drop", { dataTransfer });
  await expect(
    page.getByText("Agent not found: missing-context-session", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveAttribute("data-markdown", "Keep my current draft");
  await expect(input.locator(".composer-reference")).toHaveCount(0);
  await expect(page.getByTestId("composer-chat-history-attachment-pill")).toHaveCount(0);
  await expect(input).toBeEditable();
});
