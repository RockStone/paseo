import type { PaseoScriptEntryRaw } from "@getpaseo/protocol/messages";
import { groupScripts } from "@/screens/workspace/scripts/script-groups";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useScriptConfig } from "@/screens/workspace/scripts/script-config";
import { useTranslation } from "react-i18next";
import { Globe, Play, SquareTerminal } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { ScriptEditButton } from "@/screens/workspace/scripts/script-edit-button";
import { useScriptEditor } from "@/screens/workspace/scripts/script-editor";
import {
  FieldTriggerContent,
  useFieldTriggerStyle,
  type FieldTriggerVariant,
} from "./field-trigger";

const ThemedPlay = withUnistyles(Play);
const ThemedGlobe = withUnistyles(Globe);
const ThemedTerminal = withUnistyles(SquareTerminal);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const playIcon = <ThemedPlay size={ICON_SIZE.sm} uniProps={mutedColor} />;
const serviceIcon = <ThemedGlobe size={ICON_SIZE.sm} uniProps={mutedColor} />;
const commandIcon = <ThemedTerminal size={ICON_SIZE.sm} uniProps={mutedColor} />;

function ScriptItem({
  name,
  service,
  disabled,
  onRun,
  onEdit,
}: {
  name: string;
  service: boolean;
  disabled: boolean;
  onRun: (name: string) => void;
  onEdit: (name: string | null) => void;
}): ReactElement {
  const run = useCallback(() => onRun(name), [name, onRun]);
  const leading = useMemo(
    () => (
      <ScriptEditButton name={name} icon={service ? serviceIcon : commandIcon} onEdit={onEdit} />
    ),
    [name, service, onEdit],
  );
  return (
    <DropdownMenuItem
      testID={`new-workspace-script-${name}`}
      accessibilityLabel={name}
      leading={leading}
      disabled={disabled}
      onSelect={run}
    >
      {name}
    </DropdownMenuItem>
  );
}

/** Project config is available before a workspace exists; execution stays with the script runner. */
export function RunScriptsControl({
  serverId,
  repoRoot,
  variant,
  disabled,
  onRun,
}: {
  serverId: string;
  repoRoot: string;
  variant: FieldTriggerVariant;
  disabled: boolean;
  onRun: (name: string) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const connected = useHostRuntimeIsConnected(serverId);
  const [open, setOpen] = useState(false);
  const { open: editScript, editor } = useScriptEditor(serverId, repoRoot);
  const addScript = useCallback(() => editScript(null), [editScript]);
  const config = useScriptConfig(serverId, repoRoot);
  const scripts = useMemo(() => {
    const rows = config.data?.ok ? Object.entries(config.data.config?.scripts ?? {}) : [];
    return groupScripts(
      rows,
      ([name]) => name,
      config.data?.ok ? config.data.sharedScriptNames : [],
    );
  }, [config.data]);
  const renderScript = useCallback(
    ([name, entry]: [string, PaseoScriptEntryRaw]) => (
      <ScriptItem
        key={name}
        name={name}
        service={entry.type === "service"}
        disabled={disabled || !connected || config.isFetching}
        onRun={onRun}
        onEdit={editScript}
      />
    ),
    [disabled, connected, config.isFetching, onRun, editScript],
  );
  let readError: string | null = null;
  if (config.isError) readError = t("settings.project.readFailures.transportTitle");
  if (config.data && !config.data.ok) {
    readError =
      config.data.error.code === "invalid_project_config"
        ? t("settings.project.readFailures.invalidTitle")
        : t("settings.project.readFailures.failedTitle");
  }
  const pending = disabled || !connected || config.isPending || config.isFetching;
  const triggerStyle = useFieldTriggerStyle(variant, pending);
  const { refetch } = config;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen} compactMode="sheet">
        <DropdownMenuTrigger
          testID="new-workspace-scripts-trigger"
          accessibilityRole="button"
          accessibilityLabel={t("workspace.scripts.accessibility.trigger")}
          disabled={pending}
          style={triggerStyle}
        >
          <FieldTriggerContent
            variant={variant}
            label={t("workspace.scripts.title")}
            icon={playIcon}
            value={config.isPending ? t("common.loading") : t("workspace.scripts.actions.run")}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          offset={8}
          width={260}
          sheetTitle={t("workspace.scripts.title")}
        >
          {readError ? (
            <>
              <DropdownMenuItem disabled>{readError}</DropdownMenuItem>
              <DropdownMenuItem testID="new-workspace-scripts-retry" onSelect={retry}>
                {t("common.retry")}
              </DropdownMenuItem>
            </>
          ) : (
            <>
              {scripts.shared.map(renderScript)}
              {scripts.shared.length > 0 && scripts.workspace.length > 0 ? (
                <DropdownMenuSeparator testID="workspace-scripts-scope-divider" />
              ) : null}
              {scripts.workspace.map(renderScript)}
            </>
          )}
          {!readError ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem testID="workspace-scripts-add" onSelect={addScript}>
                {t("settings.project.scripts.actions.add")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {editor}
    </>
  );
}
