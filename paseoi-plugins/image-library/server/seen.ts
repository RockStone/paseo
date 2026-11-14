import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const fileSchema = z.object({
  version: z.literal(1),
  workspaces: z.record(z.string(), z.string()),
});

/** When the owner last opened each workspace's drawer; images newer than that are unseen. */
export class SeenStore {
  private data: z.infer<typeof fileSchema> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async load() {
    if (this.data) return this.data;
    try {
      const parsed = fileSchema.safeParse(JSON.parse(await readFile(this.file, "utf8")));
      this.data = parsed.success ? parsed.data : { version: 1, workspaces: {} };
    } catch {
      this.data = { version: 1, workspaces: {} };
    }
    return this.data;
  }

  private persist(): Promise<void> {
    const data = this.data;
    const write = async () => {
      await this.chain;
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(data));
      await rename(`${this.file}.tmp`, this.file);
    };
    const next = write();
    this.chain = next.catch(() => undefined);
    return next;
  }

  /**
   * The cutoff for a workspace. A workspace never opened starts now, so the first run does not
   * flag the whole backlog.
   */
  async cutoff(workspaceId: string): Promise<string> {
    const data = await this.load();
    const existing = data.workspaces[workspaceId];
    if (existing) return existing;
    data.workspaces[workspaceId] = this.now().toISOString();
    await this.persist();
    return data.workspaces[workspaceId];
  }

  async markSeen(workspaceId: string): Promise<void> {
    const data = await this.load();
    data.workspaces[workspaceId] = this.now().toISOString();
    await this.persist();
  }
}
