import { formatInlineReference } from "@/attachments/inline-reference";
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
import { useProviderSubagentStore, refreshProviderSubagents } from "@/subagents/provider-store";
import { useSessionStore } from "@/stores/session-store";
import {
  findActiveSessionMention,
  providerSubagentReferences,
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
  setUserInput: (text: string, selection?: { start: number; end: number }) => void;
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
  const providerSupported = useSessionStore(
    (state) => state.sessions[input.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const descriptors = useProviderSubagentStore((state) => state.descriptors);
  const hidden = useProviderSubagentStore((state) => state.hiddenFromTrack);
  useEffect(() => {
    if (!isVisible || !isConnected || !client || !providerSupported) return;
    const projectId = workspaces?.get(input.workspaceId ?? "")?.projectId;
    const parents = [...(agents?.values() ?? [])].filter(
      (agent) =>
        !agent.archivedAt &&
        (scope === "all" ||
          (projectId !== undefined &&
            workspaces?.get(agent.workspaceId ?? "")?.projectId === projectId)),
    );
    let cancelled = false;
    let next = 0;
    const refresh = async () => {
      while (next < parents.length) {
        if (cancelled) return;
        const parent = parents[next++];
        if (parent)
          await refreshProviderSubagents(client, input.serverId, parent.id).catch(() => undefined);
      }
    };
    void Promise.allSettled(Array.from({ length: Math.min(3, parents.length) }, refresh));
    return () => {
      cancelled = true;
    };
  }, [
    isVisible,
    isConnected,
    client,
    providerSupported,
    agents,
    workspaces,
    scope,
    input.serverId,
    input.workspaceId,
  ]);
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
    if (providerSupported && agents)
      entries.push(
        ...providerSubagentReferences({ serverId: input.serverId, agents, descriptors, hidden }),
      );
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
      detail: (reference.subagentId ?? reference.id).slice(0, 8),
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
    providerSupported,
    descriptors,
    hidden,
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
      const inlineMention = formatInlineReference({
        label: `#${option.reference.title}`,
        type: option.reference.referenceType,
        id: option.reference.id,
        serverId,
      });
      onSessionReferenceSelected({ ...option.reference, inlineMention });
      const insertion = `${inlineMention} `;
      const caret = active.start + insertion.length;
      setUserInput(text.slice(0, active.start) + insertion + text.slice(active.end), {
        start: caret,
        end: caret,
      });
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
    trigger: mention ? { start: mention.start, prefix: "##" } : null,
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
