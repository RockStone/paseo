import { describe, expect, it } from "vitest";
import {
  LONG_PRESS_CLICK_SUPPRESS_MS,
  LONG_PRESS_DELAY_MS,
  LongPressRecognizer,
  type LongPressClock,
  type LongPressPoint,
} from "./long-press-recognizer";

class FakeClock implements LongPressClock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
    }
    this.time = target;
  }
}

function setup(options: { handled?: boolean } = {}) {
  const clock = new FakeClock();
  const opened: LongPressPoint[] = [];
  let dismissed = 0;
  const recognizer = new LongPressRecognizer(
    {
      onLongPress: (point) => {
        opened.push(point);
        return options.handled ?? true;
      },
      onMoveAfterLongPress: () => {
        dismissed += 1;
      },
    },
    clock,
  );
  return { clock, opened, recognizer, dismissed: () => dismissed };
}

const ORIGIN = { x: 100, y: 200 };

describe("LongPressRecognizer", () => {
  it("opens at the touch point once the hold elapses", () => {
    const { clock, opened, recognizer } = setup();
    recognizer.pointerDown(1, ORIGIN);

    clock.advance(LONG_PRESS_DELAY_MS - 1);
    expect(opened).toEqual([]);

    clock.advance(1);
    expect(opened).toEqual([ORIGIN]);
  });

  it("does not open when the finger lifts before the hold elapses, and lets the tap through", () => {
    const { clock, opened, recognizer } = setup();
    recognizer.pointerDown(1, ORIGIN);
    clock.advance(200);
    recognizer.pointerUp(1);
    clock.advance(LONG_PRESS_DELAY_MS);

    expect(opened).toEqual([]);
    expect(recognizer.consumeClick()).toBe(false);
    expect(recognizer.isTracking()).toBe(false);
  });

  it("tolerates jitter within 10px but cancels on a larger move, so a scroll never opens a menu", () => {
    const jitter = setup();
    jitter.recognizer.pointerDown(1, ORIGIN);
    jitter.recognizer.pointerMove(1, { x: ORIGIN.x + 6, y: ORIGIN.y + 8 });
    jitter.clock.advance(LONG_PRESS_DELAY_MS);
    expect(jitter.opened).toHaveLength(1);

    const scroll = setup();
    scroll.recognizer.pointerDown(1, ORIGIN);
    scroll.recognizer.pointerMove(1, { x: ORIGIN.x, y: ORIGIN.y + 11 });
    scroll.clock.advance(LONG_PRESS_DELAY_MS);
    expect(scroll.opened).toEqual([]);
    // Moving back near the origin does not revive the press.
    scroll.recognizer.pointerMove(1, ORIGIN);
    scroll.clock.advance(LONG_PRESS_DELAY_MS);
    expect(scroll.opened).toEqual([]);
  });

  it("drops the press on pointercancel, which the browser fires when it starts scrolling", () => {
    const { clock, opened, recognizer } = setup();
    recognizer.pointerDown(1, ORIGIN);
    recognizer.pointerCancel(1);
    clock.advance(LONG_PRESS_DELAY_MS);
    expect(opened).toEqual([]);
    expect(recognizer.isTracking()).toBe(false);
  });

  it("ignores a second finger's press, and the pinch never opens a menu", () => {
    const { clock, opened, recognizer } = setup();
    recognizer.pointerDown(1, ORIGIN);
    recognizer.pointerDown(2, { x: 300, y: 300 });
    clock.advance(LONG_PRESS_DELAY_MS);
    expect(opened).toEqual([]);

    recognizer.pointerUp(2);
    expect(recognizer.isTracking()).toBe(true);
    recognizer.pointerUp(1);
    expect(recognizer.isTracking()).toBe(false);
  });

  it("swallows exactly the click that follows a handled long press", () => {
    const { clock, recognizer } = setup();
    recognizer.pointerDown(1, ORIGIN);
    clock.advance(LONG_PRESS_DELAY_MS + 100);
    recognizer.pointerUp(1);

    expect(recognizer.consumeClick()).toBe(true);
    expect(recognizer.consumeClick()).toBe(false);
  });

  it("stops swallowing once the suppression window has passed", () => {
    const { clock, recognizer } = setup();
    recognizer.pointerDown(1, ORIGIN);
    clock.advance(LONG_PRESS_DELAY_MS);
    recognizer.pointerUp(1);
    clock.advance(LONG_PRESS_CLICK_SUPPRESS_MS + 1);

    expect(recognizer.consumeClick()).toBe(false);
  });

  it("lets the click through when nothing took the long press", () => {
    const { clock, opened, recognizer } = setup({ handled: false });
    recognizer.pointerDown(1, ORIGIN);
    clock.advance(LONG_PRESS_DELAY_MS);
    recognizer.pointerUp(1);

    expect(opened).toHaveLength(1);
    expect(recognizer.consumeClick()).toBe(false);
  });

  it("closes the menu once when the finger moves after it opened, because that is a drag", () => {
    const { clock, recognizer, dismissed } = setup();
    recognizer.pointerDown(1, ORIGIN);
    clock.advance(LONG_PRESS_DELAY_MS);
    recognizer.pointerMove(1, { x: ORIGIN.x + 5, y: ORIGIN.y });
    expect(dismissed()).toBe(0);

    recognizer.pointerMove(1, { x: ORIGIN.x + 40, y: ORIGIN.y });
    recognizer.pointerMove(1, { x: ORIGIN.x + 80, y: ORIGIN.y });
    expect(dismissed()).toBe(1);

    recognizer.pointerUp(1);
    expect(recognizer.consumeClick()).toBe(false);
  });

  it("yields to the browser's own contextmenu while the hold is pending", () => {
    const { clock, opened, recognizer } = setup();
    recognizer.pointerDown(1, ORIGIN);
    clock.advance(400);

    expect(recognizer.nativeContextMenu()).toBe(false);
    clock.advance(LONG_PRESS_DELAY_MS);
    expect(opened).toEqual([]);
  });

  it("swallows the browser's own contextmenu when it duplicates a menu already opened", () => {
    const { clock, recognizer } = setup();
    recognizer.pointerDown(1, ORIGIN);
    clock.advance(LONG_PRESS_DELAY_MS);
    expect(recognizer.nativeContextMenu()).toBe(true);

    recognizer.pointerUp(1);
    expect(recognizer.nativeContextMenu()).toBe(true);
  });

  it("ignores moves and releases of a pointer it is not tracking", () => {
    const { clock, opened, recognizer } = setup();
    recognizer.pointerDown(1, ORIGIN);
    recognizer.pointerMove(7, { x: 900, y: 900 });
    recognizer.pointerUp(7);
    clock.advance(LONG_PRESS_DELAY_MS);
    expect(opened).toHaveLength(1);
  });
});
