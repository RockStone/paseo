import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import {
  archiveAgentFromDaemon,
  archiveAgentFromSessions,
  clickSessionRow,
  createIdleAgent,
  createMockIdleAgent,
  closeWorkspaceAgentTab,
  expectArchivedAgentFocused,
  expectSessionRowArchived,
  expectSessionRowVisible,
  expectWorkspaceArchiveOutcome,
  expectWorkspaceTabHidden,
  expectWorkspaceTabVisible,
  fetchAgentArchivedAt,
  openSessions,
  openWorkspaceWithAgents,
  primeAdditionalPage,
  resetSeededPageState,
  reloadWorkspace,
} from "../support/helpers/archive-tab";
import { expectAgentTabActive } from "../support/helpers/launcher";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import { switchWorkspaceViaSidebar } from "../support/helpers/workspace-ui";
import {
  rejectNextManagedSubagentArchiveRequest,
  seedSubagent,
} from "../support/helpers/subagents";

test.describe("Archive tab reconciliation", () => {
  let client: Awaited<ReturnType<typeof connectSeedClient>>;
  let tempRepo: { path: string; cleanup: () => Promise<void> };
  let projectId: string;
  let workspaceId: string;

  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    tempRepo = await createTempGitRepo("archive-tab-");
    client = await connectSeedClient();
    const created = await client.createWorkspace({
      source: { kind: "directory", path: tempRepo.path },
    });
    if (!created.workspace) {
      throw new Error(created.error ?? `Failed to create workspace ${tempRepo.path}`);
    }
    projectId = created.workspace.projectId;
    workspaceId = created.workspace.id;
  });

  test.afterAll(async () => {
    await client?.removeProject(projectId).catch(() => undefined);
    await client?.close().catch(() => undefined);
    await tempRepo?.cleanup();
  });

  test("non-UI archive prunes the archived tab across open pages and reload", async ({ page }) => {
    const archived = await createIdleAgent(client, {
      cwd: tempRepo.path,
      workspaceId,
      title: `cli-archive-${randomUUID().slice(0, 8)}`,
    });
    const surviving = await createIdleAgent(client, {
      cwd: tempRepo.path,
      workspaceId,
      title: `cli-control-${randomUUID().slice(0, 8)}`,
    });
    const passivePage = await page.context().newPage();

    try {
      await primeAdditionalPage(passivePage);
      await resetSeededPageState(page);
      await resetSeededPageState(passivePage);
      await openSessions(page);
      await expectSessionRowVisible(page, archived.title);
      await expectSessionRowVisible(page, surviving.title);
      await openSessions(passivePage);
      await expectSessionRowVisible(passivePage, archived.title);
      await expectSessionRowVisible(passivePage, surviving.title);
      await openWorkspaceWithAgents(page, [archived, surviving]);
      await openWorkspaceWithAgents(passivePage, [archived, surviving]);
      await archiveAgentFromDaemon(client, archived.id);
      await expectWorkspaceArchiveOutcome(page, {
        archivedAgentId: archived.id,
        survivingAgentId: surviving.id,
      });
      await expectWorkspaceArchiveOutcome(passivePage, {
        archivedAgentId: archived.id,
        survivingAgentId: surviving.id,
      });
      await reloadWorkspace(passivePage, surviving.workspaceId);
      await expectWorkspaceTabHidden(passivePage, archived.id);
    } finally {
      await passivePage.close();
    }
  });

  test("Sessions archive prunes the archived tab across open pages", async ({ page }) => {
    const archived = await createIdleAgent(client, {
      cwd: tempRepo.path,
      workspaceId,
      title: `ui-archive-${randomUUID().slice(0, 8)}`,
    });
    const surviving = await createIdleAgent(client, {
      cwd: tempRepo.path,
      workspaceId,
      title: `ui-control-${randomUUID().slice(0, 8)}`,
    });
    const passivePage = await page.context().newPage();

    try {
      await primeAdditionalPage(passivePage);
      await resetSeededPageState(page);
      await resetSeededPageState(passivePage);
      await openWorkspaceWithAgents(page, [archived, surviving]);
      await openWorkspaceWithAgents(passivePage, [archived, surviving]);
      await openSessions(page);
      await archiveAgentFromSessions(page, { agentId: archived.id, title: archived.title });
      await reloadWorkspace(page, surviving.workspaceId);
      await expectWorkspaceTabHidden(page, archived.id);
      await expectWorkspaceArchiveOutcome(passivePage, {
        archivedAgentId: archived.id,
        survivingAgentId: surviving.id,
      });
    } finally {
      await passivePage.close();
    }
  });

  test("clicking an archived session navigates without unarchiving it", async ({ page }) => {
    const archived = await createIdleAgent(client, {
      cwd: tempRepo.path,
      workspaceId,
      title: `unarchive-archived-${randomUUID().slice(0, 8)}`,
    });
    const surviving = await createIdleAgent(client, {
      cwd: tempRepo.path,
      workspaceId,
      title: `unarchive-control-${randomUUID().slice(0, 8)}`,
    });

    await resetSeededPageState(page);
    await openWorkspaceWithAgents(page, [archived, surviving]);
    await archiveAgentFromDaemon(client, archived.id);
    const archivedAt = await fetchAgentArchivedAt(client, archived.id);
    expect(archivedAt).not.toBeNull();
    await openSessions(page);
    await expectSessionRowArchived(page, archived.title);

    await clickSessionRow(page, archived.title);

    await expectArchivedAgentFocused(page, archived.id);
    await expectAgentTabActive(page, archived.id);
    expect(await fetchAgentArchivedAt(client, archived.id)).toBe(archivedAt);

    await expect(page).toHaveURL(buildHostWorkspaceRoute(getServerId(), archived.workspaceId), {
      timeout: 30_000,
    });
  });
});

