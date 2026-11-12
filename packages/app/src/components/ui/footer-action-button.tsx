import { useCallback, useMemo, type ReactNode } from "react";
import { Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";

// Paseoi: the one look for message-footer actions (Reply, Select, Cancel). It matches the
// upstream Copy and Fork buttons: no filled highlight, the glyph tints on hover, and the
// tooltip opens above.
export const footerActionMutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
export const footerActionHoverColor = (theme: Theme) => ({ color: theme.colors.foreground });

export function FooterActionButton({
  label,
  testID,
  onPress,
  disabled,
  renderIcon,
}: {
  label: string;
  testID?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Receives whether the pointer is over the button so the glyph can tint. */
  renderIcon: (hovered: boolean) => ReactNode;
}) {
  const accessibilityState = useMemo(() => ({ disabled: Boolean(disabled) }), [disabled]);
  const style = useCallback(() => [styles.button, disabled ? styles.disabled : null], [disabled]);
  const children = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) =>
      renderIcon(Boolean(hovered)),
    [renderIcon],
  );
  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={accessibilityState}
        disabled={disabled}
        onPress={onPress}
        style={style}
        testID={testID}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    alignSelf: "center",
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  disabled: { opacity: theme.opacity[50] },
  tooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
