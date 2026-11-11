import { seedSessionHosts } from "@/test/seed-session";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWorkspaceArchivePending,
  isWorkspaceArchivePending,
} from "@/contexts/session-workspace-upserts";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  archiveWorkspaceOptimistically,
  archiveWorkspacesOptimistically,
  type WorkspaceArchiveTarget,
} from "@/workspace/workspace-archive";

const SERVER_ID = "workspace-archive-test";
const SECOND_SERVER_ID = "workspace-archive-test-2";

type ArchiveWorkspacePayload = Awaited<ReturnType<DaemonClient["archiveWorkspace"]>>;

function archivePayload(input: {
  workspaceId: string;
  error?: string | null;
}): ArchiveWorkspacePayload {
  return {
    requestId: "request",
    workspaceId: input.workspaceId,
    archivedAt: null,
    error: input.error ?? null,
  };
}

function workspace(input?: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return {
    createdAt: null,
    lastUserMessageAt: null,
    id: "workspace-1",
    projectId: "project-1",
    projectDisplayName: "Project",
    projectRootPath: "/repo/project",
    workspaceDirectory: "/repo/project/workspace-1",
    projectKind: "git",
    workspaceKind: "worktree",
    name: "workspace-1",
    status: "done",
    archivingAt: null,
    statusEnteredAt: null,
    diffStat: null,
    scripts: [],
    ...input,
  };
}

function target(input?: Partial<WorkspaceArchiveTarget>): WorkspaceArchiveTarget {
  const base = workspace();
  return {
    serverId: SERVER_ID,
    workspaceId: base.id,
    ...input,
  };
}

