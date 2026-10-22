import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { addScheduleHostAndReload, createScheduleHost } from "../support/helpers/schedule-host";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { escapeRegex } from "../support/helpers/regex";
import { expectNoTruncation } from "../support/helpers/no-truncation";
import { expectSettled, expectStableHeight } from "../support/helpers/settled";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { buildSchedulesRoute } from "../../src/utils/host-routes";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";

const MOBILE_SHEET_VIEWPORT = { width: 390, height: 844 };

interface ScheduleListItem {
  id: string;
  name: string | null;
  cadence?: { type: "cron"; expression: string };
  target: {
    type: string;
    config?: {
      cwd?: string;
      archiveOnFinish?: boolean;
      isolation?: "local" | "worktree";
    };
  };
}

interface ScheduleSeedClient {
  scheduleList(): Promise<{ schedules: ScheduleListItem[]; error: string | null }>;
  scheduleDelete(input: { id: string }): Promise<{ error: string | null }>;
}

async function selectModelByLabel(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: /select model/i }).click();
  const popup = page.getByTestId("combobox-desktop-container");
  await expect(popup).toBeVisible({ timeout: 30_000 });
  const searchInput = page.getByTestId("model-search-input").first();
  await expect(searchInput).toBeVisible({ timeout: 30_000 });
  await searchInput.fill(label);
  const option = popup.getByText(new RegExp(`^${escapeRegex(label)}$`, "i")).first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await expect(popup).toHaveCount(0, { timeout: 30_000 });
}

async function deleteScheduleByName(workspace: SeededWorkspace, name: string): Promise<void> {
  const client = workspace.client as unknown as ScheduleSeedClient;
  const list = await client.scheduleList();
  const schedule = list.schedules.find((candidate) => candidate.name === name);
  if (schedule) {
    await client.scheduleDelete({ id: schedule.id }).catch(() => undefined);
  }
}

async function expectScheduleCreatedForProject(input: {
  workspace: SeededWorkspace;
  name: string;
  cadenceExpression: string;
}): Promise<void> {
  const client = input.workspace.client as unknown as ScheduleSeedClient;
  const list = await client.scheduleList();
  const schedule = list.schedules.find((candidate) => candidate.name === input.name);
  expect(schedule).toEqual(
    expect.objectContaining({
      name: input.name,
      cadence: expect.objectContaining({
        type: "cron",
        expression: input.cadenceExpression,
      }),
      target: expect.objectContaining({
        type: "new-agent",
        config: expect.objectContaining({
          cwd: input.workspace.repoPath,
        }),
      }),
    }),
  );
}

async function expectScheduleKnobs(input: {
  workspace: SeededWorkspace;
  name: string;
  archiveOnFinish: boolean;
  isolation: "local" | "worktree";
}): Promise<void> {
  const client = input.workspace.client as unknown as ScheduleSeedClient;
  const list = await client.scheduleList();
  const schedule = list.schedules.find((candidate) => candidate.name === input.name);
  expect(schedule).toEqual(
    expect.objectContaining({
      name: input.name,
      target: expect.objectContaining({
        type: "new-agent",
        config: expect.objectContaining({
          archiveOnFinish: input.archiveOnFinish,
          isolation: input.isolation,
        }),
      }),
    }),
  );
}

async function openNewScheduleSheet(page: Page): Promise<void> {
  await page.getByTestId("schedules-empty-new").click();
  const formSheet = page.getByTestId("schedule-form-sheet");
  await expect(formSheet).toBeVisible({ timeout: 10_000 });
  await expectStableHeight(formSheet);
}

function bottomSheetBackdrop(page: Page) {
  return page.getByRole("button", { name: "Bottom sheet backdrop" }).first();
}

