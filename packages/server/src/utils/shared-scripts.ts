import { join } from "node:path";
import { readPaseoConfig, type ReadPaseoConfigResult } from "./worktree.js";

export function sharedScriptsRoot(paseoHome: string): string {
  return join(paseoHome, "shared-scripts");
}

/** Only scripts inherit from the host. Repo lifecycle hooks and metadata stay local. */
export async function readWorkspaceScriptConfig(
  repoRoot: string,
  sharedRoot?: string,
): Promise<ReadPaseoConfigResult> {
  const project = await readPaseoConfig(repoRoot);
  if (!project.ok || !sharedRoot) return project;
  const shared = await readPaseoConfig(sharedRoot);
  if (!shared.ok) return shared;
  return {
    ok: true,
    config: {
      ...project.config,
      scripts: { ...shared.config?.scripts, ...project.config?.scripts },
    },
  };
}
