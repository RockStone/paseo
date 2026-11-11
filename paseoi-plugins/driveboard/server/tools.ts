import { type AgentToolDefinition, defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import { type Note, noteInputSchema } from "../shared/notes";
import type { NoteStore } from "./store";

const NO_WORKSPACE = "This agent is not in a Paseo workspace, so it has no sticky note.";

function describeNote(note: Note): string {
  const author =
    note.author.kind === "user"
      ? "user"
      : `agent ${note.author.agentTitle ? `"${note.author.agentTitle}"` : note.author.agentId}`;
  const lines = [`- [${note.createdAt}] from ${author} (id ${note.id})`];
  if (note.title) lines.push(`  Title: ${note.title}`);
  if (note.url) lines.push(`  URL: ${note.url}`);
  lines.push(...note.text.split("\n").map((line) => `  ${line}`));
  return lines.join("\n");
}

export function createAgentTools(store: NoteStore): AgentToolDefinition[] {
  const post = defineAgentTool({
    name: "post_sticky_note",
    title: "Post sticky note",
    description:
      "Pin an item to the user's sticky note for this workspace. The user reviews the sticky " +
      "note later, outside this conversation. Use it for links and important items the user " +
      "should come back to: a pull request, a deploy URL, a decision that needs them, a " +
      "follow-up they asked you to remember. Use it sparingly: at most a few notes per task, " +
      "never for progress updates or anything you are already telling the user in chat.",
    input: noteInputSchema.extend({
      text: noteInputSchema.shape.text.describe(
        "What the user should know or do, in one or two sentences",
      ),
      url: noteInputSchema.shape.url.describe("Optional absolute http(s) link the note is about"),
      title: noteInputSchema.shape.title.describe("Optional short heading for the note"),
    }),
    async execute(input, { agent }) {
      if (!agent.workspaceId) return { isError: true, text: NO_WORKSPACE };
      const note = await store.add(agent.workspaceId, input, {
        kind: "agent",
        agentId: agent.id,
        ...(agent.title ? { agentTitle: agent.title } : {}),
      });
      return {
        text: "Pinned to the user's sticky note for this workspace.",
        structuredContent: { id: note.id, createdAt: note.createdAt },
      };
    },
  });

  const read = defineAgentTool({
    name: "read_sticky_notes",
    title: "Read sticky notes",
    description:
      "Read the user's sticky note for this workspace, newest first. It holds notes the user " +
      "wrote, including instructions or reminders for agents, and items agents pinned earlier.",
    input: z.object({}),
    async execute(_input, { agent }) {
      if (!agent.workspaceId) return { isError: true, text: NO_WORKSPACE };
      const notes = await store.list(agent.workspaceId);
      const text =
        notes.length === 0
          ? "The sticky note for this workspace is empty."
          : `${notes.length} note${notes.length === 1 ? "" : "s"}, newest first:\n${notes.map(describeNote).join("\n")}`;
      return { text, structuredContent: { notes } };
    },
  });

  return [post, read];
}