async function dismissScheduleSheetWithBackdrop(page: Page): Promise<void> {
  const backdrop = bottomSheetBackdrop(page);
  await expect(backdrop).toBeVisible({ timeout: 10_000 });
  await expect(async () => {
    const box = await backdrop.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + 24);
    }
    await expect(backdrop).not.toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function expectScheduleSheetClosedAndStable(page: Page): Promise<void> {
  const formSheet = page.getByTestId("schedule-form-sheet");
  await expect(formSheet).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(500);
  await expect(formSheet).toHaveCount(0, { timeout: 1_000 });
}

async function findScheduleIdByName(workspace: SeededWorkspace, name: string): Promise<string> {
  const client = workspace.client as unknown as ScheduleSeedClient;
  const list = await client.scheduleList();
  const schedule = list.schedules.find((candidate) => candidate.name === name);
  if (!schedule) {
    throw new Error(`Expected schedule named ${name} to exist`);
  }
  return schedule.id;
}

async function rejectFirstAgentSchedule(page: Page, agentId: string): Promise<void> {
  let reject = true;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((raw) => {
      const envelope = JSON.parse(raw.toString());
      const request = envelope.message;
      if (request?.type === "schedule/create" && request.target?.agentId === agentId && reject) {
        reject = false;
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "schedule/create/response",
              payload: {
                requestId: request.requestId,
                schedule: null,
                error: "Schedule creation rejected for this check",
              },
            },
          }),
        );
        return;
      }
      server.send(raw);
    });
    server.onMessage((raw) => ws.send(raw));
  });
}

async function expectAgentScheduleExecuted(
  client: DaemonClient,
  scheduleId: string,
  agentId: string,
): Promise<void> {
  const run = await client.scheduleRunOnce({ id: scheduleId });
  expect(run.error).toBeNull();
  // Schedule fires are system-injected turns, so they do not add a human prompt row.
  await expect
    .poll(
      async () => {
        const result = await client.scheduleLogs({ id: scheduleId });
        return result.runs.map((entry) => ({ agentId: entry.agentId, status: entry.status }));
      },
      { timeout: 30_000 },
    )
    .toContainEqual({ agentId, status: "succeeded" });
}

