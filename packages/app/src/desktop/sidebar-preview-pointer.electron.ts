import { getDesktopWindow } from "./electron/window";

export async function readSidebarPreviewPointer(): Promise<{ x: number; y: number } | null> {
  return (await getDesktopWindow()?.getPointerPosition?.()) ?? null;
}
