import { describe, expect, it } from "vitest";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";
import { ResponseChangeRecorder } from "./response-change-recorder.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentStreamEvent } from "./agent-sdk-types.js";

describe("saved response workspace changes", () => {
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "paseoi-changes-test-"));
    const root = join(directory, "repo");
    await mkdir(root);
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    await writeFile(join(root, "code.ts"), "const old = 1;\n");
    await writeFile(join(root, "removed.ts"), "gone\n");
    await writeFile(join(root, ".gitignore"), "ignored\n");
    git("add", ".");
    git("commit", "-qm", "baseline");
    return {
      directory,
      root,
      git,
      recorder: new ResponseChangeRecorder(join(directory, "records")),
    };
  }

  it("records shell edits, creates and deletes after a commit without including prior dirty changes; restores saved records", async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.root, "preexisting.ts"), "unrelated dirty file\n");
      await f.recorder.begin("a", f.root);
      await writeFile(join(f.root, "code.ts"), "const middle = 2;\n");
      await writeFile(join(f.root, "code.ts"), "const final = 3;\nextra();\n");
      await writeFile(join(f.root, "new.ts"), "created();\n");
      await rm(join(f.root, "removed.ts"));
      await writeFile(join(f.root, "ignored"), "not recorded\n");
      f.git("add", ".");
      f.git("commit", "-qm", "shell edits");
      const items = await f.recorder.finish("a", "turn");
      const edits = items.filter(
        (item) => item.type === "tool_call" && item.detail.type === "edit",
      );
      expect(edits).toHaveLength(3);
      expect(JSON.stringify(items)).not.toContain("unrelated dirty file");
      expect(JSON.stringify(items)).not.toContain("not recorded");
      expect(JSON.stringify(items)).toContain("+const final = 3;");
      expect(JSON.stringify(items)).not.toContain("middle =");
      await f.recorder.save("a", "final-answer", items);
      const restored = new ResponseChangeRecorder(join(f.directory, "records"));
      const events: Extract<AgentStreamEvent, { type: "timeline" }>[] = [
        {
          type: "timeline",
          provider: "claude",
          item: { type: "assistant_message", text: "Done", messageId: "final-answer" },
        },
      ];
      await restored.replay("a", events);
      expect(events.slice(1).map((event) => event.item)).toEqual(items);
      const rewound: typeof events = [];
      await restored.replay("a", rewound);
      expect(rewound).toEqual([]);
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });

  it("omits inferred changes for overlapping agents, including a nested working directory", async () => {
    const f = await fixture();
    try {
      await mkdir(join(f.root, "nested"));
      await f.recorder.begin("a", f.root);
      await f.recorder.begin("b", join(f.root, "nested"));
      await writeFile(join(f.root, "code.ts"), "ambiguous\n");
      expect(await f.recorder.finish("a", "one")).toEqual([]);
      expect(await f.recorder.finish("b", "two")).toEqual([]);
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });

  it("skips symlinks, binary and oversized files while retaining bounded text diffs", async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.root, "large"), "x".repeat(300_000));
      await writeFile(join(f.root, "binary"), Buffer.from([0, 1, 2]));
      await symlink(join(f.root, "code.ts"), join(f.root, "link"));
      await f.recorder.begin("a", f.root);
      await writeFile(join(f.root, "code.ts"), "changed\n");
      const items = await f.recorder.finish("a", "turn");
      expect(items).toHaveLength(2);
      expect(items.at(-1)).toMatchObject({ metadata: { complete: false } });
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });
});

describe("InMemoryAgentTimelineStore", () => {
  it("clamps an overshooting before cursor into the bounded tail window", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five", messageId: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six", messageId: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven", messageId: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "before",
      cursor: { epoch: "epoch-1", seq: 100 },
      limit: 2,
    });

    expect(result).toMatchObject({
      epoch: "epoch-1",
      direction: "before",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six", messageId: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven", messageId: "seven" },
        },
      ],
    });
  });

  it("returns a bounded reset window when an after cursor is behind retained history", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five", messageId: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six", messageId: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven", messageId: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 1 },
      limit: 1,
    });

    expect(result).toMatchObject({
      epoch: "epoch-1",
      direction: "after",
      reset: true,
      staleCursor: false,
      gap: true,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven", messageId: "seven" },
        },
      ],
    });
  });
});

