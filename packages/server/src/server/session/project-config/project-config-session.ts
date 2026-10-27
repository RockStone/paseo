import { mkdir } from "node:fs/promises";
import { resolve } from "path";
import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../../workspace-registry.js";
import {
  readPaseoConfigForEdit,
  resolveProjectConfigRoot,
  writePaseoConfigForEdit,
  type ProjectConfigRpcError,
} from "../../../utils/paseo-config-file.js";
import { hasUncommittedWorktreeSetupChanges } from "./worktree-setup-commit-status.js";

export interface ProjectConfigSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface ProjectConfigSessionOptions {
  host: ProjectConfigSessionHost;
  projectRegistry: Pick<ProjectRegistry, "list">;
  workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  logger: pino.Logger;
  sharedScriptsRoot?: string;
}

/**
 * A client's read/write surface for a project's on-disk paseo.json. Resolves the
 * request's repoRoot against active project and workspace roots, including
 * symlinks. A worktree's Run menu must edit the config its commands actually read,
 * rather than the source checkout's copy. Unknown and archived paths stay outside
 * this surface.
 */
export class ProjectConfigSession {
  private readonly host: ProjectConfigSessionHost;
  private readonly projectRegistry: Pick<ProjectRegistry, "list">;
  private readonly workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  private readonly logger: pino.Logger;
  private readonly sharedScriptsRoot: string | undefined;

  constructor(options: ProjectConfigSessionOptions) {
    this.host = options.host;
    this.projectRegistry = options.projectRegistry;
    this.workspaceRegistry = options.workspaceRegistry;
    this.logger = options.logger;
    this.sharedScriptsRoot = options.sharedScriptsRoot
      ? resolve(options.sharedScriptsRoot)
      : undefined;
  }

  async handleReadProjectConfigRequest(
    msg: Extract<SessionInboundMessage, { type: "read_project_config_request" }>,
  ): Promise<void> {
    const repoRoot = await this.resolveKnownProjectRoot(msg.repoRoot);
    if (!repoRoot) {
      this.emitProjectConfigReadFailure(msg, { code: "project_not_found" });
      return;
    }

    const result = await readPaseoConfigForEdit(repoRoot);
    if (!result.ok) {
      this.logger.warn(
        { repoRoot, requestId: msg.requestId, outcome: result.error.code },
        "Failed to read project config",
      );
      this.emitProjectConfigReadFailure(msg, result.error, repoRoot);
      return;
    }

    if (result.config === null) {
      this.logger.debug(
        { repoRoot, requestId: msg.requestId, outcome: "missing_project_config" },
        "Project config missing",
      );
    }

    const setupCommitStatus = await this.readSetupCommitStatus(repoRoot, result.config);

    this.host.emit({
      type: "read_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: true,
        config: result.config,
        revision: result.revision,
        ...(this.sharedScriptsRoot ? { sharedScriptsRoot: this.sharedScriptsRoot } : {}),
        ...(setupCommitStatus === null
          ? {}
          : { hasUncommittedWorktreeSetupChanges: setupCommitStatus }),
      },
    });
  }

  async handleWriteProjectConfigRequest(
    msg: Extract<SessionInboundMessage, { type: "write_project_config_request" }>,
  ): Promise<void> {
    const repoRoot = await this.resolveKnownProjectRoot(msg.repoRoot);
    if (!repoRoot) {
      this.emitProjectConfigWriteFailure(msg, { code: "project_not_found" });
      return;
    }

    this.logger.debug(
      { repoRoot, requestId: msg.requestId, outcome: "write_attempt" },
      "Writing project config",
    );
    if (repoRoot === this.sharedScriptsRoot) {
      try {
        await mkdir(repoRoot, { recursive: true });
      } catch {
        this.emitProjectConfigWriteFailure(msg, { code: "write_failed" }, repoRoot);
        return;
      }
    }
    const result = await writePaseoConfigForEdit({
      repoRoot,
      config: msg.config,
      expectedRevision: msg.expectedRevision,
    });
    if (!result.ok) {
      this.logger.debug(
        { repoRoot, requestId: msg.requestId, outcome: result.error.code },
        "Project config write did not complete",
      );
      this.emitProjectConfigWriteFailure(msg, result.error, repoRoot);
      return;
    }

    this.logger.debug(
      { repoRoot, requestId: msg.requestId, outcome: "written" },
      "Project config written",
    );
    const setupCommitStatus = await this.readSetupCommitStatus(repoRoot, result.config);
    this.host.emit({
      type: "write_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: true,
        config: result.config,
        revision: result.revision,
        ...(setupCommitStatus === null
          ? {}
          : { hasUncommittedWorktreeSetupChanges: setupCommitStatus }),
      },
    });
  }

  private async readSetupCommitStatus(
    repoRoot: string,
    config: Parameters<typeof hasUncommittedWorktreeSetupChanges>[0]["currentConfig"],
  ): Promise<boolean | null> {
    try {
      return await hasUncommittedWorktreeSetupChanges({ repoRoot, currentConfig: config });
    } catch (error) {
      this.logger.debug({ repoRoot, error }, "Could not inspect committed worktree setup");
      return null;
    }
  }

  private emitProjectConfigReadFailure(
    msg: Extract<SessionInboundMessage, { type: "read_project_config_request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.host.emit({
      type: "read_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: false,
        error,
      },
    });
  }

  private emitProjectConfigWriteFailure(
    msg: Extract<SessionInboundMessage, { type: "write_project_config_request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.host.emit({
      type: "write_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot,
        ok: false,
        error,
      },
    });
  }

  private async resolveKnownProjectRoot(repoRoot: string): Promise<string | null> {
    const requestedRoot = resolve(repoRoot);
    const projects = await this.projectRegistry.list();
    const activeProjectIds = new Set(
      projects.filter((p) => p.archivedAt === null).map((p) => p.projectId),
    );
    const workspaces = await this.workspaceRegistry.list();
    const activeRoots = new Set([
      ...projects.filter((p) => p.archivedAt === null).map((p) => resolve(p.rootPath)),
      ...workspaces
        .filter((w) => w.archivedAt === null && activeProjectIds.has(w.projectId))
        .map((w) => resolve(w.cwd)),
      ...(this.sharedScriptsRoot ? [this.sharedScriptsRoot] : []),
    ]);
    const root = await resolveProjectConfigRoot(requestedRoot, activeRoots);
    if (!root) return null;
    // Authorization follows live registry state after alias IO, including archive/removal.
    if (root === this.sharedScriptsRoot) return root;
    const current = await this.projectRegistry.list();
    const currentProjectIds = new Set(
      current.filter((p) => p.archivedAt === null).map((p) => p.projectId),
    );
    if (current.some((p) => p.archivedAt === null && resolve(p.rootPath) === root)) return root;
    const currentWorkspaces = await this.workspaceRegistry.list();
    return currentWorkspaces.some(
      (w) => w.archivedAt === null && currentProjectIds.has(w.projectId) && resolve(w.cwd) === root,
    )
      ? root
      : null;
  }
}
