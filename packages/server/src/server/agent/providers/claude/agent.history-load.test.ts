import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ClaudeAgentClient } from "./agent.js";
import { claudeProjectDirSync } from "./project-dir.js";

/**
 * A resumed Claude agent whose transcript is missing or unreadable opens with an empty timeline.
 * The daemon log at its default level has to say which, and where it looked.
 */

const SESSION_ID = "history-load-session";

interface LogRecord {
  level: number;
  msg: string;
  sessionId?: string;
  historyPath?: string;
  err?: { message?: string };
}

describe("ClaudeAgentSession persisted history load", () => {
  let tempRoot: string;
  let cwd: string;
  let configDir: string;
  let records: LogRecord[];

  async function resume(): Promise<void> {
    const client = new ClaudeAgentClient({
      logger: pino({ level: "info" }, { write: (line: string) => records.push(JSON.parse(line)) }),
      queryFactory: vi.fn(() => {
        throw new Error("history load must not start a query");
      }),
      resolveVersion: async () => "2.1.220",
    });
    const session = await client.resumeSession(
      { provider: "claude", sessionId: SESSION_ID },
      { cwd },
    );
    await session.close();
  }

  function transcriptPath(): string {
    return path.join(claudeProjectDirSync(cwd, { configDir }), `${SESSION_ID}.jsonl`);
  }

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "claude-history-load-"));
    cwd = path.join(tempRoot, "repo");
    configDir = path.join(tempRoot, "claude-config");
    mkdirSync(cwd, { recursive: true });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
    records = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("logs the resolved transcript path when the transcript does not exist", async () => {
    await resume();

    expect(records).toContainEqual(
      expect.objectContaining({
        level: pino.levels.values.info,
        msg: "No Claude transcript to load history from",
        sessionId: SESSION_ID,
        historyPath: transcriptPath(),
      }),
    );
  });

  test.each([false, true])(
    "duplicate tool starts cannot reopen a settled historical call (failed=%s)",
    async (failed) => {
      mkdirSync(path.dirname(transcriptPath()), { recursive: true });
      const tool = {
        type: "tool_use",
        id: "settled-shell",
        name: "Bash",
        input: { command: "echo done" },
      };
      const entries = [
        {
          type: "assistant",
          uuid: "assistant-tool",
          message: { role: "assistant", content: [tool] },
        },
        {
          type: "user",
          uuid: "tool-result",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: tool.id, content: "done", is_error: failed },
            ],
          },
        },
        // Claude can append another copy of the original assistant tool_use after its result.
        {
          type: "assistant",
          uuid: "assistant-tool",
          message: { role: "assistant", content: [tool] },
        },
        {
          type: "assistant",
          uuid: "next-tool",
          message: { role: "assistant", content: [{ ...tool, id: "new-shell" }] },
        },
      ];
      writeFileSync(
        transcriptPath(),
        entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      );
      const client = new ClaudeAgentClient({
        logger: pino({ level: "silent" }),
        resolveVersion: async () => "2.1.301",
        queryFactory: vi.fn(() => {
          throw new Error("Replay must not execute commands");
        }),
      });
      const session = await client.resumeSession(
        { provider: "claude", sessionId: SESSION_ID },
        { cwd },
      );
      try {
        const states: string[] = [];
        const freshStates: string[] = [];
        for await (const event of session.streamHistory()) {
          if (event.type !== "timeline" || event.item.type !== "tool_call") continue;
          if (event.item.callId === tool.id) states.push(event.item.status);
          if (event.item.callId === "new-shell") freshStates.push(event.item.status);
        }
        expect(states).toEqual(["running", failed ? "failed" : "completed"]);
        expect(freshStates).toEqual(["running"]);
      } finally {
        await session.close();
      }
    },
  );

  test("logs a warning with the error when the transcript cannot be read", async () => {
    // A directory at the transcript path exists but cannot be read as a file.
    mkdirSync(transcriptPath(), { recursive: true });

    await resume();

    expect(records).toContainEqual(
      expect.objectContaining({
        level: pino.levels.values.warn,
        msg: "Failed to load Claude history from transcript",
        sessionId: SESSION_ID,
        historyPath: transcriptPath(),
        err: expect.objectContaining({ message: expect.stringContaining("EISDIR") }),
      }),
    );
  });

  // chmod does not remove read access on Windows, or for root.
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "logs a warning with the error when Claude's project folders cannot be listed",
    async () => {
      // The transcript is not under cwd's folder, so the lookup lists the other project folders.
      mkdirSync(path.join(configDir, "projects"), { recursive: true });
      chmodSync(path.join(configDir, "projects"), 0o000);

      try {
        await resume();
      } finally {
        chmodSync(path.join(configDir, "projects"), 0o755);
      }

      expect(records).toContainEqual(
        expect.objectContaining({
          level: pino.levels.values.warn,
          msg: "Failed to load Claude history from transcript",
          sessionId: SESSION_ID,
          err: expect.objectContaining({ message: expect.stringContaining("EACCES") }),
        }),
      );
    },
  );
});
