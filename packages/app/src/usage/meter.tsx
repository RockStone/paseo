import { useMemo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { clampPct } from "./format";

/**
 * A window's share as a bar, always green. `quiet` fills it with a surface colour instead,
 * for summaries where a row of coloured bars would be noise. The caller sizes the track.
 */
export function UsageMeter({
  percent,
  quiet = false,
  style,
}: {
  percent: number;
  quiet?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fillWidth = clampPct(percent);
  const fillStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.fill, quiet ? styles.fillQuiet : styles.fillOk, { width: `${fillWidth}%` }],
    [fillWidth, quiet],
  );
  return (
    <View style={[styles.track, style]}>
      <View style={fillStyle} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  // Follows the track, so a caller that sizes the track sizes the bar.
  fill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
  },
  fillQuiet: {
    backgroundColor: theme.colors.surface4,
  },
  fillOk: {
    backgroundColor: theme.colors.statusSuccess,
  },
}));
