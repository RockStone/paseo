/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useHoverSafeZone } from "./use-hover-safe-zone";
import { crossesSidebarEdge, useSidebarEdgeReveal } from "./use-sidebar-edge-reveal";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function sidebarRef() {
  const current = document.createElement("div");
  current.getBoundingClientRect = () => ({
    left: 0,
    right: 280,
    top: 0,
    bottom: 800,
    width: 280,
    height: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return { current };
}

test("native pointer polling keeps the sidebar open within half its width and stops on unmount", async () => {
  vi.useFakeTimers();
  const ref = sidebarRef();
  let point = { x: -139, y: 100 };
  const readWindowPointer = vi.fn(async () => point);
  const leave = vi.fn();
  const { unmount } = renderHook(() =>
    useHoverSafeZone({
      enabled: true,
      triggerRef: ref,
      contentRef: ref,
      margin: ref.current.getBoundingClientRect().width / 2,
      leaveDelayMs: 180,
      readWindowPointer,
      onEnterSafeZone: () => {},
      onLeaveSafeZone: leave,
    }),
  );
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerout", { relatedTarget: null }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(leave).not.toHaveBeenCalled();
  point = { x: -141, y: 100 };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(leave).toHaveBeenCalledTimes(1);
  unmount();
  const reads = readWindowPointer.mock.calls.length;
  await vi.advanceTimersByTimeAsync(500);
  expect(readWindowPointer).toHaveBeenCalledTimes(reads);
});

test("a late native pointer result cannot dismiss the sidebar after the pointer reenters", async () => {
  vi.useFakeTimers();
  const ref = sidebarRef();
  let finish!: (point: { x: number; y: number }) => void;
  const readWindowPointer = () =>
    new Promise<{ x: number; y: number }>((resolve) => {
      finish = resolve;
    });
  const leave = vi.fn();
  renderHook(() =>
    useHoverSafeZone({
      enabled: true,
      triggerRef: ref,
      contentRef: ref,
      readWindowPointer,
      onEnterSafeZone: () => {},
      onLeaveSafeZone: leave,
    }),
  );
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerout", { relatedTarget: null }));
  });
  act(() => {
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 100 }));
  });
  await act(async () => {
    finish({ x: -100, y: 100 });
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(leave).not.toHaveBeenCalled();
});

test.each([
  [250, -80],
  [-80, 250],
])("a fast crossing from x=%s to x=%s reveals without landing on the strip", (from, to) => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const reveal = vi.fn();
  renderHook(() =>
    useSidebarEdgeReveal({ enabled: true, triggerRef: sidebarRef(), onReveal: reveal }),
  );
  act(() => {
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: from, clientY: 300 }));
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: to, clientY: 300 }));
  });
  expect(reveal).toHaveBeenCalledTimes(1);
});

test("native samples reveal on reentry from outside and stop after cleanup", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  let point = { x: -80, y: 300 };
  const read = vi.fn(async () => point);
  const reveal = vi.fn();
  const { unmount } = renderHook(() =>
    useSidebarEdgeReveal({
      enabled: true,
      triggerRef: sidebarRef(),
      onReveal: reveal,
      readWindowPointer: read,
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(40);
  });
  expect(reveal).not.toHaveBeenCalled();
  point = { x: 90, y: 300 };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(40);
  });
  expect(reveal).toHaveBeenCalledTimes(1);
  unmount();
  const reads = read.mock.calls.length;
  await vi.advanceTimersByTimeAsync(100);
  expect(read).toHaveBeenCalledTimes(reads);
});

test("crossings outside the sidebar height and movement within the window do not reveal", () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const reveal = vi.fn();
  renderHook(() =>
    useSidebarEdgeReveal({ enabled: true, triggerRef: sidebarRef(), onReveal: reveal }),
  );
  act(() => {
    for (const x of [250, -80, 100, 10]) {
      document.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: 900 }));
    }
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 300 }));
  });
  expect(reveal).not.toHaveBeenCalled();
});

test("a preview revealed after pointerout still tracks an outside pointer immediately", async () => {
  vi.useFakeTimers();
  const ref = sidebarRef();
  const leave = vi.fn();
  renderHook(() =>
    useHoverSafeZone({
      enabled: true,
      triggerRef: ref,
      contentRef: ref,
      margin: 140,
      leaveDelayMs: 180,
      readWindowPointer: async () => ({ x: -200, y: 300 }),
      onEnterSafeZone: () => {},
      onLeaveSafeZone: leave,
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(leave).toHaveBeenCalledTimes(1);
});

function inactivePointerStream() {
  const listeners = new Set<(point: { x: number; y: number }) => void>();
  return {
    subscribe: vi.fn((listener: (point: { x: number; y: number }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(point: { x: number; y: number }) {
      for (const listener of listeners) listener(point);
    },
    get size() {
      return listeners.size;
    },
  };
}

test("an inactive window reveals from streamed cursor samples and unsubscribes on cleanup", () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const stream = inactivePointerStream();
  const reveal = vi.fn();
  const { unmount } = renderHook(() =>
    useSidebarEdgeReveal({
      enabled: true,
      triggerRef: sidebarRef(),
      onReveal: reveal,
      subscribeInactivePointer: stream.subscribe,
    }),
  );
  act(() => {
    stream.emit({ x: -60, y: 300 });
    stream.emit({ x: -10, y: 300 });
  });
  expect(reveal).not.toHaveBeenCalled();
  act(() => {
    stream.emit({ x: 40, y: 300 });
  });
  expect(reveal).toHaveBeenCalledTimes(1);
  unmount();
  expect(stream.size).toBe(0);
});

test("streamed samples dismiss an inactive window's preview once the cursor leaves the margin", async () => {
  vi.useFakeTimers();
  const ref = sidebarRef();
  const stream = inactivePointerStream();
  const leave = vi.fn();
  const { unmount } = renderHook(() =>
    useHoverSafeZone({
      enabled: true,
      triggerRef: ref,
      contentRef: ref,
      margin: 140,
      leaveDelayMs: 180,
      subscribeInactivePointer: stream.subscribe,
      onEnterSafeZone: () => {},
      onLeaveSafeZone: leave,
    }),
  );
  act(() => {
    stream.emit({ x: 400, y: 300 });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(leave).not.toHaveBeenCalled();
  act(() => {
    stream.emit({ x: 600, y: 300 });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(leave).toHaveBeenCalledTimes(1);
  unmount();
  expect(stream.size).toBe(0);
});

test("crossesSidebarEdge detects crossings in either direction within the strip height", () => {
  const rect = { left: 0, top: 40, bottom: 800 };
  expect(crossesSidebarEdge({ x: -20, y: 300 }, { x: 30, y: 300 }, rect)).toBe(true);
  expect(crossesSidebarEdge({ x: 30, y: 300 }, { x: -20, y: 300 }, rect)).toBe(true);
  expect(crossesSidebarEdge({ x: 30, y: 300 }, { x: 0, y: 300 }, rect)).toBe(true);
  expect(crossesSidebarEdge({ x: -20, y: 300 }, { x: -1, y: 300 }, rect)).toBe(false);
  expect(crossesSidebarEdge({ x: -20, y: 10 }, { x: 30, y: 10 }, rect)).toBe(false);
  expect(crossesSidebarEdge({ x: 0, y: 100 }, { x: 0, y: 200 }, rect)).toBe(false);
});
