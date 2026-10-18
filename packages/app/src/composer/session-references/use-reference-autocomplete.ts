import { useCallback } from "react";
import { useProfileReferenceAutocomplete, type ProfileReferenceOption } from "@/agent-profiles";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import {
  useSessionReferenceAutocomplete,
  type SessionReferenceAutocompleteInput,
  type SessionReferenceOption,
  type ReferenceInputSnapshot,
} from "./use-session-reference-autocomplete";

export type ComposerReferenceOption = ProfileReferenceOption | SessionReferenceOption;

export function isComposerReferenceOption(
  option: AutocompleteOption,
): option is ComposerReferenceOption {
  return (
    "type" in option && (option.type === "agent_profile" || option.type === "session_reference")
  );
}

interface ComposerReferenceAutocompleteInput extends SessionReferenceAutocompleteInput {
  onProfileSelected?: (profile: AgentProfile, inlineMention?: string) => void;
}

export function useComposerReferenceAutocomplete(input: ComposerReferenceAutocompleteInput) {
  const profiles = useProfileReferenceAutocomplete(input);
  const sessions = useSessionReferenceAutocomplete(input);
  const selectProfile = profiles.select;
  const selectSession = sessions.select;
  const select = useCallback(
    (option: ComposerReferenceOption, snapshot?: ReferenceInputSnapshot) => {
      if (option.type === "agent_profile") selectProfile(option, snapshot);
      else selectSession(option, snapshot);
    },
    [selectProfile, selectSession],
  );
  const active = sessions.isVisible ? sessions : profiles;
  return { ...active, select, header: sessions.isVisible ? sessions.header : undefined };
}
