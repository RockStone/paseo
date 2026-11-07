import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProjectPath, runCreateCommand } from "./create.js";
import { runDeleteCommand } from "./delete.js";
import { createProjectCommand } from "./index.js";
import { runLsCommand } from "./ls.js";
import { renderProjectMerge, runMergeCommand } from "./merge.js";
import { resolveProjectName, runRenameCommand } from "./rename.js";

const project = {
  projectId: "project-1",
  projectDisplayName: "Paseo",
  projectCustomName: null,
  projectRootPath: "/tmp/paseo",
  projectKind: "git" as const,
};
const addProject = vi.fn(async () => ({ project, error: null }));
const listProjects = vi.fn(async () => ({ projects: [project] }));
const renameProject = vi.fn(async (_projectId: string, name: string | null) => ({
  customName: name,
}));
const removeProject = vi.fn(async () => ({ removedWorkspaceIds: ["workspace-1"] }));
const mergeProject = vi.fn(async (input: { sourceProjectId: string; targetProjectId: string }) => ({
  requestId: "req",
  sourceProjectId: input.sourceProjectId,
  targetProjectId: input.targetProjectId,
  accepted: true,
  dryRun: false,
  workspaces: [
    { workspaceId: "workspace-1", name: "main", cwd: "/tmp/old", archived: false },
    { workspaceId: "workspace-2", name: "old", cwd: "/tmp/old-2", archived: true },
  ],
  sourceRemoved: true,
  sourceKeptReason: null,
  retainedServiceHostnames: [],
  error: null,
}));
let serverFeatures: Record<string, boolean> = { workspaceProjectMove: true };
const close = vi.fn(async () => undefined);