test.describe("Schedules project target", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  for (const layout of ["desktop", "compact"] as const) {
    test(`creates an existing-agent watchdog with failure and retry (${layout})`, async ({
      page,
    }) => {
      const workspace = await seedWorkspace({ repoPrefix: "schedule-existing-agent-", git: false });
      cleanupTasks.push(() => workspace.cleanup());
      const other = await seedWorkspace({ repoPrefix: "schedule-other-project-", git: false });
      cleanupTasks.push(() => other.cleanup());
      const create = (target: SeededWorkspace, title: string) =>
        target.client.createAgent({
          provider: "mock",
          cwd: target.repoPath,
          workspaceId: target.workspaceId,
          title,
          model: "ten-second-stream",
          modeId: "load-test",
        });
      const agent = await create(workspace, "Project coordinator");
      const archived = await create(workspace, "Archived agent");
      await workspace.client.archiveAgent(archived.id);
      const foreign = await create(other, "Another project's agent");
      const scheduleName = `Existing watchdog ${layout} ${Date.now()}`;
      cleanupTasks.push(() => deleteScheduleByName(workspace, scheduleName));
      await rejectFirstAgentSchedule(page, agent.id);
      await page.setViewportSize(
        layout === "compact" ? MOBILE_SHEET_VIEWPORT : { width: 1440, height: 1000 },
      );
      await gotoAppShell(page);
      await page.goto(buildSchedulesRoute());
      await expect(page.getByTestId("schedules-empty-new")).toBeVisible();
      await openNewScheduleSheet(page);
      await page.getByTestId("schedule-project-trigger").click();
      await page
        .getByTestId(`schedule-project-option-${projectEquivalenceViewKey(workspace.projectKey)}`)
        .click();
      await expect(page.getByTestId("schedule-agent-trigger")).toContainText("New agent each run");
      await page.getByTestId("schedule-agent-trigger").click();
      await expect(page.getByTestId(`schedule-agent-option-${archived.id}`)).toHaveCount(0);
      await expect(page.getByTestId(`schedule-agent-option-${foreign.id}`)).toHaveCount(0);
      await page.getByTestId(`schedule-agent-option-${agent.id}`).click();
      const selectedAgent = await page.getByTestId("schedule-agent-trigger").textContent();
      await expect(page.getByTestId("schedule-model-trigger")).toHaveCount(0);
      await expect(page.getByTestId("schedule-isolation-trigger")).toHaveCount(0);
      await page.getByTestId("schedule-watchdog-prompt").click();
      const promptInput = page.getByTestId("schedule-prompt-input");
      const prompt = await promptInput.inputValue();
      expect(prompt).toContain(workspace.repoPath);
      expect(prompt).toContain("unarchived agents");
      await page.getByTestId("schedule-name-input").fill(scheduleName);
      await page.getByTestId("schedule-max-runs-input").fill("1");
      await page.getByTestId("schedule-agent-trigger").click();
      await page.getByTestId("schedule-agent-option-new").click();
      await expect(page.getByTestId("schedule-model-trigger")).toBeVisible();
      await expect(promptInput).toHaveValue(prompt);
      await page.getByTestId("schedule-agent-trigger").click();
      await page.getByTestId(`schedule-agent-option-${agent.id}`).click();
      await page.getByTestId("schedule-form-submit").click({ trial: true });
      await page.screenshot({ path: `/tmp/paseoi-r84-watchdog-form-${layout}.png` });
      await page.getByTestId("schedule-form-submit").click();
      await expect(
        page.getByText("Schedule creation rejected for this check", { exact: true }),
      ).toBeVisible();
      await expect(promptInput).toHaveValue(prompt);
      await expect(page.getByTestId("schedule-agent-trigger")).toHaveText(selectedAgent!);
      await page.getByTestId("schedule-form-submit").click();
      await expect(page.getByTestId("schedule-form-sheet")).toHaveCount(0);
      const client = workspace.client as unknown as DaemonClient;
      const result = await client.scheduleList();
      const scheduled = result.schedules.find((entry) => entry.name === scheduleName);
      expect(scheduled).toMatchObject({
        prompt,
        target: { type: "agent", agentId: agent.id },
        maxRuns: 1,
      });
      await page.screenshot({ path: `/tmp/paseoi-r84-existing-watchdog-${layout}.png` });
      if (layout === "desktop") {
        await expectAgentScheduleExecuted(client, scheduled!.id, agent.id);
        await workspace.client.waitForFinish(agent.id, 30_000);
        const restored = await workspace.client.fetchAgent({ agentId: agent.id });
        expect(restored).toMatchObject({ agent: { id: agent.id } });
        expect(restored?.agent.archivedAt ?? null).toBeNull();
      }
    });
  }

  test("dismisses the new schedule sheet without reopening", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-sheet-dismiss-", git: false });
    cleanupTasks.push(() => workspace.cleanup());

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildSchedulesRoute());
    await page.setViewportSize(MOBILE_SHEET_VIEWPORT);
    await expect(page.getByTestId("schedules-empty-new")).toBeVisible({ timeout: 30_000 });

    await openNewScheduleSheet(page);
    await dismissScheduleSheetWithBackdrop(page);
    await expectScheduleSheetClosedAndStable(page);
    await expect(page.getByTestId("schedules-empty-new")).toBeVisible({ timeout: 30_000 });

    await openNewScheduleSheet(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expectScheduleSheetClosedAndStable(page);
  });

  test("creates a schedule from a project picker instead of a raw CWD selector", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-project-target-", git: false });
    cleanupTasks.push(() => workspace.cleanup());
    const scheduleName = `Project schedule ${Date.now()}`;
    cleanupTasks.push(() => deleteScheduleByName(workspace, scheduleName));

    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    await page.getByRole("button", { name: "Schedules" }).click();
    await expect(page).toHaveURL(/\/schedules$/);
    await expect(page).not.toHaveURL(/\/h\//);
    await expect(page.getByTestId("schedules-empty")).toBeVisible();

    await page.getByTestId("schedules-empty-new").click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);
    await expect(page.getByTestId("schedule-host-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-project-trigger")).toBeVisible();
    await expect(page.getByTestId("schedule-model-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-thinking-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-mode-trigger")).toHaveCount(0);
    await expect(page.getByTestId("cadence-mode")).toHaveCount(0);
    await expect(page.getByTestId("cadence-interval-value")).toHaveCount(0);
    await expect(page.getByText(/Times are in/)).toHaveCount(0);
    await expect(formSheet.getByText("Cron", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /select project/i }).click();
    await page
      .getByTestId(`schedule-project-option-${projectEquivalenceViewKey(workspace.projectKey)}`)
      .click();
    const projectTrigger = page.getByTestId("schedule-project-trigger");
    await expect(projectTrigger).toContainText(workspace.projectDisplayName);
    await expectSettled(projectTrigger);

    await selectModelByLabel(page, "Ten second stream");
    const modelTrigger = page.getByTestId("schedule-model-trigger");
    await expect(modelTrigger).toContainText("Ten second stream");
    await expectSettled(modelTrigger);
    await expect(page.getByTestId("schedule-thinking-trigger")).toContainText("Low");
    await expectSettled(page.getByTestId("schedule-thinking-trigger"));
    await expect(page.getByTestId("schedule-mode-trigger")).toBeVisible();
    await expectSettled(page.getByTestId("schedule-mode-trigger"));
    await expect(page.getByTestId("schedule-isolation-trigger")).toHaveCount(0);
    await expect(page.getByText("Worktree isolation is available for git projects.")).toHaveCount(
      0,
    );

    await page.getByTestId("schedule-cadence-preset-trigger").click();
    await page.getByTestId("schedule-cadence-preset-daily-9").click();
    await expect(page.getByTestId("schedule-cadence-preset-trigger")).toContainText("Daily 9:00");
    await expect(page.getByTestId("cadence-cron-expression")).toHaveValue("0 9 * * *");

    await page.getByLabel("Schedule name").fill(scheduleName);
    await page.getByLabel("Prompt").fill("Summarize the project status.");
    await page.getByRole("button", { name: "Create schedule" }).click();

    await expect(page.getByTestId("schedule-form-sheet")).toHaveCount(0, { timeout: 30_000 });
    await expectScheduleCreatedForProject({
      workspace,
      name: scheduleName,
      cadenceExpression: "0 9 * * *",
    });

    const secondary = await createScheduleHost();
    cleanupTasks.push(() => secondary.cleanup());
    await addScheduleHostAndReload({
      page,
      serverId: secondary.serverId,
      label: secondary.label,
      port: secondary.port,
    });

    const hostFilterTrigger = page.getByTestId("schedules-host-filter-trigger");
    await expect(hostFilterTrigger).toBeVisible({ timeout: 30_000 });
    await hostFilterTrigger.click();
    const hostFilterPopup = page.getByTestId("combobox-desktop-container").last();
    await expect(hostFilterPopup).toBeVisible({ timeout: 30_000 });
    await expectNoTruncation(hostFilterPopup);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("combobox-desktop-container")).toHaveCount(0, {
      timeout: 5_000,
    });
  });

  test("clears the selected project and model when the host changes", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-project-host-model-" });
    cleanupTasks.push(() => workspace.cleanup());
    const serverId = getServerId();
    const secondary = await createScheduleHost();
    cleanupTasks.push(() => secondary.cleanup());

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildSchedulesRoute());
    await addScheduleHostAndReload({
      page,
      serverId: secondary.serverId,
      label: secondary.label,
      port: secondary.port,
    });
    await expect(page.getByTestId("schedules-empty")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("schedules-empty-new").click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);

    const hostTrigger = page.getByTestId("schedule-host-trigger");
    const projectTrigger = page.getByTestId("schedule-project-trigger");
    const modelTrigger = page.getByTestId("schedule-model-trigger");
    const thinkingTrigger = page.getByTestId("schedule-thinking-trigger");
    const modeTrigger = page.getByTestId("schedule-mode-trigger");
    await expect(hostTrigger).toBeVisible({ timeout: 30_000 });
    await expect(projectTrigger).toHaveCount(0);
    await expect(modelTrigger).toHaveCount(0);
    await expect(thinkingTrigger).toHaveCount(0);
    await expect(modeTrigger).toHaveCount(0);
    await hostTrigger.click();
    await page.getByTestId(`schedule-host-option-${serverId}`).click();
    await expect(projectTrigger).toBeVisible();
    await expect(modelTrigger).toHaveCount(0);
    await expect(thinkingTrigger).toHaveCount(0);
    await expect(modeTrigger).toHaveCount(0);
    await expectSettled(hostTrigger);

    await projectTrigger.click();
    await page
      .getByTestId(`schedule-project-option-${projectEquivalenceViewKey(workspace.projectKey)}`)
      .click();
    await expect(projectTrigger).toContainText(workspace.projectDisplayName);
    await expectSettled(projectTrigger);

    await selectModelByLabel(page, "Ten second stream");
    await expect(modelTrigger).toContainText("Ten second stream");
    await expectSettled(modelTrigger);
    await expect(thinkingTrigger).toContainText("Low");
    await expectSettled(thinkingTrigger);
    await expect(modeTrigger).toBeVisible();
    await expectSettled(modeTrigger);

    await hostTrigger.click();
    await page.getByTestId(`schedule-host-option-${secondary.serverId}`).click();
    await expect(hostTrigger).toContainText(secondary.label);
    await expect(projectTrigger).toContainText(/select project/i);
    await expect(modelTrigger).toHaveCount(0);
    await expect(thinkingTrigger).toHaveCount(0);
    await expect(modeTrigger).toHaveCount(0);
    await expectSettled(hostTrigger);
    await expectSettled(projectTrigger);

    await projectTrigger.click();
    await page
      .getByTestId(`schedule-project-option-${projectEquivalenceViewKey(secondary.projectKey)}`)
      .click();
    await expect(projectTrigger).toContainText(secondary.projectDisplayName);
    await expectSettled(projectTrigger);
    await expect(modelTrigger).toContainText(/select model/i);
    await expectSettled(modelTrigger);
    await expect(thinkingTrigger).toHaveCount(0);
    await expect(modeTrigger).toHaveCount(0);

    await page.getByLabel("Schedule name").fill(`Cross host model ${Date.now()}`);
    await page.getByLabel("Prompt").fill("Run on the secondary host project.");
    await expect(page.getByRole("button", { name: "Create schedule" })).toBeDisabled();
  });

  test("creates and edits schedule isolation and archive cleanup knobs", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-knobs-" });
    cleanupTasks.push(() => workspace.cleanup());
    const scheduleName = `Knob schedule ${Date.now()}`;
    cleanupTasks.push(() => deleteScheduleByName(workspace, scheduleName));

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildSchedulesRoute());
    await expect(page.getByTestId("schedules-empty-new")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("schedules-empty-new").click();

    await page.getByRole("button", { name: /select project/i }).click();
    await page
      .getByTestId(`schedule-project-option-${projectEquivalenceViewKey(workspace.projectKey)}`)
      .click();
    await selectModelByLabel(page, "Ten second stream");
    await expect(
      page.getByText("Off keeps each run's workspace in the sidebar for inspection."),
    ).toHaveCount(0);
    await page.getByTestId("schedule-isolation-trigger").click();
    await page.getByTestId("schedule-isolation-worktree").click();
    await expect(page.getByTestId("schedule-isolation-trigger")).toContainText("Worktree");
    await page.getByTestId("schedule-archive-on-finish-switch").click();
    await page.getByLabel("Schedule name").fill(scheduleName);
    await page.getByLabel("Prompt").fill("Run with custom workspace cleanup.");
    await page.getByTestId("schedule-cadence-preset-trigger").click();
    await page.getByTestId("schedule-cadence-preset-every-hour").click();
    await page.getByRole("button", { name: "Create schedule" }).click();

    await expect(page.getByTestId("schedule-form-sheet")).toHaveCount(0, { timeout: 30_000 });
    await expectScheduleKnobs({
      workspace,
      name: scheduleName,
      archiveOnFinish: false,
      isolation: "worktree",
    });

    const scheduleId = await findScheduleIdByName(workspace, scheduleName);
    await page.getByTestId(`schedule-row-${scheduleId}`).click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);
    await expect(page.getByTestId("schedule-isolation-trigger")).toContainText("Worktree");
    await expect(page.getByTestId("schedule-archive-on-finish-switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(
      page.getByText("Off keeps each run's workspace in the sidebar for inspection."),
    ).toHaveCount(0);

    await page.getByTestId("schedule-isolation-trigger").click();
    await page.getByTestId("schedule-isolation-local").click();
    await page.getByTestId("schedule-archive-on-finish-switch").click();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByTestId("schedule-form-sheet")).toHaveCount(0, { timeout: 30_000 });
    await expectScheduleKnobs({
      workspace,
      name: scheduleName,
      archiveOnFinish: true,
      isolation: "local",
    });
  });
});
