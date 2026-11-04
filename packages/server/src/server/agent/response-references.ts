import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { continuesTimelineTurn, isTimelineTurnTrigger } from "@getpaseo/protocol/timeline-turn";
import { writePrivateFileAtomic } from "../private-files.js";
import type {
  AgentTimelineCursor,
  AgentTimelineFetchResult,
} from "./agent-timeline-store-types.js";

const SavedResponseSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  preview: z.string(),
  text: z.string(),
  cursor: z.object({ epoch: z.string(), seq: z.number().int().positive() }),
});

function referencePath(paseoHome: string, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid response reference");
  return join(paseoHome, "response-references", `${id}.json`);
}

export async function createResponseReference(input: {
  paseoHome: string;
  agentId: string;
  timeline: Pick<AgentTimelineFetchResult, "epoch" | "rows">;
  cursor: AgentTimelineCursor;
}): Promise<{ id: string; preview: string }> {
  const { rows, epoch } = input.timeline;
  if (epoch !== input.cursor.epoch)
    throw new Error("This response changed. Refresh the conversation and try Reply again.");
  const selected = rows.findIndex(
    (row) => row.seqEnd === input.cursor.seq && row.item.type === "assistant_message",
  );
  if (selected < 0)
    throw new Error(
      "This response is no longer available. Refresh the conversation and try Reply again.",
    );
  const continues = (previous: number, next: number) =>
    continuesTimelineTurn(
      rows[previous]?.turnId,
      rows[next]?.turnId,
      isTimelineTurnTrigger(rows[next].item),
    );
  let start = selected;
  let end = selected;
  while (start > 0 && continues(start - 1, start)) start--;
  while (end + 1 < rows.length && continues(end, end + 1)) end++;
  const text = rows
    .slice(start, end + 1)
    .flatMap((row) => (row.item.type === "assistant_message" ? [row.item.text] : []))
    .join("\n\n")
    .trim();
  if (!text) throw new Error("This response has no text to reply to.");
  // The snapshot survives runtime epochs, compaction and relaunch. The ID includes
  // its source position so identical replies in different turns remain distinct.
  const id = createHash("sha256")
    .update(JSON.stringify([input.agentId, input.cursor, text]))
    .digest("hex");
  const preview = text.replace(/\s+/g, " ").slice(0, 100);
  try {
    await writePrivateFileAtomic(
      referencePath(input.paseoHome, id),
      JSON.stringify({ id, agentId: input.agentId, cursor: input.cursor, preview, text }),
    );
  } catch (error) {
    throw new Error(
      "Could not save the reply reference on this host. Check the host storage and try again.",
      { cause: error },
    );
  }
  return { id, preview };
}

export async function readResponseReference(paseoHome: string, id: string) {
  const file = referencePath(paseoHome, id);
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error("Response reference not found on this host.", { cause: error });
    throw error;
  }
  const saved = SavedResponseSchema.parse(JSON.parse(source));
  if (saved.id !== id) throw new Error("Response reference is invalid.");
  return saved;
}
