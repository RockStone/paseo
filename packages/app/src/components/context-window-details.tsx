import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useHoverCardDismiss } from "@/components/ui/hover-card";
import { ContextWindowCompactButton } from "./context-window-compact-button";
import { AgentUsage } from "@/usage";
import { formatTokenCount } from "./context-window-meter.utils";

interface ContextWindowDetailsProps {
  serverId: string;
  agentId: string;
  context: {
    percentage: number;
    usedTokens: number;
    maxTokens: number;
  } | null;
  sessionCost: string | null;
  /** The hover card and tooltip title themselves; the sheet's header carries the title instead. */
  showTitle: boolean;
  /** Whether the usage cards have a Refresh button; without one they show their freshness. */
  refreshable: boolean;
  onCompactAccepted?: () => void;
}

/**
 * What the context window meter opens: how full the window is, then the usage of the agent's
 * account. The desktop hover card, the native wide tooltip, and the compact sheet all render it.
 */
export function ContextWindowDetails({
  serverId,
  agentId,
  context,
  sessionCost,
  showTitle,
  refreshable,
  onCompactAccepted,
}: ContextWindowDetailsProps) {
  const { t } = useTranslation();
  const dismissHoverCard = useHoverCardDismiss();
  return (
    <>
      <View style={styles.summary}>
        {showTitle ? <Text style={styles.title}>{t("contextWindow.title")}</Text> : null}
        <View style={styles.usageRow}>
          <View style={styles.stats} testID="context-window-stats">
            {context ? (
              <>
                <Text style={styles.text}>
                  {t("contextWindow.used", { percentage: context.percentage })}
                </Text>
                <Text style={styles.detail}>
                  {t("contextWindow.tokens", {
                    used: formatTokenCount(context.usedTokens),
                    max: formatTokenCount(context.maxTokens),
                  })}
                </Text>
              </>
            ) : (
              <Text style={styles.detail}>{t("contextWindow.noData")}</Text>
            )}
          </View>
          {refreshable ? (
            <ContextWindowCompactButton
              serverId={serverId}
              agentId={agentId}
              onAccepted={onCompactAccepted ?? dismissHoverCard}
            />
          ) : null}
        </View>
        {sessionCost ? (
          <Text style={styles.detail}>{t("contextWindow.sessionCost", { cost: sessionCost })}</Text>
        ) : null}
      </View>
      <AgentUsage serverId={serverId} agentId={agentId} refreshable={refreshable} />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  summary: {
    gap: theme.spacing[1.5],
    minWidth: 200,
  },
  usageRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  stats: { flex: 1, gap: theme.spacing[1.5] },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
}));