function createClient(
  archiveWorkspace: DaemonClient["archiveWorkspace"],
): Pick<DaemonClient, "archiveWorkspace"> {
  return { archiveWorkspace };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function storedWorkspaceOn(serverId: string, id: string): WorkspaceDescriptor | undefined {
  return useSessionStore.getState().sessions[serverId]?.workspaces.get(id);
}

function storedWorkspace(id: string): WorkspaceDescriptor | undefined {
  return storedWorkspaceOn(SERVER_ID, id);
}

beforeEach(() => {
  seedSessionHosts([SERVER_ID, SECOND_SERVER_ID]);
  useSessionStore.getState().initializeSession(SERVER_ID, {} as DaemonClient);
});

afterEach(() => {
  seedSessionHosts([]);
  for (let index = 1; index <= 5; index += 1) {
    clearWorkspaceArchivePending({ serverId: SERVER_ID, workspaceId: `workspace-${index}` });
  }
  clearWorkspaceArchivePending({ serverId: SECOND_SERVER_ID, workspaceId: "workspace-1" });
  clearWorkspaceArchivePending({ serverId: SECOND_SERVER_ID, workspaceId: "workspace-2" });
  useSessionStore.setState((state) => ({ ...state, sessions: {} }));
});

describe("archiveWorkspaceOptimistically", () => {
  it("hides the workspace and marks the archive pending while the daemon call runs", async () => {
    const archived = workspace();
    getHostRuntimeStore().acceptWorkspaceSnapshots(SERVER_ID, [archived]);
    const releaseArchive = deferred<ArchiveWorkspacePayload>();
    const client = createClient(vi.fn(async () => releaseArchive.promise));

    const archive = archiveWorkspaceOptimistically({
      client,
      workspace: target(),
    });

    expect(storedWorkspace(archived.id)).toBeUndefined();
    expect(
      isWorkspaceArchivePending({
        serverId: SERVER_ID,
        workspaceId: archived.id,
      }),
    ).toBe(true);

    releaseArchive.resolve(archivePayload({ workspaceId: archived.id }));
    await archive;

    expect(storedWorkspace(archived.id)).toBeUndefined();
  });

  it("restores the workspace and clears pending state when the daemon rejects the archive", async () => {
    const archived = workspace();
    getHostRuntimeStore().acceptWorkspaceSnapshots(SERVER_ID, [archived]);
    const client = createClient(
      vi.fn(async () => archivePayload({ workspaceId: archived.id, error: "nope" })),
    );

    await expect(
      archiveWorkspaceOptimistically({
        client,
        workspace: target(),
      }),
    ).rejects.toThrow("nope");

    expect(storedWorkspace(archived.id)).toEqual(archived);
    expect(
      isWorkspaceArchivePending({
        serverId: SERVER_ID,
        workspaceId: archived.id,
      }),
    ).toBe(false);
  });
});

describe("archiveWorkspacesOptimistically", () => {
  it("returns failures and restores only the workspaces whose archive failed", async () => {
    const first = workspace({ id: "workspace-1" });
    const second = workspace({
      id: "workspace-2",
      workspaceDirectory: "/repo/project/workspace-2",
      name: "workspace-2",
    });
    getHostRuntimeStore().acceptWorkspaceSnapshots(SERVER_ID, [first, second]);
    const client = createClient(
      vi.fn(async (workspaceId) =>
        archivePayload({
          workspaceId,
          error: workspaceId === second.id ? "failed" : null,
        }),
      ),
    );

    const failures = await archiveWorkspacesOptimistically({
      getClient: () => client,
      workspaces: [target({ workspaceId: first.id }), target({ workspaceId: second.id })],
      concurrency: 3,
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]?.workspaceId).toBe(second.id);
    expect(storedWorkspace(first.id)).toBeUndefined();
    expect(storedWorkspace(second.id)).toEqual(second);
  });

  it("archives each workspace through its own server client", async () => {
    const first = workspace({ id: "workspace-1" });
    const second = workspace({
      id: "workspace-2",
      workspaceDirectory: "/repo/project/workspace-2",
      name: "workspace-2",
    });
    useSessionStore.getState().initializeSession(SECOND_SERVER_ID, {} as DaemonClient);
    getHostRuntimeStore().acceptWorkspaceSnapshots(SERVER_ID, [first]);
    getHostRuntimeStore().acceptWorkspaceSnapshots(SECOND_SERVER_ID, [second]);

    const archivedByServer = new Map<string, string[]>();
    const clientFor = (serverId: string) =>
      createClient(async (workspaceId) => {
        archivedByServer.set(serverId, [...(archivedByServer.get(serverId) ?? []), workspaceId]);
        return archivePayload({ workspaceId });
      });

    const failures = await archiveWorkspacesOptimistically({
      getClient: (serverId) => clientFor(serverId),
      workspaces: [
        target({
          serverId: SERVER_ID,
          workspaceId: first.id,
        }),
        target({
          serverId: SECOND_SERVER_ID,
          workspaceId: second.id,
        }),
      ],
      concurrency: 3,
    });

    expect(failures).toEqual([]);
    expect(archivedByServer).toEqual(
      new Map([
        [SERVER_ID, [first.id]],
        [SECOND_SERVER_ID, [second.id]],
      ]),
    );
    expect(storedWorkspaceOn(SERVER_ID, first.id)).toBeUndefined();
    expect(storedWorkspaceOn(SECOND_SERVER_ID, second.id)).toBeUndefined();
  });

  it("never runs more archives at once than the concurrency limit", async () => {
    const ids = ["workspace-1", "workspace-2", "workspace-3", "workspace-4", "workspace-5"];
    getHostRuntimeStore().acceptWorkspaceSnapshots(
      SERVER_ID,
      ids.map((id) => workspace({ id, workspaceDirectory: `/repo/project/${id}`, name: id })),
    );
    const pending = new Map<string, ReturnType<typeof deferred<ArchiveWorkspacePayload>>>();
    let running = 0;
    let peak = 0;
    const client = createClient(async (workspaceId) => {
      running += 1;
      peak = Math.max(peak, running);
      const request = deferred<ArchiveWorkspacePayload>();
      pending.set(workspaceId, request);
      const payload = await request.promise;
      running -= 1;
      return payload;
    });
    const settled: string[] = [];

    const batch = archiveWorkspacesOptimistically({
      getClient: () => client,
      workspaces: ids.map((workspaceId) => target({ workspaceId })),
      concurrency: 2,
      onSettled: (settledWorkspace) => settled.push(settledWorkspace.workspaceId),
    });

    for (const id of ids) {
      await vi.waitFor(() => expect(pending.has(id)).toBe(true));
      expect(running).toBeLessThanOrEqual(2);
      pending.get(id)?.resolve(archivePayload({ workspaceId: id }));
    }
    const failures = await batch;

    expect(failures).toEqual([]);
    expect(peak).toBe(2);
    expect(settled).toEqual(ids);
    for (const id of ids) expect(storedWorkspace(id)).toBeUndefined();
  });

  it("reports failures in input order and keeps archiving after one fails", async () => {
    const ids = ["workspace-1", "workspace-2", "workspace-3"];
    getHostRuntimeStore().acceptWorkspaceSnapshots(
      SERVER_ID,
      ids.map((id) => workspace({ id, workspaceDirectory: `/repo/project/${id}`, name: id })),
    );
    const client = createClient(
      vi.fn(async (workspaceId) =>
        archivePayload({
          workspaceId,
          error: workspaceId === "workspace-2" ? null : `failed ${workspaceId}`,
        }),
      ),
    );
    const progress: [string, boolean][] = [];

    const failures = await archiveWorkspacesOptimistically({
      getClient: () => client,
      workspaces: ids.map((workspaceId) => target({ workspaceId })),
      concurrency: 1,
      onSettled: (settled, failure) => progress.push([settled.workspaceId, failure !== null]),
    });

    expect(failures.map((failure) => failure.workspaceId)).toEqual(["workspace-1", "workspace-3"]);
    expect(progress).toEqual([
      ["workspace-1", true],
      ["workspace-2", false],
      ["workspace-3", true],
    ]);
    expect(storedWorkspace("workspace-1")?.id).toBe("workspace-1");
    expect(storedWorkspace("workspace-2")).toBeUndefined();
    expect(storedWorkspace("workspace-3")?.id).toBe("workspace-3");
  });

  it("fails a workspace whose host is not connected", async () => {
    getHostRuntimeStore().acceptWorkspaceSnapshots(SERVER_ID, [workspace()]);

    const failures = await archiveWorkspacesOptimistically({
      getClient: () => null,
      workspaces: [target()],
      concurrency: 3,
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]?.workspaceId).toBe("workspace-1");
    expect(storedWorkspace("workspace-1")?.id).toBe("workspace-1");
  });
});
