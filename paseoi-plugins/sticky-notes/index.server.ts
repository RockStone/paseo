import type { PluginServerContext } from "@getpaseo/plugin/server";
import { NoteStore, resolveNotesFile } from "./server/store";
import { createAgentTools } from "./server/tools";
import { addNoteRpc, deleteNoteRpc, listNotesRpc, markSeenRpc, summaryRpc } from "./shared/notes";

export default function contribute(server: PluginServerContext) {
  const store = new NoteStore(resolveNotesFile());
  const tools = createAgentTools(store);

  server.handle(listNotesRpc, async ({ workspaceId }) => ({
    notes: await store.list(workspaceId),
  }));
  server.handle(addNoteRpc, async ({ workspaceId, ...input }) => ({
    note: await store.add(workspaceId, input, { kind: "user" }),
  }));
  server.handle(deleteNoteRpc, async ({ workspaceId, id }) => ({
    deleted: await store.delete(workspaceId, id),
  }));
  server.handle(markSeenRpc, async ({ workspaceId }) => ({
    marked: await store.markSeen(workspaceId),
  }));
  server.handle(summaryRpc, () => store.summary());

  server.addHook("agent.open.before", async ({ request }) => {
    // History opens ignore tools; agents outside a workspace have no note to post to.
    if (request.purpose === "history" || !request.workspaceId) return;
    return { ...request, tools: [...request.tools, ...tools] };
  });

  return () => {};
}
