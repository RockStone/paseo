import { Parser } from "htmlparser2";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { resolveMarkdownPreviewImageSource } from "@/components/markdown/image-source";

interface ImageReference {
  start: number;
  end: number;
  path: string;
}

export interface HtmlPreviewImageAsset {
  source: string;
  bytes: Uint8Array;
  mime: string;
}

/** Only static image attributes become host reads; page scripts never receive a file bridge. */
export function prepareHtmlPreviewImages(html: string, filePath: string, workspaceRoot: string) {
  const references: ImageReference[] = [];
  let tag = "";
  let seenSource = false;
  const parser = new Parser({
    onopentagname(name) {
      tag = name;
      seenSource = false;
    },
    onattribute(name, source) {
      if (tag !== "img" || name !== "src" || seenSource) return;
      seenSource = true;
      if (!workspaceRoot || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(source.trim())) return;
      const path = resolveMarkdownPreviewImageSource({
        source,
        markdownPath: filePath,
        workspaceRoot,
      });
      if (!path || !/\.(?:png|jpe?g|gif|webp|svg)$/i.test(path)) return;
      references.push({ start: parser.startIndex, end: parser.endIndex, path });
    },
  });
  parser.end(html);
  return {
    paths: [...new Set(references.map(({ path }) => path))],
    render(urls: ReadonlyMap<string, string>) {
      let result = "";
      let cursor = 0;
      for (const reference of references) {
        const url = urls.get(reference.path);
        if (!url) continue;
        result += html.slice(cursor, reference.start) + `src="${escapeAttribute(url)}"`;
        cursor = reference.end;
      }
      return result + html.slice(cursor);
    },
  };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export type HtmlPreviewImage =
  | { path: string; status: "ready"; bytes: Uint8Array; mime: string }
  | { path: string; status: "error"; message: string };

export async function readHtmlPreviewImages(
  client: Pick<DaemonClient, "readFile">,
  workspaceRoot: string,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<HtmlPreviewImage[]> {
  const images: HtmlPreviewImage[] = [];
  for (let start = 0; start < paths.length; start += 4) {
    if (signal.aborted) throw new Error("Image preview canceled");
    const batch = await Promise.all(paths.slice(start, start + 4).map(read));
    images.push(...batch);
  }
  return images;

  async function read(path: string): Promise<HtmlPreviewImage> {
    try {
      // Keep the workspace as the read scope, including realpath/symlink checks in the daemon.
      const file = await client.readFile(workspaceRoot, path);
      if (file.kind !== "image") throw new Error("Image unavailable");
      return { path, status: "ready", bytes: file.bytes, mime: file.mime };
    } catch (error) {
      return {
        path,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
