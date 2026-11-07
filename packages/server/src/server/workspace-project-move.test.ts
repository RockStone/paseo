import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestLogger } from "../test-utils/test-logger.js";
import {
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
  type ProjectMutation,
  type WorkspaceMutation,
} from "./workspace-registry.js";
import {
  WorkspaceProjectMoveError,
  mergeProjects,
  moveWorkspaceToProject,
} from "./workspace-project-move.js";

const CREATED_AT = "2026-03-01T12:00:00.000Z";
const NOW = "2026-11-07T12:00:00.000Z";

let workdir: string;
let projectRegistry: FileBackedProjectRegistry;
let workspaceRegistry: FileBackedWorkspaceRegistry;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "workspace-project-move-"));
  projectRegistry = new FileBackedProjectRegistry(
    path.join(workdir, "projects.json"),
    createTestLogger(),
  );
  workspaceRegistry = new FileBackedWorkspaceRegistry(
    path.join(workdir, "workspaces.json"),
    createTestLogger(),
  );
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

async function addProject(projectId: string, options: { archivedAt?: string } = {}) {
  await projectRegistry.upsert(
    createPersistedProjectRecord({
      projectId,
      rootPath: `/tmp/${projectId}`,
      kind: "git",
      displayName: projectId,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      archivedAt: options.archivedAt ?? null,
    }),
  );
}

async function addWorkspace(
  workspaceId: string,
  projectId: string,
  options: { archivedAt?: string } = {},
) {
  await workspaceRegistry.upsert(
    createPersistedWorkspaceRecord({
      workspaceId,
      projectId,
      cwd: `/tmp/${projectId}/${workspaceId}`,
      kind: "local_checkout",
      displayName: workspaceId,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      archivedAt: options.archivedAt ?? null,
    }),
  );
}

function deps(overrides: { hostnames?: Record<string, string[]> } = {}) {
  return {
    workspaceRegistry,
    projectRegistry,
    listWorkspaceServiceHostnames: (workspaceId: string) =>
      overrides.hostnames?.[workspaceId] ?? [],
    now: () => NOW,
  };
}

describe("moveWorkspaceToProject", () => {
  test("changes only the workspace's project and publishes a workspace mutation", async () => {
    await addProject("prj-a");
    await addProject("prj-b");
    await addWorkspace("ws-1", "prj-a");
    await addWorkspace("ws-2", "prj-a");
    const before = await workspaceRegistry.get("ws-1");
    const mutations: WorkspaceMutation[] = [];
    workspaceRegistry.subscribeToMutations((mutation) => {
      mutations.push(mutation);
    });

    const result = await moveWorkspaceToProject(deps(), {
      workspaceId: "ws-1",
      projectId: "prj-b",
    });

    expect(result).toMatchObject({
      changed: true,
      previousProjectId: "prj-a",
      emptiedProject: null,
    });
    expect(await workspaceRegistry.get("ws-1")).toEqual({
      ...before,
      projectId: "prj-b",
      updatedAt: NOW,
    });
    expect((await workspaceRegistry.get("ws-2"))?.projectId).toBe("prj-a");
    expect(mutations).toEqual([
      {
        kind: "upsert",
        workspaceId: "ws-1",
        workspace: expect.objectContaining({ projectId: "prj-b" }),
      },
    ]);
  });

  test("publishes a project update for a source left without active workspaces", async () => {
    await addProject("prj-a");
    await addProject("prj-b");
    await addWorkspace("ws-1", "prj-a");
    await addWorkspace("ws-old", "prj-a", { archivedAt: CREATED_AT });
    const projectMutations: ProjectMutation[] = [];
    projectRegistry.subscribeToMutations((mutation) => {
      projectMutations.push(mutation);
    });

    const result = await moveWorkspaceToProject(deps(), {
      workspaceId: "ws-1",
      projectId: "prj-b",
    });

    expect(result.emptiedProject).toMatchObject({ projectId: "prj-a", updatedAt: NOW });
    expect(projectMutations).toEqual([
      { kind: "upsert", projectId: "prj-a", project: expect.objectContaining({ updatedAt: NOW }) },
    ]);
    expect(await projectRegistry.get("prj-a")).not.toBeNull();
  });

  test("moves an archived workspace", async () => {
    await addProject("prj-a");
    await addProject("prj-b");
    await addWorkspace("ws-1", "prj-a", { archivedAt: CREATED_AT });

    const result = await moveWorkspaceToProject(deps(), {
      workspaceId: "ws-1",
      projectId: "prj-b",
    });

    expect(result.changed).toBe(true);
    expect(await workspaceRegistry.get("ws-1")).toMatchObject({
      projectId: "prj-b",
      archivedAt: CREATED_AT,
    });
  });

  test("returns the workspace unchanged when it already belongs to the project", async () => {
    await addProject("prj-a");
    await addWorkspace("ws-1", "prj-a");
    const before = await workspaceRegistry.get("ws-1");

    const result = await moveWorkspaceToProject(deps(), {
      workspaceId: "ws-1",
      projectId: "prj-a",
    });

    expect(result).toMatchObject({ changed: false, workspace: before });
    expect(await workspaceRegistry.get("ws-1")).toEqual(before);
  });

  test("reports running service hostnames that keep the old project slug", async () => {
    await addProject("prj-a");
    await addProject("prj-b");
    await addWorkspace("ws-1", "prj-a");

    const result = await moveWorkspaceToProject(
      deps({ hostnames: { "ws-1": ["web--main--old-1234abcd.localhost"] } }),
      { workspaceId: "ws-1", projectId: "prj-b" },
    );

    expect(result.retainedServiceHostnames).toEqual(["web--main--old-1234abcd.localhost"]);
  });

  test("rejects an unknown workspace, an unknown project, and an archived project", async () => {
    await addProject("prj-a");
    await addProject("prj-archived", { archivedAt: CREATED_AT });
    await addWorkspace("ws-1", "prj-a");

    await expect(
      moveWorkspaceToProject(deps(), { workspaceId: "ws-missing", projectId: "prj-a" }),
    ).rejects.toMatchObject({ code: "workspace_not_found" });
    await expect(
      moveWorkspaceToProject(deps(), { workspaceId: "ws-1", projectId: "prj-missing" }),
    ).rejects.toMatchObject({ code: "project_not_found" });
    await expect(
      moveWorkspaceToProject(deps(), { workspaceId: "ws-1", projectId: "prj-archived" }),
    ).rejects.toBeInstanceOf(WorkspaceProjectMoveError);
    expect((await workspaceRegistry.get("ws-1"))?.projectId).toBe("prj-a");
  });
});

