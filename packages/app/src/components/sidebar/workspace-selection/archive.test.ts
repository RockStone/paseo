import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS } from "@/git/worktree-archive-warning";
import {
  buildBulkArchiveConfirmation,
  resolveBulkArchiveCandidates,
  type BulkArchiveCandidate,
  type BulkArchiveSource,
} from "./archive";

function entry(
  name: string,
  overrides: Partial<BulkArchiveSource> = {},
): [string, BulkArchiveSource] {
  return [
    `server:${name}`,
    {
      serverId: "server",
      workspaceId: name,
      name,
      workspaceKind: "worktree",
      archiveHasUncommittedChanges: false,
      archiveUnpushedCommitCount: 0,
      diffStat: null,
      ...overrides,
    },
  ];
}

function candidate(name: string, riskReasons: string[] = []): BulkArchiveCandidate {
  return { key: `server:${name}`, serverId: "server", workspaceId: name, name, riskReasons };
}

const t = i18n.t.bind(i18n);

describe("resolveBulkArchiveCandidates", () => {
  it("skips selected keys whose workspace is gone", () => {
    const candidates = resolveBulkArchiveCandidates({
      selected: new Set(["server:a", "server:gone"]),
      entries: new Map([entry("a")]),
      warningLabels: DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
    });
    expect(candidates.map((item) => item.workspaceId)).toEqual(["a"]);
  });

  it("gives worktrees the single archive's warnings and local checkouts none", () => {
    const candidates = resolveBulkArchiveCandidates({
      selected: new Set(["server:dirty", "server:local"]),
      entries: new Map([
        entry("dirty", {
          archiveHasUncommittedChanges: true,
          archiveUnpushedCommitCount: 2,
          diffStat: { additions: 3, deletions: 0 },
        }),
        entry("local", { workspaceKind: "local_checkout", archiveHasUncommittedChanges: true }),
      ]),
      warningLabels: DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
    });
    expect(candidates).toEqual([
      expect.objectContaining({
        workspaceId: "dirty",
        riskReasons: ["Uncommitted changes (3 added lines)", "2 unpushed commits"],
      }),
      expect.objectContaining({ workspaceId: "local", riskReasons: [] }),
    ]);
  });
});

describe("buildBulkArchiveConfirmation", () => {
  it("summarizes the count and lists every workspace", () => {
    const confirmation = buildBulkArchiveConfirmation({
      candidates: [candidate("alpha"), candidate("beta")],
      t,
    });
    expect(confirmation.title).toBe("Archive selected workspaces (2)?");
    expect(confirmation.message).toBe("alpha\nbeta");
  });

  it("lists workspaces with something to lose first, with their reasons", () => {
    const confirmation = buildBulkArchiveConfirmation({
      candidates: [candidate("clean"), candidate("dirty", ["Uncommitted changes"])],
      t,
    });
    expect(confirmation.message).toBe("dirty: Uncommitted changes\nclean");
  });

  it("counts the workspaces past the list limit instead of naming them", () => {
    const names = Array.from({ length: 10 }, (_, index) => `ws-${index}`);
    const confirmation = buildBulkArchiveConfirmation({
      candidates: names.map((name) => candidate(name)),
      t,
    });
    const lines = confirmation.message.split("\n");
    expect(lines).toHaveLength(9);
    expect(lines.at(-1)).toBe("+2 more");
  });
});
