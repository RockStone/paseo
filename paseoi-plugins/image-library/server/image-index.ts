import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, type ImageEntry, type ImageFilter } from "../shared/images";
import { AttachmentDirectory } from "./attachments";
import {
  type ImageRef,
  imageRefsFromEntries,
  mimeTypeForPath,
  type TimelineEntryLike,
} from "./parse";

export interface AgentInfo {
  id: string;
  title: string;
  workspaceId: string;
  updatedAt: string;
  /** Resident in the daemon right now; reading a stored agent's timeline would resume it. */
  loaded: boolean;
  /** The latest of `updatedAt` and `lastUserMessageAt`. */
  activityAt: string;
}

export interface OlderScanStatus {
  /** Older agents of the workspace that were never indexed or changed since. */
  pending: number;
  running: boolean;
  /** Agents handled by the current or last press. */
  done: number;
  /** Agents this press covers. */
  total: number;
}

export interface TimelinePage {
  epoch: string;
  /** The window restarted; earlier cursors no longer apply. */
  reset: boolean;
  staleCursor: boolean;
  endCursor: { epoch: string; seq: number } | null;
  entries: TimelineEntryLike[];
}

export interface IndexDeps {
  listAgents(): Promise<AgentInfo[]>;
  workspaceNames(): Promise<Map<string, string>>;
  /** With a cursor: entries after it. Without: the whole timeline. */
  fetchTimeline(
    agentId: string,
    cursor: { epoch: string; seq: number } | null,
  ): Promise<TimelinePage>;
}

export interface IndexOptions {
  stateFile: string;
  attachments: AttachmentDirectory;
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
  concurrency?: number;
  /** Stored agents idle for longer than this are indexed only by an explicit scan. */
  recentWindowMs?: number;
  /** Agents one press of the older scan covers. */
  scanLimit?: number;
  scanPauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const SCAN_LIMIT = 20;
const SCAN_PAUSE_MS = 400;

const storedRefSchema = z.object({
  path: z.string(),
  source: z.enum(["you", "agent"]),
  timestamp: z.string(),
  clientMessageId: z.string().optional(),
});
const stateSchema = z.object({
  version: z.literal(1),
  agents: z.record(
    z.string(),
    z.object({
      updatedAt: z.string(),
      cursor: z.object({ epoch: z.string(), seq: z.number() }).nullable(),
      refs: z.array(storedRefSchema),
    }),
  ),
});
type State = z.infer<typeof stateSchema>;

const AGENT_CACHE_MS = 5_000;
const STAT_CACHE_MS = 10_000;

export function imageId(file: string): string {
  return createHash("sha1").update(file).digest("hex").slice(0, 16);
}

/**
 * Lazily indexes the images in agent timelines. An agent is rescanned only when its `updatedAt`
 * changed, and then only from the last seen timeline position; a window reset rescans it whole.
 * Results persist in the plugin's data directory, so a restart rescans nothing that was settled.
 */
export class ImageIndex {
  private state: State | null = null;
  private agents: { at: number; list: AgentInfo[] } | null = null;
  private readonly stats = new Map<string, { at: number; size: number | null }>();
  private readonly byId = new Map<string, string>();
  private saveTimer: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private job: { workspaceId: string; done: number; total: number; stop: boolean } | null = null;
  private lastJob: { workspaceId: string; done: number; total: number } | null = null;

