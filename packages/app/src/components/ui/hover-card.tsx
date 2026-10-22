import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { Dimensions, View, type Role, type StyleProp, type ViewStyle } from "react-native";
import { FadeOut } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { Portal } from "@gorhom/portal";
import { createPortal, flushSync } from "react-dom";
import { useBottomSheetModalInternal } from "@gorhom/bottom-sheet";
import {
  OverlayLayerProvider,
  useOverlayLayer,
  useWebOverlayRegistration,
  getOverlayRoot,
} from "@/lib/overlay-root";
import { FloatingSurface } from "@/components/ui/floating";
import { isWeb } from "@/constants/platform";
import { useHoverSafeZone } from "@/hooks/use-hover-safe-zone";
import { computePosition, type Alignment, type Placement } from "./anchor";

const CLOSE_GRACE_MS = 100;

interface HoverCardGroupValue {
  claim: (dismiss: () => void) => void;
  release: (dismiss: () => void) => void;
}

const HoverCardGroupContext = createContext<HoverCardGroupValue | null>(null);

export function HoverCardGroup({ children }: { children: ReactNode }): ReactElement {
  const activeDismissRef = useRef<(() => void) | null>(null);
  const claim = useCallback((dismiss: () => void) => {
    const previous = activeDismissRef.current;
    activeDismissRef.current = dismiss;
    if (previous !== dismiss) previous?.();
  }, []);
  const release = useCallback((dismiss: () => void) => {
    if (activeDismissRef.current === dismiss) activeDismissRef.current = null;
  }, []);
  const value = useMemo(() => ({ claim, release }), [claim, release]);
  return <HoverCardGroupContext.Provider value={value}>{children}</HoverCardGroupContext.Provider>;
}

interface HoverCardContextValue {
  open: boolean;
  layer: number;
  setTriggerRef: (node: View | HTMLElement | null) => void;
  triggerRef: RefObject<View | HTMLElement | null>;
  contentRef: RefObject<View | null>;
  openNow: () => void;
  scheduleClose: () => void;
  dismiss: () => void;
}

const HoverCardContext = createContext<HoverCardContextValue | null>(null);

export function useHoverCardDismiss(): (() => void) | undefined {
  return useContext(HoverCardContext)?.dismiss;
}

/**
 * A card that opens while the pointer is on its trigger and stays open while the pointer crosses
 * onto it, so its content can be pressed. Hover only exists on web; elsewhere the trigger renders
 * alone and the content never mounts. See docs/hover.md.
 *
 * ```tsx
 * <HoverCard>
 *   <HoverCardTrigger>{trigger}</HoverCardTrigger>
 *   <HoverCardContent placement="top">{details}</HoverCardContent>
 * </HoverCard>
 * ```
 */
export function HoverCard({
  disabled = false,
  children,
}: {
  /** Closes the card and keeps it closed, e.g. while its trigger is dragged. */
  disabled?: boolean;
  children: ReactNode;
}): ReactNode {
  if (!isWeb) return children;
  return <WebHoverCard disabled={disabled}>{children}</WebHoverCard>;
}

