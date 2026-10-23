import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  addScheduleHostAndReload,
  createScheduleHost,
  SECONDARY_MODEL_ID,
  SECONDARY_MODEL_LABEL,
} from "../support/helpers/schedule-host";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { expectSettled, expectStableHeight } from "../support/helpers/settled";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { buildSchedulesRoute } from "../../src/utils/host-routes";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

type ScheduleSeedClient = Pick<DaemonClient, "scheduleCreate" | "scheduleDelete" | "scheduleList">;

async function seedMockSchedule(
  workspace: SeededWorkspace,
  name: string,
  model = "ten-second-stream",
): Promise<string> {
  const client = workspace.client as unknown as ScheduleSeedClient;
  const result = await client.scheduleCreate({
    prompt: "Say hello from the scheduled agent.",
    name,
    cadence: { type: "cron", expression: "0 9 * * *" },
    target: {
      type: "new-agent",
      config: {
        provider: "mock",
        cwd: workspace.repoPath,
        model,
        modeId: "load-test",
        title: name,
      },
    },
    runOnCreate: false,
  });

  if (!result.schedule) {
    throw new Error(result.error ?? "Failed to seed schedule");
  }

  return result.schedule.id;
}

function ignoreScheduleDeleteError(): void {}

async function deleteSeededSchedule(workspace: SeededWorkspace, id: string): Promise<void> {
  await (workspace.client as unknown as ScheduleSeedClient)
    .scheduleDelete({ id })
    .catch(ignoreScheduleDeleteError);
}

async function readSeededSchedule(client: ScheduleSeedClient, id: string) {
  const list = await client.scheduleList();
  return list.schedules.find((schedule) => schedule.id === id);
}

async function hideRetargetCapability(page: Page) {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((raw) => {
      const envelope = JSON.parse(raw.toString());
      const payload = envelope.message?.payload ?? envelope.payload;
      if (payload?.status === "server_info" && payload.features)
        delete payload.features.scheduleAgentRetarget;
      ws.send(JSON.stringify(envelope));
    });
  });
}

