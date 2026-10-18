import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import { orderAutocompleteOptions } from "@/components/ui/autocomplete-utils";
import { useAgentProfiles } from "./use-agent-profiles";
import { filterProfileReferences, findActiveProfileMention } from "../profile-reference";

export interface ProfileReferenceOption extends AutocompleteOption {
  type: "agent_profile";
  profile: AgentProfile;
  serverId: string;
}

interface ProfileReferenceAutocompleteInput {
  userInput: string;
  cursorIndex: number;
  serverId: string;
  setUserInput: (text: string) => void;
  onProfileSelected?: (profile: AgentProfile) => void;
  onAutocompleteApplied?: () => void;
}

interface InputSnapshot {
  text: string;
  selection: { start: number; end: number };
}

export function useProfileReferenceAutocomplete(input: ProfileReferenceAutocompleteInput) {
  const { t } = useTranslation();
  const state = useAgentProfiles(input.serverId);
  const mention = findActiveProfileMention({
    text: input.userInput,
    cursorIndex: input.cursorIndex,
  });
  const isVisible = mention !== null && Boolean(input.onProfileSelected) && state.isSupported;
  const query = mention?.query ?? "";
  const options = useMemo<ProfileReferenceOption[]>(() => {
    const matches = filterProfileReferences(state.profiles ?? [], query);
    return orderAutocompleteOptions(matches).map((profile) => ({
      type: "agent_profile",
      id: `profile:${profile.id}`,
      label: `@@${profile.name}`,
      detail: [profile.provider, profile.model].filter(Boolean).join(" · "),
      description: profile.notes,
      kind: "agent_profile",
      profile,
      serverId: input.serverId,
    }));
  }, [state.profiles, query, input.serverId]);
  const {
    userInput,
    cursorIndex,
    serverId,
    setUserInput,
    onProfileSelected,
    onAutocompleteApplied,
  } = input;
  const select = useCallback(
    (option: ProfileReferenceOption, snapshot?: InputSnapshot) => {
      const text = snapshot?.text ?? userInput;
      const active = findActiveProfileMention({
        text,
        cursorIndex: snapshot?.selection.start ?? cursorIndex,
      });
      if (!active || option.serverId !== serverId || !onProfileSelected) return;
      onProfileSelected(option.profile);
      setUserInput(text.slice(0, active.start) + text.slice(active.end));
      onAutocompleteApplied?.();
    },
    [userInput, cursorIndex, serverId, setUserInput, onProfileSelected, onAutocompleteApplied],
  );
  const errorMessage = state.error ? t("agentAutocomplete.failedToLoad") : undefined;
  return {
    isVisible,
    options,
    query,
    select,
    presentation: {
      isLoading: state.isLoading,
      errorMessage,
      loadingText: t("agentAutocomplete.loadingProfiles"),
      emptyText: t("agentAutocomplete.noProfiles"),
    },
  };
}
