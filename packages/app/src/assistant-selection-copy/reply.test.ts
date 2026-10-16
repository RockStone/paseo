import { describe, expect, it } from "vitest";
import { appendQuotedReply } from "./reply";

describe("appendQuotedReply", () => {
  it("quotes every line and leaves room for a comment", () => {
    expect(appendQuotedReply("", "First paragraph\n\nSecond paragraph")).toBe(
      "> First paragraph\n> \n> Second paragraph\n\n",
    );
  });
  it("preserves an existing draft when adding another excerpt", () => {
    expect(appendQuotedReply("My existing comment\n", "**selected** text")).toBe(
      "My existing comment\n\n> **selected** text\n\n",
    );
  });
});
