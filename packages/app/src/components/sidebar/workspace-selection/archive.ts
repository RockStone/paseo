import type { TFunction } from "i18next";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  buildWorktreeArchiveRiskReasons,
  toWorktreeArchiveRisk,
  type WorktreeArchiveWarningLabels,
} from "@/git/worktree-archive-warning";
import type { WorkspaceArchiveTarget } from "@/workspace/workspace-archive";

export const BULK_ARCHIVE_CONCURRENCY = 3;

/** Past this many names the dialog stops listing and counts the rest. */
const CONFIRM_LIST_LIMIT = 8;

export interface BulkArchiveCandidate extends WorkspaceArchiveTarget {
  key: string;
  name: string;
  /** What the single archive would warn about. Only worktrees warn, as they do there. */
  riskReasons: string[];
}

/** The parts of a sidebar row the batch reads. */
export type BulkArchiveSource = Pick<
  SidebarWorkspaceEntry,
  | "serverId"
  | "workspaceId"
  | "name"
  | "workspaceKind"
  | "archiveHasUncommittedChanges"
  | "archiveUnpushedCommitCount"
  | "diffStat"
>;

export interface BulkArchiveConfirmation {
  title: string;
  message: string;
}

/** Resolves selected keys against the rows that still exist; anything archived elsewhere drops. */
export function resolveBulkArchiveCandidates(input: {
  selected: ReadonlySet<string>;
  entries: ReadonlyMap<string, BulkArchiveSource>;
  warningLabels: WorktreeArchiveWarningLabels;
}): BulkArchiveCandidate[] {
  const candidates: BulkArchiveCandidate[] = [];
  for (const key of input.selected) {
    const entry = input.entries.get(key);
    if (!entry) continue;
    const riskReasons =
      entry.workspaceKind === "worktree"
        ? buildWorktreeArchiveRiskReasons(toWorktreeArchiveRisk(entry), input.warningLabels)
        : [];
    candidates.push({
      key,
      serverId: entry.serverId,
      workspaceId: entry.workspaceId,
      name: entry.name,
      riskReasons,
    });
  }
  return candidates;
}

/**
 * One dialog for the whole batch. Workspaces with something to lose are listed first with the
 * same reasons the single archive gives, so a long selection cannot push a warning off the end.
 */
export function buildBulkArchiveConfirmation(input: {
  candidates: readonly BulkArchiveCandidate[];
  t: TFunction;
}): BulkArchiveConfirmation {
  const { candidates, t } = input;
  const risky = candidates.filter((candidate) => candidate.riskReasons.length > 0);
  const clean = candidates.filter((candidate) => candidate.riskReasons.length === 0);
  const ordered = [...risky, ...clean];
  const listed = ordered.slice(0, CONFIRM_LIST_LIMIT).map((candidate) =>
    candidate.riskReasons.length > 0
      ? t("sidebar.workspace.selection.confirmRiskLine", {
          name: candidate.name,
          reasons: candidate.riskReasons.join(", "),
        })
      : candidate.name,
  );
  const hidden = ordered.length - listed.length;
  const lines =
    hidden > 0 ? [...listed, t("sidebar.workspace.selection.more", { count: hidden })] : listed;
  return {
    title: t("sidebar.workspace.selection.confirmTitle", { count: candidates.length }),
    message: lines.join("\n"),
  };
}
