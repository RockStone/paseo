import type { SplitNode } from "@/stores/workspace-layout-store";
import type { WindowChromeCorners } from "@/utils/desktop-window";

/**
 * Paseoi's merged title bar across splits. The panes whose tab rows touch the top edge form one
 * visual title bar: the leftmost of them carries the header's leading content and the rightmost
 * carries its trailing content. Panes lower down keep plain tab rows.
 */
export interface TitleBarPaneIds {
  leadingPaneId: string | null;
  trailingPaneId: string | null;
}

export function resolveTitleBarPaneIds(
  root: SplitNode,
  isHidden: (node: SplitNode) => boolean,
): TitleBarPaneIds {
  const topPaneIds = collectTopRowPaneIds(root, isHidden);
  return {
    leadingPaneId: topPaneIds[0] ?? null,
    trailingPaneId: topPaneIds[topPaneIds.length - 1] ?? null,
  };
}

function collectTopRowPaneIds(node: SplitNode, isHidden: (node: SplitNode) => boolean): string[] {
  if (isHidden(node)) return [];
  if (node.kind === "pane") return [node.pane.id];
  const visibleChildren = node.group.children.filter((child) => !isHidden(child));
  if (node.group.direction === "vertical") {
    const [top] = visibleChildren;
    return top ? collectTopRowPaneIds(top, isHidden) : [];
  }
  return visibleChildren.flatMap((child) => collectTopRowPaneIds(child, isHidden));
}

/**
 * The window corners a group child sits under. Side by side, only the outermost visible children
 * reach the left and right edges; stacked, only the top visible child reaches the top.
 */
export function resolveChildWindowChromeCorners(input: {
  corners: WindowChromeCorners;
  direction: "horizontal" | "vertical";
  index: number;
  hiddenByIndex: boolean[];
}): WindowChromeCorners {
  const { corners, direction, index, hiddenByIndex } = input;
  if (corners === "none" || hiddenByIndex[index]) return "none";
  const firstVisible = hiddenByIndex.indexOf(false);
  const lastVisible = hiddenByIndex.lastIndexOf(false);
  if (direction === "vertical") return index === firstVisible ? corners : "none";
  const keepsLeft = index === firstVisible && (corners === "both" || corners === "top-left");
  const keepsRight = index === lastVisible && (corners === "both" || corners === "top-right");
  if (keepsLeft && keepsRight) return "both";
  if (keepsLeft) return "top-left";
  if (keepsRight) return "top-right";
  return "none";
}
