import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttachmentDirectory } from "../attachments";
import { countUnseen } from "../counts";
import { type AgentInfo, ImageIndex, type TimelinePage } from "../image-index";
import { ImageMedia } from "../media";
import { SeenStore } from "../seen";

let root: string;
let attachmentsDir: string;
let agents: AgentInfo[];
let pages: Map<string, TimelinePage[]>;
let fetches: { agentId: string; cursor: { epoch: string; seq: number } | null }[];
let clock: number;

async function image(name: string, bytes = "png") {
  const file = path.join(root, name);
  await writeFile(file, bytes);
  return file;
}

const assistant = (file: string, timestamp: string, seq: number) => ({
  timestamp,
  seqEnd: seq,
  item: { type: "assistant_message", text: `\n\n![Image](file://${file})\n\n` } as { type: string },
});

function createIndex(extra: Partial<ConstructorParameters<typeof ImageIndex>[1]> = {}) {
  return new ImageIndex(
    {
      listAgents: async () => agents,
      workspaceNames: async () => new Map([["w1", "Workspace one"]]),
      fetchTimeline: async (agentId, cursor) => {
        fetches.push({ agentId, cursor });
        const queue = pages.get(agentId) ?? [];
        return (
          queue.shift() ?? {
            epoch: "e",
            reset: false,
            staleCursor: false,
            endCursor: null,
            entries: [],
          }
        );
      },
    },
    {
      stateFile: path.join(root, "data", "index.json"),
      attachments: new AttachmentDirectory(attachmentsDir, () => clock, 0),
      now: () => clock,
      sleep: async () => undefined,
      ...extra,
    },
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "image-library-"));
  attachmentsDir = path.join(root, "desktop-attachments");
  await mkdir(attachmentsDir);
  agents = [];
  pages = new Map();
  fetches = [];
  clock = Date.parse("2026-11-13T12:00:00.000Z");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ImageIndex", () => {
  it("lists a workspace's owner and agent images newest first, skipping files that are gone", async () => {
    const shot = await image("shot.png");
    const gone = path.join(root, "gone.png");
    const attached = path.join(attachmentsDir, "att_msg_100_abc.png");
    await writeFile(attached, "owner");
    agents = [
      {
        id: "a1",
        title: "Fix the login bug",
        workspaceId: "w1",
        updatedAt: "1",
        loaded: true,
        activityAt: "2026-11-13T11:00:00.000Z",
      },
      {
        id: "a2",
        title: "Elsewhere",
        workspaceId: "w2",
        updatedAt: "1",
        loaded: true,
        activityAt: "2026-11-13T11:00:00.000Z",
      },
    ];
    pages.set("a1", [
      {
        epoch: "e",
        reset: false,
        staleCursor: false,
        endCursor: { epoch: "e", seq: 3 },
        entries: [
          {
            timestamp: "2026-11-13T09:00:00.000Z",
            seqEnd: 1,
            item: {
              type: "user_message",
              text: "see",
              clientMessageId: "msg_100_abc",
              imageSources: ["file:///tmp/old-copy.png"],
            } as { type: string },
          },
          assistant(shot, "2026-11-13T10:00:00.000Z", 2),
          assistant(gone, "2026-11-13T11:00:00.000Z", 3),
        ],
      },
    ]);
    const index = createIndex();
    expect(await index.refresh({ workspaceId: "w1", budgetMs: 1000 })).toBe(false);
    const result = await index.list("w1", {});
    expect(result.images.map((entry) => [entry.source, entry.path])).toEqual([
      ["agent", shot],
      ["you", attached],
    ]);
    expect(result.images[0]).toMatchObject({
      agentId: "a1",
      agentTitle: "Fix the login bug",
      workspaceId: "w1",
      workspaceName: "Workspace one",
      mimeType: "image/png",
    });
    expect(fetches.map((fetch) => fetch.agentId)).toEqual(["a1"]);
  });

  it("filters by source and agent title and pages with a cursor", async () => {
    const files = await Promise.all(["a.png", "b.png", "c.png"].map((name) => image(name)));
    agents = [
      {
        id: "a1",
        title: "Login work",
        workspaceId: "w1",
        updatedAt: "1",
        loaded: true,
        activityAt: "2026-11-13T11:00:00.000Z",
      },
      {
        id: "a2",
        title: "Docs",
        workspaceId: "w1",
        updatedAt: "1",
        loaded: true,
        activityAt: "2026-11-13T11:00:00.000Z",
      },
    ];
    pages.set("a1", [
      {
        epoch: "e",
        reset: false,
        staleCursor: false,
        endCursor: null,
        entries: [
          assistant(files[0], "2026-11-13T01:00:00.000Z", 1),
          assistant(files[1], "2026-11-13T02:00:00.000Z", 2),
        ],
      },
    ]);
    pages.set("a2", [
      {
        epoch: "e",
        reset: false,
        staleCursor: false,
        endCursor: null,
        entries: [assistant(files[2], "2026-11-13T03:00:00.000Z", 1)],
      },
    ]);
    const index = createIndex();
    await index.refresh({ workspaceId: "w1", budgetMs: 1000 });
    const first = await index.list("w1", { limit: 2 });
    expect(first.images.map((entry) => entry.path)).toEqual([files[2], files[1]]);
    expect(first.total).toBe(3);
    const second = await index.list("w1", { limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.images.map((entry) => entry.path)).toEqual([files[0]]);
    expect(second.nextCursor).toBeNull();
    expect((await index.list("w1", { query: "login" })).images).toHaveLength(2);
    expect((await index.list("w1", { filter: "you" })).images).toHaveLength(0);
  });

  it("rescans only changed agents, from the last cursor, and rescans whole after a reset", async () => {
    const one = await image("one.png");
    const two = await image("two.png");
    agents = [
      {
        id: "a1",
        title: "T",
        workspaceId: "w1",
        updatedAt: "1",
        loaded: true,
        activityAt: "2026-11-13T11:00:00.000Z",
      },
    ];
    pages.set("a1", [
      {
        epoch: "e",
        reset: false,
        staleCursor: false,
        endCursor: { epoch: "e", seq: 1 },
        entries: [assistant(one, "2026-11-13T01:00:00.000Z", 1)],
      },
    ]);
    const index = createIndex();
    await index.refresh({ budgetMs: 1000 });
    await index.refresh({ budgetMs: 1000 });
    expect(fetches).toHaveLength(1);

    clock += 10_000;
    agents = [
      {
        id: "a1",
        title: "T",
        workspaceId: "w1",
        updatedAt: "2",
        loaded: true,
        activityAt: "2026-11-13T11:00:00.000Z",
      },
    ];
    pages.set("a1", [
      {
        epoch: "e",
        reset: false,
        staleCursor: false,
        endCursor: { epoch: "e", seq: 2 },
        entries: [assistant(two, "2026-11-13T02:00:00.000Z", 2)],
      },
    ]);
    await index.refresh({ budgetMs: 1000 });
    expect(fetches[1].cursor).toEqual({ epoch: "e", seq: 1 });
    expect((await index.list("w1", {})).total).toBe(2);

    clock += 10_000;
    agents = [
      {
        id: "a1",
        title: "T",
        workspaceId: "w1",
        updatedAt: "3",
        loaded: true,
        activityAt: "2026-11-13T11:00:00.000Z",
      },
    ];
    pages.set("a1", [
      { epoch: "f", reset: true, staleCursor: false, endCursor: null, entries: [] },
      {
        epoch: "f",
        reset: false,
        staleCursor: false,
        endCursor: { epoch: "f", seq: 1 },
        entries: [assistant(two, "2026-11-13T02:00:00.000Z", 1)],
      },
    ]);
    await index.refresh({ budgetMs: 1000 });
    expect(fetches[3].cursor).toBeNull();
    expect((await index.list("w1", {})).total).toBe(1);
  });

  it("persists the index so a restart does not rescan", async () => {
    const one = await image("one.png");
    agents = [
      {
        id: "a1",
        title: "T",
        workspaceId: "w1",
        updatedAt: "1",
        loaded: true,
        activityAt: "2026-11-13T11:00:00.000Z",
      },
    ];
    pages.set("a1", [
      {
        epoch: "e",
        reset: false,
        staleCursor: false,
        endCursor: { epoch: "e", seq: 1 },
        entries: [assistant(one, "2026-11-13T01:00:00.000Z", 1)],
      },
    ]);
    await createIndex().refresh({ budgetMs: 1000 });
    const restarted = createIndex();
    await restarted.refresh({ budgetMs: 1000 });
    expect(fetches).toHaveLength(1);
    expect((await restarted.list("w1", {})).total).toBe(1);
  });

  it("serves only files the index knows by id", async () => {
    const one = await image("one.png");
    agents = [
      {
        id: "a1",
        title: "T",
        workspaceId: "w1",
        updatedAt: "1",
        loaded: true,
        activityAt: "2026-11-13T11:00:00.000Z",
      },
    ];
    pages.set("a1", [
      {
        epoch: "e",
        reset: false,
        staleCursor: false,
        endCursor: null,
        entries: [assistant(one, "2026-11-13T01:00:00.000Z", 1)],
      },
    ]);
    const index = createIndex();
    await index.refresh({ budgetMs: 1000 });
    const [entry] = (await index.list("w1", {})).images;
    expect(await index.resolve(entry.id)).toBe(one);
    expect(await index.resolve("../../etc/passwd")).toBeNull();
  });
});

