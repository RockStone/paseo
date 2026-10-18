import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { z } from "zod";

export interface ReferenceDetail {
  title: string;
  text: string;
  imagePosition?: number;
}
const Identity = z.object({
  hostId: z.string(),
  type: z.enum(["thread", "terminal", "workspace"]),
  id: z.string(),
});

export function referenceAttachmentUrl(attachment: AgentAttachment): string | null {
  if (attachment.type !== "text") return null;
  let type: string;
  let id: string;
  let host: string;
  if (attachment.text.startsWith("Referenced Paseo image:")) {
    const imageId = /^Attachment ID: (.+)$/m.exec(attachment.text)?.[1];
    const position = Number(/^Image position: (\d+)$/m.exec(attachment.text)?.[1]);
    return imageId && Number.isSafeInteger(position) && position > 0
      ? `attachment://${encodeURIComponent(imageId)}`
      : null;
  }
  if (attachment.text.startsWith("Referenced Paseo agent profile:")) {
    const profileId = /^Profile ID: (.+)$/m.exec(attachment.text)?.[1];
    const hostId = /^Host ID: (.+)$/m.exec(attachment.text)?.[1];
    if (!profileId || !hostId) return null;
    type = "agent-profile";
    id = profileId;
    host = hostId;
  } else if (attachment.text.startsWith("Referenced Paseo ")) {
    const line = /^Identity: (.+)$/m.exec(attachment.text)?.[1];
    if (!line) return null;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return null;
    }
    const identity = Identity.safeParse(value);
    if (!identity.success) return null;
    type = identity.data.type;
    id = identity.data.id;
    host = identity.data.hostId;
  } else return null;
  return `${type}://${encodeURIComponent(id)}?hostId=${encodeURIComponent(host)}`;
}

export function messageReferenceDetails(message: string, attachments: readonly AgentAttachment[]) {
  const details = new Map<string, ReferenceDetail>();
  const visibleAttachments: AgentAttachment[] = [];
  for (const attachment of attachments) {
    const url = referenceAttachmentUrl(attachment);
    const isImageContext =
      attachment.type === "text" && attachment.text.startsWith("Referenced Paseo image:");
    if (url && attachment.type === "text" && (message.includes(`](${url})`) || isImageContext)) {
      const imagePosition = isImageContext
        ? Number(/^Image position: (\d+)$/m.exec(attachment.text)?.[1])
        : undefined;
      details.set(url, { title: attachment.title ?? "", text: attachment.text, imagePosition });
    } else visibleAttachments.push(attachment);
  }
  return { details, visibleAttachments };
}
