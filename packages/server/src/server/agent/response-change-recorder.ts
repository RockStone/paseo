import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { AgentTimelineItemPayloadSchema } from "@getpaseo/protocol/messages";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { writeJsonFileAtomic } from "../atomic-file.js";

const exec = promisify(execFile);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_FILES = 20_000;
const MARKER = "paseoiWorkspaceSnapshot";

interface Snapshot {
  root: string;
  files: Map<string, string | null>;
  complete: boolean;
}
interface Capture {
  root: string;
  conflicted: boolean;
  snapshot?: Snapshot;
}
const RecordSchema = z.object({
  afterMessageId: z.string(),
  items: z.array(AgentTimelineItemPayloadSchema),
});
type SavedRecord = z.infer<typeof RecordSchema>;

async function git(cwd: string, args: string[]): Promise<string> {
  return (
    await exec("git", ["--no-optional-locks", "-C", cwd, ...args], {
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
  ).stdout;
}

async function snapshot(root: string): Promise<Snapshot> {
  const paths = [
    ...new Set(
      (await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))
        .split("\0")
        .filter(Boolean),
    ),
  ];
  if (paths.length > MAX_FILES) throw new Error("Workspace snapshot file limit exceeded");
  const result: Snapshot = { root, files: new Map(), complete: true };
  let remaining = MAX_SNAPSHOT_BYTES;
  // Keep file descriptors and memory bounded even for a large monorepo. Symlinks,
  // binary files and large/generated files never enter saved source previews.
  for (let offset = 0; offset < paths.length; offset += 8) {
    await Promise.all(
      paths.slice(offset, offset + 8).map(async (path) => {
        const absolute = resolve(root, path);
        if (!absolute.startsWith(root + sep)) return;
        let handle;
        let reserved = 0;
        try {
          handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > MAX_FILE_BYTES || stat.size > remaining) {
            result.files.set(path, null);
            result.complete = false;
            return;
          }
          remaining -= stat.size;
          reserved = stat.size;
          const buffer = Buffer.alloc(stat.size + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          const content = buffer.subarray(0, bytesRead);
          if (bytesRead > stat.size || content.includes(0)) {
            remaining += reserved;
            result.files.set(path, null);
            result.complete = false;
          } else result.files.set(path, new TextDecoder("utf-8", { fatal: true }).decode(content));
        } catch (error) {
          remaining += reserved;
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            result.files.set(path, null);
            result.complete = false;
          }
        } finally {
          await handle?.close();
        }
      }),
    );
  }
  return result;
}

function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
}

/** Observes workspace activity, not process ownership. Never writes to the Git index. */
export class ResponseChangeRecorder {
  private readonly active = new Map<string, Capture>();
  constructor(private readonly directory?: string) {}

  private markOverlaps(capture: Capture): void {
    for (const other of this.active.values()) {
      if (other !== capture && overlaps(capture.root, other.root)) {
        capture.conflicted = other.conflicted = true;
      }
    }
  }