describe("countUnseen", () => {
  it("counts images newer than the drawer's last opening and starts new workspaces at zero", async () => {
    const old = await image("old.png");
    const fresh = await image("fresh.png");
    agents = [
      {
        id: "a1",
        title: "T",
        workspaceId: "w1",
        updatedAt: "1",
        loaded: true,
        activityAt: "2026-11-13T11:00:00.000Z",
      },
    ];
    pages.set("a1", [
      {
        epoch: "e",
        reset: false,
        staleCursor: false,
        endCursor: null,
        entries: [
          assistant(old, "2026-11-13T08:00:00.000Z", 1),
          assistant(fresh, "2026-11-13T11:00:00.000Z", 2),
        ],
      },
    ]);
    const index = createIndex();
    await index.refresh({ budgetMs: 1000 });
    const seen = new SeenStore(path.join(root, "data", "seen.json"), () => new Date(clock));
    expect(await countUnseen(index, seen)).toEqual({});
    clock = Date.parse("2026-11-13T09:00:00.000Z");
    await seen.markSeen("w1");
    expect(await countUnseen(index, seen)).toEqual({ w1: 1 });
    clock = Date.parse("2026-11-13T14:00:00.000Z");
    await seen.markSeen("w1");
    expect(await countUnseen(index, seen)).toEqual({});
  });
});

