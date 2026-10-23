import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
  type PropsWithChildren,
} from "react";
import { create } from "zustand";

export const transcriptDisplayKey = (serverId: string, agentId: string) => `${serverId}:${agentId}`;

type Sections = Record<string, { expanded: boolean; thinking: boolean }>;

interface SectionExpansionState {
  thinkingExpanded: Record<string, boolean>;
  sections: Record<string, Sections>;
  revision: Record<string, number>;
  toggle: (key: string, defaultExpanded: boolean) => void;
  register: (key: string, section: string, defaultExpanded: boolean, thinking?: boolean) => void;
  setSection: (
    key: string,
    section: string,
    defaultExpanded: boolean,
    value: SetStateAction<boolean>,
    thinking?: boolean,
  ) => void;
}

export function hasExpandedSections(
  state: SectionExpansionState,
  key: string,
  fallback: boolean,
): boolean {
  const values = Object.values(state.sections[key] ?? {});
  return values.length > 0
    ? values.some((section) => section.expanded)
    : (state.thinkingExpanded[key] ?? fallback);
}

function sectionDefault(
  state: SectionExpansionState,
  key: string,
  fallback: boolean,
  thinking: boolean,
): boolean {
  if (thinking) return state.thinkingExpanded[key] ?? fallback;
  return state.revision[key] ? false : fallback;
}

export const useSectionExpansionStore = create<SectionExpansionState>((set) => ({
  thinkingExpanded: {},
  sections: {},
  revision: {},
  toggle: (key, defaultExpanded) =>
    set((state) => {
      const expanded = !hasExpandedSections(state, key, defaultExpanded);
      return {
        thinkingExpanded: { ...state.thinkingExpanded, [key]: expanded },
        sections: {
          ...state.sections,
          [key]: Object.fromEntries(
            Object.entries(state.sections[key] ?? {}).map(([id, section]) => [
              id,
              { ...section, expanded: expanded && section.thinking },
            ]),
          ),
        },
        revision: { ...state.revision, [key]: (state.revision[key] ?? 0) + 1 },
      };
    }),
  register: (key, section, defaultExpanded, thinking = false) =>
    set((state) => {
      if (state.sections[key]?.[section] !== undefined) return state;
      return {
        sections: {
          ...state.sections,
          [key]: {
            ...state.sections[key],
            [section]: {
              expanded: sectionDefault(state, key, defaultExpanded, thinking),
              thinking,
            },
          },
        },
      };
    }),
  setSection: (key, section, defaultExpanded, value, thinking = false) =>
    set((state) => {
      const previous =
        state.sections[key]?.[section]?.expanded ??
        sectionDefault(state, key, defaultExpanded, thinking);
      const expanded = typeof value === "function" ? value(previous) : value;
      if (state.sections[key]?.[section]?.expanded === expanded) return state;
      return {
        sections: {
          ...state.sections,
          [key]: { ...state.sections[key], [section]: { expanded, thinking } },
        },
      };
    }),
}));

const Scope = createContext<{ displayKey: string; itemId: string } | null>(null);

export function TranscriptExpansionScope({
  displayKey,
  itemId,
  children,
}: PropsWithChildren<{ displayKey: string; itemId: string }>) {
  const value = useMemo(() => ({ displayKey, itemId }), [displayKey, itemId]);
  return <Scope value={value}>{children}</Scope>;
}

export function useTranscriptSectionExpanded(
  defaultExpanded: boolean,
  section: string,
  enabled = true,
  thinking = false,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const scope = useContext(Scope);
  const key = enabled ? scope?.displayKey : undefined;
  const id = `${scope?.itemId}:${section}`;
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const expanded = useSectionExpansionStore((state) =>
    key
      ? (state.sections[key]?.[id]?.expanded ??
        sectionDefault(state, key, defaultExpanded, thinking))
      : localExpanded,
  );
  useEffect(() => {
    if (key) useSectionExpansionStore.getState().register(key, id, defaultExpanded, thinking);
  }, [key, id, defaultExpanded, thinking]);
  const setExpanded = useCallback<Dispatch<SetStateAction<boolean>>>(
    (value) => {
      if (key)
        useSectionExpansionStore.getState().setSection(key, id, defaultExpanded, value, thinking);
      else setLocalExpanded(value);
    },
    [key, id, defaultExpanded, thinking],
  );
  return [expanded, setExpanded];
}
