export interface SelectionReplyAnchor {
  x: number;
  top: number;
  bottom: number;
}

export function selectionReplyAnchor(selection: Selection): SelectionReplyAnchor | null {
  if (!selection.focusNode || selection.rangeCount !== 1) return null;
  const selectedRange = selection.getRangeAt(0);
  const focusRange = selectedRange.cloneRange();
  focusRange.setStart(selection.focusNode, selection.focusOffset);
  focusRange.collapse(true);
  const caret = focusRange.getBoundingClientRect();
  if (caret.height > 0) {
    return { x: caret.left, top: caret.top, bottom: caret.bottom };
  }

  // Some block boundaries expose no collapsed caret rectangle. Use the active
  // end's line fragment rather than the bounding box of all selected lines.
  const fragments = Array.from(selectedRange.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  const backwards = focusRange.compareBoundaryPoints(Range.START_TO_START, selectedRange) === 0;
  const fragment = backwards ? fragments.at(0) : fragments.at(-1);
  if (!fragment) return null;
  const x = backwards ? fragment.left : fragment.right;
  return { x, top: fragment.top, bottom: fragment.bottom };
}
