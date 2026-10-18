import type { ComposerAttachment } from "./types";

export function formatInlineReference(input: {
  label: string;
  type: string;
  id: string;
  serverId: string;
}): string {
  const label = input.label.replace(/[\\[\]]/g, "\\$&").replace(/\s+/g, " ");
  return `[${label}](${input.type}://${encodeURIComponent(input.id)}?hostId=${encodeURIComponent(input.serverId)})`;
}

export function getInlineReference(attachment: ComposerAttachment): string | undefined {
  if (attachment.kind === "session_reference" || attachment.kind === "agent_profile")
    return attachment.inlineMention;
  return undefined;
}

export function isReferenceInText(attachment: ComposerAttachment, text: string): boolean {
  const mention = getInlineReference(attachment);
  return mention === undefined || text.includes(mention);
}
