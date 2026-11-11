import { describe, expect, it, vi } from "vitest";
import { createInactivePointerFanout, readWindowPoint } from "./inactive-pointer-fanout";

function fakeSource() {
  let handler: ((payload: unknown) => void) | null = null;
  const detach = vi.fn(() => {
    handler = null;
  });
  return {
    tracking: [] as boolean[],
    detach,
    attach: (next: (payload: unknown) => void) => {
      handler = next;
      return detach;
    },
    send(payload: unknown) {
      handler?.(payload);
    },
  };
}

describe("createInactivePointerFanout", () => {
  it("requests tracking for the first listener and releases it after the last", () => {
    const fake = fakeSource();
    const fanout = createInactivePointerFanout({
      attach: fake.attach,
      setTracking: (enabled) => fake.tracking.push(enabled),
    });
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = fanout.subscribe(first);
    const stopSecond = fanout.subscribe(second);
    expect(fake.tracking).toEqual([true]);

    fake.send({ x: 3, y: 4 });
    expect(first).toHaveBeenCalledWith({ x: 3, y: 4 });
    expect(second).toHaveBeenCalledWith({ x: 3, y: 4 });

    stopFirst();
    stopFirst();
    expect(fake.tracking).toEqual([true]);
    stopSecond();
    expect(fake.tracking).toEqual([true, false]);
    expect(fake.detach).toHaveBeenCalledTimes(1);

    fanout.subscribe(first);
    expect(fake.tracking).toEqual([true, false, true]);
  });

  it("drops malformed payloads", () => {
    const fake = fakeSource();
    const fanout = createInactivePointerFanout({ attach: fake.attach, setTracking: () => {} });
    const listener = vi.fn();
    fanout.subscribe(listener);
    fake.send(null);
    fake.send({ x: "1", y: 2 });
    fake.send({ x: Number.NaN, y: 2 });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("readWindowPoint", () => {
  it("accepts finite coordinates, including outside the window", () => {
    expect(readWindowPoint({ x: -12.5, y: 300 })).toEqual({ x: -12.5, y: 300 });
    expect(readWindowPoint({ x: 1 })).toBeNull();
  });
});
