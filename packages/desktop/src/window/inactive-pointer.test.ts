import { describe, expect, it } from "vitest";

import { shouldTrackInactivePointer, toWindowPoint } from "./inactive-pointer";

const inactive = {
  requested: true,
  destroyed: false,
  focused: false,
  visible: true,
  minimized: false,
};

describe("shouldTrackInactivePointer", () => {
  it("polls only for a visible, unfocused window whose renderer asked", () => {
    expect(shouldTrackInactivePointer(inactive)).toBe(true);
  });

  it.each([
    ["not requested", { requested: false }],
    ["focused", { focused: true }],
    ["hidden", { visible: false }],
    ["minimized", { minimized: true }],
    ["destroyed", { destroyed: true }],
  ])("stops when %s", (_label, override) => {
    expect(shouldTrackInactivePointer({ ...inactive, ...override })).toBe(false);
  });
});

describe("toWindowPoint", () => {
  it("maps screen DIPs to window CSS pixels, including points left of the window", () => {
    expect(toWindowPoint({ x: 150, y: 260 }, { x: 100, y: 60 }, 1)).toEqual({ x: 50, y: 200 });
    expect(toWindowPoint({ x: 90, y: 260 }, { x: 100, y: 60 }, 2)).toEqual({ x: -5, y: 100 });
  });

  it("treats a non-positive zoom factor as 1", () => {
    expect(toWindowPoint({ x: 110, y: 70 }, { x: 100, y: 60 }, 0)).toEqual({ x: 10, y: 10 });
  });
});
