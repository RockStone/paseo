import { describe, expect, it } from "vitest";
import { findProjectForWorkspace, shouldShowProjectPill } from "./workspace-title-bar-project-pill";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";

describe("shouldShowProjectPill", () => {
  it("shows when the sidebar is not pinned open", () => {
    expect(shouldShowProjectPill({ isSidebarPinnedOpen: false, hasProject: true })).toBe(true);
  });
  it("hides when the sidebar is pinned open", () => {
    expect(shouldShowProjectPill({ isSidebarPinnedOpen: true, hasProject: true })).toBe(false);
  });
  it("hides without a project", () => {
    expect(shouldShowProjectPill({ isSidebarPinnedOpen: false, hasProject: false })).toBe(false);
  });
});

describe("findProjectForWorkspace", () => {
  const project = (viewKey: string, workspaceId: string) =>
    ({
      viewKey,
      workspaceKeys: [`s1:${workspaceId}`],
    }) as unknown as WorkspaceStructureProject;
  it("finds the project that owns the workspace", () => {
    const projects = [project("a", "w1"), project("b", "w2")];
    expect(findProjectForWorkspace(projects, "s1", "w2")?.viewKey).toBe("b");
    expect(findProjectForWorkspace(projects, "s2", "w2")).toBeNull();
  });
});
