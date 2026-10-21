export interface AfterPaintScheduler {
  schedule: (callback: () => void) => () => void;
}

export const browserAfterPaintScheduler: AfterPaintScheduler = {
  schedule: (callback) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) callback();
      });
      return () => {
        cancelled = true;
      };
    }

    let finished = false;
    let frameId: number | null = null;
    let timeoutId: number | null = null;
    let fallbackId: number | null = null;
    const cancel = () => {
      finished = true;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (fallbackId !== null) window.clearTimeout(fallbackId);
    };
    const publish = () => {
      if (finished) return;
      cancel();
      callback();
    };
    frameId = window.requestAnimationFrame(() => {
      if (!finished) timeoutId = window.setTimeout(publish, 0);
    });
    // Hidden/occluded desktop windows can suspend frames. Draft and caret
    // observers must still catch up so autocomplete can recover without a restart.
    fallbackId = window.setTimeout(publish, 100);
    return cancel;
  },
};

export class AfterPaintPublication<T> {
  private pending: T | null = null;
  private cancelScheduled: (() => void) | null = null;

  constructor(
    private readonly publish: (value: T) => void,
    private readonly scheduler: AfterPaintScheduler = browserAfterPaintScheduler,
  ) {}

  stage(value: T): void {
    this.pending = value;
    if (this.cancelScheduled) return;
    this.cancelScheduled = this.scheduler.schedule(() => {
      this.cancelScheduled = null;
      this.flush();
    });
  }

  flush(): void {
    if (this.pending === null) return;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    const value = this.pending;
    this.pending = null;
    this.publish(value);
  }

  cancel(): void {
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.pending = null;
  }
}
