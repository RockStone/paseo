import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import {
  buildWorkspaceAgentActivityIndex,
  selectWorkspaceLastActivity,
} from "./workspace-agent-activity";

function agent(input: {
  id: string;
  workspaceId?: string;
  status?: Agent["status"];
  backgroundTaskCount?: number;
  turn?: Agent["turn"];
  updatedAt: string;
  attentionTimestamp?: string | null;
  requiresAttention?: boolean;
  attentionReason?: Agent["attentionReason"];
  pendingPermissionCount?: number;
  archivedAt?: string | null;
  parentAgentId?: string | null;
}): Agent {
  return {
    serverId: "host-a",
    id: input.id,
    provider: "codex",
    status: input.status ?? "idle",
    backgroundTaskCount: input.backgroundTaskCount,
    turn:
      input.turn ??
      (input.status === "running"
        ? {
            phase: "open",
            turnId: "turn-1",
            startedAt: null,
            cancellationRequestId: null,
          }
        : { phase: "idle", cancellationRequestId: null }),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date(input.updatedAt),
    lastUserMessageAt: null,
    lastActivityAt: new Date(input.updatedAt),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: Array.from({ length: input.pendingPermissionCount ?? 0 }, (_, index) => ({
      id: `permission-${index}`,
      provider: "codex",
      name: "shell",
      kind: "tool",
      input: {},
    })),
    persistence: null,
    title: null,
    cwd: "/repo",
    workspaceId: input.workspaceId,
    model: null,
    requiresAttention: input.requiresAttention,
    attentionReason: input.attentionReason,
    attentionTimestamp: input.attentionTimestamp ? new Date(input.attentionTimestamp) : null,
    archivedAt: input.archivedAt ? new Date(input.archivedAt) : null,
    parentAgentId: input.parentAgentId ?? null,
    labels: {},
  };
}

describe("workspace last activity", () => {
  it("keeps the workspace running while its idle coordinator has background work", () => {
    const coordinator = agent({
      id: "coordinator",
      workspaceId: "workspace-1",
      updatedAt: "2026-01-01T00:01:00Z",
      backgroundTaskCount: 1,
    });
    const agents = new Map([[coordinator.id, coordinator]]);
    const active = buildWorkspaceAgentActivityIndex(agents);
    expect(active.get("workspace-1")?.status).toBe("running");
    agents.set(coordinator.id, { ...coordinator, backgroundTaskCount: 0 });
    expect(buildWorkspaceAgentActivityIndex(agents, active).get("workspace-1")?.status).toBe(
      "done",
    );
  });

  it("includes streamed descendants across workspace boundaries, independently of status and metadata", () => {
    const root = agent({
      id: "root",
      workspaceId: "workspace-1",
      status: "idle",
      updatedAt: "2026-01-01T00:01:00Z",
    });
    const child = agent({
      id: "child",
      workspaceId: "workspace-2",
      parentAgentId: root.id,
      status: "idle",
      updatedAt: "2026-01-01T00:02:00Z",
    });
    const grandchild = agent({
      id: "grandchild",
      workspaceId: "workspace-2",
      parentAgentId: child.id,
      status: "idle",
      updatedAt: "2026-01-01T00:03:00Z",
    });
    const unrelated = agent({
      id: "unrelated",
      workspaceId: "workspace-3",
      status: "running",
      updatedAt: "2026-01-01T01:00:00Z",
    });
    const agents = new Map([root, child, grandchild, unrelated].map((value) => [value.id, value]));
    const activity = new Map([[grandchild.id, new Date("2026-01-01T00:04:00Z")]]);
    root.updatedAt = new Date("2026-01-01T02:00:00Z");
    const input = { serverId: "srv", workspaceId: "workspace-1", agents, activity };
    expect(selectWorkspaceLastActivity(input)).toBe(Date.parse("2026-01-01T00:04:00Z"));
    // A late snapshot must not be overwritten by an older stream timestamp.
    grandchild.lastActivityAt = new Date("2026-01-01T00:05:00Z");
    expect(selectWorkspaceLastActivity(input)).toBe(Date.parse("2026-01-01T00:05:00Z"));
    expect(selectWorkspaceLastActivity({ ...input, workspaceId: "empty" })).toBeNull();
  });

  it("includes provider child updates only for the matching host and active parent, and tolerates parent cycles", () => {
    const root = agent({
      id: "root",
      workspaceId: "workspace-1",
      status: "idle",
      updatedAt: "2026-01-01T00:01:00Z",
      parentAgentId: "child",
    });
    const child = agent({
      id: "child",
      workspaceId: "workspace-2",
      status: "idle",
      updatedAt: "2026-01-01T00:02:00Z",
      parentAgentId: root.id,
    });
    const archived = agent({
      id: "archived",
      workspaceId: "workspace-1",
      status: "idle",
      updatedAt: "2026-01-01T04:00:00Z",
      archivedAt: "2026-01-01T04:01:00Z",
    });
    const agents = new Map([root, child, archived].map((value) => [value.id, value]));
    const input = {
      serverId: "srv",
      workspaceId: "workspace-1",
      agents,
      activity: new Map(),
      providerSubagents: new Map([
        ["srv\0root\0native", { parentAgentId: root.id, updatedAt: "2026-01-01T00:03:00Z" }],
        ["other\0root\0native", { parentAgentId: root.id, updatedAt: "2026-01-01T03:00:00Z" }],
        [
          "srv\0archived\0native",
          { parentAgentId: archived.id, updatedAt: "2026-01-01T04:00:00Z" },
        ],
      ]),
    };
    expect(selectWorkspaceLastActivity(input)).toBe(Date.parse("2026-01-01T00:03:00Z"));
    expect(selectWorkspaceLastActivity({ ...input, workspaceId: "empty" })).toBeNull();
  });
});

