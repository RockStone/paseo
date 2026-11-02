import { describe, expect, it } from "vitest";
import { insertQuotedReply } from "./reply";

function at(position: number) {
  return { start: position, end: position };
}

describe("insertQuotedReply", () => {
  it("preserves indentation on the first and subsequent command output lines", () => {
    const reply = insertQuotedReply("", "  first\n    nested\n  last\n", null);
    expect(reply.text).toBe(">   first\n>     nested\n>   last\n\n");
    expect(reply.caret).toBe(reply.text.length);
  });
  it("quotes every line and leaves room for a comment", () => {
    expect(insertQuotedReply("", "First paragraph\n\nSecond paragraph", null).text).toBe(
      "> First paragraph\n> \n> Second paragraph\n\n",
    );
  });
  it("appends after an existing draft when the caret is unknown", () => {
    const reply = insertQuotedReply("My existing comment\n", "**selected** text", null);
    expect(reply.text).toBe("My existing comment\n\n> **selected** text\n\n");
    expect(reply.caret).toBe(reply.text.length);
  });
  it("appends when the remembered caret no longer fits the draft", () => {
    expect(insertQuotedReply("short", "quote", at(40)).text).toBe("short\n\n> quote\n\n");
    expect(insertQuotedReply("short", "quote", { start: -1, end: 2 }).text).toBe(
      "short\n\n> quote\n\n",
    );
  });
  it("puts the quote first without a leading blank line when the caret is at the start", () => {
    const reply = insertQuotedReply("Existing text", "quote", at(0));
    expect(reply.text).toBe("> quote\n\n\n\nExisting text");
    expect(reply.text.slice(0, reply.caret)).toBe("> quote\n\n");
  });
  it("splits the line at a caret in the middle of it", () => {
    const reply = insertQuotedReply("First half second half", "quote", at(10));
    expect(reply.text).toBe("First half\n\n> quote\n\n\n\nsecond half");
    expect(reply.text.slice(reply.caret)).toBe("\n\nsecond half");
  });
  it("inserts between lines when the caret is at the end of a line", () => {
    const reply = insertQuotedReply("one\ntwo", "quote", at(3));
    expect(reply.text).toBe("one\n\n> quote\n\n\n\ntwo");
    expect(reply.text.slice(0, reply.caret)).toBe("one\n\n> quote\n\n");
  });
  it("keeps indentation of the following line when the caret is at a line start", () => {
    expect(insertQuotedReply("- item\n  - nested", "quote", at(7)).text).toBe(
      "- item\n\n> quote\n\n\n\n  - nested",
    );
  });
  it("collapses existing blank lines around the caret to one on each side", () => {
    const reply = insertQuotedReply("Above\n\n\n\nBelow", "quote", at(7));
    expect(reply.text).toBe("Above\n\n> quote\n\n\n\nBelow");
  });
  it("stacks a second reply right after the first one", () => {
    const first = insertQuotedReply("Intro\n\nOutro", "one", at(5));
    const second = insertQuotedReply(first.text, "two", at(first.caret));
    expect(second.text).toBe("Intro\n\n> one\n\n> two\n\n\n\nOutro");
    expect(second.text.slice(0, second.caret)).toBe("Intro\n\n> one\n\n> two\n\n");
  });
  it("inserts after a selection instead of replacing it", () => {
    expect(insertQuotedReply("keep this selected text", "quote", { start: 5, end: 9 }).text).toBe(
      "keep this\n\n> quote\n\n\n\nselected text",
    );
    expect(insertQuotedReply("keep this selected text", "quote", { start: 9, end: 5 }).text).toBe(
      "keep this\n\n> quote\n\n\n\nselected text",
    );
  });
  it("moves a caret inside a reference link to the end of the reference", () => {
    const reference = "[#Fix login](thread://agent-1?hostId=host)";
    const draft = `See ${reference} next`;
    expect(insertQuotedReply(draft, "quote", at(draft.indexOf("thread://"))).text).toBe(
      `See ${reference}\n\n> quote\n\n\n\nnext`,
    );
  });
  it("moves a caret inside an attachment reference nested in emphasis past both", () => {
    const draft = "Look at **[@Image 1](attachment://img-1) here** please";
    expect(insertQuotedReply(draft, "quote", at(draft.indexOf("Image"))).text).toBe(
      "Look at **[@Image 1](attachment://img-1) here**\n\n> quote\n\n\n\nplease",
    );
  });
  it("does not split a fenced code block or an existing quote", () => {
    const code = "```ts\nconst a = 1;\n```";
    expect(insertQuotedReply(`${code}\nafter`, "quote", at(10)).text).toBe(
      `${code}\n\n> quote\n\n\n\nafter`,
    );
    const quoted = "> earlier\n> excerpt\n\nComment";
    expect(insertQuotedReply(quoted, "quote", at(1)).text).toBe(
      "> earlier\n> excerpt\n\n> quote\n\n\n\nComment",
    );
  });
});
