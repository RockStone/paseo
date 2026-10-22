import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import { ProjectConfigSession, type ProjectConfigSessionHost } from "./project-config-session.js";
import { statPaseoConfigPath } from "../../../utils/paseo-config-file.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { SessionOutboundMessage } from "../../messages.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "project-config-session-test-")));
  tempDirs.push(root);
  return root;
}

function projectRecord(rootPath: string, archivedAt: string | null = null): PersistedProjectRecord {
  return {
    projectId: `project:${rootPath}`,
    rootPath,
    kind: "git",
    displayName: "Project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt,
  };
}

function makeSubsystem(
  records: PersistedProjectRecord[],
  workspaces: PersistedWorkspaceRecord[] = [],
  sharedScriptsRoot?: string,
) {
  const emitted: SessionOutboundMessage[] = [];
  const host: ProjectConfigSessionHost = { emit: (msg) => emitted.push(msg) };
  const subsystem = new ProjectConfigSession({
    host,
    sharedScriptsRoot,
    projectRegistry: { list: async () => records },
    workspaceRegistry: { list: async () => workspaces },
    logger: pino({ level: "silent" }),
  });
  return { subsystem, emitted };
}

describe("ProjectConfigSession", () => {
  test("edits host-shared commands with revisions without modifying a project", async () => {
    const project = makeRoot();
    const shared = join(makeRoot(), "shared-scripts");
    const { subsystem, emitted } = makeSubsystem([projectRecord(project)], [], shared);
    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "project",
      repoRoot: project,
    });
    expect(emitted[0]).toMatchObject({ payload: { ok: true, sharedScriptsRoot: shared } });
    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "save",
      repoRoot: shared,
      expectedRevision: null,
      config: { scripts: { capture: { command: "echo screenshot" } } },
    });
    expect(emitted[1]).toMatchObject({ payload: { ok: true } });
    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "shared",
      repoRoot: shared,
    });
    expect(emitted[2]).toMatchObject({
      payload: { ok: true, config: { scripts: { capture: { command: "echo screenshot" } } } },
    });
    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "stale",
      repoRoot: shared,
      expectedRevision: null,
      config: { scripts: {} },
    });
    expect(emitted[3]).toMatchObject({
      payload: { ok: false, error: { code: "stale_project_config" } },
    });
    expect(statPaseoConfigPath(project)).toBeNull();
  });

  test("edits the active workspace's config without changing the source checkout", async () => {
    const source = makeRoot();
    const checkout = makeRoot();
    const project = projectRecord(source);
    writeFileSync(
      join(source, "paseo.json"),
      JSON.stringify({ scripts: { dev: { command: "source" } } }),
    );
    writeFileSync(
      join(checkout, "paseo.json"),
      JSON.stringify({ scripts: { dev: { command: "worktree" } } }),
    );
    const workspace: PersistedWorkspaceRecord = {
      workspaceId: "workspace",
      projectId: project.projectId,
      cwd: checkout,
      kind: "worktree",
      displayName: "Worktree",
      worktreeRoot: checkout,
      isPaseoOwnedWorktree: true,
      mainRepoRoot: source,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      archivedAt: null,
    };
    const { subsystem, emitted } = makeSubsystem([project], [workspace]);
    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "read",
      repoRoot: checkout,
    });
    expect(emitted[0]).toMatchObject({
      type: "read_project_config_response",
      payload: { ok: true, config: { scripts: { dev: { command: "worktree" } } } },
    });
    const revision = statPaseoConfigPath(checkout);
    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "write",
      repoRoot: checkout,
      expectedRevision: revision,
      config: { scripts: { dev: { command: "updated" } } },
    });
    expect(emitted[1]).toMatchObject({
      type: "write_project_config_response",
      payload: { ok: true },
    });
    workspace.archivedAt = project.createdAt;
    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "archived",
      repoRoot: checkout,
    });
    expect(emitted[2]).toMatchObject({
      payload: { ok: false, error: { code: "project_not_found" } },
    });
  });
  test("read reports when the saved worktree setup differs from HEAD", async () => {
    const repoRoot = makeRoot();
    execFileSync("git", ["init", "-b", "main"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoRoot });
    writeFileSync(join(repoRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "npm ci" } }));
    execFileSync("git", ["add", "paseo.json"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "add config"], { cwd: repoRoot });
    writeFileSync(
      join(repoRoot, "paseo.json"),
      JSON.stringify({ worktree: { setup: "npm install" } }),
    );
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "read-uncommitted-setup",
      repoRoot,
    });

    expect(emitted).toEqual([
      {
        type: "read_project_config_response",
        payload: expect.objectContaining({
          requestId: "read-uncommitted-setup",
          ok: true,
          hasUncommittedWorktreeSetupChanges: true,
        }),
      },
    ]);
  });

  test("read resolves a known root despite a trailing slash and returns the raw config + revision", async () => {
    const repoRoot = makeRoot();
    writeFileSync(join(repoRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "npm ci" } }));
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "read-1",
      repoRoot: `${repoRoot}/`,
    });

    expect(emitted).toEqual([
      {
        type: "read_project_config_response",
        payload: {
          requestId: "read-1",
          repoRoot,
          ok: true,
          config: { worktree: { setup: "npm ci" } },
          revision: expect.objectContaining({
            mtimeMs: expect.any(Number),
            size: expect.any(Number),
          }),
        },
      },
    ]);
  });

  // POSIX-only: creates a directory symlink without Windows privileges.
  test.skipIf(process.platform === "win32")(
    "read resolves a symlink to an active root via realpath",
    async () => {
      const repoRoot = makeRoot();
      writeFileSync(
        join(repoRoot, "paseo.json"),
        JSON.stringify({ worktree: { setup: "npm ci" } }),
      );
      const linkRoot = join(makeRoot(), "link");
      symlinkSync(repoRoot, linkRoot, "dir");
      const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

      await subsystem.handleReadProjectConfigRequest({
        type: "read_project_config_request",
        requestId: "read-symlink-1",
        repoRoot: linkRoot,
      });

      expect(emitted).toEqual([
        {
          type: "read_project_config_response",
          payload: {
            requestId: "read-symlink-1",
            repoRoot,
            ok: true,
            config: { worktree: { setup: "npm ci" } },
            revision: expect.objectContaining({
              mtimeMs: expect.any(Number),
              size: expect.any(Number),
            }),
          },
        },
      ]);
    },
  );

  test("read rejects archived and unknown roots with project_not_found", async () => {
    const archivedRoot = makeRoot();
    const unknownRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([
      projectRecord(archivedRoot, "2026-01-02T00:00:00.000Z"),
    ]);

    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "archived-1",
      repoRoot: archivedRoot,
    });
    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "unknown-1",
      repoRoot: unknownRoot,
    });

    expect(emitted).toEqual([
      {
        type: "read_project_config_response",
        payload: {
          requestId: "archived-1",
          repoRoot: archivedRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
      {
        type: "read_project_config_response",
        payload: {
          requestId: "unknown-1",
          repoRoot: unknownRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
    ]);
  });

  test("write round-trips a config to a known root and echoes the new revision", async () => {
    const repoRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "write-1",
      repoRoot,
      config: { worktree: { setup: "npm ci" } },
      expectedRevision: null,
    });

    expect(emitted).toEqual([
      {
        type: "write_project_config_response",
        payload: {
          requestId: "write-1",
          repoRoot,
          ok: true,
          config: { worktree: { setup: "npm ci" } },
          revision: expect.objectContaining({
            mtimeMs: expect.any(Number),
            size: expect.any(Number),
          }),
        },
      },
    ]);
  });

  test("write recomputes the worktree setup commit status", async () => {
    const repoRoot = makeRoot();
    execFileSync("git", ["init", "-b", "main"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoRoot });
    writeFileSync(join(repoRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "npm ci" } }));
    execFileSync("git", ["add", "paseo.json"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "add config"], { cwd: repoRoot });
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "write-uncommitted-setup",
      repoRoot,
      config: { worktree: { setup: "npm install" } },
      expectedRevision: statPaseoConfigPath(repoRoot),
    });

    expect(emitted).toEqual([
      {
        type: "write_project_config_response",
        payload: expect.objectContaining({
          requestId: "write-uncommitted-setup",
          ok: true,
          hasUncommittedWorktreeSetupChanges: true,
        }),
      },
    ]);
  });

  test("write rejects a stale revision and an unknown root with their inline domain failures", async () => {
    const staleRoot = makeRoot();
    writeFileSync(join(staleRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "old" } }));
    const unknownRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(staleRoot)]);

    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "stale-1",
      repoRoot: staleRoot,
      config: { worktree: { setup: "new" } },
      expectedRevision: { mtimeMs: 1, size: 1 },
    });
    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "unknown-write-1",
      repoRoot: unknownRoot,
      config: { worktree: { setup: "new" } },
      expectedRevision: null,
    });

    expect(emitted).toEqual([
      {
        type: "write_project_config_response",
        payload: {
          requestId: "stale-1",
          repoRoot: staleRoot,
          ok: false,
          error: {
            code: "stale_project_config",
            currentRevision: expect.objectContaining({
              mtimeMs: expect.any(Number),
              size: expect.any(Number),
            }),
          },
        },
      },
      {
        type: "write_project_config_response",
        payload: {
          requestId: "unknown-write-1",
          repoRoot: unknownRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
    ]);
  });
});
