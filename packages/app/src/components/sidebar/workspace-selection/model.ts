import { create } from "zustand";

/**
 * The sidebar's select mode, keyed by `SidebarWorkspaceEntry.workspaceKey`.
 *
 * `confirming` and `archiving` freeze the selection: the confirm dialog lists what is selected,
 * and a toggle landing mid-run would change what the progress counts against.
 */
export type WorkspaceSelectionState =
  | { mode: "off" }
  | { mode: "selecting"; selected: ReadonlySet<string> }
  | { mode: "confirming"; selected: ReadonlySet<string> }
  | { mode: "archiving"; selected: ReadonlySet<string>; settled: number; total: number };

export const WORKSPACE_SELECTION_OFF: WorkspaceSelectionState = { mode: "off" };

export function startSelection(initial: readonly string[]): WorkspaceSelectionState {
  return { mode: "selecting", selected: new Set(initial) };
}

export function toggleSelected(
  state: WorkspaceSelectionState,
  key: string,
): WorkspaceSelectionState {
  if (state.mode !== "selecting") return state;
  const selected = new Set(state.selected);
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  return { mode: "selecting", selected };
}

/** Checks every key, or unchecks every key when all of them are already checked. */
export function toggleAllSelected(
  state: WorkspaceSelectionState,
  keys: readonly string[],
): WorkspaceSelectionState {
  if (state.mode !== "selecting" || keys.length === 0) return state;
  const selected = new Set(state.selected);
  const allChecked = keys.every((key) => selected.has(key));
  for (const key of keys) {
    if (allChecked) selected.delete(key);
    else selected.add(key);
  }
  return { mode: "selecting", selected };
}

export function beginConfirm(state: WorkspaceSelectionState): WorkspaceSelectionState {
  if (state.mode !== "selecting" || state.selected.size === 0) return state;
  return { mode: "confirming", selected: state.selected };
}

export function abortConfirm(state: WorkspaceSelectionState): WorkspaceSelectionState {
  if (state.mode !== "confirming") return state;
  return { mode: "selecting", selected: state.selected };
}

export function beginArchive(
  state: WorkspaceSelectionState,
  total: number,
): WorkspaceSelectionState {
  if (state.mode !== "confirming") return state;
  return { mode: "archiving", selected: state.selected, settled: 0, total };
}

export function recordSettled(state: WorkspaceSelectionState): WorkspaceSelectionState {
  if (state.mode !== "archiving") return state;
  return { ...state, settled: Math.min(state.total, state.settled + 1) };
}

/** Leaves select mode on success. Failed workspaces stay checked so Archive retries them. */
export function finishArchive(
  state: WorkspaceSelectionState,
  failedKeys: readonly string[],
): WorkspaceSelectionState {
  if (state.mode !== "archiving") return state;
  if (failedKeys.length === 0) return WORKSPACE_SELECTION_OFF;
  return { mode: "selecting", selected: new Set(failedKeys) };
}

/** Whether a row is checked, or `null` when select mode is off and the row behaves normally. */
export function selectionCheckedFor(state: WorkspaceSelectionState, key: string): boolean | null {
  if (state.mode === "off") return null;
  return state.selected.has(key);
}

interface WorkspaceSelectionStore {
  state: WorkspaceSelectionState;
  apply: (transition: (state: WorkspaceSelectionState) => WorkspaceSelectionState) => void;
}

export const useWorkspaceSelectionStore = create<WorkspaceSelectionStore>((set) => ({
  state: WORKSPACE_SELECTION_OFF,
  apply: (transition) => set((store) => ({ state: transition(store.state) })),
}));

export function applyWorkspaceSelection(
  transition: (state: WorkspaceSelectionState) => WorkspaceSelectionState,
): void {
  useWorkspaceSelectionStore.getState().apply(transition);
}
