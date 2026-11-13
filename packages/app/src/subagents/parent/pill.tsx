import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronLeft, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { composerPillStyles } from "@/composer/pill-styles";
import { ComposerTrackMark } from "@/composer/tracks";
import type { Theme } from "@/styles/theme";
import { useParentAgent } from "./use-parent-agent";

const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedX = withUnistyles(X);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * The way back from a subagent to the agent that started it. It leads the pill rail and names
 * the parent rather than saying "parent": in a stack of subagents the title is what tells you
 * where you will land. With a mouse, hovering swaps the chevron for an X that detaches this agent
 * from the parent (after a confirmation), which also ends the parent's finish notifications.
 * Hover follows docs/hover.md: a plain View tracks it so the nested X button can't steal it.
 */
export function ParentAgentPill({
  serverId,
  parentAgentId,
  onDetach,
}: {
  serverId: string;
  parentAgentId: string;
  /** Omitted when the host can't detach agents. */
  onDetach?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const parent = useParentAgent(serverId, parentAgentId);
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const bodyStyle = useMemo(
    () => [composerPillStyles.body, styles.body, isHovered && composerPillStyles.bodyActive],
    [isHovered],
  );
  const labelStyle = useMemo(
    () => [composerPillStyles.label, styles.label, isHovered && composerPillStyles.labelActive],
    [isHovered],
  );
  const label = parent.label ?? t("subagents.parent.backToParent");

  const showDetach = isHovered && onDetach !== undefined;

  return (
    <View
      style={styles.hoverTarget}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <PressHighlight
        testID="composer-parent-agent-pill"
        accessibilityRole="button"
        accessibilityLabel={t("subagents.parent.backTo", { label })}
        onPress={parent.open}
        style={bodyStyle}
        highlightStyle={composerPillStyles.bodyActive}
      >
        {showDetach ? (
          <PressHighlight
            testID="composer-parent-agent-detach"
            accessibilityRole="button"
            accessibilityLabel={t("subagents.parent.detach")}
            onPress={onDetach}
            hitSlop={6}
          >
            <ThemedX size={14} uniProps={foregroundColorMapping} />
          </PressHighlight>
        ) : (
          <ThemedChevronLeft
            size={14}
            uniProps={isHovered ? foregroundColorMapping : mutedColorMapping}
          />
        )}
        <ComposerTrackMark bucket={parent.statusBucket} />
        <Text style={labelStyle} numberOfLines={1}>
          {label}
        </Text>
      </PressHighlight>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  hoverTarget: {
    position: "relative",
    flexShrink: 1,
    minWidth: 0,
  },
  // The chevron's box is wider than its stroke, so the pill pulls it toward the edge to keep the
  // visible glyph on the same inset as other pills' leading marks.
  body: {
    flexShrink: 1,
    minWidth: 0,
    gap: theme.spacing[1.5],
    paddingLeft: theme.spacing[2],
  },
  label: {
    flexShrink: 1,
    maxWidth: { xs: 140, md: 240 },
  },
}));
