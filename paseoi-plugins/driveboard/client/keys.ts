import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";

// ⌘↵ on macOS, Ctrl+↵ elsewhere, submits; plain Enter keeps inserting a newline.
// The plugin builds without the DOM lib; `navigator` exists on web and in React Native.
const platformName = (globalThis as { navigator?: { platform?: string } }).navigator?.platform;
const IS_MAC = /Mac|iPhone|iPad/.test(platformName ?? "");

export const SUBMIT_HINT = IS_MAC ? "⌘↵ to submit" : "Ctrl+↵ to submit";

/** On web the key event is the DOM's, so it carries the modifier keys. */
export function isSubmitChord(event: NativeSyntheticEvent<TextInputKeyPressEventData>): boolean {
  const native = event.nativeEvent as TextInputKeyPressEventData & {
    metaKey?: boolean;
    ctrlKey?: boolean;
    isComposing?: boolean;
    repeat?: boolean;
  };
  if (native.key !== "Enter" || native.isComposing || native.repeat) return false;
  return IS_MAC ? native.metaKey === true : native.ctrlKey === true;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
