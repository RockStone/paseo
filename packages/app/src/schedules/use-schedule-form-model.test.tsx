// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildProjectOptionId, type ScheduleProjectTarget } from "./schedule-project-targets";
import { useScheduleFormModel } from "./use-schedule-form-model";
import type { ScheduleFormSnapshot } from "./schedule-form-model";

const HOSTS = [{ serverId: "host-a", label: "Host A" }] as const;
const PROJECT_A_ID = buildProjectOptionId("host-a", "project-a");

function projectTarget(input: {
  projectKey: string;
  projectName: string;
  cwd: string;
}): ScheduleProjectTarget {
  return {
    optionId: buildProjectOptionId("host-a", input.projectKey),
    serverId: "host-a",
    serverName: "Host A",
    projectViewKey: input.projectKey,
    projectName: input.projectName,
    cwd: input.cwd,
    isGit: true,
  };
}

function createSnapshot(projectTargets: readonly ScheduleProjectTarget[]): ScheduleFormSnapshot {
  return {
    mode: "create",
    hosts: HOSTS,
    defaults: {
      serverId: "host-a",
      projectTargets,
      preferences: {},
    },
  };
}

describe("useScheduleFormModel", () => {
  afterEach(() => {
    cleanup();
  });

  it("retains the selected delivery target and draft while the active-agent directory refreshes", () => {
    const projectTargets = [
      projectTarget({ projectKey: "project-a", projectName: "Project A", cwd: "/repo/a" }),
    ];
    const openedSnapshot = {
      ...createSnapshot(projectTargets),
      defaults: {
        ...createSnapshot(projectTargets).defaults,
        agentTargets: [
          {
            agentId: "agent-a",
            serverId: "host-a",
            projectOptionId: PROJECT_A_ID,
            label: "Coordinator",
          },
        ],
      },
    };
    const { result, rerender } = renderHook(({ snapshot }) => useScheduleFormModel(snapshot), {
      initialProps: { snapshot: openedSnapshot },
    });
    const model = result.current;
    act(() => {
      model.setProject(PROJECT_A_ID, { label: "Project A" });
      model.setName("Watch current work");
      model.setPrompt("Keep this draft");
      model.setAgent("agent-a", { label: "Coordinator" });
    });
    rerender({
      snapshot: { ...openedSnapshot, defaults: { ...openedSnapshot.defaults, agentTargets: [] } },
    });
    expect(result.current).toBe(model);
    expect(model.getState()).toMatchObject({
      selectedAgentId: "agent-a",
      selectedAgentDisplay: { label: "Coordinator" },
      name: "Watch current work",
      prompt: "Keep this draft",
      canSubmit: false,
    });
  });

  it("keeps one model instance and draft state while open snapshot inputs churn", () => {
    const firstTargets = [
      projectTarget({ projectKey: "project-a", projectName: "Project A", cwd: "/repo/a" }),
    ];
    const { result, rerender } = renderHook(({ snapshot }) => useScheduleFormModel(snapshot), {
      initialProps: { snapshot: createSnapshot(firstTargets) },
    });
    const openedModel = result.current;

    act(() => {
      openedModel.setName("Draft name");
      openedModel.setPrompt("Run the draft");
      openedModel.setProject(PROJECT_A_ID, { label: "Project A" });
    });

    rerender({
      snapshot: createSnapshot([
        projectTarget({ projectKey: "project-a", projectName: "Project A", cwd: "/repo/a" }),
      ]),
    });

    expect(result.current).toBe(openedModel);
    expect(result.current.getState()).toMatchObject({
      name: "Draft name",
      prompt: "Run the draft",
      selectedServerId: "host-a",
      workingDir: "/repo/a",
      projectDisplay: { label: "Project A" },
      selectedProjectOptionId: PROJECT_A_ID,
    });
  });
});
