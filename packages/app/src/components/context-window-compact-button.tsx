import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAgentCommandsQuery } from "@/hooks/use-agent-commands-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { createMessageSubmissionWriter } from "@/composer/submission/writer";

export function ContextWindowCompactButton({
  serverId,
  agentId,
  onAccepted,
}: {
  serverId: string;
  agentId: string;
  onAccepted?: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const { commands } = useAgentCommandsQuery({ serverId, agentId });
  const supportsCompact = commands.some((command) => command.name === "compact");
  const active = useSessionStore(
    (state) => selectAgentTurnPresentation(state.sessions[serverId], agentId).isActive,
  );
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compact = useCallback(async () => {
    if (
      !client ||
      !connected ||
      !supportsCompact ||
      busy.current ||
      selectAgentTurnPresentation(useSessionStore.getState().sessions[serverId], agentId).isActive
    )
      return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await dispatchComposerAgentMessage({
        client,
        agentId,
        text: "/compact",
        attachments: [],
        encodeImages: async () => undefined,
        submission: createMessageSubmissionWriter(serverId),
        activeTurnBehavior: "steer",
      });
      onAccepted?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, [agentId, client, connected, onAccepted, serverId, supportsCompact]);
  return (
    <View style={styles.container}>
      <Button
        size="xs"
        variant="secondary"
        onPress={compact}
        loading={pending}
        disabled={!client || !connected || !supportsCompact || active || pending}
        testID="context-window-compact"
      >
        {t("contextWindow.compact")}
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
  container: { gap: theme.spacing[1], alignItems: "flex-end" },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm * 0.85,
    maxWidth: 140,
    textAlign: "right",
  },
}));