describe("projected timeline retention", () => {
  it("retains one full tool state while streaming every source update", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent");
    for (let seq = 1; seq <= 2000; seq++) {
      const item = {
        type: "tool_call" as const,
        callId: "child",
        name: "task",
        status: "running" as const,
        error: null,
        detail: { type: "plain_text" as const, label: "Child", text: "x".repeat(seq * 128) },
      };
      expect(store.append("agent", item)).toMatchObject({ seq, item });
    }
    const result = store.fetch("agent", { limit: 0 });
    expect(result.rows).toHaveLength(1);
    expect(JSON.stringify(result.rows).length).toBeLessThan(260_000);
    expect(result.window.maxSeq).toBe(2000);
  });

  it("catches up a mid-message cursor with the complete projected message", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent", { epoch: "e" });
    store.append("agent", { type: "assistant_message", messageId: "m", text: "A" });
    store.append("agent", { type: "assistant_message", messageId: "m", text: "B" });
    expect(
      store.fetch("agent", { direction: "after", cursor: { epoch: "e", seq: 1 } }).rows,
    ).toMatchObject([
      {
        item: { text: "AB" },
        seqStart: 1,
        seqEnd: 2,
        sourceSeqRanges: [{ startSeq: 1, endSeq: 2 }],
      },
    ]);
  });
});

describe("projected sequence ownership", () => {
  it("preserves fetched coverage when another source chunk arrives", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("a");
    store.append("a", { type: "assistant_message", text: "A" });
    const before = store.fetch("a");
    store.append("a", { type: "assistant_message", text: "B" });
    expect(before.rows[0]).toMatchObject({
      item: { text: "A" },
      seqEnd: 1,
      sourceSeqRanges: [{ startSeq: 1, endSeq: 1 }],
    });
    expect(store.fetch("a").rows[0]).toMatchObject({
      item: { text: "AB" },
      seqEnd: 2,
      sourceSeqRanges: [{ startSeq: 1, endSeq: 2 }],
    });
  });
  it("preserves source positions when seeding a projected history whose last update is an earlier tool", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("a");
    const tool = {
      type: "tool_call" as const,
      callId: "t",
      name: "shell",
      error: null,
      detail: { type: "plain_text" as const, label: "work" },
    };
    store.append("a", { ...tool, status: "running" });
    store.append("a", { type: "assistant_message", text: "Answer" });
    store.append("a", { ...tool, status: "completed" });
    store.initialize("b", { rows: store.getRows("a") });
    expect(store.append("b", { type: "user_message", text: "next" }).seq).toBe(4);
    expect(store.fetch("b").rows.map((row) => row.seqStart)).toEqual([1, 2, 4]);
  });
  it("returns the last projected assistant message without joining different messages", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("a");
    store.append("a", { type: "assistant_message", messageId: "first", text: "First" });
    store.append("a", { type: "assistant_message", messageId: "second", text: "Sec" });
    store.append("a", { type: "assistant_message", messageId: "second", text: "ond" });
    expect(store.getLastAssistantMessage("a")).toBe("Second");
  });
});

it("includes transitive tool updates in a contiguous projected tail", () => {
  const store = new InMemoryAgentTimelineStore();
  store.initialize("a");
  const tool = (callId: string, status: "running" | "completed") => ({
    type: "tool_call" as const,
    callId,
    name: "shell",
    status,
    error: null,
    detail: { type: "plain_text" as const, label: "work" },
  });
  store.append("a", tool("first", "running"));
  store.append("a", tool("second", "running"));
  store.append("a", { type: "user_message", text: "Continue" });
  store.append("a", tool("first", "completed"));
  store.append("a", { type: "assistant_message", text: "Answer" });
  store.append("a", tool("second", "completed"));
  const tail = store.fetch("a", { limit: 1 });
  expect(tail.rows.map((row) => row.seqStart)).toEqual([1, 2, 3, 5]);
  expect(tail).toMatchObject({ startSeq: 1, endSeq: 6, hasOlder: false });
});
