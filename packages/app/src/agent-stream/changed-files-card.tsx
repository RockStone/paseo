import { memo, useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { fileNameForPath } from "@/git/file-header-presentation";
import { DiffStat } from "@/components/diff-stat";
import { DiffViewer } from "@/components/diff-viewer";
import { buildLineDiff, parseUnifiedDiff } from "@/utils/tool-call-parsers";
import type { ResponseFileChange, ResponseFileChanges } from "./response-file-changes";

const DownIcon = withUnistyles(ChevronDown, (theme) => ({ color: theme.colors.foregroundMuted }));
const RightIcon = withUnistyles(ChevronRight, (theme) => ({ color: theme.colors.foregroundMuted }));
const PREVIEW_FILE_COUNT = 3;

function RecordedDiffs({ file }: { file: ResponseFileChange }) {
  const { t } = useTranslation();
  const previews = useMemo(
    () =>
      file.edits.map((edit) => {
        if (edit.patch) return parseUnifiedDiff(edit.patch);
        if (edit.before === undefined || edit.after === undefined) return null;
        if (edit.before.split("\n").length * edit.after.split("\n").length > 250_000) return null;
        return buildLineDiff(edit.before, edit.after);
      }),
    [file.edits],
  );
  return (
    <View style={styles.previews} testID="response-file-diff">
      <Text selectable style={styles.muted}>
        {file.path}
      </Text>
      {previews.map((lines, index) => (
        <View key={file.edits[index]!.id} style={styles.preview}>
          {previews.length > 1 ? (
            <Text style={styles.muted}>{t("responseChanges.edit", { count: index + 1 })}</Text>
          ) : null}
          {lines ? (
            <DiffViewer diffLines={lines} maxHeight={260} />
          ) : (
            <Text style={styles.muted}>{t("responseChanges.noDiff")}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

function ChangedFileRow({
  file,
  onOpenFile,
}: {
  file: ResponseFileChange;
  onOpenFile: (path: string) => void;
}) {
  const compact = useIsCompactFormFactor();
  const displayPath = compact ? fileNameForPath(file.path) : file.path;
  const [expanded, setExpanded] = useState(false);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const openFile = useCallback(() => onOpenFile(file.path), [onOpenFile, file.path]);
  const { t } = useTranslation();
  const row = useMemo(
    () => (
      <View style={styles.rowContents}>
        <Text style={styles.path} numberOfLines={1} ellipsizeMode="middle">
          {displayPath}
        </Text>
        {file.counts ? (
          <DiffStat {...file.counts} />
        ) : (
          <Text style={styles.muted}>{t("responseChanges.unavailable")}</Text>
        )}
        {expanded ? <DownIcon size={14} /> : <RightIcon size={14} />}
      </View>
    ),
    [expanded, displayPath, file.counts, t],
  );
  return (
    <View style={styles.file}>
      <Button
        variant="ghost"
        style={styles.rowButton}
        accessibilityLabel={file.path}
        accessibilityState={accessibilityState}
        onPress={toggle}
        testID="response-changed-file"
        trailing={row}
      />
      {expanded ? (
        <>
          <RecordedDiffs file={file} />
          <Button variant="ghost" size="sm" onPress={openFile}>
            {t("responseChanges.openFile")}
          </Button>
        </>
      ) : null}
    </View>
  );
}

export const ChangedFilesCard = memo(function ChangedFilesCard({
  summary,
  onOpenFile,
}: {
  summary: ResponseFileChanges;
  onOpenFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const [showAll, setShowAll] = useState(false);
  const toggleFiles = useCallback(() => setShowAll((value) => !value), []);
  const { t } = useTranslation();
  const files = showAll ? summary.files : summary.files.slice(0, PREVIEW_FILE_COUNT);
  const remaining = summary.files.length - PREVIEW_FILE_COUNT;
  const header = useMemo(
    () => (
      <View style={styles.rowContents}>
        <Text style={styles.title}>
          {t("responseChanges.title", { count: summary.files.length })}
        </Text>
        {summary.counts ? (
          <DiffStat {...summary.counts} />
        ) : (
          <Text style={styles.muted}>{t("responseChanges.unavailable")}</Text>
        )}
        {expanded ? <DownIcon size={16} /> : <RightIcon size={16} />}
      </View>
    ),
    [expanded, summary.files.length, summary.counts, t],
  );
  return (
    <View style={styles.card} testID="response-changed-files">
      <Button
        variant="ghost"
        style={styles.rowButton}
        onPress={toggle}
        accessibilityState={accessibilityState}
        trailing={header}
      />
      {expanded ? (
        <>
          {files.map((file) => (
            <ChangedFileRow key={file.path} file={file} onOpenFile={onOpenFile} />
          ))}
          {remaining > 0 ? (
            <Button variant="ghost" style={styles.rowButton} onPress={toggleFiles}>
              {showAll
                ? t("responseChanges.showLess")
                : t("responseChanges.showMore", { count: remaining })}
            </Button>
          ) : null}
        </>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  card: {
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  rowContents: { flexDirection: "row", flex: 1, alignItems: "center", gap: theme.spacing[2] },
  rowButton: {
    width: "100%",
    justifyContent: "flex-start",
    borderRadius: 0,
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[2],
  },
  file: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  title: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  path: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  previews: { paddingHorizontal: theme.spacing[2], gap: theme.spacing[2] },
  preview: { gap: theme.spacing[1] },
}));
