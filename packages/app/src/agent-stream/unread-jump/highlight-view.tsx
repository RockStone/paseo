import { memo, useEffect } from "react";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { UNREAD_JUMP_HIGHLIGHT_DURATION_MS, useUnreadJumpHighlightToken } from "./highlight";

// Paseoi: an accent tint at this opacity reads as a highlight on every theme without competing
// with the user message bubble.
const PEAK_OPACITY = 0.16;
const FADE_IN_MS = 180;
const FADE_OUT_MS = 650;
// A fade is not vestibular motion; reduced-motion users still need to see which row landed.
const reduceMotion = ReduceMotion.Never;
const HOLD_MS = UNREAD_JUMP_HIGHLIGHT_DURATION_MS - FADE_IN_MS - FADE_OUT_MS;

/**
 * Paseoi: the shaded box behind the first unread message after the unread pill's jump lands.
 * Subscribes for its own message id, so the flash renders this row alone.
 */
export const UnreadJumpHighlight = memo(function UnreadJumpHighlight({
  messageId,
}: {
  messageId: string;
}) {
  const token = useUnreadJumpHighlightToken(messageId);
  if (token === null) return null;
  // Keyed by token so a second jump to the same message plays the fade again.
  return <UnreadJumpHighlightBox key={token} />;
});

function UnreadJumpHighlightBox() {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withSequence(
      withTiming(PEAK_OPACITY, {
        duration: FADE_IN_MS,
        easing: Easing.out(Easing.quad),
        reduceMotion,
      }),
      withDelay(
        HOLD_MS,
        withTiming(0, { duration: FADE_OUT_MS, easing: Easing.in(Easing.quad), reduceMotion }),
      ),
    );
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View testID="unread-jump-highlight" style={[styles.box, animatedStyle]} />;
}

const styles = StyleSheet.create((theme) => ({
  box: {
    position: "absolute",
    pointerEvents: "none",
    // Overhang the text a little vertically; the wrapper's horizontal padding gives the sides.
    top: -theme.spacing[1],
    bottom: -theme.spacing[1],
    left: 0,
    right: 0,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.accent,
  },
}));
