import { describe, expect, it } from "vitest";
import { formatRelativeTime, splitLinks } from "../../shared/format";
import { unseenLabelFor } from "../../shared/labels";

describe("splitLinks", () => {
  it("returns plain text unchanged", () => {
    expect(splitLinks("no links here")).toEqual([
      { kind: "text", text: "no links here", start: 0 },
    ]);
  });

  it("finds links and trims sentence punctuation", () => {
    expect(splitLinks("See https://example.com/a?b=1. Then http://x.dev, ok")).toEqual([
      { kind: "text", text: "See ", start: 0 },
      {
        kind: "link",
        text: "https://example.com/a?b=1",
        url: "https://example.com/a?b=1",
        start: 4,
      },
      { kind: "text", text: ". Then ", start: 29 },
      { kind: "link", text: "http://x.dev", url: "http://x.dev", start: 36 },
      { kind: "text", text: ", ok", start: 48 },
    ]);
  });

  it("keeps a balanced closing parenthesis", () => {
    const url = "https://en.wikipedia.org/wiki/Foo_(bar)";
    expect(splitLinks(`(${url}).`)).toEqual([
      { kind: "text", text: "(", start: 0 },
      { kind: "link", text: url, url, start: 1 },
      { kind: "text", text: ").", start: 1 + url.length },
    ]);
  });

  it("ignores non-http schemes", () => {
    expect(splitLinks("javascript:alert(1)")).toEqual([
      { kind: "text", text: "javascript:alert(1)", start: 0 },
    ]);
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  it.each([
    ["2026-11-10T11:59:40.000Z", "just now"],
    ["2026-11-10T11:55:00.000Z", "5m ago"],
    ["2026-11-10T09:00:00.000Z", "3h ago"],
    ["2026-11-08T12:00:00.000Z", "2d ago"],
    ["2026-10-01T12:00:00.000Z", "2026-10-01"],
    ["not a date", ""],
  ])("%s -> %s", (iso, expected) => {
    expect(formatRelativeTime(iso, now)).toBe(expected);
  });
});

describe("unseenLabelFor", () => {
  it("omits the label when nothing is unseen", () => {
    expect(unseenLabelFor({}, "ws-1")).toBeUndefined();
    expect(unseenLabelFor({ "ws-1": { total: 3, unseen: 0 } }, "ws-1")).toBeUndefined();
  });
  it("shows the unseen count, capped", () => {
    expect(unseenLabelFor({ "ws-1": { total: 3, unseen: 2 } }, "ws-1")).toBe("2");
    expect(unseenLabelFor({ "ws-1": { total: 300, unseen: 150 } }, "ws-1")).toBe("99+");
  });
});
