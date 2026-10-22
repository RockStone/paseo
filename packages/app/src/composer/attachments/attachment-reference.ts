import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";
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

interface RenumberInput {
  attachments: readonly UserComposerAttachment[];
  text: string;
  selection: { start: number; end: number };
}

export function renumberImageReferences(input: RenumberInput & { removed: AttachmentMetadata }) {
  return renumberReferences({ ...input, kind: "image", removedId: input.removed.id });
}

export function renumberFileReferences(input: RenumberInput & { removed: UploadedFileAttachment }) {
  return renumberReferences({ ...input, kind: "file", removedId: input.removed.id });
}

function renumberReferences(input: RenumberInput & { kind: "image" | "file"; removedId: string }) {
  const removedUrl = `attachment://${encodeURIComponent(input.removedId)}`;
  const references = new Map<string, string>();
  const label = input.kind === "image" ? "Image" : "File";
  let number = 0;
  const attachments = input.attachments.map((attachment) => {
    if (attachment.kind !== input.kind) return attachment;
    number++;
    const id = attachment.kind === "image" ? attachment.metadata.id : attachment.attachment.id;
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
        /^@(Image|File) \d+$/.test(node.children[0].value);
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
