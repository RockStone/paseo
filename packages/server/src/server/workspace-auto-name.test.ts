import pino from "pino";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { AgentManager } from "./agent/agent-manager.js";
import { AgentStorage, parseStoredAgentRecord } from "./agent/agent-storage.js";
import { attachWorkspaceAgentNames } from "./workspace-agent-names.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import {
  createPersistedWorkspaceRecord,
  FileBackedWorkspaceRegistry,
  type WorkspaceRegistry,
} from "./workspace-registry.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test("workspace names repair stored direct agents and stay linked without renaming children or same-cwd siblings", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "workspace-agent-names-"));
  const logger = pino({ level: "silent" });
  const registry = new FileBackedWorkspaceRegistry(path.join(directory, "workspaces.json"), logger);
  const storage = new AgentStorage(path.join(directory, "agents"), logger);
  const manager = new AgentManager({ registry: storage, logger });
  const timestamp = "2026-10-21T00:00:00.000Z";
  const workspace = createPersistedWorkspaceRecord({
    workspaceId: "main",
    projectId: "project",
    cwd: directory,
    kind: "directory",
    displayName: "repo",
    title: "Review the preview package",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const record = (id: string, fields = {}) =>
    parseStoredAgentRecord({
      id,
      provider: "mock",
      cwd: directory,
      workspaceId: workspace.workspaceId,
      title: id,
      createdAt: timestamp,
      updatedAt: timestamp,
      config: null,
      persistence: null,
      ...fields,
    });
  let detach: (() => Promise<void>) | undefined;
  try {
    await registry.upsert(workspace);
    await storage.upsert(record("direct"));
    await storage.upsert(record("child", { labels: { "paseo.parent-agent-id": "direct" } }));
    await storage.upsert(record("archived", { archivedAt: timestamp }));
    await storage.upsert(record("same-cwd", { workspaceId: "other" }));
    detach = await attachWorkspaceAgentNames({
      workspaceRegistry: registry,
      agentStorage: storage,
      agentManager: manager,
      logger,
    });
    expect((await storage.get("direct"))?.title).toBe(workspace.title);
    await registry.update(workspace.workspaceId, (current) => ({
      ...current,
      title: "Preview package decision",
    }));
    expect((await storage.get("direct"))?.title).toBe("Preview package decision");
    for (const id of ["child", "archived", "same-cwd"])
      expect((await storage.get(id))?.title).toBe(id);
    const reloaded = new AgentStorage(path.join(directory, "agents"), logger);
    expect((await reloaded.get("direct"))?.title).toBe("Preview package decision");
    // Several independent agents keep distinct names, even when their workspace is renamed.
    await storage.upsert(record("second-direct"));
    await registry.update(workspace.workspaceId, (current) => ({
      ...current,
      title: "Multiple sessions",
    }));
    expect((await storage.get("direct"))?.title).toBe("Preview package decision");
    expect((await storage.get("second-direct"))?.title).toBe("second-direct");
  } finally {
    await detach?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test("auto-name preserves workspace archival that lands during its metadata write", async () => {
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-auto-name",
    projectId: "project-auto-name",
    cwd: "/workspace",
    kind: "directory",
    displayName: "workspace",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });
  const mutationStarted = deferred();
  const allowMutation = deferred();
  const updateEmitted = deferred();
  const workspaceRegistry = {
    update: async (_workspaceId, updater) => {
      mutationStarted.resolve();
      await allowMutation.promise;
      workspace = updater(workspace);
      return workspace;
    },
  } satisfies Pick<WorkspaceRegistry, "update">;
  const autoName = new WorkspaceAutoName({
    agentManager: {} as AgentManager,
    workspaceRegistry,
    workspaceGitService: {} as WorkspaceGitService,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    readDaemonConfig: () => ({}),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => {},
    emitWorkspaceUpdateForWorkspaceId: async () => updateEmitted.resolve(),
    logger: pino({ level: "silent" }),
    generateWorkspaceName: async () => ({ title: "generated", branch: null }),
  });

  autoName.scheduleForDirectory({
    workspaceId: workspace.workspaceId,
    cwd: workspace.cwd,
    firstAgentContext: { prompt: "Name this workspace" },
  });
  await mutationStarted.promise;
  const archivedAt = "2026-08-08T00:01:00.000Z";
  workspace = { ...workspace, updatedAt: archivedAt, archivedAt };
  allowMutation.resolve();
  await updateEmitted.promise;

  expect(workspace).toMatchObject({
    title: "generated",
    archivedAt,
  });
});
