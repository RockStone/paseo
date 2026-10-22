import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { PaseoConfigRaw } from "@getpaseo/protocol/messages";
import {
  applyDraftToConfig,
  configToDraft,
  type ProjectScriptDraft,
} from "@/utils/project-config-form";

type ReadResult = Awaited<ReturnType<DaemonClient["readProjectConfig"]>>;
type Snapshot = Extract<ReadResult, { ok: true }>;
type WriteResult = Awaited<ReturnType<DaemonClient["writeProjectConfig"]>>;
type Failure =
  | "read_failed"
  | "invalid_project_config"
  | "project_not_found"
  | "stale_project_config"
  | "write_failed"
  | "duplicate_script"
  | "script_not_found";

export type ScriptEditState =
  | { status: "loading" }
  | { status: "load-error"; error: Failure }
  | {
      status: "editing" | "saving" | "loading-scope" | "scope-error";
      draft: ProjectScriptDraft;
      error: Failure | null;
    };

interface ScriptEditPorts {
  scriptName: string | null;
  read: (shared?: boolean) => Promise<ReadResult>;
  shared?: boolean;
  write: DaemonClient["writeProjectConfig"];
  saved: (result: Extract<WriteResult, { ok: true }>) => void;
}

/** A fresh instance owns one config revision and one edit, including retries. */
export function openScriptEditForm(ports: ScriptEditPorts) {
  let state: ScriptEditState = { status: "loading" };
  let snapshot: Snapshot | null = null;
  let closed = false;
  let shared = ports.shared ?? false;
  let operation = 0;
  const listeners = new Set<() => void>();
  function publish(next: ScriptEditState) {
    if (closed) return;
    state = next;
    for (const listener of listeners) listener();
  }
  async function load(preserveDraft = false) {
    if (state.status === "saving") return;
    const request = ++operation;
    const retainedDraft = preserveDraft && "draft" in state ? state.draft : null;
    snapshot = null;
    publish(
      retainedDraft
        ? { status: "loading-scope", draft: retainedDraft, error: null }
        : { status: "loading" },
    );
    try {
      const result = await ports.read(shared);
      if (closed || request !== operation) return;
      if (!result.ok) {
        publish(
          retainedDraft
            ? {
                status: "scope-error",
                draft: retainedDraft,
                error: result.error.code,
              }
            : { status: "load-error", error: result.error.code },
        );
        return;
      }
      snapshot = result;
      const draft = configToDraft(result.config).scripts.find(
        (row) => row.name === ports.scriptName,
      );
      if (ports.scriptName !== null && !draft) {
        publish({ status: "load-error", error: "script_not_found" });
        return;
      }
      publish({
        status: "editing",
        error: null,
        draft: retainedDraft ??
          draft ?? {
            id: "new-script",
            name: "",
            commandText: "",
            commandOriginalKind: "string",
            type: "",
            portText: "",
            rawEntry: {},
          },
      });
    } catch {
      if (closed || request !== operation) return;
      publish(
        retainedDraft
          ? {
              status: "scope-error",
              draft: retainedDraft,
              error: "read_failed",
            }
          : { status: "load-error", error: "read_failed" },
      );
    }
  }
  function change(draft: ProjectScriptDraft) {
    if (state.status !== "editing" && state.status !== "scope-error") return;
    publish({
      ...state,
      draft,
      error:
        state.error === "stale_project_config" || state.status === "scope-error"
          ? state.error
          : null,
    });
  }
  async function save() {
    if (state.status !== "editing" || !snapshot || state.error === "stale_project_config") return;
    const draft = state.draft;
    const name = draft.name.trim();
    if (!name || !draft.commandText.trim()) return;
    const base = snapshot.config ?? {};
    if (name !== ports.scriptName && Object.hasOwn(base.scripts ?? {}, name)) {
      publish({ ...state, error: "duplicate_script" });
      return;
    }
    const single = configToDraft(null);
    single.scripts = [draft];
    const serialized = applyDraftToConfig({ draft: single, base: null });
    const scripts = { ...base.scripts };
    if (ports.scriptName !== null) delete scripts[ports.scriptName];
    const config: PaseoConfigRaw = { ...base, scripts: { ...scripts, ...serialized.scripts } };
    publish({ status: "saving", draft, error: null });
    try {
      const result = await ports.write({
        repoRoot: snapshot.repoRoot,
        config,
        expectedRevision: snapshot.revision,
      });
      if (closed) return;
      if (!result.ok) {
        publish({ status: "editing", draft, error: result.error.code });
        return;
      }
      ports.saved(result);
    } catch {
      publish({ status: "editing", draft, error: "write_failed" });
    }
  }
  return {
    getState: () => state,
    isShared: () =>
      shared || (snapshot !== null && snapshot.repoRoot === snapshot.sharedScriptsRoot),
    setShared: async (next: boolean) => {
      if (ports.scriptName !== null || next === shared) return;
      if (state.status !== "editing" && state.status !== "scope-error") return;
      shared = next;
      await load(true);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    change,
    save,
    close: () => {
      closed = true;
      operation++;
      listeners.clear();
    },
  };
}
