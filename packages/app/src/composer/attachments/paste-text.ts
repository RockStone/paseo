import type { FileUploadInput, FileUploadResult } from "@getpaseo/client/internal/daemon-client";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import type { UserComposerAttachment } from "@/attachments/types";

type UploadedFile = Extract<UserComposerAttachment, { kind: "file" }>;
type PasteState = { status: "idle" } | { status: "pending" } | { status: "error"; message: string };

interface PasteDependencies {
  capture(): Promise<FileUploadInput>;
  upload(file: FileUploadInput): Promise<FileUploadResult>;
  attach(file: UploadedFile): void;
  pendingChanged(pending: boolean): void;
}

/** Captured bytes survive a failed upload; retries never silently read a different clipboard. */
export function createTextFilePaste(deps: PasteDependencies) {
  let state: PasteState = { status: "idle" };
  let captured: FileUploadInput | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  function publish(next: PasteState) {
    state = next;
    deps.pendingChanged(state.status === "pending");
    for (const listener of listeners) listener();
  }
  async function run() {
    if (state.status === "pending") return;
    const operation = ++generation;
    publish({ status: "pending" });
    try {
      const file = captured ?? (await deps.capture());
      if (operation !== generation) return;
      captured = file;
      const response = await deps.upload(file);
      if (operation !== generation) return;
      if (response.error || !response.file) {
        throw new Error(response.error ?? "Upload failed.");
      }
      deps.attach({ kind: "file", attachment: response.file });
      captured = null;
      publish({ status: "idle" });
    } catch (error) {
      if (operation === generation) publish({ status: "error", message: getErrorMessage(error) });
    }
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run,
    cancel() {
      generation++;
      captured = null;
      publish({ status: "idle" });
    },
  };
}
