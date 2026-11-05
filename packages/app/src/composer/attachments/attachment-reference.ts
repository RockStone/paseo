import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  ChatHistoryContextAttachment,
  UserComposerAttachment,
} from "@/attachments/types";
import type { AgentAttachment, UploadedFileAttachment } from "@getpaseo/protocol/messages";

export function addImageReferences(
  current: readonly UserComposerAttachment[],
  images: readonly AttachmentMetadata[],
) {
  let number = current.filter((attachment) => attachment.kind === "image").length;
  return images.map((metadata) => {
    number++;
    return {
      kind: "image" as const,
      metadata,
      inlineMention: `[@Image ${number}](attachment://${encodeURIComponent(metadata.id)})`,
    };
  });
}

type FileAttachment = Extract<UserComposerAttachment, { kind: "file" }>;

export function addFileReferences(
  current: readonly UserComposerAttachment[],
  files: readonly FileAttachment[],
) {
  let number = current.filter((attachment) => attachment.kind === "file").length;
  return files.map((file) => ({
    ...file,
    inlineMention: `[@File ${++number}](attachment://${encodeURIComponent(file.attachment.id)})`,
  }));
}

export function addContextReference(
  current: readonly ComposerAttachment[],
  context: ChatHistoryContextAttachment,
) {
  const contexts = current.filter((attachment) => attachment.kind === "chat_history");
  const index = contexts.findIndex((attachment) => attachment.id === context.id);
  const number = index < 0 ? contexts.length + 1 : index + 1;
  return {
    ...context,
    inlineMention:
      context.inlineMention ??
      `[@Context ${number}](attachment://${encodeURIComponent(context.id)})`,
  };
}

interface RenumberInput<Attachment extends ComposerAttachment = UserComposerAttachment> {
  attachments: readonly Attachment[];
  text: string;
  selection: { start: number; end: number };
}

export function renumberImageReferences(input: RenumberInput & { removed: AttachmentMetadata }) {
  return renumberReferences({ ...input, kind: "image", removedId: input.removed.id });
}

export function renumberFileReferences(input: RenumberInput & { removed: UploadedFileAttachment }) {
  return renumberReferences({ ...input, kind: "file", removedId: input.removed.id });
}

export function renumberContextReferences(
  input: RenumberInput<ComposerAttachment> & { removed: ChatHistoryContextAttachment },
) {
  return renumberReferences({ ...input, kind: "chat_history", removedId: input.removed.id });
}

function renumberReferences<Attachment extends ComposerAttachment>(
  input: RenumberInput<Attachment> & { kind: "image" | "file" | "chat_history"; removedId: string },
) {
  const removedUrl = `attachment://${encodeURIComponent(input.removedId)}`;
  const references = new Map<string, string>();
  const label = { image: "Image", file: "File", chat_history: "Context" }[input.kind];
  let number = 0;
  const attachments = input.attachments.map((attachment) => {
    if (attachment.kind !== input.kind) return attachment;
    number++;
    let id: string;
    if (attachment.kind === "image") id = attachment.metadata.id;
    else if (attachment.kind === "file") id = attachment.attachment.id;
    else if (attachment.kind === "chat_history") id = attachment.id;
    else return attachment;
    const url = `attachment://${encodeURIComponent(id)}`;
    const inlineMention = `[@${label} ${number}](${url})`;
    references.set(url, inlineMention);
    return attachment.inlineMention ? { ...attachment, inlineMention } : attachment;
  });
  const edits: { start: number; end: number; text: string }[] = [];
  function visit(node: Nodes) {
    if (node.type === "link") {
      const generatedLabel =
        node.children.length === 1 &&
        node.children[0]?.type === "text" &&
        /^@(Image|File|Context) \d+$/.test(node.children[0].value);
      let replacement: string | undefined;
      if (node.url === removedUrl) replacement = "";
      else if (generatedLabel) replacement = references.get(node.url);
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (
        replacement !== undefined &&
        start !== undefined &&
        end !== undefined &&
        input.text.slice(start, end) !== replacement
      )
        edits.push({ start, end, text: replacement });
      return;
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(fromMarkdown(input.text));
  function mapPosition(position: number) {
    let delta = 0;
    for (const edit of edits) {
      if (position < edit.start) break;
      if (position <= edit.end)
        return edit.start + delta + Math.min(position - edit.start, edit.text.length);
      delta += edit.text.length - (edit.end - edit.start);
    }
    return position + delta;
  }
  let text = input.text;
  // Rewrite from the end so renamed labels never become another replacement's input.
  for (const edit of edits.toReversed())
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return {
    attachments,
    text,
    selection: { start: mapPosition(input.selection.start), end: mapPosition(input.selection.end) },
  };
}

export function imageReferenceContext(
  attachment: Extract<UserComposerAttachment, { kind: "image" }>,
  position: number,
): Extract<AgentAttachment, { type: "text" }> {
  return {
    type: "text",
    mimeType: "text/plain",
    title: attachment.inlineMention?.split("]")[0].slice(2) ?? "Image",
    text: `Attached image ${position}: attachment://${encodeURIComponent(attachment.metadata.id)}`,
  };
}

export function fileReferenceContext(
  attachment: FileAttachment,
  position: number,
): Extract<AgentAttachment, { type: "text" }> {
  return {
    type: "text",
    mimeType: "text/plain",
    title: attachment.inlineMention?.split("]")[0].slice(2) ?? "File",
    text: `Attached file ${position}: attachment://${encodeURIComponent(attachment.attachment.id)}\nFile name: ${attachment.attachment.fileName}\nPath: ${attachment.attachment.path}`,
  };
}
