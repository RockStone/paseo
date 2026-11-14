import { readFile, lstat, open, rename, unlink, realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, sep } from "node:path";
import { encodeReply, replyStamp } from "./replies.mjs";

import { parse } from "./parser.mjs";
import { historyStamp, annotateUpdates } from "./updated.mjs";
export { parse } from "./parser.mjs";
export function summarize(tasks, owners) {
  const warnings = [...tasks, ...owners].filter((item) => item.warnings?.length).length;
  tasks = tasks.filter((item) => !item.warnings?.length);
  owners = owners.filter((item) => !item.warnings?.length);
  const names = { 3: "Critical", 2: "Product", 1: "Later" };
  const done = tasks.filter((i) => i.status === "done").length;
  return {
    warnings,
    total: tasks.length,
    done,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    inProgress: tasks.filter((i) => i.status === "in progress").length,
    waiting: owners.filter((i) => i.status !== "done").length,
    ranks: [3, 2, 1].map((rank) => ({
      rank,
      name: names[rank],
      open: tasks.filter((i) => i.rank === rank && i.status !== "done").length,
      total: tasks.filter((i) => i.rank === rank).length,
    })),
  };
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function snapshot(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error("Expected regular document file");
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.size !== after.size)
    throw new Error("File changed; refresh");
  return { bytes, version: `${after.ino}:${after.mtimeMs}:${digest(bytes)}`, mode: after.mode };
}
export const TASK_FILE = "docs/drive.md",
  OWNER_FILE = "docs/owner-todo.md";
/** A tracker file inside the project, or null when the project has none. */
export async function documentPath(projectDir, relative) {
  const root = await realpath(projectDir),
    path = join(root, relative);
  let real;
  try {
    real = await realpath(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!real.startsWith(root + sep)) throw new Error("Document escapes project directory");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Expected regular document file");
  return path;
}
/** Cheap detection: no contents read or hashed. Detects atomic replacements too. */
export async function documentStamp(projectDir, { history = true } = {}) {
  const stamps = await Promise.all(
    [TASK_FILE, OWNER_FILE].map(async (relative) => {
      const path = await documentPath(projectDir, relative);
      if (!path) return `${relative}:missing`;
      try {
        const s = await lstat(path, { bigint: true });
        return `${path}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
      } catch (error) {
        if (error.code === "ENOENT") return `${relative}:missing`;
        throw error;
      }
    }),
  );
  return digest(stamps.join("|") + "|" + (history ? await historyStamp(projectDir) : ""));
}
const empty = async () => ({ bytes: Buffer.alloc(0), version: "missing" });
export class TrackerStore {
  cache = new Map();
  constructor({ timestamps = true } = {}) {
    this.timestamps = timestamps;
  }
  async read(root) {
    const stamp = () => documentStamp(root, { history: this.timestamps });
    const changeVersion = await stamp();
    const cached = this.cache.get(root);
    if (cached?.changeVersion === changeVersion) return cached;
    const task = await documentPath(root, TASK_FILE),
      owner = await documentPath(root, OWNER_FILE);
    const d = task ? await snapshot(task) : await empty();
    const o = owner ? await snapshot(owner) : await empty();
    if ((await stamp()) !== changeVersion)
      throw new Error("Files changed while reading; retrying on next sync");
    const tasks = parse(d.bytes.toString()),
      owners = parse(o.bytes.toString(), true);
    if (this.timestamps)
      await Promise.all([
        task && annotateUpdates(root, TASK_FILE, d.bytes, tasks, cached?.tasks),
        owner && annotateUpdates(root, OWNER_FILE, o.bytes, owners, cached?.owners),
      ]);
    if ((await stamp()) !== changeVersion)
      throw new Error("Files changed while reading history; retrying on next sync");
    const board = {
      tasks,
      owners,
      hasTasks: !!task,
      hasOwners: !!owner,
      version: o.version,
      changeVersion,
      summary: summarize(tasks, owners),
    };
    this.cache.set(root, board);
    return board;
  }
  prune(roots) {
    for (const root of this.cache.keys()) if (!roots.has(root)) this.cache.delete(root);
  }
}
const pending = new Map();
function byteLines(bytes) {
  const lines = [];
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(10, start),
      end = newline < 0 ? bytes.length : newline + 1;
    lines.push({ start, end });
    start = end;
  }
  return lines;
}
export function writeReply(path, expectedVersion, id, text, stamp = replyStamp()) {
  return mutateReply(path, expectedVersion, id, { action: "add", text, stamp });
}
export async function mutateReply(path, expectedVersion, id, mutation) {
  const previous = pending.get(path) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const current = await snapshot(path);
      if (current.version !== expectedVersion)
        throw new Error("File changed; review the latest file before saving");
      const matches = parse(current.bytes.toString("utf8"), true).filter((item) => item.id === id);
      if (!matches.length) throw new Error("Owner item not found");
      if (matches.length !== 1 || matches[0].warnings.length)
        throw new Error("Owner item has validation warnings; fix it before changing it");
      const item = matches[0];
      const source = current.bytes.toString("utf8"),
        eol = source.includes("\r\n") ? "\r\n" : "\n",
        lines = byteLines(current.bytes);
      let start, end, insertion;
      if (mutation.action === "status") {
        // Only the checkbox character changes; every other byte stays as is.
        start = lines[item.line].start + 3;
        end = start + 1;
        if (source[start] === undefined || !/[ ~x]/.test(source[start]))
          throw new Error("Owner item checkbox not found");
        insertion = Buffer.from(mutation.done ? "x" : " ");
      } else if (mutation.action === "add") {
        start = end = lines[item.line].end;
        const terminated = current.bytes[start - 1] === 10;
        insertion = Buffer.from(
          `${terminated ? "" : eol}${encodeReply(mutation.text, mutation.stamp ?? replyStamp(), eol)}${terminated ? eol : ""}`,
        );
      } else {
        const reply = item.replies.find((reply) => reply.id === mutation.replyId);
        if (!reply) throw new Error("Reply no longer exists; sync and review the current replies");
        start = lines[reply.line].start;
        end = lines[reply.lastLine].end;
        if (mutation.action === "remove") insertion = Buffer.alloc(0);
        else if (mutation.action === "edit")
          insertion = Buffer.from(
            encodeReply(mutation.text, reply.stamp, eol) +
              (current.bytes[end - 1] === 10 ? eol : ""),
          );
        else throw new Error("Unknown reply action");
      }
      const next = Buffer.concat([
        current.bytes.subarray(0, start),
        insertion,
        current.bytes.subarray(end),
      ]);
      const temp = path + `.${randomUUID()}.tmp`;
      try {
        const file = await open(temp, "wx", current.mode & 0o777);
        try {
          await file.writeFile(next);
          await file.sync();
        } finally {
          await file.close();
        }
        if ((await snapshot(path)).version !== expectedVersion)
          throw new Error("File changed; review the latest file before saving");
        await rename(temp, path);
      } finally {
        await unlink(temp).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      return (await snapshot(path)).version;
    });
  pending.set(path, operation);
  try {
    return await operation;
  } finally {
    if (pending.get(path) === operation) pending.delete(path);
  }
}
