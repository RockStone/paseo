import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { AttachmentDirectory } from "./attachments";
import { type AgentInfo, ImageIndex, type IndexDeps } from "./image-index";
import { ImageMedia } from "./media";
import { SeenStore } from "./seen";

type Paseo = PluginHandlerContext["paseo"];

export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME?.trim() || "~/.paseo";
  let home = raw;
  if (raw === "~") home = os.homedir();
  else if (raw.startsWith("~/")) home = path.join(os.homedir(), raw.slice(2));
  return path.resolve(home);
}

export interface Services {
  index: ImageIndex;
  media: ImageMedia;
  seen: SeenStore;
  /** Binds the index to the SDK of the current request. */
  use(paseo: Paseo): void;
}

/** The index reads agents through whichever SDK handle served the latest request. */
export function createServices(home: string = resolvePaseoHome()): Services {
  const dataDirectory = path.join(home, "plugin-data", "image-library");
  let current: Paseo | null = null;
  const paseo = (): Paseo => {
    if (!current) throw new Error("The index ran before any request");
    return current;
  };
  const deps: IndexDeps = {
    async listAgents() {
      const agents: AgentInfo[] = [];
      let cursor: string | undefined;
      do {
        const page = await paseo().agents.list({
          filter: { includeArchived: true },
          page: { limit: 200, cursor },
        });
        for (const { agent } of page.entries) {
          if (!agent.workspaceId) continue;
          agents.push({
            id: agent.id,
            title: agent.title?.trim() || "Untitled agent",
            workspaceId: agent.workspaceId,
            updatedAt: agent.updatedAt,
          });
        }
        cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
      } while (cursor);
      return agents;
    },
    async workspaceNames() {
      const names = new Map<string, string>();
      let cursor: string | undefined;
      do {
        const page = await paseo().workspaces.list({ page: { limit: 200, cursor } });
        for (const workspace of page.entries) names.set(workspace.id, workspace.name);
        cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
      } while (cursor);
      return names;
    },
    async fetchTimeline(agentId, cursor) {
      const result = await paseo()
        .agents.ref(agentId)
        .timeline.refetch(
          cursor
            ? { direction: "after", cursor, limit: 0, projection: "canonical" }
            : { direction: "tail", limit: 0, projection: "canonical" },
        );
      return {
        epoch: result.epoch,
        reset: result.reset,
        staleCursor: result.staleCursor,
        endCursor: result.endCursor,
        entries: result.entries,
      };
    },
  };
  const index = new ImageIndex(deps, {
    stateFile: path.join(dataDirectory, "index.json"),
    attachments: new AttachmentDirectory(path.join(home, "desktop-attachments")),
    log: (message, error) => console.warn(`[image-library] ${message}`, error ?? ""),
  });
  return {
    index,
    media: new ImageMedia(path.join(dataDirectory, "thumbs")),
    seen: new SeenStore(path.join(dataDirectory, "seen.json")),
    use(next) {
      current = next;
    },
  };
}
