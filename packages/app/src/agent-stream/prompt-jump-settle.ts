interface PromptJumpScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

export interface PromptJumpSettleViewport {
  findTargetTop(messageId: string): number | null;
  getContainerTop(): number;
  getScrollMetrics(): PromptJumpScrollMetrics;
  setScrollTop(scrollTop: number): void;
  subscribeToUserIntent(listener: () => void): () => void;
}

export interface PromptJumpSettleController {
  /**
   * Paseoi: `onLanded` runs once the target holds its landing position, is clamped at the end
   * of the list, or the frame budget runs out with the target mounted. A user scroll, `cancel`,
   * or a newer `start` drops it.
   */
  start(messageId: string, onLanded?: () => void): void;
  cancel(): void;
  isActive(): boolean;
}

const POSITION_TOLERANCE_PX = 1;
const REQUIRED_STABLE_FRAMES = 2;
const FRAME_BUDGET = 24;
export const PROMPT_JUMP_TOP_INSET_PX = 8;

function distanceFromLandingPosition(targetTop: number, containerTop: number): number {
  return targetTop - containerTop - PROMPT_JUMP_TOP_INSET_PX;
}

export function createPromptJumpSettleController(input: {
  viewport: PromptJumpSettleViewport;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (frameId: number) => void;
}): PromptJumpSettleController {
  let activeMessageId: string | null = null;
  let frameId: number | null = null;
  let sampledFrames = 0;
  let stableFrames = 0;
  let unsubscribeFromUserIntent: (() => void) | null = null;
  let landedListener: (() => void) | null = null;

  // Paseoi: the jump stopped moving the viewport on its own, so the caller may react to it.
  function land(): void {
    const listener = landedListener;
    finish();
    listener?.();
  }

  function finish(): void {
    if (frameId !== null) input.cancelFrame(frameId);
    unsubscribeFromUserIntent?.();
    activeMessageId = null;
    frameId = null;
    sampledFrames = 0;
    stableFrames = 0;
    unsubscribeFromUserIntent = null;
    landedListener = null;
  }

  function scheduleNextFrame(): void {
    frameId = input.requestFrame(tick);
  }

  function tick(): void {
    frameId = null;
    const messageId = activeMessageId;
    if (messageId === null) return;

    sampledFrames += 1;
    const targetTop = input.viewport.findTargetTop(messageId);
    if (targetTop !== null) {
      const delta = distanceFromLandingPosition(targetTop, input.viewport.getContainerTop());
      if (Math.abs(delta) <= POSITION_TOLERANCE_PX) {
        stableFrames += 1;
        if (stableFrames >= REQUIRED_STABLE_FRAMES) {
          land();
          return;
        }
      } else {
        stableFrames = 0;
        const before = input.viewport.getScrollMetrics();
        input.viewport.setScrollTop(before.scrollTop + delta);
        const after = input.viewport.getScrollMetrics();
        const adjustedTargetTop = input.viewport.findTargetTop(messageId);
        let remainingDelta = 0;
        if (adjustedTargetTop !== null) {
          remainingDelta = distanceFromLandingPosition(
            adjustedTargetTop,
            input.viewport.getContainerTop(),
          );
        }
        const maxScrollTop = Math.max(0, after.scrollHeight - after.clientHeight);
        const isClampedAtBottom = after.scrollTop >= maxScrollTop - POSITION_TOLERANCE_PX;
        if (remainingDelta > POSITION_TOLERANCE_PX && isClampedAtBottom) {
          land();
          return;
        }
      }
    }

    if (sampledFrames >= FRAME_BUDGET) {
      // Paseoi: out of budget, the target still counts as landed if it is mounted at all.
      if (targetTop !== null) land();
      else finish();
      return;
    }
    scheduleNextFrame();
  }

  return {
    start(messageId, onLanded) {
      finish();
      activeMessageId = messageId;
      landedListener = onLanded ?? null;
      unsubscribeFromUserIntent = input.viewport.subscribeToUserIntent(finish);
      scheduleNextFrame();
    },
    cancel: finish,
    isActive() {
      return activeMessageId !== null;
    },
  };
}
