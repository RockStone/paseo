import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AfterPaintPublication,
  browserAfterPaintScheduler,
  type AfterPaintScheduler,
} from "./after-paint-publication";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createManualScheduler(): AfterPaintScheduler & {
  run: () => void;
  scheduledCount: () => number;
} {
  let callbacks: Array<() => void> = [];
  return {
    schedule: (callback) => {
      callbacks.push(callback);
      return () => {
        callbacks = callbacks.filter((candidate) => candidate !== callback);
      };
    },
    run: () => {
      const scheduled = callbacks;
      callbacks = [];
      for (const callback of scheduled) callback();
    },
    scheduledCount: () => callbacks.length,
  };
}

describe("AfterPaintPublication", () => {
  it("publishes once when animation frames stall and ignores a late frame", () => {
    vi.useFakeTimers();
    let frame: (() => void) | undefined;
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: () => void) => {
        frame = callback;
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
      setTimeout,
      clearTimeout,
    });
    const published = vi.fn();
    const publication = new AfterPaintPublication(published, browserAfterPaintScheduler);
    publication.stage("@@");
    publication.stage("##");
    vi.advanceTimersByTime(100);
    expect(published).toHaveBeenCalledExactlyOnceWith("##");
    frame?.();
    vi.runAllTimers();
    expect(published).toHaveBeenCalledTimes(1);
    publication.stage("cancelled");
    publication.cancel();
    vi.runAllTimers();
    expect(published).toHaveBeenCalledTimes(1);
  });
  it("publishes the latest staged value once after paint", () => {
    const scheduler = createManualScheduler();
    const published: string[] = [];
    const publication = new AfterPaintPublication(
      (value: string) => published.push(value),
      scheduler,
    );

    publication.stage("a");
    publication.stage("ab");
    publication.stage("abc");

    expect(scheduler.scheduledCount()).toBe(1);
    expect(published).toEqual([]);
    scheduler.run();
    expect(published).toEqual(["abc"]);
  });

  it("flushes synchronously and cancels the scheduled publication", () => {
    const scheduler = createManualScheduler();
    const published: string[] = [];
    const publication = new AfterPaintPublication(
      (value: string) => published.push(value),
      scheduler,
    );

    publication.stage("draft");
    publication.flush();
    scheduler.run();

    expect(published).toEqual(["draft"]);
  });

  it("cancels pending text before a draft is cleared", () => {
    const scheduler = createManualScheduler();
    const published: string[] = [];
    const publication = new AfterPaintPublication(
      (value: string) => published.push(value),
      scheduler,
    );

    publication.stage("sent text");
    publication.cancel();
    scheduler.run();

    expect(published).toEqual([]);
  });
});
