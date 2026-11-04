import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";
import { createResponseReference, readResponseReference } from "./response-references.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

test("a saved reference retrieves the selected response after the live timeline is gone", async () => {
  const home = await mkdtemp(join(tmpdir(), "response-reference-"));
  homes.push(home);
  const store = new InMemoryAgentTimelineStore();
  store.initialize("agent-1", {
    epoch: "epoch-1",
    rows: [
      {
        seq: 1,
        timestamp: "2026-11-04T01:00:00Z",
        turnId: "turn-1",
        item: { type: "user_message", text: "First question" },
      },
      {
        seq: 2,
        timestamp: "2026-11-04T01:00:01Z",
        turnId: "turn-1",
        item: { type: "assistant_message", text: "First response" },
      },
      {
        seq: 3,
        timestamp: "2026-11-04T01:00:02Z",
        turnId: "turn-1",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "shell",
          status: "completed",
          error: null,
          detail: { type: "plain_text", text: "Private tool output" },
        },
      },
      {
        seq: 4,
        timestamp: "2026-11-04T01:00:03Z",
        turnId: "turn-1",
        item: { type: "assistant_message", text: "First response conclusion" },
      },
      {
        seq: 5,
        timestamp: "2026-11-04T01:00:04Z",
        turnId: "turn-2",
        item: { type: "user_message", text: "Another question" },
      },
      {
        seq: 6,
        timestamp: "2026-11-04T01:00:05Z",
        turnId: "turn-2",
        item: { type: "assistant_message", text: "Another response" },
      },
    ],
  });
  const reference = await createResponseReference({
    paseoHome: home,
    agentId: "agent-1",
    timeline: store.fetch("agent-1", { limit: 0 }),
    cursor: { epoch: "epoch-1", seq: 4 },
  });
  store.delete("agent-1");
  expect(await readResponseReference(home, reference.id)).toMatchObject({
    agentId: "agent-1",
    text: "First response\n\nFirst response conclusion",
    preview: "First response First response conclusion",
  });
});

test("a stale cursor and a missing reference produce actionable errors", async () => {
  const home = await mkdtemp(join(tmpdir(), "response-reference-"));
  homes.push(home);
  await expect(
    createResponseReference({
      paseoHome: home,
      agentId: "a",
      timeline: { epoch: "new", rows: [] },
      cursor: { epoch: "old", seq: 2 },
    }),
  ).rejects.toThrow("Refresh the conversation");
  await expect(readResponseReference(home, "../config")).rejects.toThrow(
    "Invalid response reference",
  );
  await expect(readResponseReference(home, "a".repeat(64))).rejects.toThrow(
    "not found on this host",
  );
});
