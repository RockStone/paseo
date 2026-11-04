import { useEffect, type RefObject } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";

interface Point {
  x: number;
  y: number;
}

export function useSidebarEdgeReveal({
  enabled,
  triggerRef,
  onReveal,
  readWindowPointer,
}: {
  enabled: boolean;
  triggerRef: RefObject<View | HTMLElement | null>;
  onReveal: () => void;
  readWindowPointer?: () => Promise<Point | null>;
}) {
  useEffect(() => {
    if (!isWeb || !enabled) return;
    let previous: Point | null = null;
    let disposed = false;
    let revealed = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function sample(point: Point) {
      const from = previous;
      previous = point;
      const node = triggerRef.current as unknown as HTMLElement | null;
      const rect = node?.getBoundingClientRect();
      if (!from || !rect || revealed || !document.hasFocus()) return;
      // Intersect the movement segment with the window boundary. A fast move
      // need not deliver any event inside the narrow DOM edge strip.
      const dx = point.x - from.x;
      if (!dx) return;
      const fraction = (rect.left - from.x) / dx;
      const y = from.y + (point.y - from.y) * fraction;
      if (fraction >= 0 && fraction <= 1 && y >= rect.top && y <= rect.bottom) {
        revealed = true;
        onReveal();
      }
    }

    function stopPolling() {
      generation++;
      clearTimeout(timer);
    }

    async function poll(current: number) {
      const point = await readWindowPointer?.().catch(() => null);
      if (disposed || current !== generation || !point || !document.hasFocus()) return;
      sample(point);
      if (
        !revealed &&
        (point.x < 0 || point.x > window.innerWidth || point.y < 0 || point.y > window.innerHeight)
      ) {
        timer = setTimeout(() => void poll(current), 32);
      }
    }

    function startPolling() {
      stopPolling();
      if (readWindowPointer && document.hasFocus()) void poll(generation);
    }

    function move(event: PointerEvent) {
      stopPolling();
      sample({ x: event.clientX, y: event.clientY });
    }

    function leave(event: PointerEvent) {
      if (event.relatedTarget !== null) return;
      sample({ x: event.clientX, y: event.clientY });
      startPolling();
    }

    function blur() {
      stopPolling();
      previous = null;
    }

    document.addEventListener("pointermove", move, true);
    window.addEventListener("pointerout", leave);
    window.addEventListener("focus", startPolling);
    window.addEventListener("blur", blur);
    startPolling();
    return () => {
      disposed = true;
      stopPolling();
      document.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerout", leave);
      window.removeEventListener("focus", startPolling);
      window.removeEventListener("blur", blur);
    };
  }, [enabled, triggerRef, onReveal, readWindowPointer]);
}
