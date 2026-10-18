import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";
import type { AgentAttachment } from "@getpaseo/protocol/messages";

export function addImageReferences(
  current: readonly UserComposerAttachment[],
  images: readonly AttachmentMetadata[],
) {
  let number = current.filter((attachment) => attachment.kind === "image").length;
  for (const attachment of current) {
    if (attachment.kind !== "image") continue;
    const match = /^\[@Image (\d+)\]/.exec(attachment.inlineMention ?? "");
    number = Math.max(number, Number(match?.[1] ?? 0));
  }
  return images.map((metadata) => {
    number++;
    return {
      kind: "image" as const,
      metadata,
      inlineMention: `[@Image ${number}](attachment://${encodeURIComponent(metadata.id)})`,
    };
  });
}

export function imageReferenceContext(
  attachment: Extract<UserComposerAttachment, { kind: "image" }>,
  position: number,
): Extract<AgentAttachment, { type: "text" }> {
  return {
    type: "text",
    mimeType: "text/plain",
    title: attachment.inlineMention?.split("]")[0].slice(2) ?? "Image",
    text: `Referenced Paseo image:\nAttachment ID: ${attachment.metadata.id}\nImage position: ${position}\nFile name: ${JSON.stringify(attachment.metadata.fileName ?? null)}\nMIME type: ${attachment.metadata.mimeType}\nThe attachment:// ID in the user's inline reference identifies this image. Image position is one-based within the images attached to this message, in their supplied order. It is not a path or a tool resource.`,
  };
}
