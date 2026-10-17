import { memo, useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { CommitPushButton } from "@/composer/commit-push-button";
import { ComposerTrackPill } from "@/composer/tracks";
import { useMenuContext } from "@/components/ui/menu";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { checkoutCommitsQueryKey } from "@/git/query-keys";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

export const ComposerCommitHistoryPill = memo(function ComposerCommitHistoryPill({
  serverId,
  cwd,
  agentId,
}: {
  serverId: string;
  cwd: string;
  agentId: string;
}) {
  const { t } = useTranslation();
  // COMPAT(composerGitDetails): added in Paseoi r17, remove after 2027-04-17.
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.composerGitDetails === true,
  );
  if (!supported) return null;
  return (
    <ComposerTrackPill
      segments={[{ bucket: null, text: t("commitHistoryPill.label") }]}
      panelTitle={t("commitHistoryPill.title")}
      testID="composer-commit-history-pill"
    >
      <CommitHistoryList serverId={serverId} cwd={cwd} agentId={agentId} />
    </ComposerTrackPill>
  );
});

function CommitHistoryList({
  serverId,
  cwd,
  agentId,
}: {
  serverId: string;
  cwd: string;
  agentId: string;
}) {
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
      <HoverCard key={commit.sha}>
        <HoverCardTrigger focusable accessibilityLabel={commit.subject}>
          <View style={styles.row} testID="composer-commit-history-row">
            <Text style={styles.subject} numberOfLines={2}>
              {commit.subject}
            </Text>
            <Text style={styles.meta}>
              {commit.shortSha} · {commit.authorName} ·{" "}
              {new Date(commit.authorDate).toLocaleDateString(i18n.resolvedLanguage)}
            </Text>
          </View>
        </HoverCardTrigger>
        <HoverCardContent
          placement="right"
          alignment="start"
          testID="composer-commit-message"
          style={styles.bubble}
        >
          <ScrollView style={styles.messageScroll} testID="composer-commit-message-scroll">
            <Text selectable style={styles.subject}>
              {commit.message}
            </Text>
          </ScrollView>
        </HoverCardContent>
      </HoverCard>
    ));
  }
  return (
    <View style={styles.list}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t("commitHistoryPill.title")}</Text>
        <CommitPushButton serverId={serverId} agentId={agentId} />
      </View>
      {content}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { padding: theme.spacing[3], gap: theme.spacing[3] },
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
  row: { gap: theme.spacing[1] },
  subject: { fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  meta: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  bubble: { width: 420, maxWidth: 420, padding: theme.spacing[3] },
  messageScroll: { maxHeight: 260 },
}));
