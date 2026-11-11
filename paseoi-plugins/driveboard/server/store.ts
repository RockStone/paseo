import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  type Note,
  type NoteAuthor,
  type NoteInput,
  type NotesSummary,
  noteSchema,
} from "../shared/notes";

/** Oldest notes beyond this count are dropped so the file stays small. */
export const MAX_NOTES_PER_WORKSPACE = 200;

const storeFileSchema = z.object({
  version: z.literal(1),
  workspaces: z.record(z.string(), z.array(noteSchema)),
});

type StoreFile = z.infer<typeof storeFileSchema>;

/**
 * Paseo gives plugins no data-directory API, and settings documents cannot be written from the
 * server. The daemon resolves its home from PASEO_HOME (default ~/.paseo) and the plugin
 * subprocess inherits the daemon's environment, so notes live beside the daemon's own
 * plugin-settings directory, never in a repository.
 */
export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME?.trim() || "~/.paseo";
  let home = raw;
  if (raw === "~") home = os.homedir();
  else if (raw.startsWith("~/")) home = path.join(os.homedir(), raw.slice(2));
  return path.resolve(home);
}

export function resolveDataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolvePaseoHome(env), "plugin-data", "driveboard");
}

export function resolveNotesFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveDataDirectory(env), "notes.json");
}

export interface NoteStoreOptions {
  now?: () => Date;
  createId?: () => string;
  log?: (message: string) => void;
}

function emptyStore(): StoreFile {
  return { version: 1, workspaces: {} };
}

function newestFirst(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export class NoteStore {
  private state: Promise<StoreFile> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly log: (message: string) => void;

  constructor(
    readonly filePath: string,
    options: NoteStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.log = options.log ?? ((message) => console.error(message));
  }

  async list(workspaceId: string): Promise<Note[]> {
    const state = await this.read();
    return newestFirst(state.workspaces[workspaceId] ?? []);
  }

  async summary(): Promise<NotesSummary> {
    const state = await this.read();
    const workspaces: NotesSummary["workspaces"] = {};
    for (const [workspaceId, notes] of Object.entries(state.workspaces)) {
      if (notes.length === 0) continue;
      workspaces[workspaceId] = {
        total: notes.length,
        unseen: notes.filter((note) => note.seenAt === null).length,
      };
    }
    return { workspaces };
  }

  add(workspaceId: string, input: NoteInput, author: NoteAuthor): Promise<Note> {
    return this.mutate((state) => {
      const createdAt = this.now().toISOString();
      const note: Note = {
        id: this.createId(),
        text: input.text,
        ...(input.url ? { url: input.url } : {}),
        ...(input.title ? { title: input.title } : {}),
        author,
        createdAt,
        seenAt: author.kind === "user" ? createdAt : null,
      };
      const kept = newestFirst([note, ...(state.workspaces[workspaceId] ?? [])]);
      state.workspaces[workspaceId] = kept.slice(0, MAX_NOTES_PER_WORKSPACE);
      return note;
    });
  }

  delete(workspaceId: string, id: string): Promise<boolean> {
    return this.mutate((state) => {
      const notes = state.workspaces[workspaceId] ?? [];
      const remaining = notes.filter((note) => note.id !== id);
      if (remaining.length === notes.length) return false;
      if (remaining.length === 0) delete state.workspaces[workspaceId];
      else state.workspaces[workspaceId] = remaining;
      return true;
    });
  }

  markSeen(workspaceId: string): Promise<number> {
    return this.mutate((state) => {
      const seenAt = this.now().toISOString();
      let marked = 0;
      // `state` is a private copy, so the notes can be updated in place.
      for (const note of state.workspaces[workspaceId] ?? []) {
        if (note.seenAt !== null) continue;
        note.seenAt = seenAt;
        marked += 1;
      }
      return marked;
    });
  }

  private read(): Promise<StoreFile> {
    this.state ??= this.load().catch((error: unknown) => {
      // A transient read failure (permissions, I/O) must not stick; retry on the next call.
      this.state = null;
      throw error;
    });
    return this.state;
  }

  private async load(): Promise<StoreFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
      throw error;
    }
    try {
      return storeFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      // Keep the unreadable file for inspection and start over instead of crashing.
      const aside = `${this.filePath}.corrupt-${this.now().toISOString().replace(/[:.]/g, "-")}`;
      await rename(this.filePath, aside).catch(() => undefined);
      const reason = error instanceof Error ? error.message : String(error);
      this.log(`[driveboard] Notes file was invalid and was moved to ${aside}: ${reason}`);
      return emptyStore();
    }
  }

  /** Serializes writes, persists a copy atomically, and only then makes it current. */
  private async mutate<Result>(change: (state: StoreFile) => Result): Promise<Result> {
    const previous = this.queue;
    let unlock = () => {};
    this.queue = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      const next = structuredClone(await this.read());
      const result = change(next);
      await this.persist(next);
      this.state = Promise.resolve(next);
      return result;
    } finally {
      unlock();
    }
  }

  private async persist(state: StoreFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temp, this.filePath);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
}
