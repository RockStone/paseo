import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type ListRenderItemInfo,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SearchField } from "@/components/ui/search-field";
import { Button } from "@/components/ui/button";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useFetchQuery } from "@/data/query";
import {
  describeWorkspaceFilePath,
  type WorkspaceFileSearchEntry as FileFilterEntry,
} from "@/command-center/workspace-file-search-model";
import { isHiddenExplorerPath } from "./visibility";

const FILTER_LIMIT = 100;

interface FileExplorerFilterProps {
  serverId: string;
  workspaceRoot: string;
  showHiddenFiles: boolean;
  onOpenFile?: (path: string) => void;
  children: ReactNode;
}

function resultKey(entry: FileFilterEntry) {
  return entry.path;
}
function resultStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.result, (hovered || pressed) && styles.resultActive];
}

function FileFilterRow({
  entry,
  onOpenFile,
}: {
  entry: FileFilterEntry;
  onOpenFile?: (path: string) => void;
}) {
  const open = useCallback(() => onOpenFile?.(entry.path), [onOpenFile, entry.path]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entry.path}
      onPress={open}
      style={resultStyle}
      testID={`files-filter-result-${entry.path}`}
    >
      <MaterialFileIcon fileName={entry.name} size={16} />
      <View style={styles.resultText}>
        <Text numberOfLines={1} style={styles.name}>
          {entry.name}
        </Text>
        {entry.directory ? (
          <Text numberOfLines={1} style={styles.directory}>
            {entry.directory}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function describeVisibleFileMatches(input: {
  entries: readonly Pick<FileFilterEntry, "path">[];
  showHiddenFiles: boolean;
}): FileFilterEntry[] {
  const entries = input.entries.filter(
    (entry) => input.showHiddenFiles || !isHiddenExplorerPath(entry.path),
  );
  return entries.map((entry) => describeWorkspaceFilePath(entry.path));
}

export function FileExplorerFilter({
  serverId,
  workspaceRoot,
  showHiddenFiles,
  onOpenFile,
  children,
}: FileExplorerFilterProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const active = useRetainedPanelActive();
  const normalizedQuery = query.trim();
  const filtering = normalizedQuery.length > 0;
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(normalizedQuery), 180);
    return () => clearTimeout(timer);
  }, [normalizedQuery]);
  const search = useFetchQuery({
    queryKey: ["explorer-file-filter", serverId, workspaceRoot, debouncedQuery],
    enabled: filtering && debouncedQuery.length > 0 && active && isConnected && Boolean(client),
    dataShape: "value",
    staleTimeMs: 0,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.fileExplorer.filter.disconnected"));
      const result = await client.getDirectorySuggestions({
        cwd: workspaceRoot,
        query: debouncedQuery,
        includeFiles: true,
        includeDirectories: false,
        limit: FILTER_LIMIT,
      });
      if (result.error) throw new Error(result.error);
      return result.entries;
    },
  });
  const entries = describeVisibleFileMatches({ entries: search.data ?? [], showHiddenFiles });
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FileFilterEntry>) => (
      <FileFilterRow entry={item} onOpenFile={onOpenFile} />
    ),
    [onOpenFile],
  );
  const { refetch } = search;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const loading = normalizedQuery !== debouncedQuery || search.isPending;
  let status: ReactNode = null;
  if (!isConnected || search.isError) {
    status = (
      <View style={styles.status} testID="files-filter-error">
        <Text style={styles.muted}>
          {t(
            isConnected
              ? "workspace.fileExplorer.filter.failed"
              : "workspace.fileExplorer.filter.disconnected",
          )}
        </Text>
        <Button variant="secondary" size="sm" onPress={retry} disabled={!isConnected}>
          {t("workspace.fileExplorer.actions.retry")}
        </Button>
      </View>
    );
  } else if (loading) {
    status = (
      <Text style={styles.statusText} testID="files-filter-loading">
        {t("workspace.fileExplorer.filter.searching")}
      </Text>
    );
  } else if (entries.length === 0) {
    status = (
      <Text style={styles.statusText} testID="files-filter-empty">
        {t("workspace.fileExplorer.filter.empty")}
      </Text>
    );
  }
  return (
    <View style={styles.container}>
      <View style={styles.searchRail}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t("workspace.fileExplorer.filter.placeholder")}
          clearAccessibilityLabel={t("workspace.fileExplorer.filter.clear")}
          testID="files-filter-input"
          clearTestID="files-filter-clear"
        />
      </View>
      {filtering ? (
        <View style={styles.container}>
          {status}
          {!status ? (
            <FlatList
              data={entries}
              renderItem={renderItem}
              keyExtractor={resultKey}
              keyboardShouldPersistTaps="handled"
              testID="files-filter-results"
            />
          ) : null}
          {!status && (search.data?.length ?? 0) >= FILTER_LIMIT ? (
            <Text style={styles.statusText}>{t("workspace.fileExplorer.filter.limit")}</Text>
          ) : null}
        </View>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  searchRail: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    minHeight: 36,
  },
  resultActive: { backgroundColor: theme.colors.interactionHighlight },
  resultText: { flex: 1, minWidth: 0 },
  name: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  directory: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  status: { padding: theme.spacing[3], gap: theme.spacing[2], alignItems: "flex-start" },
  statusText: {
    padding: theme.spacing[3],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));
