import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceCommand } from "./index.js";
import { runMoveCommand, workspaceMoveSchema } from "./move.js";

const setWorkspaceProject = vi.fn(async (_workspaceId: string, projectId: string) => ({
  requestId: "req",
  workspaceId: "workspace-1",
  accepted: true,
  workspace: null,
  projectId,
  previousProjectId: "project-old",
  changed: true,
  retainedServiceHostnames: ["web--main--old-1234abcd.localhost"],
  error: null,
}));
const close = vi.fn(async () => undefined);
let serverFeatures: Record<string, boolean> = { workspaceProjectMove: true };

vi.mock("../../utils/client.js", () => ({
  getDaemonHost: vi.fn(() => "localhost:6767"),
  connectToDaemon: vi.fn(async () => ({
    setWorkspaceProject,
    getLastServerInfoMessage: () => ({ features: serverFeatures }),
    close,
  })),
}));

const daemonTarget = { kind: "instance" as const, home: "/tmp/workspace-move-test" };

beforeEach(() => {
  vi.clearAllMocks();
  serverFeatures = { workspaceProjectMove: true };
});

describe("workspace move", () => {
  it("is registered with a required --project option", () => {
    const move = createWorkspaceCommand().commands.find((command) => command.name() === "move");
    expect(move?.options.find((option) => option.long === "--project")?.mandatory).toBe(true);
  });

  it("moves the workspace and reports retained service hostnames", async () => {
    const result = await runMoveCommand(
      "workspace-1",
      { daemonTarget, project: " project-new " },
      {} as never,
    );

    expect(setWorkspaceProject).toHaveBeenCalledWith("workspace-1", "project-new");
    expect(result.data).toEqual({
      workspaceId: "workspace-1",
      projectId: "project-new",
      previousProjectId: "project-old",
      changed: true,
      retainedServiceHostnames: ["web--main--old-1234abcd.localhost"],
    });
    expect(workspaceMoveSchema.renderHuman?.(result, {} as never)).toBe(
      [
        "Moved workspace workspace-1 from project-old to project-new.",
        "",
        "Running services keep their current hostnames until their scripts restart:",
        "  web--main--old-1234abcd.localhost",
      ].join("\n"),
    );
    expect(close).toHaveBeenCalled();
  });

  it("tells the user to update a host without the capability", async () => {
    serverFeatures = {};

    await expect(
      runMoveCommand("workspace-1", { daemonTarget, project: "project-new" }, {} as never),
    ).rejects.toMatchObject({ code: "DAEMON_UPDATE_REQUIRED" });
    expect(setWorkspaceProject).not.toHaveBeenCalled();
  });

  it("surfaces a daemon refusal as WORKSPACE_MOVE_FAILED", async () => {
    setWorkspaceProject.mockRejectedValueOnce(new Error("Project is archived: project-new"));

    await expect(
      runMoveCommand("workspace-1", { daemonTarget, project: "project-new" }, {} as never),
    ).rejects.toEqual({
      code: "WORKSPACE_MOVE_FAILED",
      message: "Project is archived: project-new",
    });
  });
});