  constructor(
    private readonly deps: IndexDeps,
    private readonly options: IndexOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  private async loadState(): Promise<State> {
    if (this.state) return this.state;
    try {
      const parsed = stateSchema.safeParse(
        JSON.parse(await readFile(this.options.stateFile, "utf8")),
      );
      this.state = parsed.success ? parsed.data : { version: 1, agents: {} };
    } catch {
      this.state = { version: 1, agents: {} };
    }
    return this.state;
  }

  private async save(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const write = async () => {
      await this.saveTimer;
      try {
        await mkdir(path.dirname(this.options.stateFile), { recursive: true });
        const temporary = `${this.options.stateFile}.tmp`;
        await writeFile(temporary, JSON.stringify(state));
        await rename(temporary, this.options.stateFile);
      } catch (error) {
        this.options.log?.("Saving the image index failed", error);
      }
    };
    this.saveTimer = write();
    await this.saveTimer;
  }

  /**
   * Whether the index may read this agent on its own. Loaded agents and recently active ones
   * are cheap; reading any other stored agent resumes its runtime.
   */
  private automatic(agent: AgentInfo): boolean {
    if (agent.loaded) return true;
    const at = Date.parse(agent.activityAt);
    return (
      Number.isFinite(at) && this.now() - at <= (this.options.recentWindowMs ?? RECENT_WINDOW_MS)
    );
  }

  private changed(state: State, agent: AgentInfo): boolean {
    return state.agents[agent.id]?.updatedAt !== agent.updatedAt;
  }

  private async agentList(): Promise<AgentInfo[]> {
    if (!this.agents || this.now() - this.agents.at > AGENT_CACHE_MS) {
      this.agents = { at: this.now(), list: await this.deps.listAgents() };
    }
    return this.agents.list;
  }

  /**
   * Brings the index up to date for the agents of one workspace (or all), within a time budget.
   * Returns true while stale agents remain, so the caller can ask again.
   */
  async refresh(input: { workspaceId?: string; budgetMs: number }): Promise<boolean> {
    const state = await this.loadState();
    const agents = await this.agentList();
    const live = new Set(agents.map((agent) => agent.id));
    let dirty = false;
    for (const id of Object.keys(state.agents)) {
      if (!live.has(id)) {
        delete state.agents[id];
        dirty = true;
      }
    }
    const stale = agents.filter(
      (agent) =>
        (!input.workspaceId || agent.workspaceId === input.workspaceId) &&
        this.automatic(agent) &&
        this.changed(state, agent),
    );
    const deadline = this.now() + input.budgetMs;
    const queue = [...stale];
    const attachmentsFor = await this.options.attachments.load();
    const worker = async () => {
      for (let agent = queue.shift(); agent; agent = queue.shift()) {
        if (this.now() > deadline) {
          queue.unshift(agent);
          return;
        }
        try {
          await this.scan(state, agent, attachmentsFor);
          dirty = true;
        } catch (error) {
          this.options.log?.(`Indexing agent ${agent.id} failed`, error);
          // Skip it until it changes again instead of retrying every call.
          state.agents[agent.id] ??= { updatedAt: agent.updatedAt, cursor: null, refs: [] };
        }
      }
    };
    await Promise.all(Array.from({ length: this.options.concurrency ?? 3 }, worker));
    if (dirty) await this.save();
    return queue.length > 0;
  }

  /** Older agents of a workspace the owner has not scanned yet. */
  private olderPending(state: State, agents: AgentInfo[], workspaceId: string): AgentInfo[] {
    return agents.filter(
      (agent) =>
        agent.workspaceId === workspaceId && !this.automatic(agent) && this.changed(state, agent),
    );
  }

  async olderStatus(workspaceId: string): Promise<OlderScanStatus> {
    const state = await this.loadState();
    const pending = this.olderPending(state, await this.agentList(), workspaceId).length;
    const job = this.job?.workspaceId === workspaceId ? this.job : null;
    const last = this.lastJob?.workspaceId === workspaceId ? this.lastJob : null;
    const shown = job ?? last;
    return {
      pending,
      running: !!job,
      done: shown?.done ?? 0,
      total: shown?.total ?? 0,
    };
  }

  /** Starts one press of the older scan; resolves once the job is running, not finished. */
  async startOlderScan(workspaceId: string): Promise<boolean> {
    if (this.job) return false;
    const state = await this.loadState();
    const queue = this.olderPending(state, await this.agentList(), workspaceId).slice(
      0,
      this.options.scanLimit ?? SCAN_LIMIT,
    );
    if (queue.length === 0) return false;
    const job = { workspaceId, done: 0, total: queue.length, stop: false };
    this.job = job;
    void this.runOlderScan(state, queue, job);
    return true;
  }

  stopOlderScan(): void {
    if (this.job) this.job.stop = true;
  }

  /** Resolves when the running scan has ended. */
  async idle(): Promise<void> {
    while (this.job) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  private async runOlderScan(
    state: State,
    queue: AgentInfo[],
    job: { workspaceId: string; done: number; total: number; stop: boolean },
  ): Promise<void> {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    try {
      const attachmentsFor = await this.options.attachments.load();
      for (const agent of queue) {
        if (job.stop) break;
        try {
          await this.scan(state, agent, attachmentsFor);
        } catch (error) {
          this.options.log?.(`Indexing agent ${agent.id} failed`, error);
          state.agents[agent.id] ??= { updatedAt: agent.updatedAt, cursor: null, refs: [] };
        }
        job.done += 1;
        if (job.done < queue.length && !job.stop)
          await sleep(this.options.scanPauseMs ?? SCAN_PAUSE_MS);
      }
    } finally {
      this.lastJob = { workspaceId: job.workspaceId, done: job.done, total: job.total };
      this.job = null;
      await this.save();
    }
  }

  private async scan(
    state: State,
    agent: AgentInfo,
    attachmentsFor: (clientMessageId: string) => readonly string[],
  ): Promise<void> {
    const previous = state.agents[agent.id];
    let page = await this.deps.fetchTimeline(agent.id, previous?.cursor ?? null);
    let base = previous?.refs ?? [];
    if (
      previous?.cursor &&
      (page.reset || page.staleCursor || page.epoch !== previous.cursor.epoch)
    ) {
      page = await this.deps.fetchTimeline(agent.id, null);
      base = [];
    }
    const fresh = imageRefsFromEntries(page.entries, attachmentsFor);
    const seen = new Set(base.map((ref) => `${ref.path}\0${ref.timestamp}`));
    const refs = [...base];
    for (const ref of fresh) {
      const key = `${ref.path}\0${ref.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
    const last = page.entries.at(-1);
    state.agents[agent.id] = {
      updatedAt: agent.updatedAt,
      cursor:
        page.endCursor ??
        (last && previous?.cursor
          ? { epoch: page.epoch, seq: last.seqEnd }
          : (previous?.cursor ?? null)),
      refs,
    };
  }

  private async size(file: string): Promise<number | null> {
    const cached = this.stats.get(file);
    if (cached && this.now() - cached.at < STAT_CACHE_MS) return cached.size;
    let size: number | null = null;
    try {
      const info = await stat(file);
      if (info.isFile()) size = info.size;
    } catch {
      /* Temporary copies disappear. */
    }
    this.stats.set(file, { at: this.now(), size });
    return size;
  }

  /** Every image of a workspace that still exists on disk, newest first, one per file. */
  async entries(workspaceId: string): Promise<ImageEntry[]> {
    const state = await this.loadState();
    const agents = (await this.agentList()).filter((agent) => agent.workspaceId === workspaceId);
    const names = await this.deps.workspaceNames();
    const workspaceName = names.get(workspaceId) ?? workspaceId;
    const byPath = new Map<string, { agent: AgentInfo; ref: ImageRef }>();
    for (const agent of agents) {
      for (const ref of state.agents[agent.id]?.refs ?? []) {
        const existing = byPath.get(ref.path);
        // The earliest reference owns a file that several messages mention.
        if (!existing || ref.timestamp < existing.ref.timestamp)
          byPath.set(ref.path, { agent, ref });
      }
    }
    const entries: ImageEntry[] = [];
    await Promise.all(
      [...byPath].map(async ([file, { agent, ref }]) => {
        const size = await this.size(file);
        const mimeType = mimeTypeForPath(file);
        if (size === null || !mimeType) return;
        const id = imageId(file);
        this.byId.set(id, file);
        entries.push({
          id,
          source: ref.source,
          agentId: agent.id,
          agentTitle: agent.title,
          workspaceId,
          workspaceName,
          timestamp: ref.timestamp,
          mimeType,
          fileName: path.basename(file),
          path: file,
          byteSize: size,
        });
      }),
    );
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
    return entries;
  }

  async list(
    workspaceId: string,
    options: { filter?: ImageFilter; query?: string; cursor?: string; limit?: number },
  ): Promise<{ images: ImageEntry[]; nextCursor: string | null; total: number }> {
    const filter = options.filter ?? "all";
    const query = options.query?.trim().toLowerCase();
    const matching = (await this.entries(workspaceId)).filter(
      (entry) =>
        (filter === "all" || entry.source === filter) &&
        (!query || entry.agentTitle.toLowerCase().includes(query)),
    );
    let start = 0;
    if (options.cursor) {
      const index = matching.findIndex((entry) => cursorOf(entry) === options.cursor);
      // A cursor whose image vanished resumes at the first older timestamp.
      start =
        index >= 0 ? index + 1 : matching.findIndex((entry) => cursorOf(entry) < options.cursor!);
      if (start < 0) start = matching.length;
    }
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const images = matching.slice(start, start + limit);
    const more = start + limit < matching.length;
    return {
      images,
      nextCursor: more && images.length ? cursorOf(images[images.length - 1]) : null,
      total: matching.length,
    };
  }

  /** The file behind an id the index has listed; nothing else is ever readable. */
  async resolve(id: string): Promise<string | null> {
    const known = this.byId.get(id);
    if (known) return known;
    const state = await this.loadState();
    for (const agent of Object.values(state.agents)) {
      for (const ref of agent.refs) {
        if (imageId(ref.path) === id) {
          this.byId.set(id, ref.path);
          return ref.path;
        }
      }
    }
    return null;
  }

  /** Timestamps of each workspace's images, for unseen counts. */
  async timestampsByWorkspace(): Promise<Map<string, string[]>> {
    const state = await this.loadState();
    const result = new Map<string, string[]>();
    for (const agent of await this.agentList()) {
      const list = result.get(agent.workspaceId) ?? [];
      for (const ref of state.agents[agent.id]?.refs ?? []) list.push(ref.timestamp);
      result.set(agent.workspaceId, list);
    }
    return result;
  }
}

function cursorOf(entry: ImageEntry): string {
  return `${entry.timestamp}|${entry.id}`;
}
