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
import {
  Autocomplete,
  type AutocompleteOption,
  type AutocompleteStatus,
} from "@/components/ui/autocomplete";
import {
  resolveInsideAutocompleteLayout,
  type VerticalSpan,
} from "@/components/ui/autocomplete-utils";
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
  /** Inside placement only: the editor's visible box and its caret line, host-relative. */
  editor: VerticalSpan | null;
  caret: VerticalSpan | null;
}

/**
 * Where the list floats: above the anchor, or inside an anchor too tall to have room above
 * it (a composer that fills its column), on the side away from the caret.
 */
export type AutocompletePlacement = "above" | "inside";

/** Window coordinates of the editor's visible box and its caret line, when known. */
export type AutocompleteCaretReader = () => { editor: VerticalSpan; caret: VerticalSpan } | null;

interface AutocompletePopoverProps {
  header?: ReactNode;
  visible: boolean;
  children: ReactNode;
  anchorStyle?: StyleProp<ViewStyle>;
  options: readonly AutocompleteOption[];
  selectedIndex: number;
  onSelect: (option: AutocompleteOption) => void;
  status?: AutocompleteStatus | null;
  placement?: AutocompletePlacement;
  /** Inside placement reads the caret each time it measures, to keep clear of it. */
  readCaret?: AutocompleteCaretReader;
}

export function AutocompletePopover({
  header,
  visible,
  children,
  anchorStyle,
  options,
  selectedIndex,
  onSelect,
  status,
  placement = "above",
  readCaret,
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
        const caretGeometry = placement === "inside" ? (readCaret?.() ?? null) : null;
        const toHost = (span: VerticalSpan): VerticalSpan => ({
          top: span.top - hostRect.y,
          bottom: span.bottom - hostRect.y,
        });
        setRelativeAnchorRect({
          x: anchorRect.x - hostRect.x,
          y: anchorRect.y - hostRect.y,
          width: anchorRect.width,
          height: anchorRect.height,
          hostHeight: hostRect.height,
          editor: caretGeometry ? toHost(caretGeometry.editor) : null,
          caret: caretGeometry ? toHost(caretGeometry.caret) : null,
        });
        return undefined;
      },
    );
  }, [anchorRef, canMeasure, hostRef, measureAtRest, placement, readCaret]);

  // Inside placement follows the caret: a query that wraps onto the next line can move it
  // into the half the list took. Each keystroke changes the options, so measure again.
  const caretRevision = placement === "inside" ? options : null;

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
  }, [
    canMeasure,
    remeasure,
    layoutRevision,
    windowDimensions.width,
    windowDimensions.height,
    caretRevision,
  ]);

  useAnimatedReaction(
    () => isMoving.value,
    (moving, wasMoving) => {
      if (wasMoving && !moving) {
        scheduleOnRN(remeasure);
      }
    },
    [isMoving, remeasure],
  );

  const insideLayout = useMemo(() => {
    if (placement !== "inside" || !relativeAnchorRect) return null;
    const editor = relativeAnchorRect.editor ?? {
      top: relativeAnchorRect.y,
      bottom: relativeAnchorRect.y + relativeAnchorRect.height,
    };
    return {
      editor,
      ...resolveInsideAutocompleteLayout({
        editor,
        caret: relativeAnchorRect.caret,
        offset: OFFSET_FROM_ANCHOR,
      }),
    };
  }, [placement, relativeAnchorRect]);

  // Lay out at the anchor's resting position; the KeyboardTranslateView below lifts
  // it with the anchor. Height changes only at keyboard boundaries.
  const baseStyle = useMemo(() => {
    if (!relativeAnchorRect) return null;
    if (insideLayout) {
      const horizontal = {
        position: "absolute" as const,
        left: relativeAnchorRect.x + OFFSET_FROM_ANCHOR,
        width: Math.max(0, relativeAnchorRect.width - OFFSET_FROM_ANCHOR * 2),
      };
      return inlineUnistylesStyle(
        insideLayout.edge === "top"
          ? { ...horizontal, top: insideLayout.editor.top + OFFSET_FROM_ANCHOR }
          : {
              ...horizontal,
              bottom:
                relativeAnchorRect.hostHeight - insideLayout.editor.bottom + OFFSET_FROM_ANCHOR,
            },
      );
    }
    return inlineUnistylesStyle({
      position: "absolute" as const,
      left: relativeAnchorRect.x,
      width: relativeAnchorRect.width,
      bottom: relativeAnchorRect.hostHeight - relativeAnchorRect.y + OFFSET_FROM_ANCHOR,
    });
  }, [insideLayout, relativeAnchorRect]);

  // Above, the list may use the space up to the safe area. Inside, it stops short of the
  // caret line.
  const availableHeight = insideLayout
    ? insideLayout.maxHeight
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
                status={status}
              />
            </Animated.View>
          </KeyboardTranslateView>
        </Portal>
      ) : null}
    </View>
  );
}
