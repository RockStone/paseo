import { usedPercent } from "./model";
import type { UsageTone, UsageWindow } from "./types";

/** Green while plenty is left, orange as it runs low, red when nearly gone. */
export function toneForUsedPercent(usedPct: number | null): UsageTone {
  if (usedPct == null) return "default";
  if (usedPct > 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "ok";
}

/** The source's tone for a window, or one derived from how much of it is used. */
export function windowTone(window: UsageWindow): UsageTone {
  if (window.tone && window.tone !== "default") return window.tone;
  return toneForUsedPercent(usedPercent(window));
}
