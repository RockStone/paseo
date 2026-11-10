import type { NotesSummary } from "./notes";

/** Header button label: the unseen agent-note count, or undefined for an icon-only button. */
export function unseenLabelFor(
  summary: NotesSummary["workspaces"],
  workspaceId: string,
): string | undefined {
  const unseen = summary[workspaceId]?.unseen ?? 0;
  if (unseen === 0) return undefined;
  return unseen > 99 ? "99+" : String(unseen);
}
