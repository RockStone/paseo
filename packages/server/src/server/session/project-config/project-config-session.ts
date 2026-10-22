import { mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "path";
import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../../workspace-registry.js";
import {
  readPaseoConfigForEdit,
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
      ? canonicalizeConfigRoot(options.sharedScriptsRoot)
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

    const result = readPaseoConfigForEdit(repoRoot);
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
        mkdirSync(repoRoot, { recursive: true });
      } catch {
        this.emitProjectConfigWriteFailure(msg, { code: "write_failed" }, repoRoot);
        return;
      }
    }
    const result = writePaseoConfigForEdit({
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
    const requestedRoot = canonicalizeConfigRoot(repoRoot);
    if (requestedRoot === this.sharedScriptsRoot) return requestedRoot;
    const projects = await this.projectRegistry.list();
    const activeProjects = new Set<string>();
    for (const project of projects) {
      if (project.archivedAt !== null) {
        continue;
      }
      const projectRoot = canonicalizeConfigRoot(project.rootPath);
      activeProjects.add(project.projectId);
      if (requestedRoot === projectRoot) {
        return projectRoot;
      }
    }
    for (const workspace of await this.workspaceRegistry.list()) {
      if (workspace.archivedAt !== null || !activeProjects.has(workspace.projectId)) continue;
      const workspaceRoot = canonicalizeConfigRoot(workspace.cwd);
      if (requestedRoot === workspaceRoot) return workspaceRoot;
    }
    return null;
  }
}

function canonicalizeConfigRoot(repoRoot: string): string {
  const resolved = resolve(repoRoot);
  try {
    return stripTrailingPathSeparators(realpathSync(resolved));
  } catch {
    const parent = dirname(resolved);
    return parent === resolved
      ? resolved
      : join(canonicalizeConfigRoot(parent), basename(resolved));
  }
}

function stripTrailingPathSeparators(path: string): string {
  let normalized = path;
  while (normalized.length > 1 && normalized.endsWith(sep)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