function WebHoverCard({
  disabled,
  children,
}: {
  disabled: boolean;
  children: ReactNode;
}): ReactElement {
  const group = useContext(HoverCardGroupContext);
  const layer = useOverlayLayer("floating");
  const triggerRef = useRef<View | HTMLElement>(null);
  const contentRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read when focus arrives: by focusout the element losing focus no longer matches :focus-visible.
  const keyboardFocusedRef = useRef(false);

  const clearGraceTimer = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(
    function dismiss() {
      clearGraceTimer();
      setOpen(false);
      group?.release(dismiss);
    },
    [clearGraceTimer, group],
  );

  const focusInside = useCallback(() => {
    if (!isWeb) return false;
    const active = document.activeElement;
    return [triggerRef.current, contentRef.current].some((view) =>
      (view as unknown as HTMLElement | null)?.contains(active),
    );
  }, []);

  // Keyboard focus keeps the card open for keyboard users; the focus a pointer click leaves
  // behind on the trigger or a button in the card does not outlast the pointer leaving.
  const keyboardFocusInside = useCallback(() => {
    return focusInside() && document.activeElement?.matches(":focus-visible") === true;
  }, [focusInside]);

  const scheduleClose = useCallback(() => {
    if (keyboardFocusInside()) return;
    if (graceTimerRef.current) return;
    graceTimerRef.current = setTimeout(() => {
      graceTimerRef.current = null;
      if (keyboardFocusInside()) return;
      dismiss();
    }, CLOSE_GRACE_MS);
  }, [dismiss, keyboardFocusInside]);

  const openNow = useCallback(() => {
    clearGraceTimer();
    if (!disabled) {
      group?.claim(dismiss);
      setOpen(true);
    }
  }, [clearGraceTimer, disabled, dismiss, group]);

  const keyPressed = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!isWeb) return false;
      const trigger = triggerRef.current as unknown as HTMLElement | null;
      if (!trigger) return false;
      if (event.key === "Escape" && open) {
        event.preventDefault();
        if (focusInside()) trigger.focus();
        dismiss();
        return true;
      } else if (
        focusInside() &&
        event.target === trigger &&
        ["ArrowDown", "Enter", " "].includes(event.key)
      ) {
        event.preventDefault();
        openNow();
        requestAnimationFrame(() => {
          (contentRef.current as unknown as HTMLElement | null)
            ?.querySelector<HTMLElement>(
              ':is(button, [role="button"][tabindex="0"], a[href], input, [tabindex="0"]):not(:disabled):not([aria-disabled="true"])',
            )
            ?.focus();
        });
        return true;
      }
      return false;
    },
    [dismiss, focusInside, open, openNow],
  );

  const setOverlayScope = useWebOverlayRegistration({
    active: !disabled && open,
    layer,
    onKeyDown: keyPressed,
    manageFocus: false,
  });
  const setTriggerRef = useCallback(
    (node: View | HTMLElement | null) => {
      triggerRef.current = node;
      setOverlayScope(node);
    },
    [setOverlayScope],
  );

  useEffect(() => {
    if (!isWeb) return;
    const trigger = triggerRef.current as unknown as HTMLElement | null;
    if (!trigger) return;
    const close = dismiss;
    const focusEntered = (event: FocusEvent) => {
      const target = event.target as Element;
      keyboardFocusedRef.current = target.matches(":focus-visible");
      if (trigger.contains(target)) {
        openNow();
      } else if ((contentRef.current as unknown as HTMLElement | null)?.contains(target)) {
        clearGraceTimer();
      }
    };
    // Only keyboard focus keeps the card open, so only losing keyboard focus closes it. A button
    // that disables itself on press drops pointer focus while the pointer is still on the card.
    const focusLeft = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (
        keyboardFocusedRef.current &&
        !trigger.contains(next) &&
        !(contentRef.current as unknown as HTMLElement | null)?.contains(next)
      ) {
        scheduleClose();
      }
    };
    const activateClosedTrigger = (event: KeyboardEvent) => {
      if (
        !open &&
        !event.defaultPrevented &&
        !event.isComposing &&
        ["ArrowDown", "Enter", " "].includes(event.key)
      )
        keyPressed(event);
    };
    const scrolled = (event: Event) => {
      const target = event.target;
      // Chat auto-scroll does not move the composer anchor. Only an ancestor scroll does.
      if (
        target instanceof Node &&
        target.contains(trigger) &&
        !(contentRef.current as unknown as HTMLElement | null)?.contains(target)
      )
        close();
    };
    document.addEventListener("focusin", focusEntered);
    document.addEventListener("focusout", focusLeft);
    trigger.addEventListener("keydown", activateClosedTrigger);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("focusin", focusEntered);
      document.removeEventListener("focusout", focusLeft);
      trigger.removeEventListener("keydown", activateClosedTrigger);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
    };
  }, [clearGraceTimer, dismiss, keyPressed, open, openNow, scheduleClose]);

  // While open, the safe zone covers trigger + content + the bridge between
  // them. Close only fires when the pointer leaves the safe zone; re-entering
  // it (including the bridge) cancels the pending close.
  useHoverSafeZone({
    enabled: open,
    triggerRef,
    contentRef,
    onEnterSafeZone: clearGraceTimer,
    onLeaveSafeZone: scheduleClose,
  });

  useEffect(() => {
    if (disabled) {
      dismiss();
    }
  }, [disabled, dismiss]);

  useEffect(
    () => () => {
      clearGraceTimer();
      group?.release(dismiss);
    },
    [clearGraceTimer, dismiss, group],
  );

  const value = useMemo<HoverCardContextValue>(
    () => ({ open, layer, setTriggerRef, triggerRef, contentRef, openNow, scheduleClose, dismiss }),
    [open, layer, setTriggerRef, openNow, scheduleClose, dismiss],
  );

  return (
    <OverlayLayerProvider layer={layer}>
      <HoverCardContext.Provider value={value}>{children}</HoverCardContext.Provider>
    </OverlayLayerProvider>
  );
}

