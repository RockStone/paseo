import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResponseChangeRecorder } from "./response-change-recorder.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

describe("ResponseChangeRecorder", () => {
  let base: string;
  let repo: string;
  let recorder: ResponseChangeRecorder;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "recorder-test-")));
    repo = join(base, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(repo, "tracked.txt"), "one\ntwo\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "init");
    recorder = new ResponseChangeRecorder(join(base, "records"));
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  function edits(items: Awaited<ReturnType<ResponseChangeRecorder["finish"]>>) {
    return items.flatMap((item) =>
      item.type === "tool_call" && item.detail.type === "edit" ? [item.detail] : [],
    );
  }
  function endMarker(items: Awaited<ReturnType<ResponseChangeRecorder["finish"]>>) {
    const end = items.at(-1);
    return end?.type === "tool_call" ? end.metadata : undefined;
  }

  it("records a shell-style edit, a new file, and skips ignored files", async () => {
    await recorder.begin("a", repo);
    writeFileSync(join(repo, "tracked.txt"), "one\nthree\n");
    writeFileSync(join(repo, "new.txt"), "hello\n");
    writeFileSync(join(repo, "ignored.txt"), "secret\n");
    const items = await recorder.finish("a", "turn");
    const details = edits(items);
    expect(details.map((d) => d.filePath).sort()).toEqual([
      join(repo, "new.txt"),
      join(repo, "tracked.txt"),
    ]);
    const tracked = details.find((d) => d.filePath.endsWith("tracked.txt"))!;
    expect(tracked.unifiedDiff).toBe(
      `--- ${JSON.stringify("a/" + join(repo, "tracked.txt"))}\n+++ ${JSON.stringify("b/" + join(repo, "tracked.txt"))}\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n`,
    );
    expect(endMarker(items)).toMatchObject({ complete: true, root: repo });
    expect(endMarker(items)?.shared).toBeUndefined();
  });

  it("emits only the end marker when edits were reverted", async () => {
    await recorder.begin("a", repo);
    writeFileSync(join(repo, "tracked.txt"), "x\n");
    writeFileSync(join(repo, "tracked.txt"), "one\ntwo\n");
    const items = await recorder.finish("a", "turn");
    expect(items).toHaveLength(1);
    expect(endMarker(items)).toMatchObject({ complete: true });
  });

  it("leaves the real index and git status untouched", async () => {
    writeFileSync(join(repo, "dirty.txt"), "dirty\n");
    const indexBefore = readFileSync(join(repo, ".git", "index"));
    const statusBefore = git(repo, "status", "--porcelain");
    await recorder.begin("a", repo);
    writeFileSync(join(repo, "tracked.txt"), "changed\n");
    await recorder.finish("a", "turn");
    writeFileSync(join(repo, "tracked.txt"), "one\ntwo\n");
    expect(readFileSync(join(repo, ".git", "index")).equals(indexBefore)).toBe(true);
    expect(git(repo, "status", "--porcelain")).toBe(statusBefore);
  });

  it("records overlapping captures and flags both as shared", async () => {
    await recorder.begin("a", repo);
    await recorder.begin("b", repo);
    writeFileSync(join(repo, "tracked.txt"), "one\nthree\n");
    const a = await recorder.finish("a", "turn-a");
    const b = await recorder.finish("b", "turn-b");
    for (const items of [a, b]) {
      expect(edits(items)).toHaveLength(1);
      expect(endMarker(items)).toMatchObject({ shared: true, complete: true });
    }
  });

  it("does not cap concurrent captures", async () => {
    for (let i = 0; i < 6; i++) await recorder.begin(`agent-${i}`, repo);
    writeFileSync(join(repo, "tracked.txt"), "z\n");
    for (let i = 0; i < 6; i++) {
      expect(edits(await recorder.finish(`agent-${i}`, "t"))).toHaveLength(1);
    }
  });

  it("returns nothing outside a Git repository", async () => {
    const plain = join(base, "plain");
    mkdirSync(plain);
    await recorder.begin("a", plain);
    writeFileSync(join(plain, "f.txt"), "x\n");
    expect(await recorder.finish("a", "turn")).toEqual([]);
  });
});