vi.mock("../../utils/client.js", () => ({
  buildDaemonConnectionCommandError: vi.fn(({ error }: { error: unknown }) => error),
  connectToDaemon: vi.fn(async () => ({
    addProject,
    listProjects,
    renameProject,
    removeProject,
    mergeProject,
    getLastServerInfoMessage: () => ({ features: serverFeatures }),
    close,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  serverFeatures = { workspaceProjectMove: true };
});

describe("project commands", () => {
  it("exposes the complete project lifecycle", () => {
    expect(createProjectCommand().commands.map((command) => command.name())).toEqual([
      "create",
      "ls",
      "rename",
      "merge",
      "delete",
    ]);
  });

  it("creates a project from an absolute directory path", async () => {
    const result = await runCreateCommand(
      "relative/project",
      { daemonTarget: { kind: "instance", home: "/tmp/project-test" } },
      {} as never,
    );

    expect(addProject).toHaveBeenCalledWith(path.resolve("relative/project"));
    expect(result.data).toEqual({
      projectId: "project-1",
      name: "Paseo",
      kind: "git",
      path: "/tmp/paseo",
    });
    expect(close).toHaveBeenCalled();
  });

  it("resolves paths locally and leaves daemon-owned paths unchanged", () => {
    expect(resolveProjectPath({ cwd: "/home/user", pathArg: "repo" })).toBe(
      path.resolve("/home/user/repo"),
    );
    expect(resolveProjectPath({ cwd: "/home/user" })).toBe(path.resolve("/home/user"));
    expect(
      resolveProjectPath({ cwd: "/home/user", pathArg: "/srv/repo", daemonTarget: "host:6767" }),
    ).toBe("/srv/repo");
    expect(
      resolveProjectPath({ cwd: "/home/user", pathArg: "~/repo", daemonTarget: "host:6767" }),
    ).toBe("~/repo");
  });

  it("requires a daemon-owned path for an explicit target", () => {
    expect(() => resolveProjectPath({ cwd: "/home/user", daemonTarget: "host:6767" })).toThrow();
  });

  it("lists projects", async () => {
    const result = await runLsCommand(
      { daemonTarget: { kind: "instance", home: "/tmp/project-test" } },
      {} as never,
    );

    expect(listProjects).toHaveBeenCalled();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.projectId).toBe("project-1");
  });

  it("renames and resets a project", async () => {
    expect(resolveProjectName({ name: "  New name  " })).toBe("New name");
    expect(resolveProjectName({ reset: true })).toBeNull();

    const result = await runRenameCommand(
      "project-1",
      "  New name  ",
      { daemonTarget: { kind: "instance", home: "/tmp/project-test" } },
      {} as never,
    );
    expect(renameProject).toHaveBeenCalledWith("project-1", "New name");
    expect(result.data).toEqual({ projectId: "project-1", name: "New name" });
  });

  it("rejects an empty project name", () => {
    expect(() => resolveProjectName({ name: "  " })).toThrow();
  });

  it("deletes a project", async () => {
    const result = await runDeleteCommand(
      "project-1",
      { daemonTarget: { kind: "instance", home: "/tmp/project-test" } },
      {} as never,
    );

    expect(removeProject).toHaveBeenCalledWith("project-1");
    expect(result.data).toEqual({
      projectId: "project-1",
      removedWorkspaceIds: ["workspace-1"],
    });
  });
});

describe("project merge", () => {
  const daemonTarget = { kind: "instance" as const, home: "/tmp/project-test" };

  it("merges through the daemon and never calls project removal itself", async () => {
    const result = await runMergeCommand(
      "project-old",
      { daemonTarget, into: " project-1 " },
      {} as never,
    );

    expect(mergeProject).toHaveBeenCalledWith({
      sourceProjectId: "project-old",
      targetProjectId: "project-1",
      keepSource: false,
      dryRun: false,
    });
    expect(removeProject).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      sourceProjectId: "project-old",
      targetProjectId: "project-1",
      sourceRemoved: true,
    });
    expect(renderProjectMerge(result.data)).toBe(
      [
        "Moved 2 workspaces from project-old into project-1:",
        "  workspace-1  main",
        "  workspace-2  old (archived)",
        "Removed project project-old.",
      ].join("\n"),
    );
    expect(close).toHaveBeenCalled();
  });

  it("forwards --keep-source and --dry-run", async () => {
    await runMergeCommand(
      "project-old",
      { daemonTarget, into: "project-1", keepSource: true, dryRun: true },
      {} as never,
    );

    expect(mergeProject).toHaveBeenCalledWith({
      sourceProjectId: "project-old",
      targetProjectId: "project-1",
      keepSource: true,
      dryRun: true,
    });
  });

  it("summarizes a dry run and a source kept because workspaces remain", () => {
    const base = {
      sourceProjectId: "project-old",
      targetProjectId: "project-1",
      workspaces: [{ workspaceId: "workspace-1", name: "main", cwd: "/tmp/old", archived: false }],
      retainedServiceHostnames: ["web--main--old-1234abcd.localhost"],
    };

    expect(
      renderProjectMerge({ ...base, dryRun: true, sourceRemoved: true, sourceKeptReason: null }),
    ).toBe(
      [
        "Would move 1 workspace from project-old into project-1:",
        "  workspace-1  main",
        "Would remove project project-old.",
        "",
        "Running services keep their current hostnames until their scripts restart:",
        "  web--main--old-1234abcd.localhost",
      ].join("\n"),
    );
    expect(
      renderProjectMerge({
        ...base,
        retainedServiceHostnames: [],
        dryRun: false,
        sourceRemoved: false,
        sourceKeptReason: "workspaces_remain",
      }),
    ).toContain("Kept project project-old: it still has workspaces.");
  });

  it("tells the user to update a host without the capability", async () => {
    serverFeatures = {};

    await expect(
      runMergeCommand("project-old", { daemonTarget, into: "project-1" }, {} as never),
    ).rejects.toMatchObject({ code: "DAEMON_UPDATE_REQUIRED" });
    expect(mergeProject).not.toHaveBeenCalled();
  });

  it("rejects merging a project into itself before connecting", async () => {
    await expect(
      runMergeCommand("project-1", { daemonTarget, into: "project-1" }, {} as never),
    ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    expect(mergeProject).not.toHaveBeenCalled();
  });
});
