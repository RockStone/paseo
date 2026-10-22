import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useScriptConfig } from "./script-config";
import { groupScripts } from "./script-groups";

const scriptName = (script: WorkspaceDescriptor["scripts"][number]) => script.scriptName;

export function ScriptScopeRows({
  serverId,
  configRoot,
  scripts,
  children,
}: {
  serverId: string;
  configRoot: string;
  scripts: WorkspaceDescriptor["scripts"];
  children: (script: WorkspaceDescriptor["scripts"][number]) => ReactNode;
}) {
  const { t } = useTranslation();
  const config = useScriptConfig(serverId, configRoot);
  const { refetch } = config;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  if (config.isPending) return <DropdownMenuItem disabled>{t("common.loading")}</DropdownMenuItem>;
  if (config.isError || !config.data?.ok)
    return (
      <>
        <DropdownMenuItem disabled>
          {t("settings.project.readFailures.failedTitle")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={retry}
          closeOnSelect={false}
          disabled={config.isFetching}
          testID="workspace-script-groups-retry"
        >
          {t(config.isFetching ? "common.loading" : "common.retry")}
        </DropdownMenuItem>
      </>
    );
  const groups = groupScripts(scripts, scriptName, config.data.sharedScriptNames);
  return (
    <>
      {groups.shared.map(children)}
      {groups.shared.length > 0 && groups.workspace.length > 0 ? (
        <DropdownMenuSeparator testID="workspace-scripts-scope-divider" />
      ) : null}
      {groups.workspace.map(children)}
    </>
  );
}
