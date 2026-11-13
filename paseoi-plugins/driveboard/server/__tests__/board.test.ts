import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardService } from "../board";
import { BoardStateStore } from "../board-state";
import { migrateLegacyData } from "../migrate";

type Paseo = PluginHandlerContext["paseo"];

let directory: string;
let root: string;
let sent: { agentId: string; text: string }[];

const OWNER = `# Owner to-do

- [ ] **OT-1 Pick a name.** Choose one. <!-- priority:3 -->
- [~] **OT-2 Check the phone.** **You: reply when done.** <!-- priority:2 -->
- [x] **OT-3 Done thing.** Finished. <!-- priority:1 -->
`;

const TASKS = `# Drive

- [x] Z-1 Ship the parser. <!-- priority:3 -->
- [~] Z-2 Build the drawer. <!-- priority:2 -->
- [ ] Z-3 Write docs. <!-- priority:1 -->
`;

function fakePaseo(agents: { id: string; title: string; updatedAt: string; parent?: string }[]) {
  const paseo = {
    workspaces: {
      list: async () => ({
        entries: [
          {
            id: "ws-1",
            projectId: "prj-1",
            projectDisplayName: "Demo",
            projectRootPath: root,
          },
        ],
        pageInfo: { hasMore: false },
      }),
    },
    agents: {
      list: async () => ({
        entries: agents.map((agent) => ({
          agent: {
            id: agent.id,
            title: agent.title,
            updatedAt: agent.updatedAt,
            workspaceId: "ws-1",
            archivedAt: null,
            parentAgentId: agent.parent ?? null,
            labels: {},
          },
        })),
        pageInfo: { hasMore: false },
      }),
      ref: (agentId: string) => ({
        send: async (text: string) => {
          sent.push({ agentId, text });
        },
      }),
    },
  };
  return paseo as unknown as Paseo;
}

const AGENTS = [
  { id: "parent", title: "Lead", updatedAt: "2026-11-10T10:00:00Z" },
  { id: "child", title: "Helper", updatedAt: "2026-11-10T12:00:00Z", parent: "parent" },
];

