import type { Command } from "commander";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, OutputSchema, SingleResult } from "../../output/index.js";

export interface WorkspaceMoveResult {
  workspaceId: string;
  projectId: string;
  previousProjectId: string;
  changed: boolean;
  /** Running service hostnames that keep the previous project's slug until restarted. */
  retainedServiceHostnames: string[];
}

export function renderRetainedServiceHostnames(hostnames: string[]): string[] {
  if (hostnames.length === 0) return [];
  return [
    "",
    "Running services keep their current hostnames until their scripts restart:",
    ...hostnames.map((hostname) => `  ${hostname}`),
  ];
}

export const workspaceMoveSchema: OutputSchema<WorkspaceMoveResult> = {
  idField: "workspaceId",
  columns: [
    { header: "WORKSPACE ID", field: "workspaceId", width: 20 },
    { header: "PROJECT ID", field: "projectId", width: 24 },
    { header: "PREVIOUS PROJECT ID", field: "previousProjectId", width: 24 },
  ],
  renderHuman(result) {
    if (result.type !== "single") return "";
    const { data } = result;
    const lines = data.changed
      ? [`Moved workspace ${data.workspaceId} from ${data.previousProjectId} to ${data.projectId}.`]
      : [`Workspace ${data.workspaceId} already belongs to ${data.projectId}.`];
    lines.push(...renderRetainedServiceHostnames(data.retainedServiceHostnames));
    return lines.join("\n");
  },
};

export interface WorkspaceMoveOptions {
  host?: string;
  daemonTarget: import("../../utils/daemon-target.js").DaemonTarget;
  /** Required by commander; optional here to match the shared action signature. */
  project?: string;
}

export async function runMoveCommand(
  workspaceId: string,
  options: WorkspaceMoveOptions,
  _command: Command,
): Promise<SingleResult<WorkspaceMoveResult>> {
  const projectId = options.project?.trim() ?? "";
  if (projectId.length === 0) {
    throw {
      code: "MISSING_PROJECT",
      message: "Target project id cannot be empty",
      details: "Usage: paseo workspace move <workspace-id> --project <project-id>",
    } satisfies CommandError;
  }

  const host = getDaemonHost({ target: options.daemonTarget });
  const client = await connectToDaemon({ target: options.daemonTarget }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    } satisfies CommandError;
  });
  try {
    // COMPAT(workspaceProjectMove): added after v0.15.0, remove gate after 2027-05-07.
    if (!client.getLastServerInfoMessage()?.features?.workspaceProjectMove) {
      throw {
        code: "DAEMON_UPDATE_REQUIRED",
        message: "Update the host to move workspaces between projects.",
      } satisfies CommandError;
    }
    const payload = await client.setWorkspaceProject(workspaceId, projectId);
    return {
      type: "single",
      data: {
        workspaceId,
        projectId: payload.projectId ?? projectId,
        previousProjectId: payload.previousProjectId ?? projectId,
        changed: payload.changed,
        retainedServiceHostnames: payload.retainedServiceHostnames,
      },
      schema: workspaceMoveSchema,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_MOVE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
