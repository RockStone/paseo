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
  margin?: number;
  leaveDelayMs?: number;
  readWindowPointer?: () => Promise<{ x: number; y: number } | null>;
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
  margin,
  leaveDelayMs = 0,
  readWindowPointer,
}: UseHoverSafeZoneParams): void {
  useEffect(() => {
    if (!isWeb || !enabled) return;

    let disposed = false;
    let outsideWindow = false;
    let pointerGeneration = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelLeave = () => {
      clearTimeout(leaveTimer);
      leaveTimer = undefined;
    };
    const stopPolling = () => {
      outsideWindow = false;
      pointerGeneration++;
      clearTimeout(pollTimer);
    };
    const tracker = createHoverSafeZoneTracker({
      getTriggerRect: () => readRect(triggerRef),
      getContentRect: () => readRect(contentRef, true),
      margin,
      onEnterSafeZone: () => {
        cancelLeave();
        onEnterSafeZone();
      },
      onLeaveSafeZone: () => {
        if (!leaveDelayMs) {
          onLeaveSafeZone();
          return;
        }
        cancelLeave();
        leaveTimer = setTimeout(onLeaveSafeZone, leaveDelayMs);
      },
    });

    async function pollPointer(generation: number) {
      const point = await readWindowPointer?.().catch(() => null);
      if (disposed || !outsideWindow || generation !== pointerGeneration) return;
      if (!point) {
        tracker.pointerLeftWindow();
        return;
      }
      tracker.pointerMoved(point.x, point.y);
      pollTimer = setTimeout(() => {
        void pollPointer(generation);
      }, 50);
    }

    function handlePointerMove(event: PointerEvent) {
      stopPolling();
      tracker.pointerMoved(event.clientX, event.clientY);
    }

    function handlePointerOut(event: PointerEvent) {
      if (event.relatedTarget === null) {
        if (readWindowPointer) {
          stopPolling();
          outsideWindow = true;
          void pollPointer(pointerGeneration);
        } else tracker.pointerLeftWindow();
      }
    }

    function handleBlur() {
      stopPolling();
      tracker.windowBlurred();
    }

    document.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerout", handlePointerOut);
    window.addEventListener("blur", handleBlur);
    return () => {
      disposed = true;
      stopPolling();
      cancelLeave();
      document.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", handleBlur);
    };
  }, [
    enabled,
    triggerRef,
    contentRef,
    onEnterSafeZone,
    onLeaveSafeZone,
    margin,
    leaveDelayMs,
    readWindowPointer,
  ]);
}
