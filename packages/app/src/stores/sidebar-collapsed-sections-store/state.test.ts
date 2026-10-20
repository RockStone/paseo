import { describe, expect, it } from "vitest";
import {
  type CollapsedProjectsState,
  mergePersistedCollapsedProjects,
  serializeCollapsedProjects,
  setProjectCollapsed,
  togglePinnedCollapsed,
  setProjectsCollapsed,
  setWorkspaceGroupsCollapsed,
  toggleProjectCollapsed,
  toggleWorkspaceGroupCollapsed,
} from "@/stores/sidebar-collapsed-sections-store/state";

function emptyState(): CollapsedProjectsState {
  return {
    collapsedProjectKeys: new Set(),
    collapsedWorkspaceGroupKeys: new Set(),
    collapsedPinned: false,
  };
}

describe("sidebar collapsed projects transitions", () => {
  it("tracks collapsed project keys as a Set", () => {
    let state = emptyState();

    state = setProjectCollapsed(state, "project-a", true);
    state = toggleProjectCollapsed(state, "project-b");
    state = toggleProjectCollapsed(state, "project-a");
    state = toggleWorkspaceGroupCollapsed(state, "running");

    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-b"]);
    expect(Array.from(state.collapsedWorkspaceGroupKeys)).toEqual(["running"]);
  });

  it("serializes collapsed project keys for preference storage", () => {
    const state: CollapsedProjectsState = {
      collapsedProjectKeys: new Set(["project-a", "project-b"]),
      collapsedWorkspaceGroupKeys: new Set(["running"]),
      collapsedPinned: true,
    };

    expect(serializeCollapsedProjects(state)).toEqual({
      collapsedProjectKeys: ["project-a", "project-b"],
      collapsedWorkspaceGroupKeys: ["running"],
      collapsedPinned: true,
    });
  });

  it("toggles and restores the pinned section collapse flag", () => {
    const toggled = togglePinnedCollapsed(emptyState());
    expect(toggled.collapsedPinned).toBe(true);

    const restored = mergePersistedCollapsedProjects({ collapsedPinned: true }, emptyState());
    expect(restored.collapsedPinned).toBe(true);
  });

  it("collapses and expands visible projects together while preserving other preferences", () => {
    const current = toggleWorkspaceGroupCollapsed(
      togglePinnedCollapsed(setProjectCollapsed(emptyState(), "filtered-project", true)),
      "running",
    );
    const collapsed = setProjectsCollapsed(current, ["project-a", "project-b"], true);
    expect([...collapsed.collapsedProjectKeys]).toEqual([
      "filtered-project",
      "project-a",
      "project-b",
    ]);
    const restored = mergePersistedCollapsedProjects(
      serializeCollapsedProjects(collapsed),
      emptyState(),
    );
    expect(restored).toEqual(collapsed);
    expect(setProjectsCollapsed(restored, ["project-a", "project-b"], false)).toEqual(current);
  });

  it("collapses status groups without changing project or pinned preferences", () => {
    const current = togglePinnedCollapsed(setProjectCollapsed(emptyState(), "project-a", true));
    const collapsed = setWorkspaceGroupsCollapsed(current, ["running", "done"], true);
    expect([...collapsed.collapsedWorkspaceGroupKeys]).toEqual(["running", "done"]);
    expect(setWorkspaceGroupsCollapsed(collapsed, ["running", "done"], false)).toEqual(current);
  });

  it("accepts the old section flag without discarding individual collapse preferences", () => {
    const restored = mergePersistedCollapsedProjects(
      {
        collapsedWorkspaces: true,
        collapsedProjectKeys: ["project-a"],
        collapsedPinned: true,
      },
      emptyState(),
    );
    expect([...restored.collapsedProjectKeys]).toEqual(["project-a"]);
    expect(restored.collapsedPinned).toBe(true);
    expect(serializeCollapsedProjects(restored)).not.toHaveProperty("collapsedWorkspaces");
  });

  it("rejects the complete value when a persisted project key is invalid", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectKeys: ["project-a", "project-b", 42] },
      emptyState(),
    );

    expect(Array.from(restored.collapsedProjectKeys)).toEqual([]);
    expect(Array.from(restored.collapsedWorkspaceGroupKeys)).toEqual([]);
  });

  it("keeps the existing state object when persisted preferences do not change collapsed keys", () => {
    const currentState = emptyState();

    expect(mergePersistedCollapsedProjects(undefined, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({}, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({ collapsedProjectKeys: [] }, currentState)).toBe(
      currentState,
    );
  });
});
