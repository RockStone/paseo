import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@/utils/projects";
import {
  buildProjectNameByCwd,
  buildScheduleProjectTargets,
  describeScheduleCwd,
  buildScheduleAgentTargets,
} from "./schedule-project-targets";

function makeProject(overrides: Partial<ProjectSummary>): ProjectSummary {
  return {
    viewKey: "proj",
    projectName: "Project",
    hosts: [],
    totalWorkspaceCount: 0,
    hostCount: 0,
    onlineHostCount: 0,
    ...overrides,
  };
}

function makeHost(overrides: Partial<ProjectSummary["hosts"][number]>) {
  return {
    serverId: "host-1",
    projectId: "project-1",
    projectName: "Project",
    projectCustomName: null,
    serverName: "Host 1",
    isOnline: true,
    repoRoot: "/tmp/project",
    workspaceCount: 0,
    workspaces: [],
    ...overrides,
  };
}

describe("buildScheduleProjectTargets", () => {
  it("lists only unarchived agents in active workspaces of each host project, including worktrees", () => {
    const projects = [
      makeProject({
        hosts: [
          makeHost({
            workspaces: [
              {
                id: "main",
                name: "Main",
                workspaceKind: "local_checkout",
                status: "done",
                currentBranch: null,
                changeRequestNumber: null,
                statusEnteredAt: null,
              },
              {
                id: "worktree",
                name: "Isolated task",
                workspaceKind: "worktree",
                status: "done",
                currentBranch: null,
                changeRequestNumber: null,
                statusEnteredAt: null,
              },
            ],
          }),
        ],
      }),
    ];
    const base = {
      serverId: "host-1",
      workspaceId: "main",
      archivedAt: null,
      title: "Coordinator",
    };
    const result = buildScheduleAgentTargets(projects, [
      { ...base, id: "root" },
      { ...base, id: "child", workspaceId: "worktree", title: "Child" },
      { ...base, id: "archived", archivedAt: new Date() },
      { ...base, id: "other-workspace", workspaceId: "other" },
      { ...base, id: "other-host", serverId: "host-2" },
    ]);
    expect(result.map((entry) => entry.agentId)).toEqual(["root", "child"]);
    expect(result[1]).toMatchObject({
      serverId: "host-1",
      projectOptionId: "project:host-1:proj",
      label: "Child",
      description: expect.stringContaining("Isolated task"),
    });
  });
  it("emits one target per online host with a repo root", () => {
    const targets = buildScheduleProjectTargets([
      makeProject({
        projectName: "Alpha",
        hosts: [
          makeHost({ projectName: "Alpha on Host 1", repoRoot: "/tmp/alpha" }),
          makeHost({ serverId: "host-2", projectName: "Alpha on Host 2" }),
        ],
      }),
    ]);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      serverId: "host-1",
      cwd: "/tmp/alpha",
      projectName: "Alpha on Host 1",
    });
  });

  it("skips offline hosts and blank repo roots", () => {
    const targets = buildScheduleProjectTargets([
      makeProject({
        hosts: [makeHost({ isOnline: false }), makeHost({ serverId: "host-3", repoRoot: "   " })],
      }),
    ]);
    expect(targets).toHaveLength(0);
  });
});

describe("describeScheduleCwd", () => {
  it("prefers a matched project name and shortens unmatched paths", () => {
    const byCwd = buildProjectNameByCwd(
      buildScheduleProjectTargets([
        makeProject({
          projectName: "Grouped Alpha",
          hosts: [makeHost({ projectName: "Alpha on Host 1", repoRoot: "/tmp/alpha" })],
        }),
      ]),
    );
    expect(
      describeScheduleCwd({ serverId: "host-1", cwd: "/tmp/alpha", projectNameByCwd: byCwd }),
    ).toBe("Alpha on Host 1");
    expect(
      describeScheduleCwd({ serverId: "host-1", cwd: "/Users/sam/api", projectNameByCwd: byCwd }),
    ).toBe("~/api");
  });
});
