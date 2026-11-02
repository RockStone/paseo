import { useCallback } from "react";
import { Text, type PointerEvent, type PressableStateCallbackType } from "react-native";
import { Maximize2, Minimize2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const CONTROL_SIZE = 28;

function keepEditorFocused(event: PointerEvent) {
  if (isWeb) event.preventDefault();
}

/**
 * Expand and Collapse for the split composer, pinned to the top right of the text area
 * in the band the editor reserves for it. The press keeps the editor focused, so the
 * caret stays where the user left it across the toggle.
 */
export function ComposerSplitToggle({ split, onToggle }: { split: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const label = t(split ? "composer.input.collapseComposer" : "composer.input.expandComposer");
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (Boolean(hovered) || pressed) && styles.buttonHovered,
    ],
    [],
  );
  return (
    <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onToggle}
        onPointerDown={keepEditorFocused}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={buttonStyle}
        hitSlop={4}
        testID="composer-split-toggle"
      >
        {split ? (
          <ThemedMinimize2 size={ICON_SIZE.sm} uniProps={iconMutedMapping} />
        ) : (
          <ThemedMaximize2 size={ICON_SIZE.sm} uniProps={iconMutedMapping} />
        )}
      </TooltipTrigger>
      <TooltipContent side="left" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const ThemedMaximize2 = withUnistyles(Maximize2);
const ThemedMinimize2 = withUnistyles(Minimize2);
const iconMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  // The toolbar row bleeds 6px past the input padding; this circle shares Send's right edge.
  button: {
    position: "absolute",
    top: 0,
    right: -6,
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  buttonHovered: {
    backgroundColor: theme.colors.surface3,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
