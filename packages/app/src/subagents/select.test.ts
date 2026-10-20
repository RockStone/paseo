import { buildSidebarThreadTree } from "./sidebar-tree";
import { providerSubagentKey } from "./provider-store";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, describe, expect, it } from "vitest";
import { selectProviderSubagentsForParent, selectSubagentsForParent } from "./select";
import { useProviderSubagentStore } from "./provider-store";
import { useSessionStore, type Agent } from "@/stores/session-store";

const SERVER_ID = "server-1";
const AGENT_TIMESTAMP = new Date("2026-03-08T10:00:00.000Z");
const EMPTY_PENDING_ARCHIVE_IDS = new Set<string>();

const AGENT_DEFAULTS: Agent = {
  serverId: SERVER_ID,
  id: "agent",
  provider: "codex",
  status: "idle",
  turn: { phase: "idle", cancellationRequestId: null },
  createdAt: AGENT_TIMESTAMP,
  updatedAt: AGENT_TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: AGENT_TIMESTAMP,
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
  pendingPermissions: [],
  persistence: null,
  runtimeInfo: undefined,
  lastUsage: undefined,
  lastError: null,
  title: "Agent",
  cwd: "/tmp/project",
  model: null,
  features: undefined,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

function setAgents(agents: Agent[]): void {
  useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, new Map(agents.map((agent) => [agent.id, agent])));
}

afterEach(() => {
  useSessionStore.getState().clearSession(SERVER_ID);
  useProviderSubagentStore.setState({
    descriptors: new Map(),
    timelines: new Map(),
    hiddenFromTrack: new Set(),
  });
});

