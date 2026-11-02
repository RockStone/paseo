import { getNextActiveIndex } from "./combobox-keyboard";

export type AutocompleteOptionsPosition = "above-input" | "below-input";

export function orderAutocompleteOptions<T>(
  options: readonly T[],
  position: AutocompleteOptionsPosition = "above-input",
): T[] {
  if (position === "below-input") {
    return [...options];
  }
  return [...options].toReversed();
}

export function getAutocompleteFallbackIndex(
  itemCount: number,
  position: AutocompleteOptionsPosition = "above-input",
): number {
  if (itemCount <= 0) {
    return -1;
  }
  return position === "above-input" ? itemCount - 1 : 0;
}

export function getAutocompleteNextIndex(args: {
  currentIndex: number;
  itemCount: number;
  key: "ArrowDown" | "ArrowUp";
}): number {
  return getNextActiveIndex(args);
}

/** A vertical extent in one coordinate space, such as the popover host's. */
export interface VerticalSpan {
  top: number;
  bottom: number;
}

/**
 * A list that floats inside a tall editor takes the half away from the caret line, so the
 * text being typed stays visible: the bottom edge while the caret is in the top half, the
 * top edge otherwise. Without a caret it keeps to the top half.
 */
export function resolveInsideAutocompleteLayout(input: {
  editor: VerticalSpan;
  caret: VerticalSpan | null;
  offset: number;
}): { edge: "top" | "bottom"; maxHeight: number } {
  const { editor, caret, offset } = input;
  if (!caret) return { edge: "top", maxHeight: Math.max(0, (editor.bottom - editor.top) / 2) };
  const caretMiddle = (caret.top + caret.bottom) / 2;
  if (caretMiddle < (editor.top + editor.bottom) / 2) {
    return { edge: "bottom", maxHeight: Math.max(0, editor.bottom - caret.bottom - offset * 2) };
  }
  return { edge: "top", maxHeight: Math.max(0, caret.top - editor.top - offset * 2) };
}
