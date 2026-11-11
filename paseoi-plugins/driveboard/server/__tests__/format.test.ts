import { describe, expect, it } from "vitest";
import { formatRelativeTime, splitLinks, splitLinksAndPaths } from "../../shared/format";
import { badgeLabel } from "../../shared/board";

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

describe("splitLinksAndPaths", () => {
  const paths = (text: string) =>
    splitLinksAndPaths(text).flatMap((segment) =>
      segment.kind === "path" ? [{ path: segment.path, line: segment.line }] : [],
    );

  it("finds workspace paths with extensions, trailing slashes and line numbers", () => {
    expect(
      paths(
        "Read docs/owner-todo.md, then run scripts/vm-test.sh and see packages/app/ or README.md:12.",
      ),
    ).toEqual([
      { path: "docs/owner-todo.md", line: undefined },
      { path: "scripts/vm-test.sh", line: undefined },
      { path: "packages/app/", line: undefined },
      { path: "README.md", line: 12 },
    ]);
  });

  it("leaves prose, absolute paths and URL paths alone", () => {
    expect(paths("and/or OT-17/OT-18 ~/.local/state/cost.jsonl /etc/hosts v1.2")).toEqual([]);
    expect(splitLinksAndPaths("see https://example.com/docs/a.md")).toEqual([
      { kind: "text", text: "see ", start: 0 },
      {
        kind: "link",
        text: "https://example.com/docs/a.md",
        url: "https://example.com/docs/a.md",
        start: 4,
      },
    ]);
  });

  it("keeps segment offsets in the original text", () => {
    const text = "x docs/a.md y";
    for (const segment of splitLinksAndPaths(text)) {
      expect(text.slice(segment.start, segment.start + segment.text.length)).toBe(segment.text);
    }
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

describe("badgeLabel", () => {
  it("omits the label when nothing is new", () => {
    expect(badgeLabel(undefined)).toBeUndefined();
    expect(badgeLabel(0)).toBeUndefined();
  });
  it("shows the count, capped", () => {
    expect(badgeLabel(2)).toBe("2");
    expect(badgeLabel(150)).toBe("99+");
  });
});