describe("selectSubagentsForParent", () => {
  it("hides cached provider children when the host does not support them", () => {
    useProviderSubagentStore.getState().applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: "provider-child",
        parentAgentId: "parent-a",
        provider: "codex",
        title: "Provider child",
        description: null,
        subtitle: "Codex worker · 4.2k tokens",
        status: "completed",
        createdAt: "2026-03-08T10:01:00.000Z",
        updatedAt: "2026-03-08T10:02:00.000Z",
        toolCallId: "call-1",
      },
    });
    const params = { serverId: SERVER_ID, parentAgentId: "parent-a" };

    expect(
      selectProviderSubagentsForParent(useProviderSubagentStore.getState(), params, false),
    ).toEqual([]);
    expect(
      selectProviderSubagentsForParent(useProviderSubagentStore.getState(), params, true).map(
        (row) => row.id,
      ),
    ).toEqual(["provider-child"]);
    expect(
      selectProviderSubagentsForParent(useProviderSubagentStore.getState(), params, true)[0]
        ?.subtitle,
    ).toBe("Codex worker · 4.2k tokens");
  });

  it("hides locally dismissed provider children while retaining their descriptor", () => {
    const store = useProviderSubagentStore.getState();
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: "provider-child",
        parentAgentId: "parent-a",
        provider: "codex",
        title: "Provider child",
        description: null,
        status: "completed",
        createdAt: "2026-03-08T10:01:00.000Z",
        updatedAt: "2026-03-08T10:02:00.000Z",
        toolCallId: "call-1",
      },
    });
    store.hideFromTrack(SERVER_ID, "parent-a", ["provider-child"]);

    expect(
      selectProviderSubagentsForParent(
        useProviderSubagentStore.getState(),
        { serverId: SERVER_ID, parentAgentId: "parent-a" },
        true,
      ),
    ).toEqual([]);
    expect(useProviderSubagentStore.getState().descriptors.size).toBe(1);
  });

  it("places nested provider children only beneath their direct provider parent", () => {
    const store = useProviderSubagentStore.getState();
    const base = {
      parentAgentId: "parent-a",
      provider: "claude" as const,
      title: "general-purpose",
      subtitle: null,
      status: "running" as const,
      createdAt: "2026-09-04T10:00:00.000Z",
      updatedAt: "2026-09-04T10:00:00.000Z",
      toolCallId: null,
    };
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: { ...base, id: "direct", description: "Direct", parentSubagentId: null },
    });
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        ...base,
        id: "nested",
        description: "Nested",
        parentSubagentId: "direct",
      },
    });

    expect(
      selectProviderSubagentsForParent(
        useProviderSubagentStore.getState(),
        { serverId: SERVER_ID, parentAgentId: "parent-a" },
        true,
        true,
      ).map((row) => row.id),
    ).toEqual(["direct"]);
    expect(
      selectProviderSubagentsForParent(
        useProviderSubagentStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-a",
          providerParentSubagentId: "direct",
        },
        true,
        true,
      ).map((row) => row.id),
    ).toEqual(["nested"]);
  });

  it("returns only non-archived children for the requested parent", () => {
    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "child-a", parentAgentId: "parent-a" }),
      makeAgent({
        id: "archived-child",
        parentAgentId: "parent-a",
        archivedAt: new Date("2026-03-08T12:00:00.000Z"),
      }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent-a",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows.map((row) => row.id)).toEqual(["child-a"]);
  });

  it("excludes siblings, unrelated agents, and grandchildren", () => {
    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "parent-b" }),
      makeAgent({ id: "child-a", parentAgentId: "parent-a" }),
      makeAgent({ id: "sibling-b", parentAgentId: "parent-b" }),
      makeAgent({ id: "grandchild-a", parentAgentId: "child-a" }),
      makeAgent({ id: "unrelated" }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent-a",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows.map((row) => row.id)).toEqual(["child-a"]);
  });

  it("shows only direct children for each parent", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({ id: "child", parentAgentId: "parent" }),
      makeAgent({ id: "grandchild", parentAgentId: "child" }),
    ]);

    const parentRows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );
    const childRows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "child",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(parentRows.map((row) => row.id)).toEqual(["child"]);
    expect(childRows.map((row) => row.id)).toEqual(["grandchild"]);
  });

  it("sorts by createdAt ascending", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({
        id: "third",
        parentAgentId: "parent",
        createdAt: new Date("2026-03-08T10:03:00.000Z"),
      }),
      makeAgent({
        id: "first",
        parentAgentId: "parent",
        createdAt: new Date("2026-03-08T10:01:00.000Z"),
      }),
      makeAgent({
        id: "second",
        parentAgentId: "parent",
        createdAt: new Date("2026-03-08T10:02:00.000Z"),
      }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows.map((row) => row.id)).toEqual(["first", "second", "third"]);
  });

  it("maps only row-rendered fields and does not expose onOpen", () => {
    const createdAt = new Date("2026-03-08T10:01:00.000Z");
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({
        id: "child",
        parentAgentId: "parent",
        provider: "claude",
        title: "Review child",
        status: "running",
        requiresAttention: true,
        createdAt,
        model: "should-not-leak",
        cwd: "/private/project",
      }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      EMPTY_PENDING_ARCHIVE_IDS,
    );

    expect(rows).toEqual([
      {
        kind: "paseo",
        id: "child",
        provider: "claude",
        title: "Review child",
        description: null,
        subtitle: null,
        status: "running",
        turn: { phase: "idle", cancellationRequestId: null },
        requiresAttention: true,
        createdAt,
      },
    ]);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "createdAt",
      "description",
      "id",
      "kind",
      "provider",
      "requiresAttention",
      "status",
      "subtitle",
      "title",
      "turn",
    ]);
    expect(rows[0]).not.toHaveProperty("onOpen");
    expect(rows[0]).not.toHaveProperty("model");
    expect(rows[0]).not.toHaveProperty("cwd");
  });

  it("moves a child when parentAgentId changes", () => {
    const child = makeAgent({ id: "child", parentAgentId: "parent-a" });
    setAgents([makeAgent({ id: "parent-a" }), makeAgent({ id: "parent-b" }), child]);

    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-a",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual(["child"]);
    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-b",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual([]);

    setAgents([
      makeAgent({ id: "parent-a" }),
      makeAgent({ id: "parent-b" }),
      { ...child, parentAgentId: "parent-b" },
    ]);

    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-a",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual([]);
    expect(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "parent-b",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ).map((row) => row.id),
    ).toEqual(["child"]);
  });

  it("excludes children whose archive is pending", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({ id: "child-a", parentAgentId: "parent" }),
      makeAgent({ id: "child-b", parentAgentId: "parent" }),
    ]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      new Set(["child-b"]),
    );

    expect(rows.map((row) => row.id)).toEqual(["child-a"]);
  });

  it("returns the shared empty array when pending archive hides the last child", () => {
    setAgents([makeAgent({ id: "parent" }), makeAgent({ id: "child", parentAgentId: "parent" })]);

    const rows = selectSubagentsForParent(
      useSessionStore.getState(),
      {
        serverId: SERVER_ID,
        parentAgentId: "parent",
      },
      new Set(["child"]),
    );

    expect(rows).toEqual([]);
    expect(rows).toBe(
      selectSubagentsForParent(
        useSessionStore.getState(),
        {
          serverId: SERVER_ID,
          parentAgentId: "missing-parent",
        },
        EMPTY_PENDING_ARCHIVE_IDS,
      ),
    );
  });
});

