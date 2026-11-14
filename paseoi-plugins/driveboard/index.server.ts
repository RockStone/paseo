import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { BoardService } from "./server/board";
import { BoardStateStore } from "./server/board-state";
import { migrateLegacyData } from "./server/migrate";
import { NoteStore, resolveDataDirectory, resolvePaseoHome } from "./server/store";
import { createAgentTools } from "./server/tools";
import {
  addReplyRpc,
  badgeSummaryRpc,
  dismissRpc,
  editReplyRpc,
  markOwnersSeenRpc,
  markProgressSeenRpc,
  notifyRpc,
  readBoardRpc,
  removeReplyRpc,
  setOwnerDoneRpc,
} from "./shared/board";
import { addNoteRpc, deleteNoteRpc, listNotesRpc, markSeenRpc } from "./shared/notes";

export default function contribute(server: PluginServerContext) {
  const dataDirectory = resolveDataDirectory();
  // Every handler waits for the one-time copy of the retired plugins' data.
  const ready = migrateLegacyData(resolvePaseoHome(), dataDirectory).catch((error: unknown) => {
    console.error("[driveboard] Migrating earlier notes failed", error);
  });
  const notes = new NoteStore(path.join(dataDirectory, "notes.json"));
  const board = new BoardService(new BoardStateStore(path.join(dataDirectory, "board.json")));
  const tools = createAgentTools(notes);

  server.handle(listNotesRpc, async ({ workspaceId }) => {
    await ready;
    return { notes: await notes.list(workspaceId) };
  });
  server.handle(addNoteRpc, async ({ workspaceId, ...input }) => {
    await ready;
    return { note: await notes.add(workspaceId, input, { kind: "user" }) };
  });
  server.handle(deleteNoteRpc, async ({ workspaceId, id }) => {
    await ready;
    return { deleted: await notes.delete(workspaceId, id) };
  });
  server.handle(markSeenRpc, async ({ workspaceId }) => {
    await ready;
    return { marked: await notes.markSeen(workspaceId) };
  });

  server.handle(readBoardRpc, async ({ workspaceId }, { paseo }) => {
    await ready;
    return board.read(paseo, workspaceId);
  });
  server.handle(addReplyRpc, (input, { paseo }) => board.addReply(paseo, input));
  server.handle(editReplyRpc, (input, { paseo }) => board.editReply(paseo, input));
  server.handle(removeReplyRpc, (input, { paseo }) => board.removeReply(paseo, input));
  server.handle(setOwnerDoneRpc, (input, { paseo }) => board.setOwnerDone(paseo, input));
  server.handle(notifyRpc, async (input, { paseo }) => {
    await ready;
    return board.notify(paseo, input);
  });
  server.handle(dismissRpc, async (input, { paseo }) => {
    await ready;
    return board.dismiss(paseo, input);
  });
  server.handle(markOwnersSeenRpc, async ({ workspaceId }, { paseo }) => {
    await ready;
    return { marked: await board.markOwnersSeen(paseo, workspaceId) };
  });
  server.handle(markProgressSeenRpc, async ({ workspaceId }, { paseo }) => {
    await ready;
    return { marked: await board.markProgressSeen(paseo, workspaceId) };
  });
  server.handle(badgeSummaryRpc, async (_input, { paseo }) => {
    await ready;
    const unseen: Record<string, number> = {};
    for (const [workspaceId, summary] of Object.entries((await notes.summary()).workspaces)) {
      unseen[workspaceId] = summary.unseen;
    }
    return { workspaces: await board.badgeCounts(paseo, unseen) };
  });

  server.addHook("agent.open.before", async ({ request }) => {
    // History opens ignore tools; agents outside a workspace have no note to post to.
    if (request.purpose === "history" || !request.workspaceId) return;
    return { ...request, tools: [...request.tools, ...tools] };
  });

  return () => {};
}
