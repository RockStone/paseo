import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";

export interface SidebarGroupItem {
  serverId: string;
  workspaceId: string;
}

export interface SidebarGroupVisibilityInput<T> {
  items: readonly T[];
  expanded: boolean;
  policy: SidebarGroupVisibilityPolicy;
  recentWorkspaceKeys: ReadonlySet<string>;
  /** The workspace the group's rows highlight as selected. Null when no row can be selected. */
  selection: ActiveWorkspaceSelection | null;
}

export interface SidebarGroupVisibility<T> {
  /**
   * The open workspace when the collapsed limit would hide it. Rendered before `visibleItems`,
   * out of group order, outside any drag list. Never also present in `visibleItems`.
   */
  leadingItem: T | null;
  visibleItems: T[];
  canToggle: boolean;
}

export type SidebarGroupVisibilityPolicy =
  | { kind: "pinned"; limit?: number }
  | { kind: "workspaces" };

export const WORKSPACE_VISIBILITY_POLICY = { kind: "workspaces" } as const;

function isOpenWorkspace(
  item: SidebarGroupItem,
  selection: ActiveWorkspaceSelection | null,
): boolean {
  return (
    selection !== null &&
    item.serverId === selection.serverId &&
    item.workspaceId === selection.workspaceId
  );
}

export function selectSidebarGroupVisibility<T extends SidebarGroupItem>(
  input: SidebarGroupVisibilityInput<T>,
): SidebarGroupVisibility<T> {
  const { items, expanded, policy, selection, recentWorkspaceKeys } = input;
  const limit = policy.kind === "pinned" ? (policy.limit ?? 20) : 5;
  const baseline: T[] = [];
  let leadingItem: T | null = null;
  let canToggle = false;

  items.forEach((item, index) => {
    const recent = recentWorkspaceKeys.has(`${item.serverId}:${item.workspaceId}`);
    const inBaseline = policy.kind === "pinned" ? index < limit : recent && baseline.length < limit;
    if (inBaseline) {
      baseline.push(item);
    } else if (
      policy.kind === "pinned" &&
      leadingItem === null &&
      isOpenWorkspace(item, selection)
    ) {
      leadingItem = item;
    } else {
      canToggle = true;
    }
  });

  if (expanded || !canToggle) {
    return { leadingItem: null, visibleItems: items.slice(), canToggle };
  }

  return {
    leadingItem,
    visibleItems: baseline,
    canToggle,
  };
}
