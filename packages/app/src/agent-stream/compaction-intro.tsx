import React, { useState, useMemo, useCallback, type ReactNode } from "react";
import { Text, View } from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

const Down = withUnistyles(ChevronDown);
const Right = withUnistyles(ChevronRight);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function CompactionIntro({
  enabled,
  forceExpanded,
  children,
}: {
  enabled: boolean;
  forceExpanded: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded || forceExpanded;
  const accessibilityState = useMemo(() => ({ expanded: visible }), [visible]);
  const toggle = useCallback(() => setExpanded((previous) => !previous), []);
  if (!enabled) return children;
  const Chevron = visible ? Down : Right;
  return (
    <View>
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel="Compaction summary"
        accessibilityState={accessibilityState}
        aria-expanded={visible}
        onPress={toggle}
        style={styles.header}
      >
        <Chevron size={14} uniProps={iconColor} />
        <Text style={styles.label}>Compaction summary</Text>
      </PressHighlight>
      {visible ? children : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
