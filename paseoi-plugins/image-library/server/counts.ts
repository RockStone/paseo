import type { ImageIndex } from "./image-index";
import type { SeenStore } from "./seen";

/** Images added to each workspace since its drawer was last opened, counting only files that still exist. */
export async function countUnseen(
  index: ImageIndex,
  seen: SeenStore,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [workspaceId, timestamps] of await index.timestampsByWorkspace()) {
    const cutoff = await seen.cutoff(workspaceId);
    if (!timestamps.some((timestamp) => timestamp > cutoff)) continue;
    const count = (await index.entries(workspaceId)).filter(
      (entry) => entry.timestamp > cutoff,
    ).length;
    if (count > 0) counts[workspaceId] = count;
  }
  return counts;
}
