import { createHash } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import {
  createFileObserver,
  type FileObserver,
  type FileObserverSubscription,
} from "../../../../file-observer/index.js";
import type { AgentTimelineItem } from "../../../agent-sdk-types.js";
import type { SubagentObservation } from "./observation.js";
import { parseClaudeSubagentMeta, type ClaudeReplayEntry } from "./replay-source.js";
import { readClaudeSubagentHandback } from "../subagent-handback.js";

interface ChildTranscript {
  id: string;
  nativeId: string;
  file: string;
  offset: number;
  identity: string | null;
  anchor: Buffer;
  pending: Buffer;
  prompts: string[];
  startedAt: number;
  initialMetaRevision: string | null;
  handbacks: Set<string>;
  finished: boolean;
}

interface TranscriptSourceOptions {
  convertEntry: (entry: ClaudeReplayEntry) => AgentTimelineItem[] | Promise<AgentTimelineItem[]>;
  emit: (observations: SubagentObservation[]) => void;
  reportError: (error: unknown) => void;
}

/** Task events carry liveness, but background children write their conversation only to disk. */
export class ClaudeSubagentTranscriptSource {
  private readonly children = new Map<string, ChildTranscript>();
  private readonly seen = new Map<string, Set<string>>();
  private observer: FileObserver | null = null;
  private subscription: FileObserverSubscription | null = null;
  private failedSubscription: FileObserverSubscription | null = null;
  private directory: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingFlush: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly options: TranscriptSourceOptions) {}

  remember(entry: ClaudeReplayEntry): boolean {
    if (typeof entry.agentId !== "string" || (entry.type !== "user" && entry.type !== "assistant"))
      return false;
    const key =
      typeof entry.uuid === "string"
        ? entry.uuid
        : createHash("sha256").update(JSON.stringify(entry)).digest("hex");
    const records = this.seen.get(entry.agentId) ?? new Set<string>();
    if (records.has(key)) return false;
    records.add(key);
    this.seen.set(entry.agentId, records);
    return true;
  }

  private hasSeen(entry: ClaudeReplayEntry): boolean {
    if (typeof entry.agentId !== "string") return true;
    const key =
      typeof entry.uuid === "string"
        ? entry.uuid
        : createHash("sha256").update(JSON.stringify(entry)).digest("hex");
    return this.seen.get(entry.agentId)?.has(key) === true;
  }

  async track(input: {
    directory: string;
    id: string;
    nativeId: string;
    prompt?: string;
  }): Promise<void> {
    if (this.closed || !/^[\w-]+$/.test(input.nativeId)) return;
    this.directory = input.directory;
    const previous = this.children.get(input.nativeId);
    const child: ChildTranscript = previous ?? {
      id: input.id,
      nativeId: input.nativeId,
      file: path.join(input.directory, `agent-${input.nativeId}.jsonl`),
      offset: 0,
      identity: null,
      anchor: Buffer.alloc(0),
      pending: Buffer.alloc(0),
      prompts: [],
      startedAt: Date.now(),
      initialMetaRevision: null,
      handbacks: new Set(),
      finished: false,
    };
    child.startedAt = Date.now();
    child.handbacks.clear();
    try {
      const info = await stat(child.file.replace(/\.jsonl$/, ".meta.json"));
      child.initialMetaRevision = `${info.ino}:${info.mtimeMs}:${info.size}`;
    } catch (error) {
      if (!isMissing(error)) this.options.reportError(error);
    }
    if (this.closed) return;
    child.finished = false;
    if (input.prompt) child.prompts.push(input.prompt.trim());
    this.children.set(input.nativeId, child);
    await this.flush();
  }

  flush(): Promise<void> {
    this.pendingFlush = this.pendingFlush
      .then(async () => {
        if (this.closed) return;
        await this.ensureObservation();
        for (const child of this.children.values()) {
          if (this.closed) break;
          try {
            await this.readChild(child);
          } catch (error) {
            this.options.reportError(error);
          }
        }
        if (!this.closed && !this.subscription) this.schedule(2000);
        return undefined;
      })
      .catch(this.options.reportError);
    return this.pendingFlush;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.observer?.close();
    await this.pendingFlush;
    this.children.clear();
    this.seen.clear();
  }

  private schedule(delay = 50): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
    this.timer.unref();
  }

  private async ensureObservation(): Promise<void> {
    if (this.failedSubscription) {
      await this.failedSubscription.unsubscribe();
      this.failedSubscription = null;
    }
    if (!this.directory || this.subscription || this.closed) return;
    this.observer ??= createFileObserver();
    try {
      this.subscription = await this.observer.subscribe(this.directory, (error) => {
        if (error) this.releaseFailedObservation(error);
        this.schedule();
      });
    } catch (error) {
      if (!isMissing(error)) this.options.reportError(error);
    }
  }

  private releaseFailedObservation(error: Error): void {
    this.options.reportError(error);
    this.failedSubscription = this.subscription;
    this.subscription = null;
  }

  private async readChild(child: ChildTranscript): Promise<void> {
    let fd;
    try {
      fd = await open(child.file, "r");
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    try {
      const info = await fd.stat();
      const identity = `${info.dev}:${info.ino}`;
      const anchor = Buffer.alloc(child.anchor.length);
      if (child.offset >= anchor.length)
        await fd.read(anchor, 0, anchor.length, child.offset - anchor.length);
      if (child.identity !== identity || info.size < child.offset || !anchor.equals(child.anchor)) {
        child.offset = 0;
        child.pending = Buffer.alloc(0);
      }
      child.identity = identity;
      // Bound each pass; a large initial transcript yields to sockets between read chunks.
      const end = Math.min(info.size, child.offset + 4 * 1024 * 1024);
      while (!this.closed && child.offset < end) {
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, end - child.offset));
        const { bytesRead } = await fd.read(chunk, 0, chunk.length, child.offset);
        if (bytesRead === 0) break;
        child.offset += bytesRead;
        const data = Buffer.concat([child.pending, chunk.subarray(0, bytesRead)]);
        let start = 0;
        let newline: number;
        while ((newline = data.indexOf(10, start)) !== -1) {
          await this.consume(child, data.subarray(start, newline).toString("utf8"));
          start = newline + 1;
        }
        child.pending = Buffer.from(data.subarray(start));
        await setImmediate();
      }
      child.anchor = Buffer.alloc(Math.min(64, child.offset));
      await fd.read(child.anchor, 0, child.anchor.length, child.offset - child.anchor.length);
      if (child.offset < info.size) this.schedule();
    } catch (error) {
      // Retry failed conversions from disk; committed record ids prevent duplicate output.
      child.identity = null;
      this.schedule(2000);
      throw error;
    } finally {
      await fd.close();
    }
    await this.readCompletion(child);
  }

  private async consume(child: ChildTranscript, line: string): Promise<void> {
    let entry: ClaudeReplayEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (
      !entry ||
      entry.agentId !== child.nativeId ||
      (entry.type !== "assistant" && entry.type !== "user") ||
      this.hasSeen(entry)
    )
      return;
    const observations: SubagentObservation[] = [];
    for (const item of await this.options.convertEntry(entry)) {
      const promptIndex =
        item.type === "user_message" ? child.prompts.indexOf(item.text.trim()) : -1;
      if (promptIndex >= 0) {
        child.prompts.splice(promptIndex, 1);
        continue;
      }
      observations.push({
        kind: "timeline",
        id: child.id,
        item,
        ...(typeof entry.timestamp === "string" ? { timestamp: entry.timestamp } : {}),
      });
    }
    this.observeHandback(child, entry, observations);
    if (!this.closed) {
      this.options.emit(observations);
      this.remember(entry);
    }
  }

  private observeHandback(
    child: ChildTranscript,
    entry: ClaudeReplayEntry,
    observations: SubagentObservation[],
  ): void {
    const content = entry.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const handback = readClaudeSubagentHandback(block);
        if (handback) child.handbacks.add(handback.callId);
        if (
          block.type === "tool_result" &&
          child.handbacks.has(block.tool_use_id) &&
          block.is_error !== true
        )
          this.finish(child, observations);
      }
    }
  }

  private async readCompletion(child: ChildTranscript): Promise<void> {
    if (child.finished || this.closed) return;
    const file = child.file.replace(/\.jsonl$/, ".meta.json");
    try {
      const info = await stat(file);
      const revision = `${info.ino}:${info.mtimeMs}:${info.size}`;
      const meta = parseClaudeSubagentMeta(await readFile(file, "utf8"));
      // A previous run's finished flag can survive until Claude rewrites the sidecar on resume.
      if (
        meta?.finished !== true ||
        info.mtimeMs < child.startedAt ||
        revision === child.initialMetaRevision
      )
        return;
      const observations: SubagentObservation[] = [];
      this.finish(child, observations);
      if (!this.closed) this.options.emit(observations);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  private finish(child: ChildTranscript, observations: SubagentObservation[]): void {
    if (child.finished) return;
    child.finished = true;
    observations.push({ kind: "status", id: child.id, status: "completed" });
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
