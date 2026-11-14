import { readdir } from "node:fs/promises";
import path from "node:path";
import { mimeTypeForPath } from "./parse";

// The app stores each prompt attachment as `att_<clientMessageId>` plus an extension, and a
// client message id looks like `msg_<epoch-ms>_<random>`.
const ATTACHMENT_NAME = /^att_(msg_\d+_[A-Za-z0-9]+)/;

/** Image files in the desktop attachment directory, grouped by the message that owns them. */
export class AttachmentDirectory {
  private cache: { at: number; byMessage: Map<string, string[]> } | null = null;

  constructor(
    private readonly directory: string,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 5_000,
  ) {}

  async load(): Promise<(clientMessageId: string) => readonly string[]> {
    if (!this.cache || this.now() - this.cache.at > this.ttlMs) {
      const byMessage = new Map<string, string[]>();
      let names: string[] = [];
      try {
        names = await readdir(this.directory);
      } catch {
        /* No attachments stored yet. */
      }
      for (const name of names.sort()) {
        const match = ATTACHMENT_NAME.exec(name);
        if (!match || !mimeTypeForPath(name)) continue;
        const files = byMessage.get(match[1]) ?? [];
        files.push(path.join(this.directory, name));
        byMessage.set(match[1], files);
      }
      this.cache = { at: this.now(), byMessage };
    }
    const { byMessage } = this.cache;
    return (clientMessageId) => byMessage.get(clientMessageId) ?? [];
  }
}
