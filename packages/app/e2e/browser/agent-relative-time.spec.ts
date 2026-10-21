import { expect, test } from "../support/fixtures";
import { openCommandCenter } from "../support/helpers/command-center";
import { getServerId } from "../support/helpers/server-id";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { resetSeededPageState, openSessions } from "../support/helpers/archive-tab";
import { seedWorkspace, type SeedDaemonClient } from "../support/helpers/seed-client";
import { seedParentWithSubagent } from "../support/helpers/subagents";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

test("agent list age advances and command center says just now for a fresh agent", async ({
  page,
}) => {
  const session = await seedMockAgentWorkspace({
    repoPrefix: "agent-relative-time-",
    title: "Relative time agent",
  });
  try {
    await session.client.waitForAgentUpsert(session.agentId, (agent) => agent.status === "idle");
    await resetSeededPageState(page);
    await page.clock.install({ time: Date.now() });
    await openSessions(page);

    const row = page.getByTestId(`agent-row-${getServerId()}-${session.agentId}`);
    await expect(row).toContainText("just now", { timeout: 30_000 });

    const commandCenter = await openCommandCenter(page);
    await commandCenter.getByTestId("command-center-input").fill("Relative time agent");
    const agentResult = commandCenter.getByTestId(
      `command-center-agent-${getServerId()}:${session.agentId}`,
    );
    await expect(agentResult.getByTestId("command-center-result-timestamp")).toContainText(
      "just now",
    );
    await page.keyboard.press("Escape");

    await page.clock.fastForward("03:00");
    await expect(row).toContainText("3m ago");

    await openAgentRoute(page, session);
    await page.getByTestId(`workspace-tab-agent_${session.agentId}`).first().hover();
    await expect(page.getByTestId(`workspace-tab-tooltip-agent_${session.agentId}`)).toContainText(
      "3m ago",
    );

    await expect(page.getByTestId("sidebar-workspace-timestamp").first()).toHaveText("3m");
  } finally {
    await session.cleanup();
  }
});

test("workspace age follows child activity and ignores renames and read state", async ({
  page,
}) => {
  const workspace = await seedWorkspace({
    repoPrefix: "workspace-last-activity-",
    title: "Activity clock",
  });
  const client = workspace.client as Omit<SeedDaemonClient, "fetchAgent"> &
    Pick<DaemonClient, "setWorkspaceTitle" | "fetchAgent">;
  try {
    const pair = await seedParentWithSubagent(workspace, {
      parentTitle: "Clock parent",
      childTitle: "Clock child",
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.clock.install({ time: Date.now() });
    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: pair.parent.id });
    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    const timestamp = row.getByTestId("sidebar-workspace-timestamp");
    await expect(timestamp).toHaveText("now");
    const original = await timestamp.getAttribute("data-activity-at");
    expect(original).not.toBeNull();
    await page.clock.fastForward("03:00");
    await expect(timestamp).toHaveText("3m");
    await client.setWorkspaceTitle(workspace.workspaceId, "Renamed clock workspace");
    await expect(row).toContainText("Renamed clock workspace");
    await client.clearWorkspaceAttention(workspace.workspaceId);
    await expect(timestamp).toHaveText("3m");
    await expect(timestamp).toHaveAttribute("data-activity-at", original!);
    // Match the real daemon clock again before producing new activity.
    await page.clock.setFixedTime(Date.now());
    await client.sendAgentMessage(pair.child.id, "Update this workspace through its child");
    await expect
      .poll(async () => Date.parse((await timestamp.getAttribute("data-activity-at"))!))
      .toBeGreaterThan(Date.parse(original!));
    await expect(timestamp).toHaveText("now");
    const childRow = page.getByTestId(`sidebar-agent-tree-row-agent:${pair.child.id}`);
    await expect(childRow).toBeVisible();
    await expect(childRow.getByTestId("sidebar-workspace-timestamp")).toHaveCount(0);
    await client.waitForFinish(pair.child.id, 30_000);
    const finished = await client.fetchAgent({ agentId: pair.child.id });
    if (!finished) throw new Error("Child not found after completion");
    const persistedTime = finished.agent.lastActivityAt!;
    expect(Date.parse(persistedTime)).toBeGreaterThan(Date.parse(original!));
    await page.reload();
    await expect(timestamp).toHaveAttribute("data-activity-at", persistedTime);
    await expect(timestamp).toHaveText("now");
    await page.screenshot({ path: "/tmp/paseoi-r75-workspace-last-activity.png" });
  } finally {
    await workspace.cleanup();
  }
});
