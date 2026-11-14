import path from "node:path";
import { fileURLToPath } from "node:url";

export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".avif": "image/avif",
};

export function mimeTypeForPath(file: string): string | null {
  return IMAGE_MIME_BY_EXTENSION[path.extname(file).toLowerCase()] ?? null;
}

export type ImageOrigin = "you" | "agent";

export interface ImageRef {
  path: string;
  source: ImageOrigin;
  timestamp: string;
  /** The owner message the image was attached to; links it to a desktop attachment file. */
  clientMessageId?: string;
}

export interface TimelineEntryLike {
  timestamp: string;
  seqEnd: number;
  item: { type: string };
}

// Paseo renders every provider image as `![alt](source)` with `\` and `)` escaped in the source.
const MARKDOWN_IMAGE = /!\[(?:\\.|[^\]\\])*\]\(((?:\\.|[^)\\\n])+)\)/g;

/** The local image file a markdown image source points at, or null for web, data and relative sources. */
export function localImagePath(source: string): string | null {
  const unescaped = source.trim().replace(/\\(.)/g, "$1");
  let file: string | null = null;
  if (unescaped.startsWith("file://")) {
    try {
      file = fileURLToPath(unescaped);
    } catch {
      return null;
    }
  } else if (unescaped.startsWith("/")) {
    file = unescaped;
  }
  if (!file || !mimeTypeForPath(file)) return null;
  return file;
}

export function markdownImagePaths(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(MARKDOWN_IMAGE)) {
    const file = localImagePath(match[1]);
    if (file) found.push(file);
  }
  return found;
}

/**
 * Images in a page of timeline entries. The owner's come from a user message's `imageSources` (and
 * any markdown image in its text); agents' come from assistant messages, where providers append
 * inline images and tool-result screenshots as markdown images.
 *
 * `attachmentsFor` returns the desktop attachment files stored for a message. They outlive the
 * temporary copies `imageSources` points at, so they replace those when present.
 */
export function imageRefsFromEntries(
  entries: readonly TimelineEntryLike[],
  attachmentsFor: (clientMessageId: string) => readonly string[] = () => [],
): ImageRef[] {
  const refs: ImageRef[] = [];
  for (const { item: raw, timestamp } of entries) {
    const item = raw as { type: string; [key: string]: unknown };
    if (item.type === "user_message") {
      const clientMessageId =
        typeof item.clientMessageId === "string" ? item.clientMessageId : undefined;
      const stored = clientMessageId ? attachmentsFor(clientMessageId) : [];
      const sources = Array.isArray(item.imageSources) ? item.imageSources : [];
      const paths: string[] = [...stored];
      if (stored.length === 0) {
        for (const source of sources) {
          const file = typeof source === "string" ? localImagePath(source) : null;
          if (file) paths.push(file);
        }
      }
      if (typeof item.text === "string") paths.push(...markdownImagePaths(item.text));
      for (const file of paths)
        refs.push({ path: file, source: "you", timestamp, clientMessageId });
    } else if (item.type === "assistant_message" && typeof item.text === "string") {
      for (const file of markdownImagePaths(item.text)) {
        refs.push({ path: file, source: "agent", timestamp });
      }
    }
  }
  return refs;
}
