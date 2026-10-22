import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
import { openScriptEditForm } from "./script-edit-form";

interface ScriptEditorProps {
  serverId: string;
  configRoot: string;
  scriptName: string | null;
  onClose: () => void;
}

function ScriptEditor({ serverId, configRoot, scriptName, onClose }: ScriptEditorProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const queries = useQueryClient();
  const toast = useToast();
  const [model] = useState(() =>
    openScriptEditForm({
      scriptName,
      read: () =>
        queries.fetchQuery(
          fetchQueryOptions({
            queryKey: ["project-config", serverId, configRoot],
            dataShape: "value",
            staleTimeMs: 0,
            queryFn: () => {
              if (!client) throw new Error("Host disconnected");
              return client.readProjectConfig(configRoot);
            },
          }),
        ),
      write: (input) => {
        if (!client) throw new Error("Host disconnected");
        return client.writeProjectConfig(input);
      },
      saved: (result) => {
        queries.setQueryData(["project-config", serverId, configRoot], result);
        void queries.invalidateQueries({ queryKey: ["project-config", serverId, configRoot] });
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
    void model.load();
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
    let description = t("settings.project.writeFailures.failedDescription");
    if (state.error === "stale_project_config")
      description = t("settings.project.writeFailures.staleDescription");
    if (state.error === "duplicate_script") description = t("settings.project.scripts.nameExists");
    if (state.status === "load-error")
      description = t("settings.project.readFailures.failedDescription");
    const needsReload = state.status === "load-error" || state.error === "stale_project_config";
    const recover = needsReload ? reload : save;
    error = (
      <Alert
        testID="script-editor-error"
        variant="error"
        title={t(
          state.status === "load-error"
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
      pending={state.status === "saving"}
      saveDisabled={state.error === "stale_project_config"}
      error={error}
      headerTitle={title.title}
    />
  );
}

export function useScriptEditor(serverId: string, configRoot: string) {
  const [editing, setEditing] = useState<{ name: string | null } | null>(null);
  const open = useCallback((name: string | null) => setEditing({ name }), []);
  const close = useCallback(() => setEditing(null), []);
  const editor = editing ? (
    <ScriptEditor
      key={`${serverId}:${configRoot}:${editing.name}`}
      serverId={serverId}
      configRoot={configRoot}
      scriptName={editing.name}
      onClose={close}
    />
  ) : null;
  return { open, editor };
}
