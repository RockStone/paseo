import { describe, expect, it } from "vitest";
import { HIGHLIGHT_MS, HighlightStore } from "../../shared/highlights";

describe("HighlightStore", () => {
  it("keeps an id for 30 minutes from first shown", () => {
    const store = new HighlightStore();
    store.record("w:p", [{ id: "N-9", label: "New" }], 1000);
    expect(store.active("w:p", 1000 + HIGHLIGHT_MS - 1).get("N-9")).toBe("New");
    expect(store.active("w:p", 1000 + HIGHLIGHT_MS).size).toBe(0);
  });
  it("does not restart the clock for an id that is still highlighted", () => {
    const store = new HighlightStore();
    store.record("k", [{ id: "a", label: "New" }], 0);
    expect(store.record("k", [{ id: "a", label: "Updated" }], 1000)).toBe(false);
    expect(store.active("k", HIGHLIGHT_MS).size).toBe(0);
  });
  it("restarts an expired id and keys are independent", () => {
    const store = new HighlightStore();
    store.record("k", [{ id: "a", label: "New" }], 0);
    store.record("k", [{ id: "a", label: "Updated" }], HIGHLIGHT_MS + 1);
    expect(store.active("k", HIGHLIGHT_MS + 2).get("a")).toBe("Updated");
    expect(store.active("other", 0).size).toBe(0);
  });
  it("dismisses one id", () => {
    const store = new HighlightStore();
    store.record(
      "k",
      [
        { id: "a", label: "New" },
        { id: "b", label: "New" },
      ],
      0,
    );
    expect(store.dismiss("k", "a")).toBe(true);
    expect([...store.active("k", 1).keys()]).toEqual(["b"]);
  });
});
