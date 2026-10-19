import { useEffect, type RefObject } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";
import { createHoverSafeZoneTracker, type RectLike } from "@/hooks/hover-safe-zone-tracker";

interface UseHoverSafeZoneParams {
  enabled: boolean;
  triggerRef: RefObject<View | HTMLElement | null>;
  contentRef: RefObject<View | HTMLElement | null>;
  onEnterSafeZone: () => void;
  onLeaveSafeZone: () => void;
}

function readRect(
  ref: RefObject<View | HTMLElement | null>,
  visibleMenuSurface = false,
): RectLike | null {
  const node = ref.current as unknown as Element | null;
  // Scroll content extends outside the panel; only its visible viewport keeps hover open.
  const surface = visibleMenuSurface ? node?.closest('[data-menu-surface="true"]') : null;
  return (surface ?? node)?.getBoundingClientRect() ?? null;
}

export function useHoverSafeZone({
  enabled,
  triggerRef,
  contentRef,
  onEnterSafeZone,
  onLeaveSafeZone,
}: UseHoverSafeZoneParams): void {
  useEffect(() => {
    if (!isWeb || !enabled) return;

    const tracker = createHoverSafeZoneTracker({
      getTriggerRect: () => readRect(triggerRef),
      getContentRect: () => readRect(contentRef, true),
      onEnterSafeZone,
      onLeaveSafeZone,
    });

    function handlePointerMove(event: PointerEvent) {
      tracker.pointerMoved(event.clientX, event.clientY);
    }

    function handlePointerOut(event: PointerEvent) {
      if (event.relatedTarget === null) {
        tracker.pointerLeftWindow();
      }
    }

    function handleBlur() {
      tracker.windowBlurred();
    }

    document.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerout", handlePointerOut);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", handleBlur);
    };
  }, [enabled, triggerRef, contentRef, onEnterSafeZone, onLeaveSafeZone]);
}
