/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useHoverSafeZone } from "./use-hover-safe-zone";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

test("native pointer polling keeps the sidebar open near the window and stops on unmount", async () => {
  vi.useFakeTimers();
  const ref = sidebarRef();
  let point = { x: -24, y: 100 };
  const readWindowPointer = vi.fn(async () => point);
  const leave = vi.fn();
  const { unmount } = renderHook(() =>
    useHoverSafeZone({
      enabled: true,
      triggerRef: ref,
      contentRef: ref,
      margin: 32,
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
  point = { x: -40, y: 100 };
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