test.describe("Schedules", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  test("pauses and resumes a heartbeat without losing its details across reload", async ({
    page,
  }, testInfo) => {
    const workspace = await seedWorkspace({ repoPrefix: "heartbeat-pause-" });
    cleanupTasks.push(() => workspace.cleanup());
    const agent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Pausable heartbeat target",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    const client = workspace.client as unknown as ScheduleSeedClient;
    const details = {
      name: "Pausable watcher",
      prompt: "Check ongoing work and report changes.",
      cadence: { type: "cron" as const, expression: "0 0 1 1 *", timezone: "UTC" },
      target: { type: "agent" as const, agentId: agent.id },
      maxRuns: 5,
    };
    const created = await client.scheduleCreate({ ...details, runOnCreate: false });
    if (!created.schedule) throw new Error(created.error ?? "Could not create heartbeat");
    const id = created.schedule.id;
    cleanupTasks.push(() => deleteSeededSchedule(workspace, id));
    await page.goto(buildSchedulesRoute());
    const row = page.getByTestId(`schedule-row-${id}`);
    await expect(row).toContainText("Active");
    await page.getByTestId(`schedule-kebab-${id}`).click();
    await expect(page.getByTestId(`schedule-menu-run-${id}`)).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Pause heartbeat", exact: true }).click();
    await expect
      .poll(() => readSeededSchedule(client, id))
      .toMatchObject({ ...details, status: "paused", nextRunAt: null });
    await expect(row).toContainText("Paused");
    await expect(row).not.toContainText("Next run");
    await page.reload({ waitUntil: "commit" });
    await expect(row).toContainText("Paused");
    await page.getByTestId(`schedule-kebab-${id}`).click();
    await expect(
      page.getByRole("menuitem", { name: "Resume heartbeat", exact: true }),
    ).toBeEnabled();
    await page.waitForTimeout(250); // Capture the menu after its entry animation.
    await page.screenshot({ path: testInfo.outputPath("heartbeat-paused-menu.png") });
    await page.getByRole("menuitem", { name: "Resume heartbeat", exact: true }).click();
    await expect
      .poll(() => readSeededSchedule(client, id))
      .toMatchObject({
        ...details,
        status: "active",
        pausedAt: null,
        nextRunAt: expect.any(String),
      });
    await expect(row).toContainText("Active");
    await expect(row).toContainText("Next run");
    await page.reload({ waitUntil: "commit" });
    await expect(row).toContainText("Active");
    await page.getByTestId(`schedule-kebab-${id}`).click();
    await expect(
      page.getByRole("menuitem", { name: "Pause heartbeat", exact: true }),
    ).toBeEnabled();
  });

  for (const canRetarget of [true, false]) {
    test(`edits heartbeat details and restores the saved prompt on reopen (retarget ${canRetarget})`, async ({
      page,
    }, testInfo) => {
      const workspace = await seedWorkspace({ repoPrefix: "heartbeat-edit-details-" });
      cleanupTasks.push(() => workspace.cleanup());
      const agent = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Heartbeat delivery target",
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      const replacement = await workspace.client.createAgent({
        provider: "mock",
        cwd: workspace.repoPath,
        workspaceId: workspace.workspaceId,
        title: "Coordinator delivery target",
        modeId: "load-test",
        model: "e2e-fast-stream",
      });
      if (!canRetarget) await hideRetargetCapability(page);
      const client = workspace.client as unknown as ScheduleSeedClient;
      const cadence = { type: "cron" as const, expression: "0 0 1 1 *", timezone: "UTC" };
      const originalPrompt = "Check current agent activity.\nReport only changes and blockers.";
      const created = await client.scheduleCreate({
        name: "Original watcher",
        prompt: originalPrompt,
        cadence,
        target: { type: "agent", agentId: agent.id },
        maxRuns: 5,
        runOnCreate: false,
      });
      if (!created.schedule) throw new Error(created.error ?? "Could not create test heartbeat");
      const id = created.schedule.id;
      cleanupTasks.push(() => deleteSeededSchedule(workspace, id));
      await page.goto(buildSchedulesRoute());
      const row = page.getByTestId(`schedule-row-${id}`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      const sheet = page.getByTestId("schedule-form-sheet");
      await expect(sheet.getByText("Edit heartbeat", { exact: true })).toBeVisible();
      const prompt = page.getByTestId("schedule-prompt-input");
      await expect(prompt).toHaveValue(originalPrompt);
      await expect(page.getByTestId("schedule-name-input")).toHaveValue("Original watcher");
      await expect(page.getByTestId("schedule-max-runs-input")).toHaveValue("5");
      await expect(sheet).toContainText("Heartbeat delivery target");
      await expect(page.getByTestId("schedule-model-trigger")).toHaveCount(0);
      await expect(page.getByTestId("schedule-watchdog-prompt")).toHaveCount(0);
      await prompt.fill(" \n ");
      await expect(page.getByTestId("schedule-form-submit")).toBeDisabled();
      const updatedPrompt =
        "Inspect unarchived agents and delegated work.\nReport blockers without interrupting active work.";
      await prompt.fill(updatedPrompt);
      await page.getByTestId("schedule-name-input").fill("Updated watcher");
      await page.getByTestId("schedule-max-runs-input").fill("8");
      const target = page.getByTestId("schedule-agent-target");
      if (canRetarget) {
        await target.click();
        await expect(page.getByTestId("schedule-agent-option-new")).toHaveCount(0);
        await page.getByTestId(`schedule-agent-option-${replacement.id}`).click();
        await expect(target).toContainText("Coordinator delivery target");
      } else {
        await expect(target).toBeDisabled();
        await expect(sheet).toContainText(
          "Update and restart the host to change the delivery target.",
        );
      }

      await sheet.screenshot({ path: testInfo.outputPath("heartbeat-edit-details.png") });
      await page.getByTestId("schedule-form-submit").click();
      await expect(sheet).toHaveCount(0);
      await expect
        .poll(() => readSeededSchedule(client, id))
        .toMatchObject({
          name: "Updated watcher",
          prompt: updatedPrompt,
          maxRuns: 8,
          cadence,
          nextRunAt: created.schedule.nextRunAt,
          target: { type: "agent", agentId: canRetarget ? replacement.id : agent.id },
        });
      await row.click();
      await expect(prompt).toHaveValue(updatedPrompt);
      await expect(page.getByTestId("schedule-agent-target")).toContainText(
        canRetarget ? "Coordinator delivery target" : "Heartbeat delivery target",
      );
      await expect(page.getByTestId("schedule-name-input")).toHaveValue("Updated watcher");
      await expect(page.getByTestId("schedule-max-runs-input")).toHaveValue("8");
      await prompt.fill("Discard this unsaved change.");
      await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await row.click();
      await expect(prompt).toHaveValue(updatedPrompt);
      await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.reload({ waitUntil: "commit" });
      await row.click();
      await expect(prompt).toHaveValue(updatedPrompt);
      await sheet.screenshot({ path: testInfo.outputPath("heartbeat-details-restored.png") });
    });
  }

  test("edit form hydrates the scheduled model selection", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-model-hydration-" });
    cleanupTasks.push(() => workspace.cleanup());
    const scheduleName = `Hydrate model ${Date.now()}`;
    const scheduleId = await seedMockSchedule(workspace, scheduleName);
    cleanupTasks.push(() => deleteSeededSchedule(workspace, scheduleId));

    await page.goto(buildSchedulesRoute());
    const row = page.getByTestId(`schedule-row-${scheduleId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(workspace.projectDisplayName, { timeout: 30_000 });

    await row.click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);
    const hostTrigger = page.getByTestId("schedule-host-trigger");
    const projectTrigger = page.getByTestId("schedule-project-trigger");
    const modelTrigger = page.getByTestId("schedule-model-trigger");
    const thinkingTrigger = page.getByTestId("schedule-thinking-trigger");
    const modeTrigger = page.getByTestId("schedule-mode-trigger");
    await expect(hostTrigger).toBeVisible({ timeout: 30_000 });
    await expect(hostTrigger).toBeDisabled();
    await expectSettled(hostTrigger);
    await expect(projectTrigger).toContainText(workspace.projectDisplayName, { timeout: 30_000 });
    await expectSettled(projectTrigger);
    await expect(modelTrigger).toContainText("Ten second stream", { timeout: 30_000 });
    await expectSettled(modelTrigger);
    await expect(thinkingTrigger).toContainText("Low");
    await expectSettled(thinkingTrigger);
    await expect(modeTrigger).toBeVisible({ timeout: 30_000 });
    await expectSettled(modeTrigger);
    await expect(page.getByTestId("cadence-mode")).toHaveCount(0);
    await expect(page.getByTestId("cadence-interval-value")).toHaveCount(0);
    await expect(page.getByTestId("schedule-cadence-preset-trigger")).toContainText("Daily 9:00");
    await expect(page.getByText(/Times are in/)).toHaveCount(0);
    await expect(formSheet.getByText("Cron", { exact: true })).toHaveCount(0);
  });

  test("edit form hydrates a non-default host schedule after reload", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-host-b-hydration-" });
    cleanupTasks.push(() => workspace.cleanup());
    const secondary = await createScheduleHost();
    cleanupTasks.push(() => secondary.cleanup());
    const scheduleId = await seedMockSchedule(
      secondary,
      "Secondary host schedule",
      SECONDARY_MODEL_ID,
    );
    cleanupTasks.push(() => deleteSeededSchedule(secondary, scheduleId));

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildSchedulesRoute());
    await addScheduleHostAndReload({
      page,
      serverId: secondary.serverId,
      label: secondary.label,
      port: secondary.port,
    });
    await page.reload();

    const row = page.getByTestId(`schedule-row-${scheduleId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);
    const hostTrigger = page.getByTestId("schedule-host-trigger");
    const projectTrigger = page.getByTestId("schedule-project-trigger");
    const modelTrigger = page.getByTestId("schedule-model-trigger");
    const modeTrigger = page.getByTestId("schedule-mode-trigger");

    await expect(hostTrigger).toContainText(secondary.label, { timeout: 30_000 });
    await expect(hostTrigger).toBeDisabled();
    await expectSettled(hostTrigger);
    await expect(projectTrigger).toContainText(secondary.projectDisplayName, { timeout: 30_000 });
    await expectSettled(projectTrigger);
    await expect(modelTrigger).toContainText(SECONDARY_MODEL_LABEL, { timeout: 30_000 });
    await expectSettled(modelTrigger);
    await expect(modeTrigger).toContainText("Load Test", { timeout: 30_000 });
    await expectSettled(modeTrigger);
    await expect(page.getByTestId("cadence-mode")).toHaveCount(0);
    await expect(page.getByTestId("schedule-cadence-preset-trigger")).toContainText("Daily 9:00");
  });

  test("create opens pristine after closing an edit form", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-pristine-create-" });
    cleanupTasks.push(() => workspace.cleanup());
    const scheduleName = `Pristine create ${Date.now()}`;
    const scheduleId = await seedMockSchedule(workspace, scheduleName);
    cleanupTasks.push(() => deleteSeededSchedule(workspace, scheduleId));

    await page.goto(buildSchedulesRoute());
    const row = page.getByTestId(`schedule-row-${scheduleId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    const formSheet = page.getByTestId("schedule-form-sheet");
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(formSheet);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(formSheet).toHaveCount(0, { timeout: 30_000 });

    await page.getByTestId("schedules-new").click();
    await expect(formSheet).toBeVisible({ timeout: 10_000 });
    const projectTrigger = page.getByTestId("schedule-project-trigger");
    await expect(projectTrigger).toContainText(/select project/i);
    await expectSettled(projectTrigger);
    await expect(page.getByTestId("schedule-model-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-thinking-trigger")).toHaveCount(0);
    await expect(page.getByTestId("schedule-mode-trigger")).toHaveCount(0);
    await expect(page.getByTestId("cadence-interval-value")).toHaveCount(0);
  });
});
