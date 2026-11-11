import { describe, expect, it } from "vitest";
import { hoverControlsAlwaysVisible } from "./use-hover-controls-always-visible";

describe("hoverControlsAlwaysVisible", () => {
  it("keeps the hover reveal for a desktop mouse, including hybrid touch laptops", () => {
    expect(hoverControlsAlwaysVisible({ finePointer: true, isCompact: false })).toBe(false);
  });

  it("shows controls on a touch tablet running the desktop layout", () => {
    expect(hoverControlsAlwaysVisible({ finePointer: false, isCompact: false })).toBe(true);
  });

  it("shows controls on compact layouts even with a mouse", () => {
    expect(hoverControlsAlwaysVisible({ finePointer: true, isCompact: true })).toBe(true);
  });
});
