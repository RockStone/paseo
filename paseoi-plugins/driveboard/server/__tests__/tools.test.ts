import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentToolContext, AgentToolDefinition } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NoteStore } from "../store";
import { createAgentTools } from "../tools";

let directory: string;
let store: NoteStore;
let post: AgentToolDefinition;
let read: AgentToolDefinition;

function context(workspaceId: string | null, title: string | null = "Fix login"): AgentToolContext {
  return {
    agent: {
      id: "agent-1",
      workspaceId,
      parentAgentId: null,
      provider: "claude",
      cwd: "/repo",
      title,
    },
    paseo: {} as AgentToolContext["paseo"],
    signal: new AbortController().signal,
  };
}

// Paseo validates input with the tool's schema before calling execute.
function call(tool: AgentToolDefinition, input: unknown, ctx: AgentToolContext) {
  return tool.execute(tool.input.parse(input), ctx);
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "sticky-notes-tools-"));
  store = new NoteStore(path.join(directory, "notes.json"), { log: () => {} });
  [post, read] = createAgentTools(store);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("agent tools", () => {
  it("have valid names and a description that asks for sparing use", () => {
    expect(post.name).toBe("post_sticky_note");
    expect(read.name).toBe("read_sticky_notes");
    expect(post.description).toMatch(/sticky note for this workspace/);
    expect(post.description).toMatch(/sparingly/);
  });

  it("post_sticky_note pins an agent note to the calling agent's workspace", async () => {
    const result = await call(
      post,
      { text: "Deploy preview is up", url: "https://preview.example.com", title: "Preview" },
      context("ws-1"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.text).toBe("Pinned to the user's sticky note for this workspace.");

    const [note] = await store.list("ws-1");
    expect(note).toMatchObject({
      text: "Deploy preview is up",
      url: "https://preview.example.com",
      title: "Preview",
      author: { kind: "agent", agentId: "agent-1", agentTitle: "Fix login" },
      seenAt: null,
    });
    expect(await store.summary()).toEqual({ workspaces: { "ws-1": { total: 1, unseen: 1 } } });
  });

  it("post_sticky_note omits a missing agent title", async () => {
    await call(post, { text: "x" }, context("ws-1", null));
    const [note] = await store.list("ws-1");
    expect(note.author).toEqual({ kind: "agent", agentId: "agent-1" });
  });

  it("rejects empty text and non-http URLs before execute", () => {
    expect(() => post.input.parse({ text: "   " })).toThrow();
    expect(() => post.input.parse({ text: "x", url: "javascript:alert(1)" })).toThrow();
  });

  it("reports an error for an agent outside a workspace", async () => {
    expect((await call(post, { text: "x" }, context(null))).isError).toBe(true);
    expect((await call(read, {}, context(null))).isError).toBe(true);
  });

  it("read_sticky_notes returns the workspace's notes, including the user's", async () => {
    expect((await call(read, {}, context("ws-1"))).text).toBe(
      "The sticky note for this workspace is empty.",
    );
    await store.add("ws-1", { text: "Please use pnpm here" }, { kind: "user" });
    await store.add("ws-2", { text: "not visible" }, { kind: "user" });
    await call(post, { text: "PR opened", url: "https://example.com/pr/2" }, context("ws-1"));

    const result = await call(read, {}, context("ws-1"));
    expect(result.text).toContain("2 notes, newest first");
    expect(result.text).toContain("Please use pnpm here");
    expect(result.text).toContain("from user");
    expect(result.text).toContain('from agent "Fix login"');
    expect(result.text).toContain("URL: https://example.com/pr/2");
    expect(result.text).not.toContain("not visible");
    const structured = result.structuredContent as { notes: unknown[] };
    expect(structured.notes).toHaveLength(2);
    // Reading does not mark agent notes as seen by the user.
    expect((await store.summary()).workspaces["ws-1"].unseen).toBe(1);
  });
});
