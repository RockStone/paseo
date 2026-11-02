import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { AgentMode } from "@getpaseo/protocol/agent-types";
import type { KeyboardActionTrigger } from "@/keyboard/keyboard-action-dispatcher";

export function resolveNextAgentModeId({
  modeOptions,
  selectedMode,
}: {
  modeOptions: readonly AgentMode[];
  selectedMode: string | null | undefined;
}): string | null {
  if (modeOptions.length < 2) return null;

  const selectedIndex = modeOptions.findIndex((mode) => mode.id === selectedMode);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const nextIndex = (currentIndex + 1) % modeOptions.length;
  return modeOptions[nextIndex]?.id ?? null;
}

export function resolveAgentControlsMode(agentControls?: DraftAgentControlsProps) {
  return agentControls ? "draft" : "ready";
}

/**
 * The expanded editor outdents on Shift+Tab, so the mode cycle steps aside for that key
 * only. A cycle shortcut rebound to another key keeps working while expanded.
 */
export function leavesModeCycleToEditor(
  split: boolean,
  trigger: Omit<KeyboardActionTrigger, "preventDefault"> | undefined,
): boolean {
  if (!split || !trigger) return false;
  return (
    trigger.key === "Tab" &&
    trigger.shiftKey &&
    !trigger.metaKey &&
    !trigger.ctrlKey &&
    !trigger.altKey
  );
}
