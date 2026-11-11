import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet as RNStyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { StyleSheet } from "react-native-unistyles";
import { useHeaderRowRef } from "@/components/headers/header-row-context";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { measureElement } from "@/components/ui/anchor";
import { EdgeDrawerLayer } from "@/components/ui/edge-drawer-layer";
import { useMenuContext } from "@/components/ui/menu";
import { PANEL_SLIDE_DURATION_MS, PANEL_SLIDE_EASING } from "@/mobile-panels/motion";

export const PLUGIN_DRAWER_WIDTH = 380;

const SLIDE_TIMING = { duration: PANEL_SLIDE_DURATION_MS, easing: PANEL_SLIDE_EASING };

/**
 * Paseoi: the surface a bare header popover (the sticky notes) opens in on wide layouts. A drawer
 * flush with the window's right edge, from the bottom of the header row its trigger sits in down
 * to the bottom of the window, sliding in and out like the sidebars. Open state stays on the
 * enclosing `MenuRoot`, so the trigger toggles it and keeps its open highlight.
 */
export function PluginDrawerSurface({
  testID,
  children,
}: {
  testID?: string;
  children: ReactNode;
}) {
  const { open, setOpen, triggerRef } = useMenuContext("PluginDrawerSurface");
  const rowRef = useHeaderRowRef();
  const active = useRetainedPanelActive();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [top, setTop] = useState<number | null>(null);
  // Stays true after `open` drops until the slide-out finishes.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const offscreen = PLUGIN_DRAWER_WIDTH;
  const translateX = useSharedValue(offscreen);
  const close = useCallback(() => setOpen(false), [setOpen]);

  const finishExit = useCallback(() => {
    setShown(false);
    setTop(null);
  }, []);

  // A drawer belongs to the panel that opened it, like a menu: it closes for good when the panel
  // leaves the screen instead of waiting hidden to reappear with it.
  useEffect(() => {
    if (active) return;
    if (open) setOpen(false);
    translateX.value = offscreen;
    finishExit();
  }, [active, open, setOpen, translateX, offscreen, finishExit]);

  // The top edge is the bottom of the header row, or of the trigger outside one. Measured on open
  // and again when the window resizes; a zero-size measurement is a row that has not laid out yet.
  useEffect(() => {
    if (!open) return undefined;
    const anchor = rowRef?.current ?? triggerRef.current;
    if (!anchor) return undefined;
    let cancelled = false;
    void measureElement(anchor).then((rect) => {
      if (cancelled || rect.height === 0) return undefined;
      setTop(rect.y + rect.height);
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [open, rowRef, triggerRef, windowWidth, windowHeight]);

  // Nothing paints until the top is known, so the slide starts from the final position.
  const placed = shown && top !== null;
  useEffect(() => {
    if (!placed) return;
    if (open) {
      translateX.value = withTiming(0, SLIDE_TIMING);
      return;
    }
    translateX.value = withTiming(offscreen, SLIDE_TIMING, (finished) => {
      "worklet";
      if (finished) scheduleOnRN(finishExit);
    });
  }, [placed, open, translateX, offscreen, finishExit]);

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  // Full height below the header row: the notes list grows long quickly.
  const frameStyle = useMemo(
    () => ({ top: top ?? 0, pointerEvents: open ? ("auto" as const) : ("none" as const) }),
    [top, open],
  );

  if (!active || !placed) return null;
  return (
    <EdgeDrawerLayer active={open} onClose={close} triggerRef={triggerRef}>
      <Animated.View testID={testID} style={[staticStyles.frame, frameStyle, slideStyle]}>
        <View style={styles.panel}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
            {children}
          </ScrollView>
        </View>
      </Animated.View>
    </EdgeDrawerLayer>
  );
}

// Static styles for the Animated.View: a Unistyles style there would have Unistyles patch the
// node Reanimated also manages (see left-sidebar.tsx).
const staticStyles = RNStyleSheet.create({
  frame: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: PLUGIN_DRAWER_WIDTH,
    maxWidth: "100%",
  },
});

// The menu card's look, flush against the window's right and bottom edges: only the top-left
// corner rounds.
const styles = StyleSheet.create((theme) => ({
  panel: {
    flex: 1,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderColor: theme.colors.borderAccent,
    borderTopLeftRadius: theme.borderRadius.lg,
    overflow: "hidden",
    ...theme.shadow.md,
  },
  scroll: { flex: 1 },
}));
