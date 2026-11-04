export const readSidebarPreviewPointer:
  | (() => Promise<{ x: number; y: number } | null>)
  | undefined = undefined;