describe("workspace agent activity index", () => {
  it("uses turn liveness for running while preserving protocol lifecycle states", () => {
    const result = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "open",
          agent({
            id: "open",
            workspaceId: "workspace-open",
            status: "idle",
            turn: {
              phase: "open",
              turnId: null,
              startedAt: null,
              cancellationRequestId: null,
            },
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ],
        [
          "idle-error",
          agent({
            id: "idle-error",
            workspaceId: "workspace-error",
            status: "error",
            turn: { phase: "idle", cancellationRequestId: null },
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ],
      ]),
    );

    expect(result.get("workspace-open")?.status).toBe("running");
    expect(result.get("workspace-error")?.status).toBe("failed");
  });

  it("keeps the latest active root agent for each workspace", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "older",
          agent({
            id: "older",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "permission",
          agent({
            id: "permission",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:01:00.000Z",
            pendingPermissionCount: 1,
          }),
        ],
        [
          "attention",
          agent({
            id: "attention",
            workspaceId: "workspace-b",
            updatedAt: "2026-06-01T10:00:00.000Z",
            attentionTimestamp: "2026-06-01T10:02:00.000Z",
            requiresAttention: true,
            attentionReason: "finished",
          }),
        ],
      ]),
    );

    expect(index).toEqual(
      new Map([
        [
          "workspace-a",
          {
            agentId: "permission",
            status: "needs_input",
            enteredAt: new Date("2026-06-01T10:01:00.000Z"),
          },
        ],
        [
          "workspace-b",
          {
            agentId: "attention",
            status: "attention",
            enteredAt: new Date("2026-06-01T10:02:00.000Z"),
          },
        ],
      ]),
    );
  });

  it("does not let archived or child agents change root workspace activity", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:03:00.000Z",
            pendingPermissionCount: 1,
            parentAgentId: "root",
          }),
        ],
        [
          "archived",
          agent({
            id: "archived",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:04:00.000Z",
            requiresAttention: true,
            attentionReason: "error",
            archivedAt: "2026-06-01T10:04:00.000Z",
          }),
        ],
      ]),
    );

    expect(index.get("workspace-a")).toEqual({
      agentId: "root",
      status: "running",
      enteredAt: new Date("2026-06-01T10:00:00.000Z"),
    });
  });

  it("treats a cross-workspace subagent as activity in its own workspace", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "parent",
          agent({
            id: "parent",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-b",
            status: "running",
            updatedAt: "2026-06-01T10:03:00.000Z",
            parentAgentId: "parent",
          }),
        ],
      ]),
    );

    expect(index).toEqual(
      new Map([
        [
          "workspace-a",
          {
            agentId: "parent",
            status: "done",
            enteredAt: new Date("2026-06-01T10:00:00.000Z"),
          },
        ],
        [
          "workspace-b",
          {
            agentId: "child",
            status: "running",
            enteredAt: new Date("2026-06-01T10:03:00.000Z"),
          },
        ],
      ]),
    );
  });

  it("preserves the activity index while the same agent remains in the same status", () => {
    const previous = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
    );

    const next = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:05:00.000Z",
          }),
        ],
      ]),
      previous,
    );

    expect(next).toBe(previous);
    expect(next.get("workspace-a")?.enteredAt).toEqual(new Date("2026-06-01T10:00:00.000Z"));
  });

  it("records a new entry time when an agent changes status", () => {
    const previous = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
    );

    const next = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "idle",
            updatedAt: "2026-06-01T10:05:00.000Z",
            pendingPermissionCount: 1,
          }),
        ],
      ]),
      previous,
    );

    expect(next).not.toBe(previous);
    expect(next.get("workspace-a")).toEqual({
      agentId: "root",
      status: "needs_input",
      enteredAt: new Date("2026-06-01T10:05:00.000Z"),
    });
  });
});
