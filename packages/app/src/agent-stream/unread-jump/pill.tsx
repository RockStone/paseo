import { memo } from "react";
import { View } from "react-native";
import Animated, { type EntryOrExitLayoutType } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronsUp } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import type { UnreadSummary } from "./model";

// The Button colors its icon by variant; this one matches the label's accent instead.
function UnreadJumpIcon({ size }: { color: string; size: number }) {
  return <ChevronsUp size={size} color={styles.label.color} />;
}

/** Floats over the top of the transcript while a return has unread messages above. */
export const UnreadJumpPill = memo(function UnreadJumpPill({
  summary,
  onPress,
  entering,
  exiting,
}: {
  summary: UnreadSummary | null;
  onPress: () => void;
  entering?: EntryOrExitLayoutType;
  exiting?: EntryOrExitLayoutType;
}) {
  const { t } = useTranslation();
  if (!summary) return null;
  const label = summary.countIsPartial
    ? t("agentStream.newMessagesMore", { count: summary.count })
    : t("agentStream.newMessages", { count: summary.count });
  return (
    <View style={styles.container} pointerEvents="box-none">
      <Animated.View entering={entering} exiting={exiting} style={styles.shadow}>
        <Button
          variant="secondary"
          size="sm"
          onPress={onPress}
          leftIcon={UnreadJumpIcon}
          textStyle={styles.label}
          accessibilityLabel={t("agentStream.jumpToFirstUnread", { label })}
          testID="unread-jump-pill"
        >
          {label}
        </Button>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    top: theme.spacing[3],
    left: 0,
    right: 0,
    alignItems: "center",
  },
  shadow: {
    borderRadius: theme.borderRadius.full,
    ...theme.shadow.sm,
  },
  label: {
    color: theme.colors.accentBright,
  },
}));
