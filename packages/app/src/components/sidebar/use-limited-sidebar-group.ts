import { useCallback, useEffect, useMemo, useState } from "react";
import {
  selectSidebarGroupVisibility,
  type SidebarGroupItem,
  type SidebarGroupVisibility,
  type SidebarGroupVisibilityPolicy,
} from "./sidebar-group-visibility";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";

import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import { useProviderSubagentStore } from "@/subagents/provider-store";
import { selectRecentWorkspaceKeys } from "@/utils/workspace-agent-activity";
import { subscribeToRelativeTimeTick } from "@/utils/relative-time-ticker";

const EMPTY_RECENT_KEYS: string[] = [];
const EMPTY_DESCRIPTORS = new Map<string, { parentAgentId: string; updatedAt: string }>();
const PINNED_POLICY = { kind: "pinned" } as const;

interface LimitedSidebarGroupInput<T> {
  items: readonly T[];
  selection: ActiveWorkspaceSelection | null;
  policy?: SidebarGroupVisibilityPolicy;
}

export function useLimitedSidebarGroup<T extends SidebarGroupItem>({
  items,
  selection,
  policy = PINNED_POLICY,
}: LimitedSidebarGroupInput<T>): SidebarGroupVisibility<T> & {
  expanded: boolean;
  toggleExpanded: () => void;
} {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const providerSubagents = useProviderSubagentStore((state) =>
    policy.kind === "workspaces" ? state.descriptors : EMPTY_DESCRIPTORS,
  );
  const recentKeys = useSessionStore(
    useShallow((state) => {
      if (policy.kind !== "workspaces") return EMPTY_RECENT_KEYS;
      const recent = selectRecentWorkspaceKeys({
        sessions: state.sessions,
        activity: state.agentLastActivity,
        providerSubagents,
        now,
      });
      return items
        .filter((item) => recent.has(`${item.serverId}:${item.workspaceId}`))
        .map((item) => `${item.serverId}:${item.workspaceId}`);
    }),
  );
  useEffect(() => {
    if (policy.kind !== "workspaces") return;
    return subscribeToRelativeTimeTick("minute", () => setNow(Date.now()));
  }, [policy.kind]);
  const visibility = useMemo(
    () =>
      selectSidebarGroupVisibility({
        items,
        expanded,
        policy,
        selection,
        recentWorkspaceKeys: new Set(recentKeys),
      }),
    [expanded, items, policy, selection, recentKeys],
  );
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

  return { ...visibility, expanded, toggleExpanded };
}