describe("sidebar coordinator tree", () => {
  function tree(
    agents: Agent[],
    descriptors: ProviderSubagentDescriptorPayload[] = [],
    hiddenProviderKeys = new Set<string>(),
    providerSupported = true,
    activityCutoff?: number,
    activity?: ReadonlyMap<string, Date>,
  ) {
    return buildSidebarThreadTree({
      serverId: SERVER_ID,
      workspaceId: "workspace-a",
      agents: new Map(agents.map((agent) => [agent.id, agent])),
      descriptors: new Map(
        descriptors.map((entry) => [
          providerSubagentKey(SERVER_ID, entry.parentAgentId, entry.id),
          entry,
        ]),
      ),
      hiddenProviderKeys,
      providerSupported,
      nestingSupported: true,
      activityCutoff,
      activity,
    });
  }
  it("uses exact parent IDs, preserves nested children and links across workspaces", () => {
    const agents = [
      makeAgent({ id: "coordinator", title: "Plan", workspaceId: "workspace-a" }),
      makeAgent({
        id: "child",
        title: "Plan",
        workspaceId: "workspace-b",
        parentAgentId: "coordinator",
      }),
      makeAgent({ id: "grandchild", workspaceId: "workspace-b", parentAgentId: "child" }),
      makeAgent({ id: "independent", title: "Plan", workspaceId: "workspace-a" }),
    ];
    const roots = tree(agents);
    expect(roots.map((node) => node.key)).toEqual(["agent:coordinator"]);
    expect(roots[0]?.children[0]?.key).toBe("agent:child");
    expect(roots[0]?.children[0]?.children[0]?.target).toEqual({
      kind: "agent",
      agentId: "grandchild",
    });
  });
  it("removes archived and detached children without changing any records", () => {
    const root = makeAgent({ id: "parent", workspaceId: "workspace-a" });
    const child = makeAgent({ id: "child", workspaceId: "workspace-a", parentAgentId: "parent" });
    expect(tree([root, child])).toHaveLength(1);
    expect(tree([root, { ...child, archivedAt: AGENT_TIMESTAMP }])).toEqual([]);
    expect(tree([root, { ...child, parentAgentId: null }])).toEqual([]);
    expect(child.parentAgentId).toBe("parent");
  });
  it("places Claude-native descendants under their own provider parent and honors capability and hidden state", () => {
    const root = makeAgent({ id: "parent", workspaceId: "workspace-a" });
    const base: ProviderSubagentDescriptorPayload = {
      id: "native",
      parentAgentId: "parent",
      parentSubagentId: null,
      provider: "claude",
      title: "Explore",
      description: "Inspect implementation",
      status: "completed",
      createdAt: AGENT_TIMESTAMP.toISOString(),
      updatedAt: AGENT_TIMESTAMP.toISOString(),
      toolCallId: null,
    };
    const nested = {
      ...base,
      id: "native-child",
      parentSubagentId: "native",
      description: "Check tests",
    };
    const result = tree([root], [base, nested]);
    const native = result[0]?.children[0];
    expect(native?.title).toBe("Inspect implementation");
    expect(native?.target).toEqual({
      kind: "provider_subagent",
      parentAgentId: "parent",
      subagentId: "native",
      workspaceId: "workspace-a",
    });
    expect(native?.children[0]?.key).toBe("provider:parent:native-child");
    expect(tree([root], [base, nested], new Set(), false)).toEqual([]);
    expect(
      tree([root], [base, nested], new Set([providerSubagentKey(SERVER_ID, "parent", "native")])),
    ).toEqual([]);
  });
  it("hides inactive children at 24 hours while retaining live work and recent descendants", () => {
    const cutoff = AGENT_TIMESTAMP.getTime() + 1;
    const root = makeAgent({ id: "parent", workspaceId: "workspace-a" });
    const child = (id: string, extra: Partial<Agent> = {}) =>
      makeAgent({
        id,
        parentAgentId: "parent",
        ...extra,
      });
    const agents = [
      root,
      child("old"),
      child("boundary", { lastActivityAt: new Date(cutoff) }),
      child("running", { status: "running" }),
      child("permission", { attentionReason: "permission" }),
      child("ancestor"),
      child("recent-descendant", { parentAgentId: "ancestor", lastActivityAt: new Date(cutoff) }),
      child("live-activity"),
    ];
    const result = tree(
      agents,
      [],
      new Set(),
      true,
      cutoff,
      new Map([["live-activity", new Date(cutoff)]]),
    );
    expect(result[0]?.children.map((node) => node.key)).toEqual([
      "agent:boundary",
      "agent:live-activity",
      "agent:running",
      "agent:permission",
      "agent:ancestor",
    ]);
    expect(
      result[0]?.children.find((node) => node.key === "agent:ancestor")?.children[0]?.key,
    ).toBe("agent:recent-descendant");
    expect(agents.find((agent) => agent.id === "old")?.archivedAt).toBeNull();
  });
  it("uses native subagent update times and retains running native subagents", () => {
    const root = makeAgent({ id: "parent", workspaceId: "workspace-a" });
    const base: ProviderSubagentDescriptorPayload = {
      id: "old",
      parentAgentId: "parent",
      parentSubagentId: null,
      provider: "claude",
      title: "Explore",
      description: null,
      status: "completed",
      createdAt: AGENT_TIMESTAMP.toISOString(),
      updatedAt: AGENT_TIMESTAMP.toISOString(),
      toolCallId: null,
    };
    const cutoff = AGENT_TIMESTAMP.getTime() + 1;
    const result = tree(
      [root],
      [
        base,
        { ...base, id: "recent", updatedAt: new Date(cutoff).toISOString() },
        { ...base, id: "running", status: "running" },
      ],
      new Set(),
      true,
      cutoff,
    );
    expect(result[0]?.children.map((node) => node.key)).toEqual([
      "provider:parent:recent",
      "provider:parent:running",
    ]);
  });
  it("orders sibling threads by last activity descending, including native children and live updates", () => {
    const root = makeAgent({ id: "parent", workspaceId: "workspace-a" });
    const child = (id: string, delta: number, parentAgentId = "parent") =>
      makeAgent({
        id,
        parentAgentId,
        lastActivityAt: new Date(AGENT_TIMESTAMP.getTime() + delta),
      });
    const native: ProviderSubagentDescriptorPayload = {
      id: "native",
      parentAgentId: "parent",
      parentSubagentId: null,
      provider: "claude",
      title: "Explore",
      description: null,
      status: "completed",
      createdAt: AGENT_TIMESTAMP.toISOString(),
      updatedAt: new Date(AGENT_TIMESTAMP.getTime() + 2000).toISOString(),
      toolCallId: null,
    };
    const agents = [
      root,
      child("old", 0),
      child("new", 3000),
      child("nested-old", 0, "old"),
      child("nested-new", 1000, "old"),
    ];
    const result = tree(agents, [native]);
    expect(result[0]?.children.map((node) => node.key)).toEqual([
      "agent:new",
      "provider:parent:native",
      "agent:old",
    ]);
    expect(result[0]?.children[2]?.children.map((node) => node.key)).toEqual([
      "agent:nested-new",
      "agent:nested-old",
    ]);
    const updated = tree(
      agents,
      [native],
      new Set(),
      true,
      undefined,
      new Map([["old", new Date(AGENT_TIMESTAMP.getTime() + 4000)]]),
    );
    expect(updated[0]?.children[0]?.key).toBe("agent:old");
  });
  it("cuts cyclic metadata instead of recursively rendering it forever", () => {
    const root = makeAgent({ id: "a", workspaceId: "workspace-a", parentAgentId: "b" });
    const child = makeAgent({ id: "b", workspaceId: "workspace-b", parentAgentId: "a" });
    expect(tree([root, child])[0]?.children[0]?.children).toEqual([]);
  });
});
