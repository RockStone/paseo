import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  countsRpc,
  imageBytesRpc,
  listImagesRpc,
  markSeenRpc,
  scanOlderRpc,
  stopScanRpc,
} from "./shared/images";
import { countUnseen } from "./server/counts";
import { createServices } from "./server/service";

const LIST_BUDGET_MS = 6_000;
const COUNT_BUDGET_MS = 3_000;

export default function contribute(server: PluginServerContext) {
  const services = createServices();
  const { index, media, seen } = services;

  server.handle(listImagesRpc, async ({ workspaceId, ...options }, { paseo }) => {
    services.use(paseo);
    const scanning = await index.refresh({ workspaceId, budgetMs: LIST_BUDGET_MS });
    return {
      ...(await index.list(workspaceId, options)),
      scanning,
      older: await index.olderStatus(workspaceId),
    };
  });

  server.handle(scanOlderRpc, async ({ workspaceId }, { paseo }) => {
    services.use(paseo);
    return { started: await index.startOlderScan(workspaceId) };
  });

  server.handle(stopScanRpc, async () => {
    index.stopOlderScan();
    return { stopped: true };
  });

  server.handle(imageBytesRpc, async ({ id, variant }, { paseo }) => {
    services.use(paseo);
    const file = await index.resolve(id);
    if (!file)
      return { mimeType: "application/octet-stream", data: null, reason: "missing" as const };
    return media.bytes(file, variant);
  });

  server.handle(countsRpc, async (_input, { paseo }) => {
    services.use(paseo);
    await index.refresh({ budgetMs: COUNT_BUDGET_MS });
    return { workspaces: await countUnseen(index, seen) };
  });

  server.handle(markSeenRpc, async ({ workspaceId }) => {
    await seen.markSeen(workspaceId);
    return { marked: true };
  });

  return () => {};
}
