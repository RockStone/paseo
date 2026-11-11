import { createInactivePointerFanout, type WindowPoint } from "./inactive-pointer-fanout";
import { getDesktopWindow } from "./electron/window";

export async function readSidebarPreviewPointer(): Promise<{ x: number; y: number } | null> {
  return (await getDesktopWindow()?.getPointerPosition?.()) ?? null;
}

const inactivePointer = createInactivePointerFanout({
  attach: (handler) => getDesktopWindow()?.onInactivePointer?.(handler),
  setTracking: (enabled) => {
    void getDesktopWindow()
      ?.setInactivePointerTracking?.(enabled)
      .catch(() => {});
  },
});

// Chromium delivers no pointer events to an inactive window, so the desktop main process
// streams the cursor instead. Points arrive in window CSS pixels, like clientX/clientY.
export function subscribeInactiveWindowPointer(listener: (point: WindowPoint) => void): () => void {
  return inactivePointer.subscribe(listener);
}
