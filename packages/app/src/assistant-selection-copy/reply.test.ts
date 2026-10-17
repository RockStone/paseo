import { describe, expect, it } from "vitest";
import { appendQuotedReply } from "./reply";

describe("appendQuotedReply", () => {
  it("preserves indentation on the first and subsequent command output lines", () => {
    expect(appendQuotedReply("", "  first\n    nested\n  last\n")).toBe(
      ">   first\n>     nested\n>   last\n\n",
    );
  });
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
