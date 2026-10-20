import {
  createNestedSidebarWorkspaceParentsSelector,
  nestedSidebarWorkspaceParents,
  groupSidebarProjects,
} from "./sidebar-workspace-grouping";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
import { buildSidebarThreadTree, createSidebarActivityOrderSelector } from "./sidebar-tree";
import { providerSubagentKey } from "./provider-store";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSubagentsForParentSelector,
  selectProviderSubagentsForParent,
  selectSubagentsForParent,
} from "./select";
import { createWorkspaceAgentVisibilitySelector } from "@/workspace-tabs/agent-visibility";
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

function tickAgentStream(agentId: string, text: string): void {
  useSessionStore.getState().setAgentStreamState(SERVER_ID, agentId, {
    head: [{ kind: "assistant_message", id: "message", text, timestamp: AGENT_TIMESTAMP }],
  });
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
    nestedWorkspaceIds?: ReadonlySet<string>,
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
      nestedWorkspaceIds,
    });
  }
  it("nests delegated workspaces with their descendants without changing ownership", () => {
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
    const grouped = tree(
      agents,
      [],
      new Set(),
      true,
      undefined,
      undefined,
      new Set(["workspace-b"]),
    );
    expect(grouped.map((node) => node.key)).toEqual(["agent:coordinator"]);
    expect(grouped[0]?.children[0]?.key).toBe("agent:child");
    expect(grouped[0]?.children[0]?.children[0]?.key).toBe("agent:grandchild");
    expect(tree(agents)).toEqual([]);
    const childWorkspaceTree = buildSidebarThreadTree({
      serverId: SERVER_ID,
      workspaceId: "workspace-b",
      agents: new Map(agents.map((agent) => [agent.id, agent])),
      descriptors: new Map(),
      hiddenProviderKeys: new Set(),
      providerSupported: true,
      nestingSupported: true,
    });
    expect(childWorkspaceTree.map((node) => node.key)).toEqual(["agent:child"]);
    expect(childWorkspaceTree[0]?.children.map((node) => node.key)).toEqual(["agent:grandchild"]);
    expect(agents[1]?.parentAgentId).toBe("coordinator");
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
    expect(tree([root, child])).toEqual([]);
  });
});

describe("sidebar delegated workspace grouping", () => {
  function project(ids: string[]): SidebarProjectEntry {
    return {
      viewKey: "project",
      projectName: "Project",
      projectKind: "git",
      iconWorkingDir: "/repo",
      hosts: [],
      workspaces: ids.map((id) => ({
        workspaceId: id,
        workspaceKey: `${SERVER_ID}:${id}`,
        serverId: SERVER_ID,
        projectViewKey: "project",
        projectName: "Project",
        projectKind: "git",
        workspaceKind: "worktree",
        name: id,
      })),
    };
  }
  const parent = makeAgent({ id: "parent", workspaceId: "parent-ws" });
  const child = makeAgent({ id: "child", workspaceId: "child-ws", parentAgentId: "parent" });
  function groups(projects: SidebarProjectEntry[], agents: Agent[]) {
    return nestedSidebarWorkspaceParents(projects, {
      [SERVER_ID]: { agents: new Map(agents.map((agent) => [agent.id, agent])) },
    });
  }
  it("folds child workspaces under a visible parent and carries their activity rank", () => {
    const projects = [project(["child-ws", "other-ws", "parent-ws"])];
    const parents = groups(projects, [parent, child]);
    expect([...parents]).toEqual([[`${SERVER_ID}:child-ws`, `${SERVER_ID}:parent-ws`]]);
    expect(
      groupSidebarProjects(projects, parents)[0]?.workspaces.map(
        (workspace) => workspace.workspaceId,
      ),
    ).toEqual(["parent-ws", "other-ws"]);
    expect(projects[0]?.workspaces).toHaveLength(3);
  });
  it("retains independent, detached, archived-parent and filtered-parent workspaces", () => {
    const projects = [project(["parent-ws", "child-ws"])];
    expect(
      groups(projects, [parent, child, makeAgent({ id: "independent", workspaceId: "child-ws" })])
        .size,
    ).toBe(0);
    expect(groups(projects, [parent, { ...child, parentAgentId: null }]).size).toBe(0);
    expect(groups(projects, [{ ...parent, archivedAt: AGENT_TIMESTAMP }, child]).size).toBe(0);
    expect(groups([project(["child-ws"])], [parent, child]).size).toBe(0);
  });
  it("retains cyclic workspaces instead of hiding both", () => {
    expect(
      groups([project(["parent-ws", "child-ws"])], [{ ...parent, parentAgentId: "child" }, child])
        .size,
    ).toBe(0);
  });
  it("reuses the grouping across stream ticks until the agent map changes", () => {
    setAgents([parent, child]);
    const select = createNestedSidebarWorkspaceParentsSelector([
      project(["parent-ws", "child-ws"]),
    ]);
    const before = select(useSessionStore.getState());
    for (let tick = 0; tick < 20; tick += 1) {
      tickAgentStream("parent", `token ${tick}`);
      expect(select(useSessionStore.getState())).toBe(before);
    }
    expect(before.size).toBe(1);

    setAgents([parent, { ...child, parentAgentId: null }]);
    expect(select(useSessionStore.getState()).size).toBe(0);
  });
});