describe("mergeProjects", () => {
  test("moves active and archived workspaces and removes the empty source", async () => {
    await addProject("prj-a");
    await addProject("prj-b");
    await addWorkspace("ws-1", "prj-a");
    await addWorkspace("ws-2", "prj-a", { archivedAt: CREATED_AT });
    await addWorkspace("ws-3", "prj-b");
    const removedIcons: string[] = [];

    const result = await mergeProjects(
      {
        ...deps(),
        removeProjectIcon: async (projectId) => {
          removedIcons.push(projectId);
        },
      },
      { sourceProjectId: "prj-a", targetProjectId: "prj-b" },
    );

    expect(result).toMatchObject({ dryRun: false, sourceRemoved: true, sourceKeptReason: null });
    expect(
      result.workspaces.map((workspace) => [workspace.workspaceId, workspace.archived]),
    ).toEqual([
      ["ws-1", false],
      ["ws-2", true],
    ]);
    const workspaces = await workspaceRegistry.list();
    expect(workspaces.map((workspace) => [workspace.workspaceId, workspace.projectId])).toEqual([
      ["ws-1", "prj-b"],
      ["ws-2", "prj-b"],
      ["ws-3", "prj-b"],
    ]);
    expect((await workspaceRegistry.get("ws-1"))?.archivedAt).toBeNull();
    expect(await projectRegistry.get("prj-a")).toBeNull();
    expect(removedIcons).toEqual(["prj-a"]);
  });

  test("never removes a source that still has a workspace after the moves", async () => {
    await addProject("prj-a");
    await addProject("prj-b");
    await addWorkspace("ws-1", "prj-a");
    // A workspace created in the source while the merge runs must keep the source alive.
    const realUpdate = workspaceRegistry.update.bind(workspaceRegistry);
    workspaceRegistry.update = async (workspaceId, updater) => {
      const updated = await realUpdate(workspaceId, updater);
      await addWorkspace("ws-late", "prj-a");
      return updated;
    };

    const result = await mergeProjects(deps(), {
      sourceProjectId: "prj-a",
      targetProjectId: "prj-b",
    });

    expect(result).toMatchObject({ sourceRemoved: false, sourceKeptReason: "workspaces_remain" });
    expect(await projectRegistry.get("prj-a")).not.toBeNull();
    expect((await workspaceRegistry.get("ws-late"))?.archivedAt).toBeNull();
  });

  test("keeps the source when asked", async () => {
    await addProject("prj-a");
    await addProject("prj-b");
    await addWorkspace("ws-1", "prj-a");

    const result = await mergeProjects(deps(), {
      sourceProjectId: "prj-a",
      targetProjectId: "prj-b",
      keepSource: true,
    });

    expect(result).toMatchObject({ sourceRemoved: false, sourceKeptReason: "keep_source" });
    expect(result.emptiedProject).toMatchObject({ projectId: "prj-a" });
    expect((await workspaceRegistry.get("ws-1"))?.projectId).toBe("prj-b");
    expect(await projectRegistry.get("prj-a")).not.toBeNull();
  });

  test("a dry run reports the plan and changes nothing", async () => {
    await addProject("prj-a");
    await addProject("prj-b");
    await addWorkspace("ws-1", "prj-a");

    const result = await mergeProjects(deps(), {
      sourceProjectId: "prj-a",
      targetProjectId: "prj-b",
      dryRun: true,
    });

    expect(result).toMatchObject({
      dryRun: true,
      sourceRemoved: true,
      workspaces: [{ workspaceId: "ws-1", archived: false }],
    });
    expect((await workspaceRegistry.get("ws-1"))?.projectId).toBe("prj-a");
    expect(await projectRegistry.get("prj-a")).not.toBeNull();
  });

  test("rejects merging into the same, an unknown, or an archived project", async () => {
    await addProject("prj-a");
    await addProject("prj-archived", { archivedAt: CREATED_AT });
    await addWorkspace("ws-1", "prj-a");

    await expect(
      mergeProjects(deps(), { sourceProjectId: "prj-a", targetProjectId: "prj-a" }),
    ).rejects.toMatchObject({ code: "same_project" });
    await expect(
      mergeProjects(deps(), { sourceProjectId: "prj-a", targetProjectId: "prj-missing" }),
    ).rejects.toMatchObject({ code: "project_not_found" });
    await expect(
      mergeProjects(deps(), { sourceProjectId: "prj-a", targetProjectId: "prj-archived" }),
    ).rejects.toMatchObject({ code: "project_archived" });
    expect((await workspaceRegistry.get("ws-1"))?.projectId).toBe("prj-a");
    expect(await projectRegistry.get("prj-a")).not.toBeNull();
  });
});
