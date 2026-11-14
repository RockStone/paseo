import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Board, TrackerBoard, TrackerItem } from "../shared/board";
import { notificationText, notifiedBaseline } from "../shared/prompt";
import type { BoardStateStore } from "./board-state";
import {
  documentPath,
  mutateReply,
  OWNER_FILE,
  parse,
  snapshot,
  TrackerStore,
  writeReply,
} from "./tracker/files.mjs";

type Paseo = PluginHandlerContext["paseo"];

export interface WorkspaceProject {
  workspaceId: string;
  projectId: string;
  projectName: string;
  root: string;
}

const WORKSPACE_CACHE_MS = 5_000;

/**
 * The board belongs to the project; notes and the notified agent belong to the workspace.
 * Tracker files are read from the project's root checkout, the same files every workspace of the
 * project shows.
 */
export class BoardService {
  private readonly boards = new TrackerStore();
  /** Badges poll every workspace; skip the git history lookups they do not need. */
  private readonly badgeBoards = new TrackerStore({ timestamps: false });
  private workspaces: { at: number; map: Promise<Map<string, WorkspaceProject>> } | null = null;

  constructor(
    private readonly state: BoardStateStore,
    private readonly now: () => number = Date.now,
  ) {}

  async allWorkspaces(paseo: Paseo): Promise<Map<string, WorkspaceProject>> {
    if (this.workspaces && this.now() - this.workspaces.at < WORKSPACE_CACHE_MS) {
      return this.workspaces.map;
    }
    const map = (async () => {
      const result = new Map<string, WorkspaceProject>();
      let cursor: string | undefined;
      do {
        const page = await paseo.workspaces.list({ page: { limit: 200, cursor } });
        for (const workspace of page.entries) {
          result.set(workspace.id, {
            workspaceId: workspace.id,
            projectId: workspace.projectId,
            projectName: workspace.projectDisplayName,
            root: workspace.projectRootPath,
          });
        }
        cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
      } while (cursor);
      return result;
    })();
    this.workspaces = { at: this.now(), map };
    map.catch(() => {
      this.workspaces = null;
    });
    return map;
  }

  async workspace(paseo: Paseo, workspaceId: string): Promise<WorkspaceProject | null> {
    const cached = (await this.allWorkspaces(paseo)).get(workspaceId);
    if (cached) return cached;
    this.workspaces = null;
    return (await this.allWorkspaces(paseo)).get(workspaceId) ?? null;
  }

  async read(paseo: Paseo, workspaceId: string): Promise<Board> {
    const empty: Board = {
      project: null,
      error: null,
      hasTasks: false,
      hasOwners: false,
      version: "missing",
      tasks: [],
      owners: [],
      summary: null,
      notifiedReplyIds: [],
      newOwnerIds: [],
      newTaskIds: [],
      agent: null,
    };
    const workspace = await this.workspace(paseo, workspaceId);
    if (!workspace) return { ...empty, error: "Workspace not found" };
    const project = { id: workspace.projectId, name: workspace.projectName };
    const agent = await this.notifyTarget(paseo, workspaceId).catch(() => null);
    let board: TrackerBoard;
    try {
      board = await this.boards.read(workspace.root);
    } catch (error) {
      return { ...empty, project, agent, error: errorMessage(error) };
    }
    const state = await this.ensureBaseline(workspace.projectId, board);
    return {
      project,
      error: null,
      hasTasks: board.hasTasks,
      hasOwners: board.hasOwners,
      version: board.version,
      tasks: board.tasks,
      owners: board.owners,
      summary: board.hasTasks || board.hasOwners ? board.summary : null,
      notifiedReplyIds: board.owners
        .flatMap((item) => item.replies.map((reply) => reply.id))
        .filter((id) => state.notified.includes(id)),
      newOwnerIds: newOwnerIds(board, state.seen),
      newTaskIds: changedIds(board.tasks, state.progressSeen),
      addedTaskIds: addedIds(board.tasks, state.progressSeen),
      agent,
    };
  }

