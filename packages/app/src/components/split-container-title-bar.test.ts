import { describe, expect, it } from "vitest";
import type { SplitNode } from "@/stores/workspace-layout-store";
import { resolveTitleBarPaneIds } from "./split-container-title-bar";

function pane(id: string, hidden = false): SplitNode {
  return { kind: "pane", pane: { id, tabIds: [], focusedTabId: null, hidden } } as SplitNode;
}

function group(direction: "horizontal" | "vertical", children: SplitNode[]): SplitNode {
  return {
    kind: "group",
    group: { id: `${direction}-${children.length}`, direction, children, sizes: [] },
  } as SplitNode;
}

const hiddenPane = (node: SplitNode) => node.kind === "pane" && node.pane.hidden === true;

describe("resolveTitleBarPaneIds", () => {
  it("gives a lone pane both sides", () => {
    expect(resolveTitleBarPaneIds(pane("a"), hiddenPane)).toEqual({
      leadingPaneId: "a",
      trailingPaneId: "a",
    });
  });

  it("splits the sides across a left and right pane", () => {
    expect(resolveTitleBarPaneIds(group("horizontal", [pane("a"), pane("b")]), hiddenPane)).toEqual(
      { leadingPaneId: "a", trailingPaneId: "b" },
    );
  });

  it("keeps a stacked split's sides on its top pane", () => {
    expect(resolveTitleBarPaneIds(group("vertical", [pane("a"), pane("b")]), hiddenPane)).toEqual({
      leadingPaneId: "a",
      trailingPaneId: "a",
    });
  });

  it("uses the top row of nested splits", () => {
    const root = group("horizontal", [
      group("vertical", [pane("a"), pane("b")]),
      group("vertical", [group("horizontal", [pane("c"), pane("d")]), pane("e")]),
    ]);
    expect(resolveTitleBarPaneIds(root, hiddenPane)).toEqual({
      leadingPaneId: "a",
      trailingPaneId: "d",
    });
  });

  it("skips hidden panes", () => {
    const root = group("horizontal", [pane("a", true), pane("b"), pane("c", true)]);
    expect(resolveTitleBarPaneIds(root, hiddenPane)).toEqual({
      leadingPaneId: "b",
      trailingPaneId: "b",
    });
    const stacked = group("vertical", [pane("a", true), pane("b")]);
    expect(resolveTitleBarPaneIds(stacked, hiddenPane).leadingPaneId).toBe("b");
  });
});
