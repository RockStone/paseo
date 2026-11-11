import { describe, expect, it } from "vitest";
import {
  abortConfirm,
  beginArchive,
  beginConfirm,
  finishArchive,
  recordSettled,
  selectionCheckedFor,
  startSelection,
  toggleAllSelected,
  toggleSelected,
  WORKSPACE_SELECTION_OFF,
  type WorkspaceSelectionState,
} from "./model";

function selectedKeys(state: WorkspaceSelectionState): string[] {
  return state.mode === "off" ? [] : [...state.selected].sort();
}

describe("workspace selection", () => {
  it("starts with the row that opened it already checked", () => {
    const state = startSelection(["a"]);
    expect(state.mode).toBe("selecting");
    expect(selectedKeys(state)).toEqual(["a"]);
  });

  it("toggles rows on and off while selecting", () => {
    let state = startSelection([]);
    state = toggleSelected(state, "a");
    state = toggleSelected(state, "b");
    state = toggleSelected(state, "a");
    expect(selectedKeys(state)).toEqual(["b"]);
  });

  it("ignores toggles while off, confirming, or archiving", () => {
    expect(toggleSelected(WORKSPACE_SELECTION_OFF, "a")).toBe(WORKSPACE_SELECTION_OFF);
    const confirming = beginConfirm(startSelection(["a"]));
    expect(toggleSelected(confirming, "b")).toBe(confirming);
    const archiving = beginArchive(confirming, 1);
    expect(toggleSelected(archiving, "b")).toBe(archiving);
  });

  it("checks a whole project, and unchecks it when every row is already checked", () => {
    let state = startSelection(["a"]);
    state = toggleAllSelected(state, ["a", "b", "c"]);
    expect(selectedKeys(state)).toEqual(["a", "b", "c"]);
    state = toggleAllSelected(state, ["b", "c"]);
    expect(selectedKeys(state)).toEqual(["a"]);
  });

  it("only confirms a non-empty selection", () => {
    const empty = startSelection([]);
    expect(beginConfirm(empty)).toBe(empty);
    expect(beginConfirm(startSelection(["a"])).mode).toBe("confirming");
  });

  it("returns to selecting with the same rows when the confirm is declined", () => {
    const state = abortConfirm(beginConfirm(startSelection(["a", "b"])));
    expect(state.mode).toBe("selecting");
    expect(selectedKeys(state)).toEqual(["a", "b"]);
  });

  it("counts settled archives without passing the total", () => {
    let state = beginArchive(beginConfirm(startSelection(["a", "b"])), 2);
    state = recordSettled(recordSettled(recordSettled(state)));
    expect(state).toMatchObject({ mode: "archiving", settled: 2, total: 2 });
  });

  it("leaves select mode when every archive succeeds", () => {
    const state = beginArchive(beginConfirm(startSelection(["a", "b"])), 2);
    expect(finishArchive(state, [])).toBe(WORKSPACE_SELECTION_OFF);
  });

  it("keeps only the failed rows checked so the user can retry", () => {
    const state = beginArchive(beginConfirm(startSelection(["a", "b", "c"])), 3);
    const after = finishArchive(state, ["c"]);
    expect(after.mode).toBe("selecting");
    expect(selectedKeys(after)).toEqual(["c"]);
  });

  it("reports null for every row while off, so rows keep navigating", () => {
    expect(selectionCheckedFor(WORKSPACE_SELECTION_OFF, "a")).toBeNull();
    const state = startSelection(["a"]);
    expect(selectionCheckedFor(state, "a")).toBe(true);
    expect(selectionCheckedFor(state, "b")).toBe(false);
  });
});
