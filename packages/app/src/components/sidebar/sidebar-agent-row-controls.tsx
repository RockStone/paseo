import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, type GestureResponderEvent } from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { MoreVertical } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useContextMenu, useOpenContextMenuAtEvent } from "@/components/ui/context-menu";
import { isNative } from "@/constants/platform";
import { useHoverControlsAlwaysVisible } from "@/hooks/use-hover-controls-always-visible";
import { agentRowKebabVisible } from "@/components/sidebar/sidebar-agent-row-actions";
import type { Theme } from "@/styles/theme";

const ThemedMoreVertical = withUnistyles(MoreVertical);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Paseoi: must render inside the row's ContextMenu. On native the row's own Pressable takes the
// gesture, so the long press that opens the menu lives here rather than on the menu trigger.
// Web keeps its right click and the touch-browser long press from ContextMenuTrigger.
export function AgentThreadPressable({
  onPress,
  children,
  ...props
}: {
  onPress: () => void;
  children: ReactNode;
  accessibilityRole: "button";
  accessibilityLabel: string;
  style: object;
  "aria-selected": boolean;
  testID: string;
}) {
  const openAtEvent = useOpenContextMenuAtEvent();
  return (
    <PressHighlight {...props} onPress={onPress} onLongPress={isNative ? openAtEvent : undefined}>
      {children}
    </PressHighlight>
  );
}

export function AgentRowKebab({ hovered, testID }: { hovered: boolean; testID: string }) {
  const { t } = useTranslation();
  const menu = useContextMenu();
  const alwaysVisible = useHoverControlsAlwaysVisible();
  const openAtEvent = useOpenContextMenuAtEvent();
  const handlePress = useCallback(
    (event: GestureResponderEvent) => openAtEvent(event),
    [openAtEvent],
  );
  if (!agentRowKebabVisible({ hovered, controlsAlwaysVisible: alwaysVisible, menuOpen: menu.open }))
    return null;
  return (
    <PressHighlight
      onPress={handlePress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t("sidebar.project.actions.menu")}
      style={styles.kebab}
      testID={testID}
    >
      <View>
        <ThemedMoreVertical size={14} uniProps={mutedIcon} />
      </View>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  kebab: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing[1],
  },
}));
