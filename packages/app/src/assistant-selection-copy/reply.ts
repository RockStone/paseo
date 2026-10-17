import { createContext } from "react";

export const SelectionReplyContext = createContext<((text: string) => void) | null>(null);

export function appendQuotedReply(draft: string, selectedText: string): string {
  const quote = selectedText
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .trimEnd()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const prefix = draft.trimEnd();
  return `${prefix ? `${prefix}\n\n` : ""}${quote}\n\n`;
}
