import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_TEXT_LENGTH = 4000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_URL_LENGTH = 2000;

const httpUrlSchema = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .regex(/^https?:\/\/\S+$/i, "Use an absolute http(s) URL");

export const noteAuthorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({
    kind: z.literal("agent"),
    agentId: z.string(),
    agentTitle: z.string().optional(),
  }),
]);

export const noteSchema = z.object({
  id: z.string(),
  text: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
  author: noteAuthorSchema,
  createdAt: z.string(),
  /** When the user first saw an agent-posted note. User notes are created seen. */
  seenAt: z.string().nullable(),
});

export type NoteAuthor = z.infer<typeof noteAuthorSchema>;
export type Note = z.infer<typeof noteSchema>;

export const noteInputSchema = z.object({
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  url: httpUrlSchema.optional(),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
});

export type NoteInput = z.infer<typeof noteInputSchema>;

const workspaceIdSchema = z.string().min(1);

export const listNotesRpc = defineRpc({
  name: "notes.list",
  input: z.object({ workspaceId: workspaceIdSchema }),
  output: z.object({ notes: z.array(noteSchema) }),
});

export const addNoteRpc = defineRpc({
  name: "notes.add",
  input: noteInputSchema.extend({ workspaceId: workspaceIdSchema }),
  output: z.object({ note: noteSchema }),
});

export const deleteNoteRpc = defineRpc({
  name: "notes.delete",
  input: z.object({ workspaceId: workspaceIdSchema, id: z.string().min(1) }),
  output: z.object({ deleted: z.boolean() }),
});

export const markSeenRpc = defineRpc({
  name: "notes.mark_seen",
  input: z.object({ workspaceId: workspaceIdSchema }),
  output: z.object({ marked: z.number().int().nonnegative() }),
});

export const workspaceSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  unseen: z.number().int().nonnegative(),
});

export interface NotesSummary {
  workspaces: Record<string, z.infer<typeof workspaceSummarySchema>>;
}
