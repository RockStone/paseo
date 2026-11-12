import type { AgentAttentionReason } from "@getpaseo/protocol/agent-attention-notification";

export const PRESENCE_THRESHOLD_MS = 180_000;

export interface ClientPresenceState {
  // Absent for clients that have not sent a heartbeat yet; treated as "web".
  deviceType?: "web" | "mobile";
  appVisible: boolean;
  lastActivityAtMs: number | null;
  focusedAgentId: string | null;
  focusedTerminalId: string | null;
}

export type AttentionFocusTarget = { kind: "agent"; id: string } | { kind: "terminal"; id: string };

export interface NotificationPlan {
  inAppRecipientIndex: number | null;
  shouldPush: boolean;
}

interface ComputeNotificationPlanInput {
  allStates: ClientPresenceState[];
  // A present, app-visible client focused on the attention target suppresses the
  // notification entirely. Pass null when the target should not suppress notifications.
  focusTarget: AttentionFocusTarget | null;
  // Whether a push notification is allowed when no phone or tablet has the app on screen.
  pushEligible: boolean;
  nowMs: number;
}

function isFocusedOnTarget(
  state: ClientPresenceState,
  target: AttentionFocusTarget | null,
): boolean {
  if (target === null) {
    return false;
  }
  if (target.kind === "agent") {
    return state.focusedAgentId === target.id;
  }
  return state.focusedTerminalId === target.id;
}

// Paseoi: push whenever no mobile client has the app on screen, even while a desktop or browser
// client is present. Before, any present client suppressed the push, so a phone stayed silent
// while its owner worked at the Mac, and a just-locked phone swallowed the alert in-app. The
// desktop still gets its in-app alert, so the same event can alert on both.
export function computeNotificationPlan({
  allStates,
  focusTarget,
  pushEligible,
  nowMs,
}: ComputeNotificationPlanInput): NotificationPlan {
  let mostRecentPresentIndex: number | null = null;
  let mostRecentPresentAtMs = Number.NEGATIVE_INFINITY;
  let mobileOnScreen = false;

  for (const [clientIndex, state] of allStates.entries()) {
    const clampedActivityAtMs =
      state.lastActivityAtMs === null ? null : Math.min(state.lastActivityAtMs, nowMs);
    const isPresent =
      clampedActivityAtMs !== null && nowMs - clampedActivityAtMs <= PRESENCE_THRESHOLD_MS;

    if (!isPresent) {
      continue;
    }

    if (state.appVisible && isFocusedOnTarget(state, focusTarget)) {
      return { inAppRecipientIndex: null, shouldPush: false };
    }

    const isMobile = state.deviceType === "mobile";
    if (isMobile && state.appVisible) {
      mobileOnScreen = true;
    }
    // A backgrounded phone can't show an in-app alert; it gets the push instead.
    if (isMobile && !state.appVisible) {
      continue;
    }

    if (clampedActivityAtMs > mostRecentPresentAtMs) {
      mostRecentPresentIndex = clientIndex;
      mostRecentPresentAtMs = clampedActivityAtMs;
    }
  }

  return {
    inAppRecipientIndex: mostRecentPresentIndex,
    shouldPush: pushEligible && !mobileOnScreen,
  };
}

export function isPushEligibleAttentionReason(reason: AgentAttentionReason): boolean {
  return reason !== "error";
}
