import type { TextInputProps } from "react-native";
import type { NativePastedFile } from "@/composer/native-pasted-image";

/** Stable for the mounted editor lifetime; reset() owns any inner input replacement. */
export interface EditingTextInputHandle {
  focus(): void;
  blur(): void;
  isFocused(): boolean;
  getText(): string;
  getSelection?(): { start: number; end: number };
  replaceText(text: string, selection?: { start: number; end: number }): void;
  setSelection(selection: { start: number; end: number }): void;
  /** Scroll the caret into view, for editors that scroll their own content. */
  revealSelection?(): void;
  /** Clear the editor and reset its intrinsic layout, preserving focus intent. */
  reset(): void;
  getNativeRef(): unknown;
}

export interface EditingTextInputProps extends Omit<
  TextInputProps,
  "defaultValue" | "onChangeText" | "value"
> {
  initialValue?: string;
  onChangeText?: (text: string) => void;
  onPasteImages?: (files: readonly NativePastedFile[]) => void;
  onPasteError?: (message: string) => void;
  /** Web editor only: fires after an undo with the text before and after it. */
  onUndoText?: (previous: string, next: string) => void;
  variant?: "default" | "bottom-sheet";
}
