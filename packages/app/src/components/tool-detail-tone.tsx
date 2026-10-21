import React, { createContext, forwardRef, useContext, useMemo } from "react";
import { Text, type TextProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export const ToolDetailMutedContext = createContext(false);

// Apply the same tone to plain output, syntax tokens, and diffs without changing
// their backgrounds or affecting code rendered outside a tool's detail body.
export const ToolDetailText = forwardRef<Text, TextProps>(function ToolDetailText(props, ref) {
  const muted = useContext(ToolDetailMutedContext);
  const style = useMemo(() => [props.style, muted && styles.muted], [props.style, muted]);
  return <Text {...props} ref={ref} style={style} />;
});

const styles = StyleSheet.create((theme) => ({ muted: { color: theme.colors.foregroundMuted } }));
