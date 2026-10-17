import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useMenuContext } from "@/components/ui/menu";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function CommitPushButton({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const { selectItem } = useMenuContext("CommitPushButton");
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = useCallback(async () => {
    if (busy.current || !client) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await dispatchComposerAgentMessage({
        client,
        agentId,
        text: "Please review the current Git changes, commit the changes for this task with a clear commit message, and push the current branch to its remote. Preserve unrelated work. Report the commit and push result.",
        attachments: [],
        encodeImages: async () => undefined,
        submission: createMessageSubmissionWriter(serverId),
        activeTurnBehavior: "steer",
      });
      setSent(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("commitHistoryPill.sendFailed"));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, [agentId, client, serverId, t]);
  const handlePress = useCallback(() => {
    selectItem(() => void send(), false);
  }, [selectItem, send]);
  return (
    <View style={styles.container}>
      <Button
        size="xs"
        variant="ghost"
        testID="composer-commit-push"
        accessibilityLabel={t("commitHistoryPill.commitPush")}
        onPress={handlePress}
        loading={pending}
        disabled={!connected || sent}
      >
        {sent ? t("commitHistoryPill.requestSent") : t("commitHistoryPill.commitPush")}
      </Button>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flexShrink: 1, alignItems: "flex-end" },
  error: { fontSize: theme.fontSize.sm, color: theme.colors.destructive, maxWidth: 220 },
}));
