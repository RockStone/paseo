/**
 * Recognizes a touch long press for opening context menus on touch browsers.
 *
 * iPadOS Safari and Chrome never fire `contextmenu` for a long press, so a right-click-only menu
 * has no touch path there. This recognizer is the platform-free state machine behind
 * `context-menu-long-press.web.ts`; it owns timing, the movement cancel, and the click that
 * follows a recognized press. It never touches the DOM, so it is unit-tested with a fake clock.
 */

export const LONG_PRESS_DELAY_MS = 500;
/** Matches react-native-web's own long-press cancel, so a scroll never opens a menu. */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
/** How long after the finger lifts the follow-up click is still swallowed. */
export const LONG_PRESS_CLICK_SUPPRESS_MS = 600;

export interface LongPressPoint {
  x: number;
  y: number;
}

export interface LongPressClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface LongPressRecognizerCallbacks {
  /** The hold elapsed without moving. Returns true when something (a menu) took the press. */
  onLongPress(point: LongPressPoint): boolean;
  /**
   * The finger moved past the tolerance after the menu opened. A drag owns the gesture from
   * here, so the caller closes the menu it opened.
   */
  onMoveAfterLongPress(): void;
}

type PressState =
  | { kind: "idle" }
  | { kind: "pending"; pointerId: number; origin: LongPressPoint; timer: unknown }
  | { kind: "fired"; pointerId: number; origin: LongPressPoint; handled: boolean; moved: boolean }
  // The browser delivered its own `contextmenu` (Android Chrome) or a second finger landed. The
  // rest of this press is ignored.
  | { kind: "abandoned"; pointerId: number };

const DEFAULT_CLOCK: LongPressClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

function distance(a: LongPressPoint, b: LongPressPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class LongPressRecognizer {
  private state: PressState = { kind: "idle" };
  private suppressClickUntil = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly callbacks: LongPressRecognizerCallbacks,
    private readonly clock: LongPressClock = DEFAULT_CLOCK,
    private readonly delayMs: number = LONG_PRESS_DELAY_MS,
    private readonly moveTolerancePx: number = LONG_PRESS_MOVE_TOLERANCE_PX,
  ) {}

  /** True while a press is being tracked, so the caller knows to keep its move listeners. */
  isTracking(): boolean {
    return this.state.kind !== "idle";
  }

  pointerDown(pointerId: number, point: LongPressPoint): void {
    if (this.state.kind !== "idle") {
      // A second finger: a pinch or a two-finger scroll, never a long press.
      this.clearTimer();
      this.state = { kind: "abandoned", pointerId: this.trackedPointerId() };
      return;
    }
    const timer = this.clock.setTimeout(() => this.fire(), this.delayMs);
    this.state = { kind: "pending", pointerId, origin: point, timer };
  }

  pointerMove(pointerId: number, point: LongPressPoint): void {
    const state = this.state;
    if (state.kind !== "pending" && state.kind !== "fired") return;
    if (state.pointerId !== pointerId) return;
    if (distance(state.origin, point) <= this.moveTolerancePx) return;

    if (state.kind === "pending") {
      this.clearTimer();
      this.state = { kind: "abandoned", pointerId };
      return;
    }
    if (!state.moved) {
      state.moved = true;
      if (state.handled) this.callbacks.onMoveAfterLongPress();
    }
  }

  pointerUp(pointerId: number): void {
    const state = this.state;
    if (state.kind === "idle" || this.trackedPointerId() !== pointerId) return;
    if (state.kind === "fired" && state.handled && !state.moved) {
      this.suppressClickUntil = this.clock.now() + LONG_PRESS_CLICK_SUPPRESS_MS;
    }
    this.reset();
  }

  pointerCancel(pointerId: number): void {
    if (this.state.kind === "idle" || this.trackedPointerId() !== pointerId) return;
    this.reset();
  }

  /**
   * The browser fired its own `contextmenu` during a touch (Android Chrome does on long press).
   * Returns true when the event duplicates a menu this recognizer already opened and must be
   * swallowed; false when the browser's event should open the menu itself.
   */
  nativeContextMenu(): boolean {
    const state = this.state;
    if (state.kind === "pending") {
      this.clearTimer();
      this.state = { kind: "abandoned", pointerId: state.pointerId };
      return false;
    }
    if (state.kind === "fired") return state.handled;
    return this.clock.now() <= this.suppressClickUntil;
  }

  /** Returns true, once, for the click that follows a recognized long press. */
  consumeClick(): boolean {
    if (this.clock.now() > this.suppressClickUntil) return false;
    this.suppressClickUntil = Number.NEGATIVE_INFINITY;
    return true;
  }

  dispose(): void {
    this.reset();
    this.suppressClickUntil = Number.NEGATIVE_INFINITY;
  }

  private fire(): void {
    const state = this.state;
    if (state.kind !== "pending") return;
    // Mark the press fired before calling out, so a contextmenu dispatched from inside the
    // callback reads as this press's own event.
    const fired: PressState = {
      kind: "fired",
      pointerId: state.pointerId,
      origin: state.origin,
      handled: false,
      moved: false,
    };
    this.state = fired;
    fired.handled = this.callbacks.onLongPress(state.origin);
  }

  private trackedPointerId(): number {
    return this.state.kind === "idle" ? -1 : this.state.pointerId;
  }

  private clearTimer(): void {
    if (this.state.kind === "pending") this.clock.clearTimeout(this.state.timer);
  }

  private reset(): void {
    this.clearTimer();
    this.state = { kind: "idle" };
  }
}
