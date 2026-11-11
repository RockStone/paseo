import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Driveboard replaced two plugins: Sticky notes (notes.json) and the standalone Driveboard
 * (its host settings remember which owner replies were already sent). Their data is copied once,
 * when the new files do not exist yet; the old files are left in place.
 */
export async function migrateLegacyData(home: string, dataDirectory: string): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  await copyIfMissing(
    path.join(home, "plugin-data", "sticky-notes", "notes.json"),
    path.join(dataDirectory, "notes.json"),
  );
  const boardFile = path.join(dataDirectory, "board.json");
  if (await exists(boardFile)) return;
  const legacy = await readJson(
    path.join(home, "plugin-settings", "paseo-drive", "drive-notified.json"),
  );
  const projects = (legacy as { values?: { projects?: Record<string, unknown> } } | null)?.values
    ?.projects;
  if (!projects) return;
  const migrated: Record<string, { notified: string[]; seen: null }> = {};
  for (const [projectId, ids] of Object.entries(projects)) {
    if (Array.isArray(ids)) {
      migrated[projectId] = { notified: ids.filter((id) => typeof id === "string"), seen: null };
    }
  }
  await writeFile(boardFile, `${JSON.stringify({ version: 1, projects: migrated }, null, 2)}\n`, {
    flag: "wx",
  }).catch(() => undefined);
}

async function exists(file: string): Promise<boolean> {
  return readFile(file).then(
    () => true,
    () => false,
  );
}

async function copyIfMissing(from: string, to: string): Promise<void> {
  if (!(await exists(from)) || (await exists(to))) return;
  await copyFile(from, to).catch(() => undefined);
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}
