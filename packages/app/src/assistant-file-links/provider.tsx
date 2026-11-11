import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";
import React from "react";
import type { ToastApi } from "@/components/toast-host";
import type { OpenFileDisposition } from "@/workspace/file-open";
import type { InlinePathTarget } from "./parse";
import type { AssistantFileLinkContext, GetDirectorySuggestions } from "./resolver";

export interface AssistantFileLinkDaemonClient {
  readFile?: import("@getpaseo/client/internal/daemon-client").DaemonClient["readFile"];
  getDirectorySuggestions: GetDirectorySuggestions;
}

export interface AssistantFileLinkResolverConfig {
  client?: AssistantFileLinkDaemonClient | null;
  serverId?: string;
  workspaceRoot?: string;
  relativePathBase?: string;
  onOpenWorkspaceFile?: (target: InlinePathTarget, disposition: OpenFileDisposition) => void;
  /**
   * Paseoi: opens a web URL inside Paseoi (a browser tab in the side pane). Returns false when it
   * cannot, and the caller falls back to the default browser (or, for images, the lightbox).
   */
  onOpenUrlInApp?: (url: string) => boolean;
  toast?: ToastApi | null;
}

export interface AssistantFileLinkResolverProviderProps extends AssistantFileLinkResolverConfig {
  children: ReactNode;
}

export interface AssistantFileLinkResolverContextValue {
  configRef: MutableRefObject<AssistantFileLinkResolverConfig>;
  getDirectorySuggestions: GetDirectorySuggestions;
}

const AssistantFileLinkResolverContext =
  createContext<AssistantFileLinkResolverContextValue | null>(null);

export function useAssistantFileLinkEnvironmentBridge() {
  const value = useContext(AssistantFileLinkResolverContext);
  return useCallback(
    (children: ReactNode) => (
      <AssistantFileLinkResolverContext.Provider value={value}>
        {children}
      </AssistantFileLinkResolverContext.Provider>
    ),
    [value],
  );
}

export function AssistantFileLinkResolverProvider({
  client,
  serverId,
  workspaceRoot,
  relativePathBase,
  onOpenWorkspaceFile,
  onOpenUrlInApp,
  toast,
  children,
}: AssistantFileLinkResolverProviderProps) {
  // A nested provider (an agent stream, a user message, a markdown preview) keeps the workspace's
  // in-app URL opener unless it brings its own.
  const parent = useContext(AssistantFileLinkResolverContext);
  const inheritedOpenUrlInApp = useCallback(
    (url: string) => parent?.configRef.current.onOpenUrlInApp?.(url) === true,
    [parent],
  );
  onOpenUrlInApp ??= parent ? inheritedOpenUrlInApp : undefined;
  const configRef = useRef<AssistantFileLinkResolverConfig>({
    client,
    serverId,
    workspaceRoot,
    relativePathBase,
    onOpenWorkspaceFile,
    onOpenUrlInApp,
    toast,
  });
  configRef.current = {
    client,
    serverId,
    workspaceRoot,
    relativePathBase,
    onOpenWorkspaceFile,
    onOpenUrlInApp,
    toast,
  };

  const getDirectorySuggestions = useCallback<GetDirectorySuggestions>(async (input) => {
    const activeClient = configRef.current.client;
    if (!activeClient) {
      return { entries: [], error: null };
    }

    const result = await activeClient.getDirectorySuggestions(input);
    return { entries: result.entries, error: result.error };
  }, []);

  const value = useMemo<AssistantFileLinkResolverContextValue>(
    () => ({ configRef, getDirectorySuggestions }),
    [getDirectorySuggestions],
  );

  return (
    <AssistantFileLinkResolverContext.Provider value={value}>
      {children}
    </AssistantFileLinkResolverContext.Provider>
  );
}

export function useAssistantFileLinkResolverContext(): AssistantFileLinkResolverContextValue {
  const context = useContext(AssistantFileLinkResolverContext);
  return context ?? EMPTY_CONTEXT;
}

export type { AssistantFileLinkContext };

const EMPTY_CONTEXT: AssistantFileLinkResolverContextValue = {
  configRef: { current: {} },
  getDirectorySuggestions: async () => ({ entries: [], error: null }),
};

export function useAssistantFileLinkEnvironment() {
  return useAssistantFileLinkResolverContext().configRef.current;
}
