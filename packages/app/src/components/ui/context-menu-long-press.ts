// Native builds open context menus from the Pressable's own `onLongPress`; see
// `context-menu-long-press.web.ts` for the touch-browser recognizer.

export function bindLongPressMenuDismiss(_event: unknown, _dismiss: () => void): void {}

export function installContextMenuLongPress(): () => void {
  return () => {};
}