  async begin(agentId: string, cwd: string): Promise<void> {
    if (!this.directory) return;
    const capture: Capture = { root: resolve(cwd), conflicted: this.active.size >= 4 };
    this.active.set(agentId, capture);
    this.markOverlaps(capture);
    try {
      capture.root = resolve((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
      this.markOverlaps(capture);
      if (!capture.conflicted) capture.snapshot = await snapshot(capture.root);
    } catch {
      // Non-Git and unavailable workspaces retain their explicit provider edits.
      capture.conflicted = true;
    }
  }

  discard(agentId: string): void {
    this.active.delete(agentId);
  }

  async finish(agentId: string, turnId: string): Promise<AgentTimelineItem[]> {
    const capture = this.active.get(agentId);
    if (!capture) return [];
    let temp: string | undefined;
    try {
      if (capture.conflicted || !capture.snapshot) return [];
      const before = capture.snapshot;
      const after = await snapshot(capture.root);
      const items: AgentTimelineItem[] = [];
      const captureId = `paseoi-changes:${turnId}:${randomUUID()}`;
      let complete = before.complete && after.complete;
      let bytes = 0;
      for (const path of new Set([...before.files.keys(), ...after.files.keys()])) {
        if (capture.conflicted) return [];
        const oldText = before.files.get(path);
        const newText = after.files.get(path);
        if (oldText === null || newText === null || oldText === newText) continue;
        // Git lists tracked deletions too; a missing entry is an absent file.
        temp ??= await mkdtemp(join(tmpdir(), "paseoi-diff-"));
        await writeFile(join(temp, "before"), oldText ?? "", { mode: 0o600 });
        await writeFile(join(temp, "after"), newText ?? "", { mode: 0o600 });
        let patch: string;
        try {
          patch = await git(temp, [
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--no-textconv",
            "--text",
            "--",
            "before",
            "after",
          ]);
        } catch (error) {
          const failure = error as { code?: number; stdout?: string };
          if (failure.code !== 1 || typeof failure.stdout !== "string") throw error;
          patch = failure.stdout;
        }
        const headerEnd = patch.indexOf("\n@@");
        if (headerEnd < 0) continue;
        const absolute = join(capture.root, path).replace(/\\/g, "/");
        patch = `--- ${JSON.stringify("a/" + absolute)}\n+++ ${JSON.stringify("b/" + absolute)}${patch.slice(headerEnd)}`;
        bytes += Buffer.byteLength(patch);
        if (bytes > MAX_RECORD_BYTES) {
          complete = false;
          break;
        }
        items.push({
          type: "tool_call",
          callId: `${captureId}:${items.length}`,
          name: "Workspace changes",
          status: "completed",
          error: null,
          metadata: { [MARKER]: true },
          detail: { type: "edit", filePath: join(capture.root, path), unifiedDiff: patch },
        });
      }
      if (capture.conflicted) return [];
      // An empty complete snapshot also matters: edits may have been reverted.
      items.push({
        type: "tool_call",
        callId: `${captureId}:end`,
        name: "Workspace changes",
        status: "completed",
        error: null,
        metadata: { [MARKER]: true, complete, root: capture.root.replace(/\\/g, "/") },
        detail: { type: "plain_text", text: "Workspace changes observed during this response" },
      });
      return items;
    } finally {
      this.active.delete(agentId);
      if (temp) await rm(temp, { recursive: true, force: true });
    }
  }

  private path(agentId: string): string {
    // Encoding keeps opaque agent IDs from becoming filesystem paths.
    return join(this.directory!, Buffer.from(agentId).toString("hex"), "history.json");
  }

  private async read(agentId: string): Promise<SavedRecord[]> {
    if (!this.directory) return [];
    try {
      return z.array(RecordSchema).parse(JSON.parse(await readFile(this.path(agentId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async save(agentId: string, afterMessageId: string, items: AgentTimelineItem[]): Promise<void> {
    if (!this.directory || !items.length) return;
    const records = await this.read(agentId);
    await mkdir(dirname(this.path(agentId)), { recursive: true, mode: 0o700 });
    await writeJsonFileAtomic(this.path(agentId), [
      ...records.filter((record) => record.afterMessageId !== afterMessageId),
      { afterMessageId, items },
    ]);
  }

  async replay(
    agentId: string,
    events: Extract<import("./agent-sdk-types.js").AgentStreamEvent, { type: "timeline" }>[],
  ): Promise<void> {
    const records = new Map(
      (await this.read(agentId)).map((record) => [record.afterMessageId, record.items]),
    );
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]!;
      if (event.item.type !== "assistant_message" || !event.item.messageId) continue;
      const items = records.get(event.item.messageId);
      if (items) {
        events.splice(index + 1, 0, ...items.map((item) => Object.assign({}, event, { item })));
        records.delete(event.item.messageId);
      }
    }
  }

  async remove(agentId: string): Promise<void> {
    this.discard(agentId);
    if (this.directory) await rm(this.path(agentId), { force: true });
  }
}