  /** Badge counts per workspace: new owner items and added tasks for its project, plus unseen notes. */
  async badgeCounts(paseo: Paseo, unseenNotes: Record<string, number>) {
    const workspaces = await this.allWorkspaces(paseo);
    const perProject = new Map<string, Promise<number>>();
    const counts: Record<string, number> = {};
    await Promise.all(
      [...workspaces.values()].map(async (workspace) => {
        let pending = perProject.get(workspace.projectId);
        if (!pending) {
          pending = this.newItemCount(workspace).catch(() => 0);
          perProject.set(workspace.projectId, pending);
        }
        const total = (await pending) + (unseenNotes[workspace.workspaceId] ?? 0);
        if (total > 0) counts[workspace.workspaceId] = total;
      }),
    );
    this.badgeBoards.prune(new Set([...workspaces.values()].map((workspace) => workspace.root)));
    return counts;
  }

  async markOwnersSeen(paseo: Paseo, workspaceId: string): Promise<number> {
    const workspace = await this.requireWorkspace(paseo, workspaceId);
    const board = await this.boards.read(workspace.root);
    const marked = newOwnerIds(
      board,
      (await this.state.get(workspace.projectId))?.seen ?? {},
    ).length;
    await this.state.update(workspace.projectId, (state) => {
      state.seen = versionMap(board.owners);
    });
    return marked;
  }

  async markProgressSeen(paseo: Paseo, workspaceId: string): Promise<number> {
    const workspace = await this.requireWorkspace(paseo, workspaceId);
    const board = await this.boards.read(workspace.root);
    const marked = changedIds(
      board.tasks,
      (await this.state.get(workspace.projectId))?.progressSeen ?? {},
    ).length;
    await this.state.update(workspace.projectId, (state) => {
      state.progressSeen = versionMap(board.tasks);
    });
    return marked;
  }

  async addReply(
    paseo: Paseo,
    input: { workspaceId: string; version: string; id: string; text: string },
  ) {
    const owner = await this.ownerFile(paseo, input.workspaceId);
    return { version: await writeReply(owner, input.version, input.id, input.text) };
  }

  async editReply(
    paseo: Paseo,
    input: { workspaceId: string; version: string; id: string; replyId: string; text: string },
  ) {
    const owner = await this.ownerFile(paseo, input.workspaceId);
    const mutation = { action: "edit" as const, replyId: input.replyId, text: input.text };
    return { version: await mutateReply(owner, input.version, input.id, mutation) };
  }

  async removeReply(
    paseo: Paseo,
    input: { workspaceId: string; version: string; id: string; replyId: string },
  ) {
    const owner = await this.ownerFile(paseo, input.workspaceId);
    const mutation = { action: "remove" as const, replyId: input.replyId };
    return { version: await mutateReply(owner, input.version, input.id, mutation) };
  }

  async setOwnerDone(
    paseo: Paseo,
    input: { workspaceId: string; version: string; id: string; done: boolean },
  ) {
    const owner = await this.ownerFile(paseo, input.workspaceId);
    const mutation = { action: "status" as const, done: input.done };
    return { version: await mutateReply(owner, input.version, input.id, mutation) };
  }

  async notify(paseo: Paseo, input: { workspaceId: string; version: string; replyIds: string[] }) {
    const workspace = await this.requireWorkspace(paseo, input.workspaceId);
    const owner = await this.ownerFile(paseo, input.workspaceId);
    const current = await snapshot(owner);
    if (current.version !== input.version) {
      throw new Error("Owner file changed; review the latest replies before sending");
    }
    const items = parse(current.bytes.toString(), true).filter(
      (item) => item.warnings.length === 0,
    );
    const known = new Set(items.flatMap((item) => item.replies.map((reply) => reply.id)));
    const replyIds = input.replyIds.filter((id) => known.has(id));
    if (replyIds.length === 0) throw new Error("Those replies are gone; refresh and try again");
    const agent = await this.notifyTarget(paseo, input.workspaceId);
    if (!agent) throw new Error("This workspace has no agent to notify");
    await paseo.agents.ref(agent.id).send(notificationText(items, replyIds));
    await this.state.update(workspace.projectId, (state) => {
      state.notified.push(...replyIds);
    });
    return { agentTitle: agent.title };
  }

