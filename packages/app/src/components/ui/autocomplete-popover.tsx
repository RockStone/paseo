import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { View, useWindowDimensions } from "react-native";
import { Portal } from "@gorhom/portal";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import { useFloatingPanelPortal } from "@/components/ui/floating-panel-portal";
import { useKeyboardShift } from "@/keyboard/shift";
import { SPACING } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const OFFSET_FROM_ANCHOR = SPACING[3];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RelativeAnchorRect {
  x: number;
  y: number;
  width: number;
  hostHeight: number;
}

function measureElement(element: View): Promise<Rect> {
  return new Promise((resolve) => {
    element.measureInWindow((x, y, width, height) => {
      resolve({ x, y, width, height });
    });
  });
}

interface AutocompletePopoverProps {
  header?: ReactNode;
  visible: boolean;
  anchorRef: RefObject<View | null>;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
}

export function AutocompletePopover({
  header,
  visible,
  anchorRef,
  options,
  selectedIndex,
  onSelect,
  isLoading,
  errorMessage,
  loadingText,
  emptyText,
}: AutocompletePopoverProps): ReactElement | null {
  "use no memo";
  // React Compiler memoizes effect captures by reading SharedValue.value during render.
  const [relativeAnchorRect, setRelativeAnchorRect] = useState<RelativeAnchorRect | null>(null);
  const windowDimensions = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const { hostName: portalHostName, hostRef, layoutRevision } = useFloatingPanelPortal();
  const { shift, isMoving } = useKeyboardShift();
  const measuredShift = useSharedValue(0);
  const measurementGeneration = useRef(0);
  const canMeasure = visible && (options.length === 0 || selectedIndex >= 0);

  const remeasure = useCallback(() => {
    if (!canMeasure) return;
    const anchorElement = anchorRef.current;
    const hostElement = hostRef.current;
    if (!anchorElement || !hostElement) return;
    const generation = measurementGeneration.current;
    void Promise.all([measureElement(anchorElement), measureElement(hostElement)]).then(
      ([anchorRect, hostRect]) => {
        if (
          generation !== measurementGeneration.current ||
          anchorRect.width <= 0 ||
          anchorRect.height <= 0 ||
          hostRect.width <= 0 ||
          hostRect.height <= 0
        )
          return undefined;
        setRelativeAnchorRect({
          x: anchorRect.x - hostRect.x,
          y: anchorRect.y - hostRect.y,
          width: anchorRect.width,
          hostHeight: hostRect.height,
        });
        measuredShift.value = shift.value;
        return undefined;
      },
    );
  }, [anchorRef, canMeasure, hostRef, measuredShift, shift]);

  useEffect(() => {
    measurementGeneration.current += 1;
    if (!canMeasure) {
      setRelativeAnchorRect(null);
      return;
    }

    remeasure();
    const raf = requestAnimationFrame(remeasure);

    return () => {
      measurementGeneration.current += 1;
      cancelAnimationFrame(raf);
    };
  }, [canMeasure, remeasure, layoutRevision, windowDimensions.width, windowDimensions.height]);

  useAnimatedReaction(
    () => isMoving.value,
    (moving, wasMoving) => {
      if (wasMoving && !moving) {
        scheduleOnRN(remeasure);
      }
    },
    [isMoving, remeasure],
  );

  const baseStyle = useMemo(() => {
    if (!relativeAnchorRect) return null;
    return inlineUnistylesStyle({
      position: "absolute" as const,
      left: relativeAnchorRect.x,
      width: relativeAnchorRect.width,
    });
  }, [relativeAnchorRect]);

  const anchorY = relativeAnchorRect?.y ?? 0;
  const baseBottom = relativeAnchorRect
    ? relativeAnchorRect.hostHeight - relativeAnchorRect.y + OFFSET_FROM_ANCHOR
    : 0;
  const keyboardLayoutStyle = useAnimatedStyle(() => {
    const shiftDelta = shift.value - measuredShift.value;
    return {
      bottom: baseBottom + shiftDelta,
      maxHeight: Math.max(0, anchorY - shiftDelta - safeAreaInsets.top - OFFSET_FROM_ANCHOR * 2),
    };
  }, [anchorY, baseBottom, safeAreaInsets.top]);

  if (!visible || !relativeAnchorRect || !baseStyle) return null;
  if (options.length > 0 && selectedIndex < 0) return null;

  return (
    <Portal key={portalHostName} hostName={portalHostName}>
      <View style={styles.overlay} pointerEvents="box-none">
        <Animated.View
          testID="composer-autocomplete-popover"
          style={[baseStyle, keyboardLayoutStyle]}
        >
          <Autocomplete
            header={header}
            options={options}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            isLoading={isLoading}
            errorMessage={errorMessage}
            loadingText={loadingText}
            emptyText={emptyText}
          />
        </Animated.View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create(() => ({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
}));
