/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Platform } from "react-native";
import { IOS_TEARDOWN_GRACE_MS, MenuOpenTrackerProvider, useMenuState } from "./menu-context";

/**
 * `Platform.OS` is a plain property on the react-native-web double, so the iOS branch is
 * reachable by writing to it. The grace period only exists on iOS, which is exactly the platform
 * whose selections used to be dropped.
 */
const originalPlatform = Platform.OS;

function setPlatform(os: string) {
  Object.assign(Platform, { OS: os });
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  setPlatform(originalPlatform);
});

describe("useMenuState selectItem on iOS", () => {
  beforeEach(() => setPlatform("ios"));

  it("runs a closing item's action once the surface has had time to go away", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useMenuState({ defaultOpen: true }));

    act(() => result.current.selectItem(onSelect, true));
    expect(result.current.open).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(IOS_TEARDOWN_GRACE_MS));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("leaves the menu open for an item that does not close it", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useMenuState({ defaultOpen: true }));

    act(() => result.current.selectItem(onSelect, false));
    expect(result.current.open).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("useMenuState selectItem elsewhere", () => {
  beforeEach(() => setPlatform("android"));

  it("runs a closing item's action immediately", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useMenuState({ defaultOpen: true }));

    act(() => result.current.selectItem(onSelect, true));
    expect(result.current.open).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("useMenuState pages", () => {
  it("pops the open page on Back and leaves Back at the root to the surface", () => {
    const { result } = renderHook(() => useMenuState({ defaultOpen: true }));
    act(() => result.current.openSub({ id: "row", depth: 0 }));

    let handled = false;
    act(() => {
      handled = result.current.goBack();
    });
    expect(handled).toBe(true);
    expect(result.current.path).toEqual([]);

    act(() => {
      handled = result.current.goBack();
    });
    expect(handled).toBe(false);
    expect(result.current.open).toBe(true);
  });

  it("falls back to the list when the open page's definition goes away", () => {
    const { result } = renderHook(() => useMenuState({ defaultOpen: true }));
    act(() => result.current.openSub({ id: "row", depth: 0 }));

    const keepNoPage = () => false;
    act(() => result.current.prunePages(keepNoPage));

    expect(result.current.path).toEqual([]);
    let handled = true;
    act(() => {
      handled = result.current.goBack();
    });
    expect(handled).toBe(false);
  });
});

describe("useMenuState open tracking", () => {
  it("reports each open span to the region that renders the menu", () => {
    const closed = vi.fn();
    const track = vi.fn(() => closed);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MenuOpenTrackerProvider value={track}>{children}</MenuOpenTrackerProvider>
    );
    const { result, unmount } = renderHook(() => useMenuState({}), { wrapper });
    expect(track).not.toHaveBeenCalled();

    act(() => result.current.setOpen(true));
    expect(track).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();

    act(() => result.current.selectItem(vi.fn(), true));
    expect(closed).toHaveBeenCalledTimes(1);

    act(() => result.current.setOpen(true));
    unmount();
    expect(track).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenCalledTimes(2);
  });
});
