import { useCallback, useState, type ReactElement } from "react";
import { View, type GestureResponderEvent } from "react-native";
import { Settings2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useHoverControlsAlwaysVisible } from "@/hooks/use-hover-controls-always-visible";
import { useDropdownMenuClose } from "@/components/ui/dropdown-menu";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { Theme } from "@/styles/theme";

const ThemedSettings = withUnistyles(Settings2);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function ScriptEditButton({
  name,
  icon,
  onEdit,
}: {
  name: string;
  icon: ReactElement;
  onEdit: (name: string | null) => void;
}) {
  const { t } = useTranslation();
  const hoverControlsAlwaysVisible = useHoverControlsAlwaysVisible();
  const closeMenu = useDropdownMenuClose();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reveal = hovered || focused || hoverControlsAlwaysVisible;
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const focus = useCallback(() => setFocused(true), []);
  const blur = useCallback(() => setFocused(false), []);
  const edit = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      closeMenu();
      onEdit(name);
    },
    [closeMenu, name, onEdit],
  );
  const label = t("settings.project.scripts.editScript", { name });
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`script-edit-trigger-${name}`}
      onPress={edit}
      onHoverIn={enter}
      onHoverOut={leave}
      onFocus={focus}
      onBlur={blur}
      style={styles.button}
    >
      <View pointerEvents="none" style={reveal ? styles.hidden : styles.layer}>
        {icon}
      </View>
      <View pointerEvents="none" style={reveal ? styles.layer : styles.hidden}>
        <ThemedSettings size={14} uniProps={mutedColor} />
      </View>
    </PressHighlight>
  );
}
const styles = StyleSheet.create({
  button: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  layer: { position: "absolute", opacity: 1 },
  hidden: { position: "absolute", opacity: 0 },
});
