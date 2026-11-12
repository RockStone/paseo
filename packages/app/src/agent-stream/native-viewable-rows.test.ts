import { describe, expect, it, vi } from "vitest";
import { createReadingRowReporter, nativeReadingRows } from "./native-viewable-rows";

const row = (index: number) => ({ index, item: { id: `row-${index}` } });

describe("nativeReadingRows", () => {
  it("returns the first and last fully visible rows by index", () => {
    expect(nativeReadingRows([row(4), row(2), row(3)])).toEqual({
      topRowId: "row-2",
      readThroughRowId: "row-4",
    });
  });

  it("returns null when no row is fully visible", () => {
    expect(nativeReadingRows([])).toBeNull();
  });
});

describe("createReadingRowReporter", () => {
  it("reports each id once until it changes", () => {
    const onReadingPositionChange = vi.fn();
    const onReadThroughChange = vi.fn();
    const reporter = createReadingRowReporter({ onReadingPositionChange, onReadThroughChange });
    reporter.report({ topRowId: "a", readThroughRowId: "c" });
    reporter.report({ topRowId: "a", readThroughRowId: "c" });
    reporter.report({ topRowId: "b", readThroughRowId: "c" });
    expect(onReadingPositionChange.mock.calls).toEqual([["a"], ["b"]]);
    expect(onReadThroughChange.mock.calls).toEqual([["c"]]);
  });

  it("reports again after a reset", () => {
    const onReadingPositionChange = vi.fn();
    const reporter = createReadingRowReporter({
      onReadingPositionChange,
      onReadThroughChange: vi.fn(),
    });
    reporter.report({ topRowId: "a", readThroughRowId: "c" });
    reporter.reset();
    reporter.report({ topRowId: "a", readThroughRowId: "c" });
    expect(onReadingPositionChange).toHaveBeenCalledTimes(2);
  });
});
