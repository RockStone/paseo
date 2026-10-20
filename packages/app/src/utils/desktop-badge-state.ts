import type { WorkspaceDescriptor } from "@/stores/session-store";

export type DesktopBadgeWorkspaceStatus = WorkspaceDescriptor["status"];

export function isWorkspaceActionableForDesktopBadge(status: DesktopBadgeWorkspaceStatus): boolean {
  return status === "attention" || status === "needs_input" || status === "failed";
}

export function deriveMacDockBadgeCountFromWorkspaceStatuses(
  statuses: readonly DesktopBadgeWorkspaceStatus[],
): number {
  const actionableCount = statuses.filter(isWorkspaceActionableForDesktopBadge).length;
  // An explicit zero clears a badge retained by macOS, including on the first render.
  return actionableCount;
}
