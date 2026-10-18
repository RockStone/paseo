import { SessionReferenceScopeFilter, type SessionReferenceScope } from "./scope-filter";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import { orderAutocompleteOptions } from "@/components/ui/autocomplete-utils";
import { useFetchQuery } from "@/data/query";
import {
  getHostRuntimeStore,
  useHostRuntimeSnapshot,
  isHostRuntimeDirectoryLoading,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  findActiveSessionMention,
  filterSessionReferences,
  sessionReferencesInCurrentProject,
  type SessionReferenceAttachment,
} from "@/attachments/session-reference";

export interface SessionReferenceOption extends AutocompleteOption {
  type: "session_reference";
  reference: SessionReferenceAttachment;
}

export interface SessionReferenceAutocompleteInput {
  userInput: string;
  cursorIndex: number;
  serverId: string;
  agentId: string;
  workspaceId?: string;
  sessionReferencesEnabled?: boolean;
  setUserInput: (text: string) => void;
  onSessionReferenceSelected?: (reference: SessionReferenceAttachment) => void;
  onAutocompleteApplied?: () => void;
}

export interface ReferenceInputSnapshot {
  text: string;
  selection: { start: number; end: number };
}

export function useSessionReferenceAutocomplete(input: SessionReferenceAutocompleteInput) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<SessionReferenceScope>("current");
  const onApplied = input.onAutocompleteApplied;
  const changeScope = useCallback(
    (next: SessionReferenceScope) => {
      setScope(next);
      onApplied?.();
    },
    [onApplied],
  );
  const header = useMemo(
    () => <SessionReferenceScopeFilter scope={scope} onChange={changeScope} />,
    [scope, changeScope],
  );
  const mention = findActiveSessionMention({
    text: input.userInput,
    cursorIndex: input.cursorIndex,
  });
  const isVisible =
    mention !== null &&
    Boolean(input.onSessionReferenceSelected) &&
    input.sessionReferencesEnabled !== false;
  const snapshot = useHostRuntimeSnapshot(input.serverId);
  const client = snapshot?.client;
  const isConnected = snapshot?.connectionStatus === "online";
  const runtime = getHostRuntimeStore();
  useEffect(() => {
    if (!isVisible) return;
    return runtime.acquireDirectoryDemand(input.serverId);
  }, [isVisible, runtime, input.serverId]);
  const agents = useSessionStore((state) => state.sessions[input.serverId]?.agents);
  const workspaces = useSessionStore((state) => state.sessions[input.serverId]?.workspaces);
  const terminals = useFetchQuery({
    queryKey: ["composer-session-terminals", input.serverId],
    enabled: isVisible && isConnected && Boolean(client),
    dataShape: "value",
    staleTimeMs: 0,
    retry: false,
    refetchInterval: isVisible ? 5000 : false,
    queryFn: async () => {
      if (!client) throw new Error(t("sessionReference.disconnected"));
      return await client.listTerminals();
    },
  });
  let errorMessage: string | undefined;
  if (!isConnected) errorMessage = t("sessionReference.disconnected");
  else if (terminals.error || snapshot?.agentDirectoryError)
    errorMessage = t("sessionReference.loadFailed");
  const isLoading = isConnected && (terminals.isLoading || isHostRuntimeDirectoryLoading(snapshot));
  const query = mention?.query ?? "";
  const options = useMemo<SessionReferenceOption[]>(() => {
    if (!isVisible || isLoading || errorMessage) return [];
    const entries: SessionReferenceAttachment[] = [];
    for (const terminal of terminals.data?.terminals ?? []) {
      entries.push({
        kind: "session_reference",
        serverId: input.serverId,
        referenceType: "terminal",
        id: terminal.id,
        title: terminal.title?.trim() || terminal.name,
        cwd: terminal.cwd ?? "",
        workspaceId: terminal.workspaceId,
      });
    }
    for (const agent of agents?.values() ?? []) {
      if (agent.id === input.agentId || agent.archivedAt) continue;
      entries.push({
        kind: "session_reference",
        serverId: input.serverId,
        referenceType: "thread",
        id: agent.id,
        title: agent.title ?? agent.id,
        cwd: agent.cwd,
        workspaceId: agent.workspaceId,
      });
    }
    const scopedEntries =
      scope === "current"
        ? sessionReferencesInCurrentProject({
            entries,
            workspaces: workspaces ?? new Map(),
            workspaceId: input.workspaceId,
          })
        : entries;
    const matches = filterSessionReferences({
      entries: scopedEntries,
      query,
      workspaceId: input.workspaceId,
    });
    return orderAutocompleteOptions(matches).map((reference) => ({
      type: "session_reference",
      id: `session:${reference.referenceType}:${reference.id}`,
      label: `${t(`sessionReference.${reference.referenceType}`)} · ${reference.title}`,
      detail: reference.id.slice(0, 8),
      description: reference.cwd,
      kind: reference.referenceType,
      reference,
    }));
  }, [
    isVisible,
    isLoading,
    errorMessage,
    terminals.data,
    agents,
    workspaces,
    scope,
    input.serverId,
    input.agentId,
    input.workspaceId,
    query,
    t,
  ]);
  const {
    userInput,
    cursorIndex,
    serverId,
    setUserInput,
    onSessionReferenceSelected,
    onAutocompleteApplied,
  } = input;
  const select = useCallback(
    (option: SessionReferenceOption, current?: ReferenceInputSnapshot) => {
      const text = current?.text ?? userInput;
      const active = findActiveSessionMention({
        text,
        cursorIndex: current?.selection.start ?? cursorIndex,
      });
      if (
        !active ||
        option.reference.serverId !== serverId ||
        !isConnected ||
        !onSessionReferenceSelected
      )
        return;
      onSessionReferenceSelected(option.reference);
      setUserInput(text.slice(0, active.start) + text.slice(active.end));
      onAutocompleteApplied?.();
    },
    [
      userInput,
      cursorIndex,
      serverId,
      setUserInput,
      onSessionReferenceSelected,
      onAutocompleteApplied,
      isConnected,
    ],
  );
  return {
    isVisible,
    options,
    query: `${scope}\0${query}`,
    header,
    select,
    presentation: {
      isLoading,
      errorMessage,
      loadingText: t("sessionReference.loading"),
      emptyText: t(
        scope === "current" ? "sessionReference.emptyCurrent" : "sessionReference.empty",
      ),
    },
  };
}
