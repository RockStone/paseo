import { describe, expect, it } from "vitest";
import { formatContextPercentage, meterPresentation } from "./context-window-meter.utils";

describe("context window meter formatting", () => {
  it("localizes percentages without hiding context overflow", () => {
    expect(formatContextPercentage(125, "en")).toBe("125%");
    expect(formatContextPercentage(42, "fr")).toBe("42\u00a0%");
  });
});

describe("meterPresentation", () => {
  it("uses the sheet on compact layouts and wherever there is no fine pointer", () => {
    expect(meterPresentation({ isCompact: true, finePointer: true })).toBe("sheet");
    expect(meterPresentation({ isCompact: false, finePointer: false })).toBe("sheet");
  });

  it("keeps the hover card for a wide layout with a mouse", () => {
    expect(meterPresentation({ isCompact: false, finePointer: true })).toBe("hover-card");
  });
});
