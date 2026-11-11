import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useOverlayRegistration, type KeyboardInputEvent } from "@/keyboard";
import { getOverlayRoot, OverlayLayerProvider, useOverlayLayer } from "@/lib/overlay-root";
import type { EdgeDrawerLayerProps } from "./edge-drawer-layer";

export type { EdgeDrawerLayerProps } from "./edge-drawer-layer";

/**
 * Web: a portal into the shared overlay root, at the floating layer, with no backdrop. The rest
 * of the window stays live, so a press outside the drawer both closes it and reaches its target.
 * A press on the trigger is left to the trigger, which toggles the drawer closed. Presses inside
 * the overlay root belong to layers painted above the drawer (toasts, tooltips, a menu the drawer
 * opened) and leave it open.
 */
export function EdgeDrawerLayer({ active, onClose, triggerRef, children }: EdgeDrawerLayerProps) {
  const layer = useOverlayLayer("floating");
  const scopeRef = useRef<HTMLElement | null>(null);
  const handleKeyDown = useCallback(
    (event: KeyboardInputEvent) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      onClose();
      return true;
    },
    [onClose],
  );
  const setRegistrationScope = useOverlayRegistration({
    keys: ["Escape"],
    active,
    layer,
    onKeyDown: handleKeyDown,
    restoreFocusRef: triggerRef,
  });
  const setScope = useCallback(
    (node: unknown) => {
      scopeRef.current = node instanceof HTMLElement ? node : null;
      setRegistrationScope(node);
    },
    [setRegistrationScope],
  );

  useEffect(() => {
    if (!active) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (scopeRef.current?.contains(target)) return;
      const trigger: unknown = triggerRef.current;
      if (trigger instanceof HTMLElement && trigger.contains(target)) return;
      if (getOverlayRoot().contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [active, onClose, triggerRef]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <OverlayLayerProvider layer={layer}>
      <View ref={setScope} style={[styles.layer, { zIndex: layer }]}>
        {children}
      </View>
    </OverlayLayerProvider>,
    getOverlayRoot(),
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: "box-none",
  },
});