export function HoverCardTrigger({
  children,
  inline = false,
  focusable = false,
  accessibilityLabel,
}: {
  children: ReactNode;
  inline?: boolean;
  focusable?: boolean;
  accessibilityLabel?: string;
}): ReactNode {
  const ctx = useContext(HoverCardContext);
  if (!ctx) return children;
  if (isWeb && inline)
    return (
      <span
        ref={ctx.setTriggerRef}
        onMouseEnter={ctx.openNow}
        onMouseLeave={ctx.scheduleClose}
        tabIndex={focusable ? 0 : undefined}
        aria-label={accessibilityLabel}
      >
        {children}
      </span>
    );
  return (
    <View
      ref={ctx.setTriggerRef}
      tabIndex={focusable ? 0 : undefined}
      accessibilityRole={focusable ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      collapsable={false}
      onPointerEnter={ctx.openNow}
      onPointerLeave={ctx.scheduleClose}
    >
      {children}
    </View>
  );
}

interface HoverCardContentProps {
  placement: Placement;
  alignment?: Alignment;
  offset?: number;
  /** Layered over the default popover surface. */
  style?: StyleProp<ViewStyle>;
  role?: Role;
  accessibilityLabel?: string;
  testID?: string;
  /** Mounted only while the card is open, so whatever it fetches runs only then. */
  children: ReactNode;
}

export function HoverCardContent(props: HoverCardContentProps): ReactElement | null {
  const ctx = useContext(HoverCardContext);
  if (!ctx?.open) return null;
  return (
    <HoverCardSurface
      {...props}
      layer={ctx.layer}
      triggerRef={ctx.triggerRef}
      contentRef={ctx.contentRef}
    />
  );
}

function HoverCardSurface({
  layer,
  triggerRef,
  contentRef,
  placement,
  alignment = "center",
  offset = 4,
  style,
  role,
  accessibilityLabel,
  testID,
  children,
}: HoverCardContentProps & {
  layer: number;
  triggerRef: RefObject<View | HTMLElement | null>;
  contentRef: RefObject<View | null>;
}): ReactElement {
  const group = useContext(HoverCardGroupContext);
  const bottomSheetInternal = useBottomSheetModalInternal(true);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!isWeb) return;
    const trigger = triggerRef.current as HTMLElement | null;
    const content = contentRef.current as unknown as HTMLElement | null;
    if (!trigger || !content) return;
    const update = () => {
      const { width, height } = Dimensions.get("window");
      const { x, y } = computePosition({
        triggerRect: trigger.getBoundingClientRect(),
        contentSize: content.getBoundingClientRect(),
        displayArea: { x: 0, y: 0, width, height },
        placement,
        flipHorizontal: true,
        alignment,
        offset,
      });
      setPosition((previous) => (previous?.x === x && previous.y === y ? previous : { x, y }));
    };
    // Measure at the real available width before revealing the surface. RN's onLayout
    // arrives after paint; streaming usage can otherwise paint at the previous height.
    update();
    const observer = new ResizeObserver(() => flushSync(update));
    observer.observe(content, { box: "border-box" });
    observer.observe(trigger, { box: "border-box" });
    return () => observer.disconnect();
  }, [alignment, contentRef, offset, placement, triggerRef]);

  const frameStyle = useMemo(
    () => ({
      position: "absolute" as const,
      top: position?.y ?? 0,
      left: position?.x ?? 0,
      opacity: position ? 1 : 0,
    }),
    [position],
  );
  const surfaceStyle = useMemo(() => [styles.surface, style], [style]);

  const overlay = (
    <View pointerEvents="box-none" style={[styles.portalOverlay, { zIndex: layer }]}>
      <FloatingSurface
        ref={contentRef}
        exiting={group ? undefined : FadeOut.duration(80)}
        collapsable={false}
        role={role}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={surfaceStyle}
        frameStyle={frameStyle}
      >
        {children}
      </FloatingSurface>
    </View>
  );
  // Menus live in the web overlay root. An app-local Portal cannot rise above
  // their backdrop regardless of the card's z-index inside that stacking context.
  if (isWeb) return createPortal(overlay, getOverlayRoot());
  return <Portal hostName={bottomSheetInternal?.hostName}>{overlay}</Portal>;
}

const styles = StyleSheet.create((theme) => ({
  portalOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
  },
  surface: {
    backgroundColor: theme.colors.popover,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.xl,
    ...theme.shadow.md,
    zIndex: 1000,
  },
}));
