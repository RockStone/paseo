import { execFile } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { imageId } from "./image-index";
import { mimeTypeForPath } from "./parse";

const run = promisify(execFile);

export const THUMB_EDGE = 320;
export const FULL_EDGE = 2048;
/** Files at most this large are sent as they are when no resized copy can be made. */
export const THUMB_PASSTHROUGH_BYTES = 300 * 1024;
export const FULL_RESIZE_ABOVE_BYTES = 3 * 1024 * 1024;
export const FULL_MAX_BYTES = 12 * 1024 * 1024;

/** Writes a JPEG no larger than `edge` on its long side; false when it cannot. */
export type Resizer = (input: string, output: string, edge: number) => Promise<boolean>;

/** macOS ships `sips`; elsewhere (or if it fails) callers fall back to the original bytes. */
export const sipsResize: Resizer = async (input, output, edge) => {
  if (process.platform !== "darwin") return false;
  try {
    await run(
      "sips",
      [
        "-Z",
        String(edge),
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        "70",
        input,
        "--out",
        output,
      ],
      { timeout: 15_000 },
    );
    return true;
  } catch {
    return false;
  }
};

export interface BytesResult {
  mimeType: string;
  data: string | null;
  reason?: "missing" | "too-large";
}

/** Reads image bytes for the client, shrinking large ones and caching what it shrank. */
export class ImageMedia {
  constructor(
    private readonly cacheDirectory: string,
    private readonly resize: Resizer = sipsResize,
  ) {}

  async bytes(file: string, variant: "thumb" | "full"): Promise<BytesResult> {
    const mimeType = mimeTypeForPath(file) ?? "application/octet-stream";
    let info;
    try {
      info = await stat(file);
    } catch {
      return { mimeType, data: null, reason: "missing" };
    }
    const original = async (limit: number): Promise<BytesResult> =>
      info.size <= limit
        ? { mimeType, data: (await readFile(file)).toString("base64") }
        : { mimeType, data: null, reason: "too-large" };

    if (variant === "full" && info.size <= FULL_RESIZE_ABOVE_BYTES) return original(FULL_MAX_BYTES);
    const edge = variant === "thumb" ? THUMB_EDGE : FULL_EDGE;
    const cached = path.join(
      this.cacheDirectory,
      `${imageId(file)}-${Math.round(info.mtimeMs)}-${info.size}-${edge}.jpg`,
    );
    try {
      return { mimeType: "image/jpeg", data: (await readFile(cached)).toString("base64") };
    } catch {
      /* Not cached yet. */
    }
    await mkdir(this.cacheDirectory, { recursive: true });
    if (await this.resize(file, cached, edge)) {
      try {
        return { mimeType: "image/jpeg", data: (await readFile(cached)).toString("base64") };
      } catch {
        /* Fall through to the original. */
      }
    }
    return original(variant === "thumb" ? THUMB_PASSTHROUGH_BYTES : FULL_MAX_BYTES);
  }
}
