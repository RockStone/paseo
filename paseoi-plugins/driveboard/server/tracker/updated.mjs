import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
const repositories = new Map();
async function repository(root) {
  if (repositories.has(root)) return repositories.get(root);
  for (let directory = resolve(root); ; directory = dirname(directory)) {
    try {
      const path = join(directory, ".git"),
        entry = await stat(path);
      const git = entry.isDirectory()
        ? path
        : resolve(directory, (await readFile(path, "utf8")).trim().replace(/^gitdir: /, ""));
      let common = git;
      try {
        common = resolve(git, (await readFile(join(git, "commondir"), "utf8")).trim());
      } catch {}
      const repo = { git, common };
      repositories.set(root, repo);
      return repo;
    } catch {}
    if (dirname(directory) === directory) break;
  }
  return null;
}
/** Small local Git metadata reads keep timestamps fresh after commits, including worktrees. */
export async function historyStamp(root) {
  const repo = await repository(root);
  if (!repo) return "";
  try {
    const head = (await readFile(join(repo.git, "HEAD"), "utf8")).trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    for (const directory of new Set([repo.git, repo.common])) {
      try {
        return (await readFile(join(directory, ref), "utf8")).trim();
      } catch {}
    }
    const packed = await readFile(join(repo.common, "packed-refs"), "utf8").catch(() => "");
    return packed.split("\n").find((line) => line.endsWith(" " + ref)) ?? head;
  } catch {
    return "";
  }
}
export function parseBlame(output) {
  const lines = [];
  let index = -1,
    time = null,
    dirty = false;
  for (const line of output.split("\n")) {
    const header = line.match(/^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/);
    if (header) {
      index = Number(header[2]) - 1;
      dirty = /^0+$/.test(header[1]);
      time = null;
    } else if (line.startsWith("committer-time ") && !dirty) {
      const date = new Date(Number(line.slice(15)) * 1000);
      time = Number.isFinite(date.getTime()) ? date.toISOString() : null;
    } else if (line.startsWith("\t") && index >= 0) lines[index] = { at: time, dirty };
  }
  return lines;
}
async function blame(root, file, bytes) {
  if (!(await repository(root))) return [];
  return new Promise((resolveResult) => {
    const child = execFile(
      "git",
      ["--no-pager", "blame", "--line-porcelain", "--contents", "-", "--", file],
      {
        cwd: root,
        timeout: 3000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
      (error, stdout) => resolveResult(error ? [] : parseBlame(stdout)),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(bytes);
  });
}
export async function annotateUpdates(root, file, bytes, items, previous, now = Date.now()) {
  const history = await blame(root, file, bytes),
    source = bytes.toString().split(/\r?\n/),
    old = new Map((previous ?? []).map((item) => [item.id, item]));
  for (const item of items) {
    const block = source.slice(item.line, item.lastLine + 1),
      meaningful = block
        .flatMap((text, i) => (text.trim() ? [history[item.line + i]] : []))
        .filter(Boolean);
    item.updateHash = createHash("sha256").update(block.join("\n").trimEnd()).digest("hex");
    item.uncommitted = meaningful.some((line) => line.dirty);
    const uncertain = item.uncommitted || !meaningful.length;
    item.updatedAt = null;
    item.updatedSource = "unknown";
    const before = old.get(item.id);
    if (
      uncertain &&
      (before?.updateHash ? before.updateHash !== item.updateHash : previous !== undefined)
    ) {
      item.updatedAt = new Date(now).toISOString();
      item.updatedSource = "observed";
    } else if (
      uncertain &&
      before?.updateHash === item.updateHash &&
      before.updatedSource === "observed"
    ) {
      item.updatedAt = before.updatedAt;
      item.updatedSource = "observed";
    } else if (!uncertain) {
      item.updatedAt =
        meaningful
          .map((line) => line.at)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;
      if (item.updatedAt) item.updatedSource = "git";
    }
    // A reply records its own timestamp, even when the surrounding prose has no known edit time.
    if (!item.updatedAt) {
      const reply = item.replies.filter((reply) => reply.time).at(-1);
      if (reply) {
        item.updatedAt = `${reply.date}T${reply.time}:00.000Z`;
        item.updatedSource = "reply";
      }
    }
  }
}
