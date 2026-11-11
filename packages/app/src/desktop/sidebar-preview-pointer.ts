export const readSidebarPreviewPointer:
  | (() => Promise<{ x: number; y: number } | null>)
  | undefined = undefined;

export const subscribeInactiveWindowPointer:
  | ((listener: (point: { x: number; y: number }) => void) => () => void)
  | undefined = undefined;
