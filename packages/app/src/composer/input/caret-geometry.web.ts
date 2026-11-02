import { EditorView } from "@codemirror/view";
import type { AutocompleteCaretReader } from "@/components/ui/autocomplete-popover";

/** The focused composer editor's visible box and caret line, in window coordinates. */
export const readFocusedComposerCaret: AutocompleteCaretReader = () => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const view = EditorView.findFromDOM(active);
  if (!view) return null;
  const caret = view.coordsAtPos(view.state.selection.main.head);
  if (!caret) return null;
  const editor = view.scrollDOM.getBoundingClientRect();
  return {
    editor: { top: editor.top, bottom: editor.bottom },
    caret: { top: caret.top, bottom: caret.bottom },
  };
};
