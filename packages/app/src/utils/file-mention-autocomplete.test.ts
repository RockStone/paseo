import { describe, expect, it } from "vitest";
import {
  applyFileMentionReplacement,
  findActiveFileMention,
  formatFileMentionPath,
} from "./file-mention-autocomplete";

describe("findActiveFileMention", () => {
  it("detects mentions at the start of input", () => {
    const mention = findActiveFileMention({
      text: "@src/components",
      cursorIndex: "@src/components".length,
    });
    expect(mention).toEqual({
      start: 0,
      end: "@src/components".length,
      query: "src/components",
    });
  });

  it("detects mentions in the middle of input using cursor position", () => {
    const text = 'read "@src/com" before merging';
    const cursorIndex = text.indexOf('"') + 9;
    const mention = findActiveFileMention({
      text,
      cursorIndex,
    });
    expect(mention).toEqual({
      start: text.indexOf("@"),
      end: cursorIndex,
      query: "src/com",
    });
  });

  it("returns null when cursor is outside the mention token", () => {
    const text = "please review @src/components now";
    const mention = findActiveFileMention({
      text,
      cursorIndex: text.length,
    });
    expect(mention).toBeNull();
  });

  it("returns null when @ at start is followed by a delimiter", () => {
    const mention = findActiveFileMention({
      text: "@ ",
      cursorIndex: 2,
    });
    expect(mention).toBeNull();
  });

  it("returns null for the issue #1364 angle-bracket email example", () => {
    const text = "user <12345+user@noreply.example.com>";
    const mention = findActiveFileMention({
      text,
      cursorIndex: text.length,
    });
    expect(mention).toBeNull();
  });

  it("returns null for email addresses (word char before @)", () => {
    const text = "alice@example.com";
    const mention = findActiveFileMention({
      text,
      cursorIndex: text.length,
    });
    expect(mention).toBeNull();
  });

  it("returns null for email addresses (+ immediately before @)", () => {
    // Local part ends with + so the character at index-1 is '+', not a word char.
    const text = "noreply+@example.com";
    const mention = findActiveFileMention({
      text,
      cursorIndex: text.length,
    });
    expect(mention).toBeNull();
  });

  it("returns null for plus-tagged email local parts", () => {
    const text = "noreply+tag@example.com";
    const mention = findActiveFileMention({
      text,
      cursorIndex: text.length,
    });
    expect(mention).toBeNull();
  });

  it("returns null when query contains angle brackets", () => {
    const text = "check @foo<bar> end";
    const mention = findActiveFileMention({
      text,
      cursorIndex: text.indexOf(" end"),
    });
    expect(mention).toBeNull();
  });

  it("returns null when query ends with a closing angle bracket", () => {
    const text = "check @foo>";
    const mention = findActiveFileMention({
      text,
      cursorIndex: text.length,
    });
    expect(mention).toBeNull();
  });

  it("still detects a file mention after an email in the same input", () => {
    const text = "user <12345+user@noreply.example.com> and also @file";
    const mention = findActiveFileMention({
      text,
      cursorIndex: text.length,
    });
    expect(mention).toEqual({
      start: text.lastIndexOf("@"),
      end: text.length,
      query: "file",
    });
  });
});

describe("formatFileMentionPath", () => {
  it("links workspace-relative paths with an at-sign label", () => {
    expect(formatFileMentionPath('src/changed "file".ts')).toBe(
      '[@src/changed "file".ts](src/changed%20%22file%22.ts)',
    );
  });
});

describe("applyFileMentionReplacement", () => {
  it("replaces only the active @query segment with a linked relative path", () => {
    const text = "open @src/com next";
    const next = applyFileMentionReplacement({
      text,
      mention: { start: 5, end: 13, query: "src/com" },
      relativePath: "src/components/chat.tsx",
    });
    expect(next).toBe("open [@src/components/chat.tsx](src/components/chat.tsx) next");
  });

  it("encodes special characters in link targets", () => {
    const text = "@foo";
    const next = applyFileMentionReplacement({
      text,
      mention: { start: 0, end: 4, query: "foo" },
      relativePath: 'src/"quoted".ts',
    });
    expect(next).toBe('[@src/"quoted".ts](src/%22quoted%22.ts) ');
  });

  it.each(["README.md", "src/"])("adds a trailing space after selecting %s", (relativePath) => {
    expect(
      applyFileMentionReplacement({
        text: "open @re",
        mention: { start: 5, end: 8, query: "re" },
        relativePath,
      }),
    ).toBe(`open ${formatFileMentionPath(relativePath)} `);
  });

  it("separates a selected path from following text without changing that text", () => {
    expect(
      applyFileMentionReplacement({
        text: "@re, please",
        mention: { start: 0, end: 3, query: "re" },
        relativePath: "README.md",
      }),
    ).toBe("[@README.md](README.md) , please");
  });
});

it("does not reopen autocomplete inside a completed inline reference", () => {
  const text = "[@README.md](README.md)";
  expect(findActiveFileMention({ text, cursorIndex: text.length })).toBeNull();
});
