import { describe, expect, it } from "vitest";
import { getTurnFooterLabel } from "./assistant-turn-footer-label";

describe("turn footer labels", () => {
  it("shows duration, completion time and age together", () => {
    expect(getTurnFooterLabel({ durationMs: 533_000, timestamp: "7:46 PM", age: "25m ago" })).toBe(
      "8m 53s @ 7:46 PM (25m ago)",
    );
  });
  it("shows the timestamp and age when the start is unavailable", () => {
    expect(getTurnFooterLabel({ durationMs: null, timestamp: "7:46 PM", age: "2h ago" })).toBe(
      "7:46 PM (2h ago)",
    );
  });
  it("preserves zero duration and omits missing times", () => {
    expect(getTurnFooterLabel({ durationMs: 0, timestamp: "7:46 PM", age: "just now" })).toBe(
      "0s @ 7:46 PM (just now)",
    );
    expect(getTurnFooterLabel({ durationMs: 14_000, timestamp: "", age: "" })).toBe("14s");
    expect(getTurnFooterLabel({ timestamp: "", age: "" })).toBe("");
  });
});
