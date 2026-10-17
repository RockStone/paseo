import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { CheckoutWorkingTreeSummary } from "@getpaseo/protocol/messages";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { composerPillStyles } from "@/composer/pill-styles";

export const ComposerGitStatusPill = memo(function ComposerGitStatusPill({
  summary,
  onPress,
}: {
  summary: CheckoutWorkingTreeSummary;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const remaining = summary.total - summary.files.length;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Pressable
          testID="composer-git-status-pill"
          accessibilityRole="button"
          accessibilityLabel={t("gitStatusPill.title", { count: summary.total })}
          style={composerPillStyles.body}
          onPress={onPress}
        >
          <Text style={composerPillStyles.label}>
            {t("gitStatusPill.title", { count: summary.total })}
          </Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" maxWidth={420} testID="composer-git-status-preview">
        <View style={styles.preview}>
          <Text style={styles.heading}>{t("gitStatusPill.heading")}</Text>
          <Text style={styles.muted}>
            {t("gitStatusPill.breakdown", {
              tracked: summary.tracked,
              untracked: summary.untracked,
            })}
          </Text>
          {summary.files.slice(0, 10).map((file) => (
            <Text
              key={file.path}
              testID="composer-git-status-file"
              style={styles.file}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {file.status.trim()} {file.path}
            </Text>
          ))}
          {remaining > 0 ? (
            <Text style={styles.muted}>{t("gitStatusPill.more", { count: remaining })}</Text>
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
});

const styles = StyleSheet.create((theme) => ({
  preview: { gap: theme.spacing[1], maxWidth: 390 },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  file: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
