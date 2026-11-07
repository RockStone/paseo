import type { Command } from "commander";
import type { ProjectMergeWorkspace } from "@getpaseo/protocol/messages";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";
import { renderRetainedServiceHostnames } from "../workspace/move.js";

export interface ProjectMergeResult {
  sourceProjectId: string;
  targetProjectId: string;
  dryRun: boolean;
  workspaces: ProjectMergeWorkspace[];
  /** Whether the source was removed, or would be removed in a dry run. */
  sourceRemoved: boolean;
  sourceKeptReason: string | null;
  retainedServiceHostnames: string[];
}

function describeSourceOutcome(data: ProjectMergeResult): string {
  if (data.dryRun) {
    return data.sourceRemoved
      ? `Would remove project ${data.sourceProjectId}.`
      : `Would keep project ${data.sourceProjectId} (--keep-source).`;
  }
  if (data.sourceRemoved) return `Removed project ${data.sourceProjectId}.`;
  if (data.sourceKeptReason === "keep_source") {
    return `Kept project ${data.sourceProjectId} (--keep-source).`;
  }
  return `Kept project ${data.sourceProjectId}: it still has workspaces.`;
}

export function renderProjectMerge(data: ProjectMergeResult): string {
  const count = data.workspaces.length;
  const noun = count === 1 ? "workspace" : "workspaces";
  const verb = data.dryRun ? "Would move" : "Moved";
  const lines = [
    `${verb} ${count} ${noun} from ${data.sourceProjectId} into ${data.targetProjectId}${count > 0 ? ":" : "."}`,
    ...data.workspaces.map(
      (workspace) =>
        `  ${workspace.workspaceId}  ${workspace.name}${workspace.archived ? " (archived)" : ""}`,
    ),
    describeSourceOutcome(data),
    ...renderRetainedServiceHostnames(data.retainedServiceHostnames),
  ];
  return lines.join("\n");
}

const projectMergeSchema: OutputSchema<ProjectMergeResult> = {
  idField: "targetProjectId",
  columns: [],
  renderHuman(result) {
    return result.type === "single" ? renderProjectMerge(result.data) : "";
  },
};

export interface ProjectMergeOptions extends CommandOptions {
  /** Required by commander; optional here to match the shared action signature. */
  into?: string;
  keepSource?: boolean;
  dryRun?: boolean;
}

export async function runMergeCommand(
  sourceProjectId: string,
  options: ProjectMergeOptions,
  _command: Command,
): Promise<SingleResult<ProjectMergeResult>> {
  const targetProjectId = options.into?.trim() ?? "";
  if (targetProjectId.length === 0) {
    throw {
      code: "MISSING_PROJECT",
      message: "Target project id cannot be empty",
      details: "Usage: paseo project merge <source-project-id> --into <target-project-id>",
    } satisfies CommandError;
  }
  if (targetProjectId === sourceProjectId) {
    throw {
      code: "INVALID_OPTIONS",
      message: "Source and target project must be different",
    } satisfies CommandError;
  }

  const client = await connectToDaemon({ target: options.daemonTarget }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ target: options.daemonTarget, error });
  });
  try {
    // COMPAT(workspaceProjectMove): added after v0.15.0, remove gate after 2027-05-07.
    if (!client.getLastServerInfoMessage()?.features?.workspaceProjectMove) {
      throw {
        code: "DAEMON_UPDATE_REQUIRED",
        message: "Update the host to merge projects.",
      } satisfies CommandError;
    }
    // The daemon moves every workspace, archived ones included, and removes the source
    // only when nothing is left in it. It never archives a workspace or an agent.
    const payload = await client.mergeProject({
      sourceProjectId,
      targetProjectId,
      keepSource: options.keepSource === true,
      dryRun: options.dryRun === true,
    });
    return {
      type: "single",
      data: {
        sourceProjectId,
        targetProjectId,
        dryRun: payload.dryRun,
        workspaces: payload.workspaces,
        sourceRemoved: payload.sourceRemoved,
        sourceKeptReason: payload.sourceKeptReason,
        retainedServiceHostnames: payload.retainedServiceHostnames,
      },
      schema: projectMergeSchema,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "PROJECT_MERGE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