  async dismiss(paseo: Paseo, input: { workspaceId: string; replyIds: string[] }) {
    const workspace = await this.requireWorkspace(paseo, input.workspaceId);
    await this.state.update(workspace.projectId, (state) => {
      state.notified.push(...input.replyIds);
    });
    return { dismissed: input.replyIds.length };
  }

  /** The workspace's most recently active top-level agent: the one the owner talks to. */
  async notifyTarget(
    paseo: Paseo,
    workspaceId: string,
  ): Promise<{ id: string; title: string } | null> {
    const agents: { id: string; title: string; updatedAt: string; parent: string | null }[] = [];
    let cursor: string | undefined;
    do {
      const page = await paseo.agents.list({
        filter: { includeArchived: false },
        page: { limit: 200, cursor },
      });
      for (const { agent } of page.entries) {
        if (agent.workspaceId !== workspaceId || agent.archivedAt) continue;
        agents.push({
          id: agent.id,
          title: agent.title ?? "Agent",
          updatedAt: agent.updatedAt,
          parent:
            (agent as { parentAgentId?: string | null }).parentAgentId ??
            agent.labels?.["paseo.parent-agent-id"] ??
            null,
        });
      }
      cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
    } while (cursor);
    const ids = new Set(agents.map((agent) => agent.id));
    const [target] = agents
      .filter((agent) => !agent.parent || !ids.has(agent.parent))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return target ? { id: target.id, title: target.title } : null;
  }

  private async newItemCount(workspace: WorkspaceProject): Promise<number> {
    const board = await this.badgeBoards.read(workspace.root);
    if (!board.hasOwners && !board.hasTasks) return 0;
    const state = await this.ensureBaseline(workspace.projectId, board);
    // Added tasks count; status and wording changes only dot the Progress tab, since agents tick
    // tasks off all day and would keep the badge lit.
    return newOwnerIds(board, state.seen).length + addedIds(board.tasks, state.progressSeen).length;
  }

  private async ensureBaseline(projectId: string, board: TrackerBoard) {
    const existing = await this.state.get(projectId);
    if (existing?.seen && existing.progressSeen) return existing;
    return this.state.update(projectId, (state) => {
      state.seen ??= versionMap(board.owners);
      state.progressSeen ??= versionMap(board.tasks);
      if (!existing) state.notified.push(...notifiedBaseline(board.owners, this.now()));
    });
  }

  private async requireWorkspace(paseo: Paseo, workspaceId: string) {
    const workspace = await this.workspace(paseo, workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    return workspace;
  }

  private async ownerFile(paseo: Paseo, workspaceId: string): Promise<string> {
    const workspace = await this.requireWorkspace(paseo, workspaceId);
    const owner = await documentPath(workspace.root, OWNER_FILE);
    if (!owner) throw new Error(`${OWNER_FILE} is missing in ${workspace.projectName}`);
    return owner;
  }
}

function versionMap(items: TrackerItem[]): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.id, item.contentVersion]));
}

/** Valid items whose content differs from the version last seen, including added ones. */
function changedIds(items: TrackerItem[], seen: Record<string, string> | null): string[] {
  if (!seen) return [];
  return items
    .filter((item) => item.warnings.length === 0 && seen[item.id] !== item.contentVersion)
    .map((item) => item.id);
}

/** Changed ids the owner has no previous version of. */
function addedIds(items: TrackerItem[], seen: Record<string, string> | null): string[] {
  if (!seen) return [];
  return changedIds(items, seen).filter((id) => !(id in seen));
}

function newOwnerIds(board: TrackerBoard, seen: Record<string, string> | null): string[] {
  const done = new Set(board.owners.filter((item) => item.status === "done").map((i) => i.id));
  return changedIds(board.owners, seen).filter((id) => !done.has(id));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
