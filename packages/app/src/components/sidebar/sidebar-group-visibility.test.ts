import { describe, expect, it } from "vitest";
import type { SidebarStateBucket } from "@/hooks/sidebar-workspaces-view-model";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import {
  selectSidebarGroupVisibility,
  type SidebarGroupItem,
  type SidebarGroupVisibilityPolicy,
} from "./sidebar-group-visibility";

interface Item extends SidebarGroupItem {
  id: number;
  statusBucket: SidebarStateBucket;
}

const serverId = "host-a";

function rows(statuses: readonly SidebarStateBucket[], rowServerId = serverId): Item[] {
  return statuses.map((statusBucket, index) => ({
    id: index + 1,
    serverId: rowServerId,
    workspaceId: `workspace-${index + 1}`,
    statusBucket,
  }));
}

const workspacePolicy: SidebarGroupVisibilityPolicy = {
  kind: "workspaces",
};

function selectionFor(item: SidebarGroupItem): ActiveWorkspaceSelection {
  return { serverId: item.serverId, workspaceId: item.workspaceId };
}

describe("selectSidebarGroupVisibility", () => {
  it("shows only recent workspaces even when there are fewer than five, preserving order", () => {
    const items = rows(Array(9).fill("running"));
    const recentWorkspaceKeys = new Set([
      `${serverId}:${items[1]!.workspaceId}`,
      `${serverId}:${items[7]!.workspaceId}`,
    ]);
    expect(
      selectSidebarGroupVisibility({
        items,
        recentWorkspaceKeys,
        policy: workspacePolicy,
        expanded: false,
        selection: selectionFor(items[8]!),
      }),
    ).toEqual({ leadingItem: null, visibleItems: [items[1], items[7]], canToggle: true });
  });

  it("keeps the strict five-row cap even for a selected overflow workspace", () => {
    const items = rows(Array(9).fill("done"));
    const result = selectSidebarGroupVisibility({
      items,
      recentWorkspaceKeys: new Set(items.map((item) => `${item.serverId}:${item.workspaceId}`)),
      expanded: false,
      policy: workspacePolicy,
      selection: selectionFor(items[8]!),
    });

    expect(result.leadingItem).toBeNull();
    expect(result.visibleItems).toEqual(items.slice(0, 5));
    expect(result.canToggle).toBe(true);
  });

  it("leaves selected rows in place when they are already in the baseline", () => {
    const items = rows([...Array(8).fill("done"), "running", "done"]);
    const expected = items.slice(0, 5);

    for (const selectedIndex of [2, 8]) {
      const result = selectSidebarGroupVisibility({
        items,
        recentWorkspaceKeys: new Set(items.map((item) => `${item.serverId}:${item.workspaceId}`)),
        expanded: false,
        policy: workspacePolicy,
        selection: selectionFor(items[selectedIndex]!),
      });

      expect(result.leadingItem).toBeNull();
      expect(result.visibleItems).toEqual(expected);
      expect(result.canToggle).toBe(true);
    }
  });

  it("keeps the cap even when the open row is hidden", () => {
    const items = rows(Array(8).fill("done"));
    const result = selectSidebarGroupVisibility({
      items,
      recentWorkspaceKeys: new Set(items.map((item) => `${item.serverId}:${item.workspaceId}`)),
      expanded: false,
      policy: workspacePolicy,
      selection: selectionFor(items[7]!),
    });

    expect(result.leadingItem).toBeNull();
    expect(result.visibleItems).toEqual(items.slice(0, 5));
    expect(result.canToggle).toBe(true);
  });

  it("keeps expanded groups in their original order", () => {
    const items = rows(Array(9).fill("done"));
    const result = selectSidebarGroupVisibility({
      items,
      recentWorkspaceKeys: new Set(items.map((item) => `${item.serverId}:${item.workspaceId}`)),
      expanded: true,
      policy: workspacePolicy,
      selection: selectionFor(items[8]!),
    });

    expect(result.leadingItem).toBeNull();
    expect(result.visibleItems).toEqual(items);
    expect(result.canToggle).toBe(true);
  });

  it("applies the twenty-row limit to pinned groups", () => {
    const items = rows(Array(22).fill("done"));
    const result = selectSidebarGroupVisibility({
      items,
      recentWorkspaceKeys: new Set(items.map((item) => `${item.serverId}:${item.workspaceId}`)),
      expanded: false,
      policy: { kind: "pinned" },
      selection: selectionFor(items[21]!),
    });

    expect(result.leadingItem).toBe(items[21]);
    expect(result.visibleItems).toEqual(items.slice(0, 20));
    expect(result.canToggle).toBe(true);
  });

  it("preserves the current limit when selection is null", () => {
    const items = rows(Array(8).fill("done"));
    const result = selectSidebarGroupVisibility({
      items,
      recentWorkspaceKeys: new Set(items.map((item) => `${item.serverId}:${item.workspaceId}`)),
      expanded: false,
      policy: workspacePolicy,
      selection: null,
    });

    expect(result.leadingItem).toBeNull();
    expect(result.visibleItems).toEqual(items.slice(0, 5));
    expect(result.canToggle).toBe(true);
  });

  it("matches the open row by server and workspace identity", () => {
    const items = rows(Array(9).fill("done"), "host-b");
    const result = selectSidebarGroupVisibility({
      items,
      recentWorkspaceKeys: new Set(items.map((item) => `${item.serverId}:${item.workspaceId}`)),
      expanded: false,
      policy: workspacePolicy,
      selection: { serverId: serverId, workspaceId: items[8]!.workspaceId },
    });

    expect(result.leadingItem).toBeNull();
    expect(result.visibleItems).toEqual(items.slice(0, 5));
    expect(result.canToggle).toBe(true);
  });
});
