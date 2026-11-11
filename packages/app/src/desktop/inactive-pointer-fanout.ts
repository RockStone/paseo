export interface WindowPoint {
  x: number;
  y: number;
}

export interface InactivePointerSource {
  attach: (handler: (payload: unknown) => void) => (() => void) | undefined;
  setTracking: (enabled: boolean) => void;
}

export function readWindowPoint(payload: unknown): WindowPoint | null {
  if (!payload || typeof payload !== "object") return null;
  const { x, y } = payload as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

// One desktop stream serves every hook that needs the pointer while the window is
// inactive. The main process polls only while at least one listener is subscribed.
export function createInactivePointerFanout(source: InactivePointerSource) {
  const listeners = new Set<(point: WindowPoint) => void>();
  let detach: (() => void) | undefined;

  function dispatch(payload: unknown): void {
    const point = readWindowPoint(payload);
    if (!point) return;
    for (const listener of listeners) listener(point);
  }

  return {
    subscribe(listener: (point: WindowPoint) => void): () => void {
      const entry = (point: WindowPoint) => listener(point);
      listeners.add(entry);
      if (listeners.size === 1) {
        detach = source.attach(dispatch);
        source.setTracking(true);
      }
      return () => {
        if (!listeners.delete(entry) || listeners.size > 0) return;
        source.setTracking(false);
        detach?.();
        detach = undefined;
      };
    },
  };
}
