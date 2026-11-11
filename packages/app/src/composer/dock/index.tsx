export { ComposerDockBackground } from "./internal/background";
export { ComposerFullscreenBody, ComposerFullscreenFooter } from "./internal/fullscreen";
export { useComposerSurface, type ComposerSurface } from "./internal/surface";
import { ScrollView } from "@/components/ui/scroll-view";
import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { resolveInlineComposerCapacity } from "./internal/capacity";
import { useFullscreenSlotFrame } from "./internal/fullscreen";
import { ComposerSurfaceContext, type ComposerSurface } from "./internal/surface";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HEADER_INNER_HEIGHT } from "@/constants/layout";

interface ComposerDockProps {
  children: [ReactNode, ReactNode, ReactNode?];
  centered?: boolean;
  /** See the native dock: the same mounted composer fills the visible surface. */
  fullscreen?: boolean;
  /** The content is a conversation the composer can sit beside instead of below. */
  splittable?: boolean;
  /** The composer asked to sit beside the content; honored on wide layouts only. */
  split?: boolean;
  /** Told whenever split becomes available or unavailable, so the owner can drop a request. */
  onSplitAvailabilityChange?: (available: boolean) => void;
}

export function ComposerDock({
  children: [content, composer, overlay],
  centered = false,
  fullscreen = false,
  splittable = false,
  split = false,
  onSplitAvailabilityChange,
}: ComposerDockProps) {
  const compact = useIsCompactFormFactor();
  const [surfaceSize, setSurfaceSize] = useState<{ width: number; height: number }>();
  const surfaceRef = useRef<View>(null);
  const fullscreenFrame = useFullscreenSlotFrame(fullscreen, surfaceRef, surfaceSize);
  const constraint = useMemo(
    () => ({ maxHeight: resolveInlineComposerCapacity(surfaceSize?.height, compact) }),
    [surfaceSize?.height, compact],
  );
  const splitAvailable = splittable && !compact && !centered && !fullscreen;
  const isSplit = splitAvailable && split;
  const latestAvailabilityListener = useRef(onSplitAvailabilityChange);
  latestAvailabilityListener.current = onSplitAvailabilityChange;
  useEffect(() => {
    latestAvailabilityListener.current?.(splitAvailable);
  }, [splitAvailable]);
  const surface = useMemo(
    (): ComposerSurface => ({ height: surfaceSize?.height, splitAvailable, split: isSplit }),
    [surfaceSize?.height, splitAvailable, isSplit],
  );
  const measureViewport = useCallback((event: import("react-native").LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (height > 0) setSurfaceSize({ width, height });
  }, []);
  if (centered) {
    return (
      <ComposerSurfaceContext.Provider value={surface}>
        <View ref={surfaceRef} style={styles.centered} onLayout={measureViewport}>
          <View style={styles.form}>
            <ScrollView style={styles.setup} keyboardShouldPersistTaps="handled">
              {content}
            </ScrollView>
            <View
              style={
                fullscreen
                  ? [styles.fullscreenComposer, fullscreenFrame]
                  : [styles.centeredComposer, constraint]
              }
            >
              {composer}
            </View>
            {overlay}
          </View>
        </View>
      </ComposerSurfaceContext.Provider>
    );
  }
  // Split keeps the same three children in the same order, so the mounted editor, its
  // caret, and focus survive the toggle; only the styles around them change.
  return (
    <ComposerSurfaceContext.Provider value={surface}>
      <View
        ref={surfaceRef}
        style={isSplit ? styles.splitSurface : styles.surface}
        onLayout={measureViewport}
        testID="composer-dock"
      >
        <View style={isSplit ? styles.splitContent : styles.content}>{content}</View>
        <View
          style={resolveComposerSlotStyle({ fullscreen, isSplit, fullscreenFrame, constraint })}
          testID={isSplit ? "composer-split-column" : undefined}
        >
          {composer}
        </View>
        {overlay}
      </View>
    </ComposerSurfaceContext.Provider>
  );
}

function resolveComposerSlotStyle(input: {
  fullscreen: boolean;
  isSplit: boolean;
  fullscreenFrame: ReturnType<typeof useFullscreenSlotFrame>;
  constraint: { maxHeight: number | undefined };
}) {
  if (input.fullscreen) return [styles.fullscreenComposer, input.fullscreenFrame];
  if (input.isSplit) return styles.splitComposer;
  return [styles.composer, input.constraint];
}

const styles = StyleSheet.create((theme) => ({
  surface: { flex: 1, overflow: "hidden" },
  content: { flex: 1, justifyContent: "flex-end" },
  composer: { width: "100%", flexShrink: 1, paddingBottom: theme.spacing[4] },
  splitSurface: { flex: 1, flexDirection: "row", overflow: "hidden" },
  splitContent: { flex: 1, flexBasis: 0, minWidth: 0, justifyContent: "flex-end" },
  splitComposer: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
  },
  // Fixed, not absolute: a touch pan that starts inside an overflow-hidden ancestor
  // never reaches the zoomed visual viewport, while a fixed box chains to the viewport
  // directly. React Native Web renders `fixed`; React Native's style type omits it.
  fullscreenComposer: { position: "fixed" as "absolute" },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: HEADER_INNER_HEIGHT + 24,
  },
  form: { flexShrink: 1, width: "100%", maxWidth: theme.contentMaxWidth },
  centeredComposer: { flexShrink: 0 },
  setup: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
}));
