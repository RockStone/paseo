import { memo, useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Undo2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { CheckoutWorkingTreeSummary } from "@getpaseo/protocol/messages";
import { CommitPushButton } from "@/composer/commit-push-button";
import { ComposerTrackPill } from "@/composer/tracks";
import { useMenuContext } from "@/components/ui/menu";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { Theme } from "@/styles/theme";

const ThemedUndo = withUnistyles(Undo2);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
type WorkingFile = CheckoutWorkingTreeSummary["files"][number];

export const ComposerGitStatusPill = memo(function ComposerGitStatusPill({
  summary,
  serverId,
  cwd,
  agentId,
}: {
  summary: CheckoutWorkingTreeSummary;
  serverId: string;
  cwd: string;
  agentId: string;
}) {
  const { t } = useTranslation();
  return (
    <ComposerTrackPill
      segments={[{ bucket: null, text: t("gitStatusPill.title", { count: summary.total }) }]}
      panelTitle={t("gitStatusPill.heading")}
      testID="composer-git-status-pill"
      openOnHover
    >
      <GitStatusList summary={summary} serverId={serverId} cwd={cwd} agentId={agentId} />
    </ComposerTrackPill>
  );
});

function GitStatusList({
  summary,
  serverId,
  cwd,
  agentId,
}: {
  summary: CheckoutWorkingTreeSummary;
  serverId: string;
  cwd: string;
  agentId: string;
}) {
  const { t } = useTranslation();
  const discardChanges = useCheckoutGitActionsStore((state) => state.discardChanges);
  const { selectItem } = useMenuContext("GitStatusList");
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const discardFile = useCallback(
    async (file: WorkingFile) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(file.path);
      setError(null);
      try {
        const name = file.originalPath ? `${file.originalPath} → ${file.path}` : file.path;
        const confirmed = await confirmDialog({
          title: t("workspace.fileActions.confirmRevert.title"),
          message: t(
            file.status === "??"
              ? "gitStatusPill.discardUntracked"
              : "gitStatusPill.discardTracked",
            { path: name },
          ),
          confirmLabel: t("gitStatusPill.discard"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        });
        if (!confirmed) return;
        await discardChanges({
          serverId,
          cwd,
          paths: file.originalPath ? [file.path, file.originalPath] : [file.path],
        });
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : t("workspace.fileActions.confirmRevert.failed"),
        );
      } finally {
        pendingRef.current = false;
        setPending(null);
      }
    },
    [cwd, discardChanges, serverId, t],
  );
  const handleDiscard = useCallback(
    (file: WorkingFile) =>
      selectItem(() => {
        void discardFile(file);
      }, false),
    [selectItem, discardFile],
  );
  return (
    <View style={styles.list}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t("gitStatusPill.heading")}</Text>
        <CommitPushButton serverId={serverId} agentId={agentId} />
      </View>
      <Text style={styles.meta}>
        {t("gitStatusPill.breakdown", { tracked: summary.tracked, untracked: summary.untracked })}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" testID="composer-discard-error" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {summary.files.map((file) => (
        <GitStatusRow
          key={file.path}
          file={file}
          disabled={pending !== null}
          pending={pending === file.path}
          onDiscard={handleDiscard}
        />
      ))}
    </View>
  );
}

function GitStatusRow({
  file,
  disabled,
  pending,
  onDiscard,
}: {
  file: WorkingFile;
  disabled: boolean;
  pending: boolean;
  onDiscard: (file: WorkingFile) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onDiscard(file), [onDiscard, file]);
  return (
    <View style={styles.row} testID="composer-git-status-file">
      <Text style={styles.path} numberOfLines={1} ellipsizeMode="middle">
        {file.status.trim()} {file.path}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("gitStatusPill.discardFile", { path: file.path })}
        disabled={disabled}
        onPress={handlePress}
        style={styles.undo}
      >
        {pending ? (
          <ActivityIndicator size="small" />
        ) : (
          <ThemedUndo size={16} uniProps={iconColor} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { gap: theme.spacing[2], padding: theme.spacing[3] },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  heading: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  meta: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  path: { flex: 1, minWidth: 0, fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  undo: { padding: theme.spacing[2], borderRadius: theme.borderRadius.md },
  error: { fontSize: theme.fontSize.sm, color: theme.colors.destructive },
}));
