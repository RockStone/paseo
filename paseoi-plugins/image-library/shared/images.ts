import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 48;

export const filterSchema = z.enum(["all", "you", "agent"]);
export type ImageFilter = z.infer<typeof filterSchema>;

export const imageEntrySchema = z.object({
  /** Stable per file path; the bytes RPC accepts only ids the index has produced. */
  id: z.string(),
  /** "you": attached to a prompt by the owner. "agent": produced by an agent. */
  source: z.enum(["you", "agent"]),
  agentId: z.string(),
  agentTitle: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  /** When the message or tool result was recorded. */
  timestamp: z.string(),
  mimeType: z.string(),
  fileName: z.string(),
  /** Absolute path on the daemon machine. */
  path: z.string(),
  byteSize: z.number(),
});
export type ImageEntry = z.infer<typeof imageEntrySchema>;

export const listImagesRpc = defineRpc({
  name: "images.list",
  input: z.object({
    workspaceId: z.string(),
    filter: filterSchema.optional(),
    /** Case-insensitive match on the agent title. */
    query: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  }),
  output: z.object({
    images: z.array(imageEntrySchema),
    nextCursor: z.string().nullable(),
    /** Total images matching the filter, before paging. */
    total: z.number(),
    /** True while agents are still being indexed; poll again for more. */
    scanning: z.boolean(),
    /** Agents idle for days are indexed only when the owner scans them. */
    older: z.object({
      pending: z.number(),
      running: z.boolean(),
      done: z.number(),
      total: z.number(),
    }),
  }),
});

export const scanOlderRpc = defineRpc({
  name: "images.scan_older",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ started: z.boolean() }),
});

export const stopScanRpc = defineRpc({
  name: "images.stop_scan",
  input: z.object({}),
  output: z.object({ stopped: z.boolean() }),
});

export const imageBytesRpc = defineRpc({
  name: "images.bytes",
  input: z.object({ id: z.string(), variant: z.enum(["thumb", "full"]) }),
  output: z.object({
    mimeType: z.string(),
    /** Base64, or null when the image cannot be sent. */
    data: z.string().nullable(),
    reason: z.enum(["missing", "too-large"]).optional(),
  }),
});

export const countsRpc = defineRpc({
  name: "images.counts",
  input: z.object({}),
  output: z.object({
    /** Images added since each workspace's drawer was last opened. */
    workspaces: z.record(z.string(), z.number()),
  }),
});

export const markSeenRpc = defineRpc({
  name: "images.mark_seen",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ marked: z.boolean() }),
});

export function badgeLabel(count: number | undefined): string | undefined {
  if (!count || count < 1) return undefined;
  return count > 99 ? "99+" : String(count);
}
