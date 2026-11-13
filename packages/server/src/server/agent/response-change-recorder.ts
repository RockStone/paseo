import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { AgentTimelineItemPayloadSchema } from "@getpaseo/protocol/messages";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { writeJsonFileAtomic } from "../atomic-file.js";

const exec = promisify(execFile);
const MAX_RECORD_BYTES = 128 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 256 * 1024 * 1024;
const MARKER = "paseoiWorkspaceSnapshot";

interface Capture {
  root: string;
  /** True once `root` is the resolved Git top level. */
  resolved: boolean;
  /** Another capture overlapped this root at any time during the turn. */
  shared: boolean;
  tree?: string;
}
const RecordSchema = z.object({
  afterMessageId: z.string(),
  items: z.array(AgentTimelineItemPayloadSchema),
});
type SavedRecord = z.infer<typeof RecordSchema>;

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return (
    await exec("git", ["--no-optional-locks", "-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
    })
  ).stdout;
}

/**
 * Hashes the working tree (tracked + untracked, honoring .gitignore) into a Git tree
 * object using a private copy of the index. The real index, refs and stash are untouched;
 * only unreferenced blob/tree objects are written.
 */
async function snapshotTree(root: string): Promise<string> {
  const temp = await mkdtemp(join(tmpdir(), "paseoi-index-"));
  try {
    const indexFile = join(temp, "index");
    const realIndex = resolve(root, (await git(root, ["rev-parse", "--git-path", "index"])).trim());
    try {
      await copyFile(realIndex, indexFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const env = { GIT_INDEX_FILE: indexFile };
    await git(root, ["add", "-A", "--", "."], env);
    return (await git(root, ["write-tree"], env)).trim();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const DIFF_TREE_ARGS = ["diff-tree", "-r", "--no-ext-diff", "--no-textconv", "--no-renames"];

function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
}

/** Observes workspace activity, not process ownership. Never writes to the Git index. */
export class ResponseChangeRecorder {
  private readonly active = new Map<string, Capture>();
  constructor(private readonly directory?: string) {}

  private markOverlaps(agentId: string, capture: Capture): void {
    for (const [otherId, other] of this.active) {
      if (otherId !== agentId && other.resolved && overlaps(capture.root, other.root)) {
        capture.shared = other.shared = true;
      }
    }
  }

  async begin(agentId: string, cwd: string): Promise<void> {
    if (!this.directory) return;
    const capture: Capture = { root: resolve(cwd), resolved: false, shared: false };
    this.active.set(agentId, capture);
    try {
      capture.root = resolve((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
      capture.resolved = true;
      this.markOverlaps(agentId, capture);
      capture.tree = await snapshotTree(capture.root);
    } catch {
      // Non-Git and unavailable workspaces retain their explicit provider edits.
      if (this.active.get(agentId) === capture) this.active.delete(agentId);
    }
  }

  discard(agentId: string): void {
    this.active.delete(agentId);
  }

  async finish(agentId: string, turnId: string): Promise<AgentTimelineItem[]> {
    const capture = this.active.get(agentId);
    if (!capture) return [];
    try {
      if (!capture.tree) return [];
      const before = capture.tree;
      const after = await snapshotTree(capture.root);
      const numstat = (
        await git(capture.root, [...DIFF_TREE_ARGS, "--numstat", "-z", before, after])
      )
        .split("\0")
        .filter(Boolean);
      const paths = numstat.map((entry) => entry.split("\t").slice(2).join("\t"));
      const patches = paths.length
        ? (await git(capture.root, [...DIFF_TREE_ARGS, "-p", before, after]))
            .split(/^(?=diff --git )/m)
            .filter(Boolean)
        : [];
      const items: AgentTimelineItem[] = [];
      const captureId = `paseoi-changes:${turnId}:${randomUUID()}`;
      let complete = patches.length === paths.length;
      let bytes = 0;
      for (let index = 0; index < Math.min(paths.length, patches.length); index++) {
        let patch = patches[index]!;
        const path = paths[index]!;
        const headerEnd = patch.indexOf("\n@@");
        // Binary and mode-only changes carry no hunk.
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
      // An empty complete snapshot also matters: edits may have been reverted.
      items.push({
        type: "tool_call",
        callId: `${captureId}:end`,
        name: "Workspace changes",
        status: "completed",
        error: null,
        metadata: {
          [MARKER]: true,
          complete,
          root: capture.root.replace(/\\/g, "/"),
          ...(capture.shared ? { shared: true } : {}),
        },
        detail: { type: "plain_text", text: "Workspace changes observed during this response" },
      });
      return items;
    } catch {
      return [];
    } finally {
      this.active.delete(agentId);
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