function service() {
  return new BoardService(new BoardStateStore(path.join(directory, "data", "board.json")));
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "driveboard-"));
  root = path.join(directory, "project");
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "owner-todo.md"), OWNER);
  await writeFile(path.join(root, "docs", "drive.md"), TASKS);
  sent = [];
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("BoardService", () => {
  it("reads the project's owner to-dos, tasks and the workspace's top-level agent", async () => {
    const board = await service().read(fakePaseo(AGENTS), "ws-1");
    expect(board.error).toBeNull();
    expect(board.project).toEqual({ id: "prj-1", name: "Demo" });
    expect(board.owners.map((item) => item.id)).toEqual(["OT-1", "OT-2", "OT-3"]);
    expect(board.summary).toMatchObject({ total: 3, done: 1, inProgress: 1, waiting: 2 });
    // A helper agent is newer, but replies go to the agent the owner talks to.
    expect(board.agent).toEqual({ id: "parent", title: "Lead" });
  });

  it("treats everything as seen on first sight, then flags changed and added items", async () => {
    const paseo = fakePaseo(AGENTS);
    const boards = service();
    expect((await boards.read(paseo, "ws-1")).newOwnerIds).toEqual([]);
    await writeFile(
      path.join(root, "docs", "owner-todo.md"),
      `${OWNER.replace("Choose one.", "Choose one today.")}- [ ] **OT-4 New ask.** Now. <!-- priority:3 -->\n`,
    );
    expect((await boards.read(paseo, "ws-1")).newOwnerIds).toEqual(["OT-1", "OT-4"]);
    expect(await boards.badgeCounts(paseo, { "ws-1": 2 })).toEqual({ "ws-1": 4 });
    expect(await boards.markOwnersSeen(paseo, "ws-1")).toBe(2);
    expect((await boards.read(paseo, "ws-1")).newOwnerIds).toEqual([]);
    expect(await boards.badgeCounts(paseo, {})).toEqual({});
  });

  it("flags changed and added tasks until the Progress tab is seen", async () => {
    const paseo = fakePaseo(AGENTS);
    const boards = service();
    expect((await boards.read(paseo, "ws-1")).newTaskIds).toEqual([]);
    await writeFile(
      path.join(root, "docs", "drive.md"),
      `${TASKS.replace("[~] Z-2", "[x] Z-2")}- [ ] Z-4 Add dots. <!-- priority:2 -->\n`,
    );
    const changed = await boards.read(paseo, "ws-1");
    expect(changed.newTaskIds).toEqual(["Z-2", "Z-4"]);
    expect(changed.addedTaskIds).toEqual(["Z-4"]);
    // Only the added task counts toward the header badge; the status change does not.
    expect(await boards.badgeCounts(paseo, {})).toEqual({ "ws-1": 1 });
    expect(await boards.markProgressSeen(paseo, "ws-1")).toBe(2);
    expect((await boards.read(paseo, "ws-1")).newTaskIds).toEqual([]);
    expect(await boards.badgeCounts(paseo, {})).toEqual({});
  });

  it("writes a reply and sends only the new replies to the agent", async () => {
    const paseo = fakePaseo(AGENTS);
    const boards = service();
    const before = await boards.read(paseo, "ws-1");
    await boards.addReply(paseo, {
      workspaceId: "ws-1",
      version: before.version,
      id: "OT-1",
      text: "Call it Drive",
    });
    const after = await boards.read(paseo, "ws-1");
    const reply = after.owners[0]?.replies[0];
    expect(reply?.text).toBe("Call it Drive");
    expect(after.notifiedReplyIds).toEqual([]);

    const result = await boards.notify(paseo, {
      workspaceId: "ws-1",
      version: after.version,
      replyIds: [reply?.id ?? ""],
    });
    expect(result).toEqual({ agentTitle: "Lead" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.agentId).toBe("parent");
    expect(sent[0]?.text).toContain("OT-1 — Pick a name.");
    expect(sent[0]?.text).toContain("> Call it Drive");
    expect((await boards.read(paseo, "ws-1")).notifiedReplyIds).toEqual([reply?.id]);
  });

  it("edits and removes only the chosen reply", async () => {
    const paseo = fakePaseo(AGENTS);
    const boards = service();
    let { version } = await boards.read(paseo, "ws-1");
    for (const text of ["First", "Second\nwith a second line"]) {
      ({ version } = await boards.addReply(paseo, {
        workspaceId: "ws-1",
        version,
        id: "OT-2",
        text,
      }));
    }
    let owner = (await boards.read(paseo, "ws-1")).owners[1];
    expect(owner?.replies.map((reply) => reply.text)).toEqual([
      "First",
      "Second\nwith a second line",
    ]);
    const [first, second] = owner?.replies ?? [];
    ({ version } = await boards.editReply(paseo, {
      workspaceId: "ws-1",
      version,
      id: "OT-2",
      replyId: second?.id ?? "",
      text: "Second, edited",
    }));
    await boards.removeReply(paseo, {
      workspaceId: "ws-1",
      version,
      id: "OT-2",
      replyId: first?.id ?? "",
    });
    owner = (await boards.read(paseo, "ws-1")).owners[1];
    expect(owner?.replies.map((reply) => reply.text)).toEqual(["Second, edited"]);
    const file = await readFile(path.join(root, "docs", "owner-todo.md"), "utf8");
    expect(file).toContain("**OT-1 Pick a name.**");
    expect(file.match(/> Owner reply/g)).toHaveLength(1);
  });

  it("refuses a stale reply", async () => {
    const paseo = fakePaseo(AGENTS);
    await expect(
      service().addReply(paseo, { workspaceId: "ws-1", version: "stale", id: "OT-1", text: "x" }),
    ).rejects.toThrow(/File changed/);
  });

  it("shows a project without tracker files as empty, not as an error", async () => {
    await rm(path.join(root, "docs"), { recursive: true });
    const board = await service().read(fakePaseo([]), "ws-1");
    expect(board).toMatchObject({ error: null, hasOwners: false, hasTasks: false, agent: null });
    expect(board.summary).toBeNull();
  });
});

describe("migrateLegacyData", () => {
  it("copies sticky notes and the old board's sent replies once", async () => {
    const home = path.join(directory, "home");
    await mkdir(path.join(home, "plugin-data", "sticky-notes"), { recursive: true });
    await mkdir(path.join(home, "plugin-settings", "paseo-drive"), { recursive: true });
    await writeFile(path.join(home, "plugin-data", "sticky-notes", "notes.json"), '{"version":1}');
    await writeFile(
      path.join(home, "plugin-settings", "paseo-drive", "drive-notified.json"),
      JSON.stringify({ version: 1, values: { projects: { "prj-1": ["reply-a-0"] } } }),
    );
    const target = path.join(home, "plugin-data", "driveboard");
    await migrateLegacyData(home, target);
    expect(await readFile(path.join(target, "notes.json"), "utf8")).toBe('{"version":1}');
    const state = new BoardStateStore(path.join(target, "board.json"));
    expect(await state.get("prj-1")).toEqual({
      notified: ["reply-a-0"],
      seen: null,
      progressSeen: null,
    });

    // A second start keeps what the new plugin wrote since.
    await writeFile(path.join(target, "notes.json"), '{"version":2}');
    await migrateLegacyData(home, target);
    expect(await readFile(path.join(target, "notes.json"), "utf8")).toBe('{"version":2}');
  });
});
