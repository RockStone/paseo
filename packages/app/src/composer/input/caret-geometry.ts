import type { AutocompleteCaretReader } from "@/components/ui/autocomplete-popover";

/** Native editors expose no caret geometry; the list keeps to the top of the editor. */
export const readFocusedComposerCaret: AutocompleteCaretReader = () => null;
