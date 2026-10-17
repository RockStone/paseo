import { memo, useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ComposerTrackPill } from "@/composer/tracks";
import { useMenuContext } from "@/components/ui/menu";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { checkoutCommitsQueryKey } from "@/git/query-keys";

export const ComposerCommitHistoryPill = memo(function ComposerCommitHistoryPill({
  serverId,
  cwd,
}: {
  serverId: string;
  cwd: string;
}) {
  const { t } = useTranslation();
  // COMPAT(recentCheckoutCommits): added in Paseoi r15, remove after 2027-04-17.
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.recentCheckoutCommits === true,
  );
  if (!supported) return null;
  return (
    <ComposerTrackPill
      segments={[{ bucket: null, text: t("commitHistoryPill.label") }]}
      panelTitle={t("commitHistoryPill.title")}
      testID="composer-commit-history-pill"
    >
      <CommitHistoryList serverId={serverId} cwd={cwd} />
    </ComposerTrackPill>
  );
});

function CommitHistoryList({ serverId, cwd }: { serverId: string; cwd: string }) {
  const { t, i18n } = useTranslation();
  const { open } = useMenuContext("CommitHistoryList");
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const query = useFetchQuery({
    queryKey: [...checkoutCommitsQueryKey(serverId, cwd), "recent"],
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected");
      return client.listCheckoutCommits(cwd, undefined, { recent: true });
    },
    enabled: open && connected && Boolean(client),
    staleTimeMs: 0,
    dataShape: "list",
    retry: false,
  });
  const { refetch } = query;
  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);
  let content;
  if (!connected) {
    content = <Text style={styles.meta}>{t("commitHistoryPill.disconnected")}</Text>;
  } else if (query.isError) {
    content = (
      <View style={styles.row}>
        <Text style={styles.meta}>{t("workspace.git.diff.commits.loadError")}</Text>
        <Pressable accessibilityRole="button" onPress={handleRetry}>
          <Text style={styles.subject}>{t("common.actions.retry")}</Text>
        </Pressable>
      </View>
    );
  } else if (!query.data || query.isPlaceholderData) {
    content = <Text style={styles.meta}>{t("workspace.git.diff.commits.loading")}</Text>;
  } else if (query.data.commits.length === 0) {
    content = <Text style={styles.meta}>{t("workspace.git.diff.commits.empty")}</Text>;
  } else {
    content = query.data.commits.map((commit) => (
      <View key={commit.sha} style={styles.row} testID="composer-commit-history-row">
        <Text style={styles.subject} numberOfLines={2}>
          {commit.subject}
        </Text>
        <Text style={styles.meta}>
          {commit.shortSha} · {commit.authorName} ·{" "}
          {new Date(commit.authorDate).toLocaleDateString(i18n.resolvedLanguage)}
        </Text>
      </View>
    ));
  }
  return (
    <View style={styles.list}>
      <Text style={styles.heading}>{t("commitHistoryPill.title")}</Text>
      {content}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { padding: theme.spacing[3], gap: theme.spacing[3] },
  heading: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  row: { gap: theme.spacing[1] },
  subject: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  meta: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
