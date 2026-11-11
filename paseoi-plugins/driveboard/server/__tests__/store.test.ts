import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_NOTES_PER_WORKSPACE, NoteStore, resolveNotesFile } from "../store";

let directory: string;
let file: string;
let clock: number;
let ids: number;

function createStore(log: (message: string) => void = () => {}) {
  return new NoteStore(file, {
    now: () => new Date(clock),
    createId: () => `note-${++ids}`,
    log,
  });
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "sticky-notes-"));
  file = path.join(directory, "nested", "notes.json");
  clock = Date.parse("2026-11-10T12:00:00.000Z");
  ids = 0;
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("resolveNotesFile", () => {
  it("uses PASEO_HOME", () => {
    expect(resolveNotesFile({ PASEO_HOME: "/srv/paseo" })).toBe(
      "/srv/paseo/plugin-data/driveboard/notes.json",
    );
  });

  it("defaults to ~/.paseo like the daemon", () => {
    expect(resolveNotesFile({})).toBe(
      path.join(os.homedir(), ".paseo", "plugin-data", "driveboard", "notes.json"),
    );
    expect(resolveNotesFile({ PASEO_HOME: "~/alt" })).toBe(
      path.join(os.homedir(), "alt", "plugin-data", "driveboard", "notes.json"),
    );
  });
});

describe("NoteStore", () => {
  it("starts empty when the file does not exist", async () => {
    const store = createStore();
    expect(await store.list("ws-1")).toEqual([]);
    expect(await store.summary()).toEqual({ workspaces: {} });
  });

  it("adds notes per workspace, newest first, and persists them", async () => {
    const store = createStore();
    await store.add("ws-1", { text: "first" }, { kind: "user" });
    clock += 1000;
    await store.add(
      "ws-1",
      { text: "PR ready", url: "https://example.com/pr/1", title: "Review" },
      { kind: "agent", agentId: "agent-1", agentTitle: "Fix login" },
    );
    await store.add("ws-2", { text: "other workspace" }, { kind: "user" });

    const notes = await store.list("ws-1");
    expect(notes.map((note) => note.text)).toEqual(["PR ready", "first"]);
    expect(notes[0]).toMatchObject({
      id: "note-2",
      url: "https://example.com/pr/1",
      title: "Review",
      author: { kind: "agent", agentId: "agent-1", agentTitle: "Fix login" },
      createdAt: "2026-11-10T12:00:01.000Z",
      seenAt: null,
    });
    expect(notes[1].seenAt).toBe(notes[1].createdAt);

    const reopened = createStore();
    expect((await reopened.list("ws-1")).map((note) => note.id)).toEqual(["note-2", "note-1"]);
    expect((await reopened.list("ws-2")).map((note) => note.text)).toEqual(["other workspace"]);
  });

  it("counts unseen agent notes and marks them seen", async () => {
    const store = createStore();
    await store.add("ws-1", { text: "mine" }, { kind: "user" });
    await store.add("ws-1", { text: "a" }, { kind: "agent", agentId: "agent-1" });
    await store.add("ws-1", { text: "b" }, { kind: "agent", agentId: "agent-2" });
    expect(await store.summary()).toEqual({ workspaces: { "ws-1": { total: 3, unseen: 2 } } });

    expect(await store.markSeen("ws-1")).toBe(2);
    expect(await store.markSeen("ws-1")).toBe(0);
    expect(await store.summary()).toEqual({ workspaces: { "ws-1": { total: 3, unseen: 0 } } });
    expect(await store.markSeen("ws-unknown")).toBe(0);
    expect(await store.summary()).toEqual({ workspaces: { "ws-1": { total: 3, unseen: 0 } } });
  });

  it("deletes notes and drops empty workspaces", async () => {
    const store = createStore();
    const note = await store.add("ws-1", { text: "gone soon" }, { kind: "user" });
    expect(await store.delete("ws-1", "missing")).toBe(false);
    expect(await store.delete("ws-1", note.id)).toBe(true);
    expect(await store.list("ws-1")).toEqual([]);
    expect(await store.summary()).toEqual({ workspaces: {} });
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved).toEqual({ version: 1, workspaces: {} });
  });

  it("serializes concurrent writes without losing notes", async () => {
    const store = createStore();
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.add("ws-1", { text: `note ${index}` }, { kind: "agent", agentId: "agent-1" }),
      ),
    );
    expect(await createStore().list("ws-1")).toHaveLength(20);
  });

  it("keeps the newest notes when a workspace exceeds the cap", async () => {
    const store = createStore();
    for (let index = 0; index < MAX_NOTES_PER_WORKSPACE + 3; index += 1) {
      clock += 1000;
      await store.add("ws-1", { text: `note ${index}` }, { kind: "user" });
    }
    const notes = await store.list("ws-1");
    expect(notes).toHaveLength(MAX_NOTES_PER_WORKSPACE);
    expect(notes[0].text).toBe(`note ${MAX_NOTES_PER_WORKSPACE + 2}`);
    expect(notes.at(-1)?.text).toBe("note 3");
  });

  it("writes atomically and leaves no temp files behind", async () => {
    const store = createStore();
    await store.add("ws-1", { text: "x" }, { kind: "user" });
    const entries = await readdir(path.dirname(file));
    expect(entries).toEqual(["notes.json"]);
  });

  it("moves a corrupt file aside and keeps working", async () => {
    const store = createStore();
    await store.add("ws-1", { text: "x" }, { kind: "user" });
    await writeFile(file, "{ not json", "utf8");

    const messages: string[] = [];
    const recovered = createStore((message) => messages.push(message));
    expect(await recovered.list("ws-1")).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("invalid");

    const entries = await readdir(path.dirname(file));
    const aside = entries.filter((entry) => entry.startsWith("notes.json.corrupt-"));
    expect(aside).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(file), aside[0]), "utf8")).toBe("{ not json");

    await recovered.add("ws-1", { text: "after recovery" }, { kind: "user" });
    expect((await createStore().list("ws-1")).map((note) => note.text)).toEqual(["after recovery"]);
  });

  it("rejects a file that parses but fails the schema", async () => {
    await createStore().add("ws-1", { text: "x" }, { kind: "user" });
    await writeFile(file, JSON.stringify({ version: 1, workspaces: { "ws-1": [{ id: 1 }] } }));
    const messages: string[] = [];
    expect(await createStore((message) => messages.push(message)).list("ws-1")).toEqual([]);
    expect(messages).toHaveLength(1);
  });
});
