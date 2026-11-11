import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const replySchema = z.object({
  id: z.string(),
  date: z.string(),
  time: z.string().nullable(),
  text: z.string(),
});

export const itemSchema = z.object({
  id: z.string(),
  line: z.number(),
  section: z.string(),
  title: z.string(),
  text: z.string(),
  detailBlocks: z.array(z.object({ text: z.string(), bold: z.boolean() })),
  rank: z.number().int().min(0).max(3),
  status: z.enum(["open", "in progress", "done"]),
  replies: z.array(replySchema),
  warnings: z.array(z.string()),
  contentVersion: z.string(),
  updatedAt: z.string().nullable().optional(),
});

export type TrackerReply = z.infer<typeof replySchema>;
export type TrackerItem = z.infer<typeof itemSchema>;

export const summarySchema = z.object({
  warnings: z.number(),
  total: z.number(),
  done: z.number(),
  percent: z.number(),
  inProgress: z.number(),
  waiting: z.number(),
  ranks: z.array(
    z.object({ rank: z.number(), name: z.string(), open: z.number(), total: z.number() }),
  ),
});

export interface TrackerBoard {
  tasks: TrackerItem[];
  owners: TrackerItem[];
  hasTasks: boolean;
  hasOwners: boolean;
  /** The owner file's write guard; "missing" without one. */
  version: string;
  changeVersion: string;
  summary: z.infer<typeof summarySchema>;
}

const workspace = z.object({ workspaceId: z.string().min(1) });
const ownerId = z.string().regex(/^OT-\d+$/);

export const boardSchema = z.object({
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  error: z.string().nullable(),
  hasTasks: z.boolean(),
  hasOwners: z.boolean(),
  version: z.string(),
  tasks: z.array(itemSchema),
  owners: z.array(itemSchema),
  summary: summarySchema.nullable(),
  /** Replies already sent to (or dismissed for) the agent. */
  notifiedReplyIds: z.array(z.string()),
  /** Owner items that are new or changed since the owner last opened the board. */
  newOwnerIds: z.array(z.string()),
  /** Tasks that are new or changed since the owner last opened the Progress tab. */
  newTaskIds: z.array(z.string()),
  /** The workspace's top-level agent that notifications go to. */
  agent: z.object({ id: z.string(), title: z.string() }).nullable(),
});

export type Board = z.infer<typeof boardSchema>;

export const readBoardRpc = defineRpc({
  name: "board.read",
  input: workspace,
  output: boardSchema,
});

const versioned = workspace.extend({ version: z.string(), id: ownerId });
const replyText = z.string().trim().min(1).max(4000);

export const addReplyRpc = defineRpc({
  name: "board.reply.add",
  input: versioned.extend({ text: replyText }),
  output: z.object({ version: z.string() }),
});

export const editReplyRpc = defineRpc({
  name: "board.reply.edit",
  input: versioned.extend({ replyId: z.string().min(1), text: replyText }),
  output: z.object({ version: z.string() }),
});

export const removeReplyRpc = defineRpc({
  name: "board.reply.remove",
  input: versioned.extend({ replyId: z.string().min(1) }),
  output: z.object({ version: z.string() }),
});

const replySelection = workspace.extend({
  replyIds: z.array(z.string().min(1)).min(1).max(2000),
});

export const notifyRpc = defineRpc({
  name: "board.notify",
  input: replySelection.extend({ version: z.string() }),
  output: z.object({ agentTitle: z.string() }),
});

export const dismissRpc = defineRpc({
  name: "board.dismiss",
  input: replySelection,
  output: z.object({ dismissed: z.number() }),
});

export const markOwnersSeenRpc = defineRpc({
  name: "board.owners.mark_seen",
  input: workspace,
  output: z.object({ marked: z.number() }),
});

export const markProgressSeenRpc = defineRpc({
  name: "board.progress.mark_seen",
  input: workspace,
  output: z.object({ marked: z.number() }),
});

export const badgeSummaryRpc = defineRpc({
  name: "board.summary",
  input: z.object({}),
  output: z.object({ workspaces: z.record(z.string(), z.number().int().nonnegative()) }),
});

/** Header badge text: the count, capped, or undefined for an icon-only button. */
export function badgeLabel(count: number | undefined): string | undefined {
  if (!count) return undefined;
  return count > 99 ? "99+" : String(count);
}