describe("ImageMedia", () => {
  it("sends small files as they are and shrinks large ones through the resizer", async () => {
    const small = await image("small.png", "tiny");
    const large = await image("large.png", "x".repeat(400 * 1024));
    const media = new ImageMedia(path.join(root, "thumbs"), async (_input, output) => {
      await writeFile(output, "jpeg");
      return true;
    });
    expect(await media.bytes(small, "thumb")).toMatchObject({
      mimeType: "image/jpeg",
      data: Buffer.from("jpeg").toString("base64"),
    });
    expect(await media.bytes(small, "full")).toEqual({
      mimeType: "image/png",
      data: Buffer.from("tiny").toString("base64"),
    });
    expect((await media.bytes(large, "thumb")).data).toBe(Buffer.from("jpeg").toString("base64"));
  });

  it("falls back to the original, reports too-large, and reports missing files", async () => {
    const large = await image("large.png", "x".repeat(400 * 1024));
    const media = new ImageMedia(path.join(root, "thumbs"), async () => false);
    expect(await media.bytes(large, "thumb")).toEqual({
      mimeType: "image/png",
      data: null,
      reason: "too-large",
    });
    expect((await media.bytes(large, "full")).data).not.toBeNull();
    expect(await media.bytes(path.join(root, "missing.png"), "thumb")).toMatchObject({
      data: null,
      reason: "missing",
    });
  });

  describe("indexing policy", () => {
    const day = 24 * 60 * 60 * 1000;
    const stored = (id: string, ageDays: number, extra: Partial<AgentInfo> = {}): AgentInfo => ({
      id,
      title: id,
      workspaceId: "w1",
      updatedAt: `u-${id}`,
      loaded: false,
      activityAt: new Date(clock - ageDays * day).toISOString(),
      ...extra,
    });

    const fetched = () => fetches.map((fetch) => fetch.agentId).sort();
    const oldAgents = (count: number, ageDays: number) =>
      Array.from({ length: count }, (_, n) => stored(`old${n}`, ageDays + n));

    it("indexes loaded and recently active agents on its own, never old stored ones", async () => {
      agents = [
        stored("loaded-old", 90, { loaded: true }),
        stored("recent", 2),
        stored("old", 4),
        stored("ancient", 90),
      ];
      const index = createIndex();
      expect(await index.refresh({ workspaceId: "w1", budgetMs: 1000 })).toBe(false);
      expect(fetched()).toEqual(["loaded-old", "recent"]);
      expect((await index.olderStatus("w1")).pending).toBe(2);
    });

    it("scans at most one batch per press, one agent at a time, and counts what remains", async () => {
      agents = oldAgents(5, 30);
      const index = createIndex({ scanLimit: 3 });
      await index.refresh({ workspaceId: "w1", budgetMs: 1000 });
      expect(fetches).toEqual([]);
      expect(await index.startOlderScan("w1")).toBe(true);
      await index.idle();
      expect(fetches).toHaveLength(3);
      expect(await index.olderStatus("w1")).toEqual({
        pending: 2,
        running: false,
        done: 3,
        total: 3,
      });
      expect(await index.startOlderScan("w1")).toBe(true);
      await index.idle();
      expect(fetches).toHaveLength(5);
      expect((await index.olderStatus("w1")).pending).toBe(0);
      expect(await index.startOlderScan("w1")).toBe(false);
    });

    it("stops a running scan between agents", async () => {
      agents = oldAgents(5, 30);
      let index: ImageIndex;
      index = createIndex({
        sleep: async () => {
          index.stopOlderScan();
        },
      });
      await index.startOlderScan("w1");
      await index.idle();
      expect(fetches).toHaveLength(1);
      expect((await index.olderStatus("w1")).pending).toBe(4);
    });

    it("never reads an unchanged agent again, scanned or not, even across a restart", async () => {
      agents = [stored("old", 30), stored("recent", 1)];
      const first = createIndex();
      await first.refresh({ budgetMs: 1000 });
      await first.startOlderScan("w1");
      await first.idle();
      expect(fetched()).toEqual(["old", "recent"]);
      fetches = [];
      const restarted = createIndex();
      await restarted.refresh({ budgetMs: 1000 });
      await restarted.startOlderScan("w1");
      await restarted.idle();
      expect(fetches).toEqual([]);
      expect((await restarted.olderStatus("w1")).pending).toBe(0);
    });

    it("fetches only new rows for a changed agent after it was scanned", async () => {
      agents = [stored("old", 30)];
      pages.set("old", [
        {
          epoch: "e",
          reset: false,
          staleCursor: false,
          endCursor: { epoch: "e", seq: 4 },
          entries: [],
        },
      ]);
      const index = createIndex();
      await index.startOlderScan("w1");
      await index.idle();
      agents = [stored("old", 0, { updatedAt: "changed" })];
      clock += 10_000;
      await index.refresh({ budgetMs: 1000, workspaceId: "w1" });
      expect(fetches.at(-1)).toEqual({ agentId: "old", cursor: { epoch: "e", seq: 4 } });
    });
  });
});
