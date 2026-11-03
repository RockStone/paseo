import { describe, expect, test } from "vitest";
import type { ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import { buildWorkspaceStructureProjects, createProjectViewKey } from "./workspace-structure";

function project(input: {
  id: string;
  key: string | null;
  root: string;
  name?: string;
}): ProjectDescriptor {
  return {
    projectId: input.id,
    projectKey: input.key,
    projectDisplayName: input.name ?? "acme/app",
    projectCustomName: null,
    projectRootPath: input.root,
    projectKind: "git",
  };
}

function workspace(id: string, projectId: string, root: string): WorkspaceDescriptor {
  return {
    createdAt: null,
    lastUserMessageAt: null,
    id,
    projectId,
    projectDisplayName: "acme/app",
    projectCustomName: null,
    projectRootPath: root,
    workspaceDirectory: root,
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

describe("buildWorkspaceStructureProjects", () => {
  test("groups the same project key across hosts and keeps host-local ids", () => {
    const key = "remote:github.com/acme/app";
    const result = buildWorkspaceStructureProjects({
      sessions: [
        {
          serverId: "host-a",
          projects: [project({ id: "prj_a", key, root: "/a/app" })],
          workspaces: [workspace("ws-a", "prj_a", "/a/app")],
        },
        {
          serverId: "host-b",
          projects: [project({ id: "prj_b", key, root: "/b/app" })],
          workspaces: [workspace("ws-b", "prj_b", "/b/app")],
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      viewKey: key,
      projectKey: key,
      hosts: [
        { serverId: "host-a", projectId: "prj_a" },
        { serverId: "host-b", projectId: "prj_b" },
      ],
      workspaceKeys: ["host-a:ws-a", "host-b:ws-b"],
    });
  });

  test("keeps two clones with the same key on one host separate", () => {
    const key = "remote:github.com/acme/app";
    const result = buildWorkspaceStructureProjects({
      sessions: [
        {
          serverId: "host-a",
          projects: [
            project({ id: "prj_one", key, root: "/repos/one" }),
            project({ id: "prj_two", key, root: "/repos/two" }),
          ],
          workspaces: [
            workspace("ws-one", "prj_one", "/repos/one"),
            workspace("ws-two", "prj_two", "/repos/two"),
          ],
        },
      ],
    });

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.projectKey)).toEqual([key, key]);
    expect(result.map((item) => item.hosts[0]?.projectId).sort()).toEqual(["prj_one", "prj_two"]);
    expect(result.map((item) => item.workspaceKeys[0]).sort()).toEqual([
      "host-a:ws-one",
      "host-a:ws-two",
    ]);
  });

  test("does not let project order choose which same-host clone groups with another host", () => {
    const key = "remote:github.com/acme/app";
    const hostAProjects = [
      project({ id: "prj_one", key, root: "/repos/one" }),
      project({ id: "prj_two", key, root: "/repos/two" }),
    ];
    const build = (projects: ProjectDescriptor[]) =>
      buildWorkspaceStructureProjects({
        sessions: [
          { serverId: "host-a", projects, workspaces: [] },
          {
            serverId: "host-b",
            projects: [project({ id: "prj_remote", key, root: "/repos/remote" })],
            workspaces: [],
          },
        ],
      });
    const identitiesByProjectId = (projects: ReturnType<typeof build>) => {
      const identities: Record<string, string> = {};
      for (const group of projects) {
        for (const host of group.hosts) identities[host.projectId] = group.viewKey;
      }
      return identities;
    };

    const forward = build(hostAProjects);
    const reversed = build(hostAProjects.toReversed());

    expect(forward).toHaveLength(3);
    expect(identitiesByProjectId(forward)).toEqual(identitiesByProjectId(reversed));
    expect(new Set(Object.values(identitiesByProjectId(forward))).size).toBe(3);
  });

  test("keeps projects without persisted keys scoped to their host", () => {
    const result = buildWorkspaceStructureProjects({
      sessions: [
        {
          serverId: "host-a",
          projects: [project({ id: "/workspace/app", key: null, root: "/workspace/app" })],
          workspaces: [],
        },
        {
          serverId: "host-b",
          projects: [project({ id: "/workspace/app", key: null, root: "/workspace/app" })],
          workspaces: [],
        },
      ],
    });

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.projectKey)).toEqual([null, null]);
    expect(new Set(result.map((item) => item.viewKey)).size).toBe(2);
  });

  test("keeps opaque project keys separate from placement view keys", () => {
    const placementShapedKey = createProjectViewKey({
      kind: "placement",
      serverId: "host-a",
      projectId: "prj_b",
    });
    const result = buildWorkspaceStructureProjects({
      sessions: [
        {
          serverId: "host-a",
          projects: [
            project({ id: "prj_a", key: placementShapedKey, root: "/repos/a" }),
            project({ id: "prj_b", key: null, root: "/repos/b" }),
          ],
          workspaces: [],
        },
      ],
    });

    expect(result).toHaveLength(2);
    expect(new Set(result.map((item) => item.viewKey)).size).toBe(2);
    expect(result.find((item) => item.projectKey === placementShapedKey)?.viewKey).toBe(
      placementShapedKey,
    );
  });
});

test("sorts by creation or human prompt without changing picker name order", () => {
  const old = {
    ...workspace("old", "p", "/p"),
    name: "A",
    createdAt: new Date("2026-01-01"),
    lastUserMessageAt: new Date("2026-03-01"),
  };
  const fresh = {
    ...workspace("fresh", "p", "/p"),
    name: "B",
    createdAt: new Date("2026-02-01"),
    lastUserMessageAt: null,
  };
  const sessions = [
    {
      serverId: "host",
      projects: [project({ id: "p", key: "p", root: "/p" })],
      workspaces: [old, fresh],
    },
  ];
  expect(
    buildWorkspaceStructureProjects({ sessions, workspaceSort: "created" })[0].workspaceKeys,
  ).toEqual(["host:fresh", "host:old"]);
  expect(
    buildWorkspaceStructureProjects({ sessions, workspaceSort: "lastPrompt" })[0].workspaceKeys,
  ).toEqual(["host:old", "host:fresh"]);
  expect(buildWorkspaceStructureProjects({ sessions })[0].workspaceKeys).toEqual([
    "host:old",
    "host:fresh",
  ]);
});

test("time ties use workspace identity so renaming cannot move Created rows", () => {
  const a = { ...workspace("a", "p", "/p"), name: "Z", createdAt: new Date("2026-01-01") };
  const b = { ...workspace("b", "p", "/p"), name: "A", createdAt: a.createdAt };
  const sessions = [
    { serverId: "h", projects: [project({ id: "p", key: "p", root: "/p" })], workspaces: [b, a] },
  ];
  expect(
    buildWorkspaceStructureProjects({ sessions, workspaceSort: "created" })[0].workspaceKeys,
  ).toEqual(["h:a", "h:b"]);
  a.name = "A";
  b.name = "Z";
  expect(
    buildWorkspaceStructureProjects({ sessions, workspaceSort: "created" })[0].workspaceKeys,
  ).toEqual(["h:a", "h:b"]);
});

test("ascending reverses the time sorts and keeps identity tie-breaks", () => {
  const old = {
    ...workspace("old", "p", "/p"),
    createdAt: new Date("2026-01-01"),
    lastUserMessageAt: new Date("2026-03-01"),
  };
  const fresh = {
    ...workspace("fresh", "p", "/p"),
    createdAt: new Date("2026-02-01"),
    lastUserMessageAt: null,
  };
  const twin = { ...workspace("twin", "p", "/p"), createdAt: old.createdAt };
  const sessions = [
    {
      serverId: "host",
      projects: [project({ id: "p", key: "p", root: "/p" })],
      workspaces: [twin, old, fresh],
    },
  ];
  const keys = (
    workspaceSort: "created" | "lastPrompt",
    workspaceSortDirection: "ascending" | "descending",
  ) =>
    buildWorkspaceStructureProjects({ sessions, workspaceSort, workspaceSortDirection })[0]
      .workspaceKeys;
  expect(keys("created", "descending")).toEqual(["host:fresh", "host:old", "host:twin"]);
  expect(keys("created", "ascending")).toEqual(["host:old", "host:twin", "host:fresh"]);
  expect(keys("lastPrompt", "ascending")).toEqual(["host:twin", "host:fresh", "host:old"]);
});

test("Name sorts by the displayed title, case-insensitive and numeric", () => {
  const named = (id: string, name: string, branch?: string): WorkspaceDescriptor => ({
    ...workspace(id, "p", "/p"),
    name,
    ...(branch === undefined ? {} : { gitRuntime: { currentBranch: branch } }),
  });
  const sessions = [
    {
      serverId: "h",
      projects: [project({ id: "p", key: "p", root: "/p" })],
      workspaces: [
        named("w10", "Task 10", "alpha"),
        named("w2", "task 2", "HEAD"),
        named("b", "beta", "zeta"),
        named("b2", "Beta"),
      ],
    },
  ];
  const keys = (
    workspaceSortDirection: "ascending" | "descending",
    workspaceTitleSource?: "title" | "branch",
  ) =>
    buildWorkspaceStructureProjects({
      sessions,
      workspaceSort: "name",
      workspaceSortDirection,
      workspaceTitleSource,
    })[0].workspaceKeys;

  expect(keys("ascending")).toEqual(["h:b", "h:b2", "h:w2", "h:w10"]);
  expect(keys("descending")).toEqual(["h:w10", "h:w2", "h:b", "h:b2"]);
  // Branch titles: alpha, task 2 (detached HEAD falls back to the name), zeta, Beta.
  expect(keys("ascending", "branch")).toEqual(["h:w10", "h:b2", "h:w2", "h:b"]);
});

test("Manual keeps its newest-first baseline whatever the direction says", () => {
  const old = { ...workspace("old", "p", "/p"), createdAt: new Date("2026-01-01") };
  const fresh = { ...workspace("fresh", "p", "/p"), createdAt: new Date("2026-02-01") };
  const sessions = [
    {
      serverId: "h",
      projects: [project({ id: "p", key: "p", root: "/p" })],
      workspaces: [old, fresh],
    },
  ];
  for (const workspaceSortDirection of ["ascending", "descending"] as const) {
    expect(
      buildWorkspaceStructureProjects({
        sessions,
        workspaceSort: "manual",
        workspaceSortDirection,
      })[0].workspaceKeys,
    ).toEqual(["h:fresh", "h:old"]);
  }
});
