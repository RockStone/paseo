import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchQueryOptions } from "@/data/query";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { ScriptEditModal } from "@/components/project-script-edit-modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ActivityIndicator } from "react-native";
import { useToast } from "@/contexts/toast-context";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { openScriptEditForm } from "./script-edit-form";

interface ScriptEditorProps {
  serverId: string;
  configRoot: string;
  scriptName: string | null;
  onClose: () => void;
  shared: boolean;
  supportsShared: boolean;
}

function ScriptEditor({
  serverId,
  configRoot,
  scriptName,
  onClose,
  shared,
  supportsShared,
}: ScriptEditorProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const queries = useQueryClient();
  const toast = useToast();
  const resolvedRoot = useRef(new Map<boolean, string>());
  const [model] = useState(() =>
    openScriptEditForm({
      scriptName,
      shared,
      read: async (requestedShared = false) => {
        if (!client) throw new Error("Host disconnected");
        const fetch = (root: string) =>
          queries.fetchQuery(
            fetchQueryOptions({
              queryKey: ["project-config", serverId, root],
              dataShape: "value",
              staleTimeMs: 0,
              queryFn: () => client.readProjectConfig(root),
            }),
          );
        const resolved = resolvedRoot.current.get(requestedShared);
        if (resolved) return fetch(resolved);
        const project = await fetch(configRoot);
        if (!project.ok) return project;
        const root = project.sharedScriptsRoot;
        const inherited =
          scriptName !== null && !Object.hasOwn(project.config?.scripts ?? {}, scriptName);
        if (requestedShared && !root) throw new Error("Host does not support shared commands");
        const targetRoot = (requestedShared || inherited) && root ? root : project.repoRoot;
        resolvedRoot.current.set(requestedShared, targetRoot);
        if (targetRoot !== project.repoRoot) return fetch(targetRoot);
        return project;
      },
      write: (input) => {
        if (!client) throw new Error("Host disconnected");
        return client.writeProjectConfig(input);
      },
      saved: () => {
        void queries.invalidateQueries({ queryKey: ["project-config", serverId] });
        void queries.invalidateQueries({ queryKey: ["project-script-options", serverId] });
        void getHostRuntimeStore()
          .refreshWorkspaceDirectory({ serverId })
          .catch(() => undefined);
        toast.show(t("settings.project.actions.saved"), { variant: "success" });
        onClose();
      },
    }),
  );
  useEffect(() => {
    void model.load();
    return model.close;
  }, [model]);
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const reload = useCallback(() => {
    const current = model.getState();
    void model.load(current.status === "scope-error");
  }, [model]);
  const save = useCallback(() => {
    void model.save();
  }, [model]);
  const title = useMemo(
    () => ({
      title: scriptName
        ? t("settings.project.scripts.editScript", { name: scriptName })
        : t("settings.project.scripts.newScript"),
    }),
    [scriptName, t],
  );
  if (state.status === "loading") {
    return (
      <AdaptiveModalSheet visible header={title} onClose={onClose} testID="script-editor-loading">
        <ActivityIndicator />
      </AdaptiveModalSheet>
    );
  }
  let error = null;
  if (state.error) {
    const readFailed = state.status === "load-error" || state.status === "scope-error";
    let description = t("settings.project.writeFailures.failedDescription");
    if (state.error === "stale_project_config")
      description = t("settings.project.writeFailures.staleDescription");
    if (state.error === "duplicate_script") description = t("settings.project.scripts.nameExists");
    if (readFailed) description = t("settings.project.readFailures.failedDescription");
    const needsReload = readFailed || state.error === "stale_project_config";
    const recover = needsReload ? reload : save;
    error = (
      <Alert
        testID="script-editor-error"
        variant="error"
        title={t(
          readFailed
            ? "settings.project.readFailures.failedTitle"
            : "settings.project.writeFailures.failedTitle",
        )}
        description={description}
      >
        <Button onPress={recover} size="sm" variant="outline" testID="script-editor-reload">
          {t(needsReload ? "settings.project.actions.reload" : "common.retry")}
        </Button>
      </Alert>
    );
  }
  if (state.status === "load-error") {
    return (
      <AdaptiveModalSheet
        visible
        header={title}
        onClose={onClose}
        testID="script-editor-load-error"
      >
        {error}
      </AdaptiveModalSheet>
    );
  }
  return (
    <ScriptEditModal
      script={state.draft}
      onChange={model.change}
      onCancel={onClose}
      onSave={save}
      pending={state.status === "saving" || state.status === "loading-scope"}
      saveDisabled={state.error === "stale_project_config" || state.status === "scope-error"}
      error={error}
      headerTitle={title.title}
      scopeLabel={
        scriptName !== null && model.isShared()
          ? t("settings.project.scripts.sharedScope")
          : undefined
      }
      shared={model.isShared()}
      onSharedChange={scriptName === null && supportsShared ? model.setShared : undefined}
    />
  );
}

export function useScriptEditor(serverId: string, configRoot: string) {
  const [editing, setEditing] = useState<{ name: string | null; shared: boolean } | null>(null);
  const toast = useToast();
  const { t } = useTranslation();
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.sharedCommands === true,
  );
  const open = useCallback(
    (name: string | null, shared = false) => {
      // COMPAT(sharedCommands): added in v0.12.0-paseoi.81; remove after 2027-04-21 once the host floor includes it.
      if (shared && !supported) {
        toast.show(t("settings.project.scripts.updateHost"), { variant: "error" });
        return;
      }
      setEditing({ name, shared });
    },
    [supported, toast, t],
  );
  const close = useCallback(() => setEditing(null), []);
  const editor = editing ? (
    <ScriptEditor
      key={`${serverId}:${configRoot}:${editing.name}:${editing.shared}`}
      serverId={serverId}
      configRoot={configRoot}
      scriptName={editing.name}
      shared={editing.shared}
      supportsShared={supported}
      onClose={close}
    />
  ) : null;
  return { open, editor };
}
