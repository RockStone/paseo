import type { StreamItem } from "@/types/stream";

export interface ChangeCounts {
  additions: number;
  deletions: number;
}

export interface RecordedFileEdit {
  id: string;
  before?: string;
  after?: string;
  patch?: string;
}

export interface ResponseFileChange {
  path: string;
  edits: RecordedFileEdit[];
  counts: ChangeCounts | null;
}

export interface ResponseFileChanges {
  files: ResponseFileChange[];
  counts: ChangeCounts | null;
}

function textLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function countTextChange(before: string, after: string): ChangeCounts | null {
  const oldLines = textLines(before);
  const newLines = textLines(after);
  // A summary must not allocate a quadratic matrix for large generated files.
  if (oldLines.length * newLines.length > 250_000) return null;
  let previous = Array<number>(newLines.length + 1).fill(0);
  for (const oldLine of oldLines) {
    const row = Array<number>(newLines.length + 1).fill(0);
    for (let index = 0; index < newLines.length; index++) {
      row[index + 1] =
        oldLine === newLines[index]
          ? previous[index]! + 1
          : Math.max(previous[index + 1]!, row[index]!);
    }
    previous = row;
  }
  const common = previous[newLines.length]!;
  return { additions: newLines.length - common, deletions: oldLines.length - common };
}

function countPatch(patch: string): ChangeCounts | null {
  if (/^\.\.\.\[truncated \d+ chars\]$/m.test(patch)) return null;
  let additions = 0;
  let deletions = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let foundHunk = false;
  for (const line of patch.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      if (oldRemaining || newRemaining) return null;
      oldRemaining = Number(hunk[1] ?? 1);
      newRemaining = Number(hunk[2] ?? 1);
      foundHunk = true;
    } else if (oldRemaining || newRemaining) {
      if (line.startsWith("+")) {
        additions++;
        newRemaining--;
      } else if (line.startsWith("-")) {
        deletions++;
        oldRemaining--;
      } else if (line.startsWith(" ")) {
        oldRemaining--;
        newRemaining--;
      } else if (!line.startsWith("\\ No newline")) return null;
      if (oldRemaining < 0 || newRemaining < 0) return null;
    }
  }
  return foundHunk && oldRemaining === 0 && newRemaining === 0 ? { additions, deletions } : null;
}

function relativePath(filePath: string, root: string): string {
  const path = filePath.replace(/\\/g, "/");
  const prefix = root.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function patchPath(patch: string): string | null {
  const metadata = patch.replace(/\r\n/g, "\n").split(/^@@/m, 1)[0]!;
  const header = /^\+\+\+ (.+)$/m.exec(metadata)?.[1];
  const oldHeader = /^--- (.+)$/m.exec(metadata)?.[1];
  const gitHeader = /^diff --git a\/(.*?) b\/(.+)$/m.exec(metadata)?.[2];
  const raw = header === "/dev/null" ? oldHeader : (header ?? gitHeader);
  if (!raw) return null;
  let path = raw.split("\t")[0]!;
  if (path.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(path);
      if (typeof decoded !== "string") return null;
      path = decoded;
    } catch {
      return null;
    }
  }
  return path.replace(/^[ab]\//, "");
}

function fileCounts(edits: RecordedFileEdit[]): ChangeCounts | null {
  // Snippets do not identify their position. Even a matching before/after chain
  // could edit two different occurrences, so repeated edits have no proven net total.
  if (edits.length !== 1) return null;
  const edit = edits[0]!;
  if (edit.patch) return countPatch(edit.patch);
  if (edit.before !== undefined && edit.after !== undefined)
    return countTextChange(edit.before, edit.after);
  return null;
}

function summarize(items: StreamItem[], root: string): ResponseFileChanges | null {
  const calls = new Map<string, Extract<StreamItem, { kind: "tool_call" }>>();
  for (const item of items) {
    if (item.kind === "tool_call") calls.set(item.id, item);
  }
  const files = new Map<string, RecordedFileEdit[]>();
  function add(path: string, edit: RecordedFileEdit) {
    const key = relativePath(path, root);
    const edits = files.get(key) ?? [];
    edits.push(edit);
    files.set(key, edits);
  }
  for (const item of calls.values()) {
    if (item.payload.source !== "agent") continue;
    const { status, detail } = item.payload.data;
    if (status !== "completed") continue;
    if (detail.type === "write") {
      add(detail.filePath, { id: item.id, after: detail.content });
    } else if (detail.type === "edit") {
      if (detail.unifiedDiff) {
        const patches = detail.unifiedDiff
          .split(/(?=^diff --git )/m)
          .filter((patch) => patch.trim());
        for (const patch of patches) {
          add(patchPath(patch) ?? detail.filePath, {
            id: `${item.id}:${patchPath(patch) ?? detail.filePath}`,
            patch,
            before: detail.oldString,
            after: detail.newString,
          });
        }
      } else {
        add(detail.filePath, { id: item.id, before: detail.oldString, after: detail.newString });
      }
    }
  }
  const changes = Array.from(files, ([path, edits]) => ({
    path,
    edits,
    counts: fileCounts(edits),
  })).filter((file) => file.counts === null || file.counts.additions + file.counts.deletions > 0);
  if (!changes.length) return null;
  const counts = changes.every((file) => file.counts !== null)
    ? changes.reduce(
        (sum, file) => ({
          additions: sum.additions + file.counts!.additions,
          deletions: sum.deletions + file.counts!.deletions,
        }),
        { additions: 0, deletions: 0 },
      )
    : null;
  return { files: changes, counts };
}

/** Saved tool events survive commits; the current checkout is never used to attribute edits. */
export function collectResponseFileChanges(
  items: StreamItem[],
  root: string,
): Map<string, ResponseFileChanges> {
  const summaries = new Map<string, ResponseFileChanges>();
  let response: StreamItem[] = [];
  function finish() {
    const assistant = response.findLast((item) => item.kind === "assistant_message");
    if (!assistant) return;
    const summary = summarize(response, root);
    if (summary) summaries.set(assistant.id, summary);
  }
  for (const item of items) {
    if (item.kind === "user_message") {
      finish();
      response = [];
    }
    response.push(item);
  }
  finish();
  return summaries;
}