describe("createSidebarActivityOrderSelector", () => {
  it("reuses the order across stream ticks until activity timestamps change", () => {
    const agents = [
      makeAgent({ id: "older", lastActivityAt: new Date("2026-03-08T09:00:00.000Z") }),
      makeAgent({ id: "newer", lastActivityAt: new Date("2026-03-08T09:30:00.000Z") }),
    ];
    setAgents(agents);
    const select = createSidebarActivityOrderSelector({
      serverId: SERVER_ID,
      agents: new Map(agents.map((agent) => [agent.id, agent])),
      descriptors: new Map(),
      activityCutoff: 0,
    });
    const before = select(useSessionStore.getState());
    for (let tick = 0; tick < 20; tick += 1) {
      tickAgentStream("older", `token ${tick}`);
      expect(select(useSessionStore.getState())).toBe(before);
    }
    expect(before).toEqual(["agent:newer", "agent:older"]);

    useSessionStore
      .getState()
      .setAgentLastActivityBatch(new Map([["older", new Date("2026-03-08T10:00:00.000Z")]]));
    expect(select(useSessionStore.getState())).toEqual(["agent:older", "agent:newer"]);
  });
});

describe("createSubagentsForParentSelector", () => {
  class IterationCountingMap<K, V> extends Map<K, V> {
    iterations = 0;
    override values() {
      this.iterations += 1;
      return super.values();
    }
    override entries() {
      this.iterations += 1;
      return super.entries();
    }
    override [Symbol.iterator]() {
      this.iterations += 1;
      return super[Symbol.iterator]();
    }
  }

  const params = { serverId: SERVER_ID, parentAgentId: "parent" };

  function streamTick(text: string): void {
    useSessionStore.getState().setAgentStreamState(SERVER_ID, "parent", {
      head: [
        {
          kind: "assistant_message",
          id: "message-1",
          text,
          timestamp: new Date("2026-03-08T10:05:00.000Z"),
        },
      ],
    });
  }

  it("returns the cached rows without walking agents when a stream tick leaves them unchanged", () => {
    const agents = new IterationCountingMap<string, Agent>(
      [
        makeAgent({ id: "parent" }),
        makeAgent({ id: "child", parentAgentId: "parent" }),
        makeAgent({ id: "unrelated" }),
      ].map((agent) => [agent.id, agent]),
    );
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    useSessionStore.getState().setAgents(SERVER_ID, agents);
    const select = createSubagentsForParentSelector(params, EMPTY_PENDING_ARCHIVE_IDS);
    const before = select(useSessionStore.getState());
    const iterationsAfterFirstSelect = agents.iterations;

    for (let tick = 0; tick < 100; tick += 1) {
      streamTick(`token ${tick}`);
      expect(select(useSessionStore.getState())).toBe(before);
    }

    expect(useSessionStore.getState().sessions[SERVER_ID]?.agents).toBe(agents);
    expect(agents.iterations).toBe(iterationsAfterFirstSelect);
    expect(before.map((row) => row.id)).toEqual(["child"]);
  });

  it("recomputes when the agents map changes", () => {
    setAgents([makeAgent({ id: "parent" }), makeAgent({ id: "child-a", parentAgentId: "parent" })]);
    const select = createSubagentsForParentSelector(params, EMPTY_PENDING_ARCHIVE_IDS);
    const before = select(useSessionStore.getState());

    useSessionStore.getState().setAgents(SERVER_ID, (current) => {
      const child = makeAgent({
        id: "child-b",
        parentAgentId: "parent",
        createdAt: new Date("2026-03-08T10:01:00.000Z"),
      });
      return new Map(current).set(child.id, child);
    });
    const after = select(useSessionStore.getState());

    expect(after).not.toBe(before);
    expect(after.map((row) => row.id)).toEqual(["child-a", "child-b"]);
  });

  it("keeps the previous rows when a changed agents map yields the same rows", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({ id: "child", parentAgentId: "parent" }),
      makeAgent({ id: "unrelated" }),
    ]);
    const select = createSubagentsForParentSelector(params, EMPTY_PENDING_ARCHIVE_IDS);
    const before = select(useSessionStore.getState());

    useSessionStore.getState().setAgents(SERVER_ID, (current) => {
      return new Map(current).set("unrelated", makeAgent({ id: "unrelated", status: "running" }));
    });

    expect(select(useSessionStore.getState())).toBe(before);
  });

  it("applies the pending archive ids it was created with", () => {
    setAgents([
      makeAgent({ id: "parent" }),
      makeAgent({ id: "child-a", parentAgentId: "parent" }),
      makeAgent({ id: "child-b", parentAgentId: "parent" }),
    ]);

    const rows = createSubagentsForParentSelector(
      params,
      new Set(["child-b"]),
    )(useSessionStore.getState());

    expect(rows.map((row) => row.id)).toEqual(["child-a"]);
  });
  it("does no agent map walks for 100 stream commits with unchanged source maps", () => {
    const agents = new IterationCountingMap<string, Agent>(
      Array.from({ length: 200 }, (_, i) => {
        const agent = makeAgent({
          id: `agent-${i}`,
          workspaceId: "workspace",
          parentAgentId: i < 3 ? null : `agent-${i % 3}`,
        });
        return [agent.id, agent] as const;
      }),
    );
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    useSessionStore.getState().setAgents(SERVER_ID, agents);
    const selectVisibility = createWorkspaceAgentVisibilitySelector({
      serverId: SERVER_ID,
      workspaceId: "workspace",
    });
    const selectChildren = Array.from({ length: 3 }, (_, i) =>
      createSubagentsForParentSelector(
        { serverId: SERVER_ID, parentAgentId: `agent-${i}` },
        EMPTY_PENDING_ARCHIVE_IDS,
      ),
    );
    const select = (state: ReturnType<typeof useSessionStore.getState>) => {
      selectVisibility(state);
      selectChildren.forEach((selector) => selector(state));
    };
    select(useSessionStore.getState());
    const before = agents.iterations;
    const unsubscribe = useSessionStore.subscribe(select);
    try {
      for (let tick = 0; tick < 100; tick++) {
        useSessionStore.getState().setAgentStreamState(SERVER_ID, "agent-0", {
          head: [
            {
              kind: "assistant_message",
              id: "message",
              text: `token ${tick}`,
              timestamp: AGENT_TIMESTAMP,
            },
          ],
        });
      }
      expect(useSessionStore.getState().sessions[SERVER_ID]?.agents).toBe(agents);
      expect(agents.iterations - before).toBe(0);
    } finally {
      unsubscribe();
      useSessionStore.getState().clearSession(SERVER_ID);
    }
  });
});
