import { create } from "zustand";

export const thinkingDisplayKey = (serverId: string, agentId: string) => `${serverId}:${agentId}`;

export const useThinkingDisplayStore = create<{
  expanded: Record<string, boolean>;
  toggle: (key: string, defaultExpanded: boolean) => void;
}>((set) => ({
  expanded: {},
  toggle: (key, defaultExpanded) =>
    set((state) => ({
      expanded: { ...state.expanded, [key]: !(state.expanded[key] ?? defaultExpanded) },
    })),
}));
