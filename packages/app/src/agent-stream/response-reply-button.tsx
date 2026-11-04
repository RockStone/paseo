import { useCallback, useContext } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Reply } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ResponseReplyContext } from "@/assistant-selection-copy/reply";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedReply = withUnistyles(Reply);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function ResponseReplyButton({ cursor }: { cursor: { epoch: string; seq: number } }) {
  const onReply = useContext(ResponseReplyContext);
  const { t } = useTranslation();
  const reply = useMutation({
    mutationFn: async () => {
      await onReply?.(cursor);
    },
  });
  const { mutate } = reply;
  const handleReply = useCallback(() => mutate(), [mutate]);
  if (!onReply) return null;
  return (
    <View style={styles.container}>
      <ToolbarButton
        label={t("common.reply")}
        testID="reply-to-response"
        disabled={reply.isPending}
        onPress={handleReply}
        compact
      >
        {reply.isPending ? (
          <ThemedLoadingSpinner size="small" uniProps={iconColor} />
        ) : (
          <ThemedReply size={ICON_SIZE.sm} uniProps={iconColor} />
        )}
      </ToolbarButton>
      {reply.isError ? (
        <Text accessibilityRole="alert" style={styles.error} testID="response-reply-error">
          {reply.error.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
  error: { color: theme.colors.palette.red[300], fontSize: 12, flexShrink: 1 },
}));