test.describe("Agent tab lifecycle", () => {
  test("tab close keeps the parent history and children, and can be reopened from the sidebar", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "close-parent-tab-" });
    const timelineClient = workspace.client as typeof workspace.client &
      Pick<DaemonClient, "fetchAgentTimeline">;
    try {
      const parent = await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Parent whose tab can close",
      });
      const child = await seedSubagent(workspace, { parentId: parent.id, title: "Retained child" });
      await workspace.client.sendAgentMessage(parent.id, "Keep this original conversation.");
      await workspace.client.waitForFinish(parent.id, 30_000);
      const before = await timelineClient.fetchAgentTimeline(parent.id, {
        direction: "tail",
        limit: 0,
        projection: "projected",
      });
      expect(before.entries.length).toBeGreaterThan(0);
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parent.id });
      await page.getByTestId(`workspace-tab-agent_${parent.id}`).filter({ visible: true }).hover();
      await closeWorkspaceAgentTab(page, parent.id);
      expect(await fetchAgentArchivedAt(workspace.client, parent.id)).toBeNull();
      await expect(workspace.client.fetchAgent({ agentId: child.id })).resolves.toMatchObject({
        agent: { archivedAt: null, labels: { "paseo.parent-agent-id": parent.id } },
      });
      await page.reload();
      await expectWorkspaceTabHidden(page, parent.id);
      await switchWorkspaceViaSidebar({
        page,
        serverId: getServerId(),
        workspaceId: workspace.workspaceId,
      });
      await expectAgentTabActive(page, parent.id);
      const after = await timelineClient.fetchAgentTimeline(parent.id, {
        direction: "tail",
        limit: 0,
        projection: "projected",
      });
      expect(after.entries.map((entry) => entry.item)).toEqual(
        before.entries.map((entry) => entry.item),
      );
    } finally {
      await workspace.cleanup();
    }
  });

  test("bulk and single tab close preserve running agents; explicit archive requires confirmation", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "bulk-close-agent-tabs-" });
    try {
      const parent = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Running parent",
        modeId: "load-test",
        model: "five-minute-stream",
        initialPrompt: "Keep running",
      });
      const child = await seedSubagent(workspace, { parentId: parent.id, title: "Child tab" });
      const control = await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Keep this tab",
      });
      for (const agent of [parent, child, control]) {
        await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: agent.id });
        await expectWorkspaceTabVisible(page, agent.id);
      }
      const controlTab = page
        .getByTestId(`workspace-tab-agent_${control.id}`)
        .filter({ visible: true });
      await controlTab.click({ button: "right" });
      const bulkDialog = page.waitForEvent("dialog").then(async (dialog) => {
        expect(dialog.message()).toContain("This will close 2 tab(s).");
        return dialog.accept();
      });
      await page.getByTestId(`workspace-tab-context-agent_${control.id}-close-others`).click();
      await bulkDialog;
      await expectWorkspaceTabHidden(page, parent.id);
      await expectWorkspaceTabHidden(page, child.id);
      await expect(workspace.client.fetchAgent({ agentId: parent.id })).resolves.toMatchObject({
        agent: { status: "running", archivedAt: null },
      });
      await expect(workspace.client.fetchAgent({ agentId: child.id })).resolves.toMatchObject({
        agent: { archivedAt: null, labels: { "paseo.parent-agent-id": parent.id } },
      });

      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parent.id });
      await page.getByTestId(`workspace-tab-agent_${parent.id}`).filter({ visible: true }).hover();
      await closeWorkspaceAgentTab(page, parent.id);
      await expect(workspace.client.fetchAgent({ agentId: parent.id })).resolves.toMatchObject({
        agent: { status: "running", archivedAt: null },
      });
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parent.id });
      const parentTab = page
        .getByTestId(`workspace-tab-agent_${parent.id}`)
        .filter({ visible: true });
      await parentTab.click({ button: "right" });
      const archiveItem = page.getByTestId(
        `workspace-tab-context-agent_${parent.id}-archive-agent`,
      );
      const cancelDialog = page.waitForEvent("dialog").then(async (dialog) => {
        expect(dialog.message()).toContain("Archive running agent?");
        return dialog.dismiss();
      });
      await archiveItem.click();
      await cancelDialog;
      await expectWorkspaceTabVisible(page, parent.id);
      await expect(workspace.client.fetchAgent({ agentId: parent.id })).resolves.toMatchObject({
        agent: { status: "running", archivedAt: null },
      });

      await parentTab.click({ button: "right" });
      await page.screenshot({ path: "/tmp/paseoi-r71-tab-archive-menu.png" });
      const acceptDialog = page.waitForEvent("dialog").then((dialog) => dialog.accept());
      await archiveItem.click();
      await acceptDialog;
      await expectWorkspaceTabHidden(page, parent.id);
      await expect.poll(() => fetchAgentArchivedAt(workspace.client, parent.id)).not.toBeNull();
      await expect.poll(() => fetchAgentArchivedAt(workspace.client, child.id)).not.toBeNull();
      expect(await fetchAgentArchivedAt(workspace.client, control.id)).toBeNull();
    } finally {
      await workspace.cleanup();
    }
  });

  test("explicit archive restores the tab on failure and can be retried", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "retry-tab-archive-" });
    try {
      const parent = await createMockIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Retry archive",
      });
      const rejected = await rejectNextManagedSubagentArchiveRequest(page, parent.id);
      await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parent.id });
      const tab = page.getByTestId(`workspace-tab-agent_${parent.id}`).filter({ visible: true });
      const item = page.getByTestId(`workspace-tab-context-agent_${parent.id}-archive-agent`);
      await tab.click({ button: "right" });
      await item.click();
      await rejected.waitForRejection();
      await expect(page.getByText("Failed to archive agent", { exact: true })).toBeVisible();
      await expectWorkspaceTabVisible(page, parent.id);
      expect(await fetchAgentArchivedAt(workspace.client, parent.id)).toBeNull();
      await tab.click({ button: "right" });
      await item.click();
      await expectWorkspaceTabHidden(page, parent.id);
      await expect.poll(() => fetchAgentArchivedAt(workspace.client, parent.id)).not.toBeNull();
    } finally {
      await workspace.cleanup();
    }
  });
});
