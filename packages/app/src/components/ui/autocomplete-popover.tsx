import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { Portal } from "@gorhom/portal";
import Animated, { useAnimatedReaction, useAnimatedStyle } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import { useFloatingPanelPortal } from "@/components/ui/floating-panel-portal";
import { KeyboardTranslateView, useKeyboardAnchor, useKeyboardShift } from "@/keyboard/shift";
import { measureElement } from "./anchor";
import { SPACING } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const OFFSET_FROM_ANCHOR = SPACING[3];

interface RelativeAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
  hostHeight: number;
}

/**
 * Where the list floats: above the anchor, or over the top of an anchor too tall to have
 * room above it (a composer that fills its column).
 */
export type AutocompletePlacement = "above" | "inside-top";

interface AutocompletePopoverProps {
  header?: ReactNode;
  visible: boolean;
  children: ReactNode;
  anchorStyle?: StyleProp<ViewStyle>;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  loadingText?: string;
  emptyText?: string;
  placement?: AutocompletePlacement;
}

export function AutocompletePopover({
  header,
  visible,
  children,
  anchorStyle,
  options,
  selectedIndex,
  onSelect,
  isLoading,
  errorMessage,
  loadingText,
  emptyText,
  placement = "above",
}: AutocompletePopoverProps): ReactElement | null {
  "use no memo";
  // React Compiler memoizes effect captures by reading SharedValue.value during render.
  const anchorRef = useRef<View>(null);
  const [relativeAnchorRect, setRelativeAnchorRect] = useState<RelativeAnchorRect | null>(null);
  const windowDimensions = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const { hostName: portalHostName, hostRef, layoutRevision } = useFloatingPanelPortal();
  const { isMoving } = useKeyboardShift();
  const anchor = useKeyboardAnchor();
  const { measureAtRest } = anchor;
  const measurementGeneration = useRef(0);
  const canMeasure = visible && (options.length === 0 || selectedIndex >= 0);

  const remeasure = useCallback(() => {
    if (!canMeasure) return;
    const anchorElement = anchorRef.current;
    const hostElement = hostRef.current;
    if (!anchorElement || !hostElement) return;
    const generation = measurementGeneration.current;
    void Promise.all([measureAtRest(anchorElement), measureElement(hostElement)]).then(
      ([anchorRect, hostRect]) => {
        if (
          generation !== measurementGeneration.current ||
          !anchorRect ||
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
          height: anchorRect.height,
          hostHeight: hostRect.height,
        });
        return undefined;
      },
    );
  }, [anchorRef, canMeasure, hostRef, measureAtRest]);

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

  // Lay out at the anchor's resting position; the KeyboardTranslateView below lifts
  // it with the anchor. Height changes only at keyboard boundaries.
  const baseStyle = useMemo(() => {
    if (!relativeAnchorRect) return null;
    if (placement === "inside-top") {
      return inlineUnistylesStyle({
        position: "absolute" as const,
        left: relativeAnchorRect.x + OFFSET_FROM_ANCHOR,
        width: Math.max(0, relativeAnchorRect.width - OFFSET_FROM_ANCHOR * 2),
        top: relativeAnchorRect.y + OFFSET_FROM_ANCHOR,
      });
    }
    return inlineUnistylesStyle({
      position: "absolute" as const,
      left: relativeAnchorRect.x,
      width: relativeAnchorRect.width,
      bottom: relativeAnchorRect.hostHeight - relativeAnchorRect.y + OFFSET_FROM_ANCHOR,
    });
  }, [placement, relativeAnchorRect]);

  // Above, the list may use the space up to the safe area. Inside the anchor, half its
  // height leaves the lower text and the toolbar visible.
  const availableHeight =
    placement === "inside-top"
      ? (relativeAnchorRect?.height ?? 0) / 2
      : (relativeAnchorRect?.y ?? 0) - safeAreaInsets.top - OFFSET_FROM_ANCHOR * 2;
  const reservedLift = anchor.reservedLift;
  const heightStyle = useAnimatedStyle(
    () => ({
      maxHeight: Math.max(0, availableHeight - reservedLift.value),
    }),
    [availableHeight, reservedLift],
  );

  const showPopover = canMeasure && relativeAnchorRect && baseStyle;

  // The translate view is the popover's own frame, so it lifts only the popover.
  return (
    <View ref={anchorRef} onLayout={remeasure} style={anchorStyle} collapsable={false}>
      {children}
      {showPopover ? (
        <Portal key={portalHostName} hostName={portalHostName}>
          <KeyboardTranslateView {...anchor.translation} style={baseStyle}>
            <Animated.View testID="composer-autocomplete-popover" style={heightStyle}>
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
          </KeyboardTranslateView>
        </Portal>
      ) : null}
    </View>
  );
}
