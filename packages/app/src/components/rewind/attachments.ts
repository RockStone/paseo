import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";
import { messageReferenceDetails } from "@/attachments/reference-details";
import { addFileReferences, addImageReferences } from "@/composer/attachments/attachment-reference";

export interface RewoundComposerMessage {
  text: string;
  attachments: UserComposerAttachment[];
}

export function buildRewoundComposerMessage(input: {
  text: string;
  images: readonly AttachmentMetadata[];
  attachments: readonly AgentAttachment[];
}): RewoundComposerMessage {
  let text = input.text;
  const { details } = messageReferenceDetails(text, input.attachments);
  const references = new Map<number, string>();
  for (const [url, detail] of details) {
    if (detail.imagePosition) references.set(detail.imagePosition, url);
  }
  // Imported provider history can retain the inline reference without its attachment context.
  for (const match of text.matchAll(/\[@Image ([1-9]\d*)\]\((attachment:\/\/[^)\s]+)\)/g)) {
    if (!references.has(Number(match[1]))) references.set(Number(match[1]), match[2]!);
  }
  const images = addImageReferences([], input.images).map((image, index) => {
    const previousUrl = references.get(index + 1);
    const url = `attachment://${encodeURIComponent(image.metadata.id)}`;
    if (previousUrl && previousUrl !== url) {
      text = text.replaceAll(`](${previousUrl})`, `](${url})`);
      text = text
        .split("\n")
        .map((line) =>
          line === `Attached image ${index + 1}: ${previousUrl}`
            ? `Attached image ${index + 1}: ${url}`
            : line,
        )
        .join("\n");
    }
    return text.includes(image.inlineMention)
      ? image
      : { kind: "image" as const, metadata: image.metadata };
  });
  const files = addFileReferences(
    [],
    input.attachments.flatMap((attachment) =>
      attachment.type === "uploaded_file" ? [{ kind: "file" as const, attachment }] : [],
    ),
  ).map((file) =>
    text.includes(file.inlineMention)
      ? file
      : { kind: "file" as const, attachment: file.attachment },
  );
  return { text, attachments: [...images, ...files] };
}
