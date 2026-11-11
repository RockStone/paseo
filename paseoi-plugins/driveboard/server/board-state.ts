import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const projectStateSchema = z.object({
  /** Owner replies already sent to, or dismissed for, the agent. */
  notified: z.array(z.string()).default([]),
  /** Owner item id → content version the owner last saw. Null until the first read. */
  seen: z.record(z.string(), z.string()).nullable().default(null),
});

const stateFileSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), projectStateSchema),
});

export type ProjectState = z.infer<typeof projectStateSchema>;
type StateFile = z.infer<typeof stateFileSchema>;

const MAX_NOTIFIED = 2000;

/** Per-project board state beside the notes file. Writes are serialized and atomic. */
export class BoardStateStore {
  private state: Promise<StateFile> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly filePath: string) {}

  async get(projectId: string): Promise<ProjectState | null> {
    return (await this.read()).projects[projectId] ?? null;
  }

  update(projectId: string, change: (state: ProjectState) => void): Promise<ProjectState> {
    return this.mutate((file) => {
      const current = file.projects[projectId] ?? { notified: [], seen: null };
      change(current);
      current.notified = [...new Set(current.notified)].slice(-MAX_NOTIFIED);
      file.projects[projectId] = current;
      return current;
    });
  }

  private read(): Promise<StateFile> {
    this.state ??= this.load().catch((error: unknown) => {
      this.state = null;
      throw error;
    });
    return this.state;
  }

  private async load(): Promise<StateFile> {
    try {
      return stateFileSchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const aside = `${this.filePath}.corrupt-${Date.now()}`;
        await rename(this.filePath, aside).catch(() => undefined);
        console.error(`[driveboard] Board state was invalid and was moved to ${aside}`, error);
      }
      return { version: 1, projects: {} };
    }
  }

  private async mutate<Result>(change: (state: StateFile) => Result): Promise<Result> {
    const previous = this.queue;
    let unlock = () => {};
    this.queue = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      const next = structuredClone(await this.read());
      const result = change(next);
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        await rename(temp, this.filePath);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      this.state = Promise.resolve(next);
      return result;
    } finally {
      unlock();
    }
  }
}
