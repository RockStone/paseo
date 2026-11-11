import { useCallback } from "react";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { buildWorkspaceKeyboardHandlerId } from "@/keyboard/handler-id";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { pluginButtonStore } from "./store";

// Paseoi: the plugin API has no keyboard hook, so the host owns the sticky notes' shortcut and
// presses the plugin's own header button.
const STICKY_NOTES_PLUGIN_ID = "sticky-notes";
const STICKY_NOTES_ACTIONS: readonly KeyboardActionId[] = ["workspace.sticky-notes.toggle"];

interface StickyNotesShortcutInput {
  serverId: string;
  workspaceId: string;
  enabled: boolean;
}

/** Toggles the sticky notes of the workspace this screen shows. A no-op without the plugin. */
export function useStickyNotesShortcut({
  serverId,
  workspaceId,
  enabled,
}: StickyNotesShortcutInput): void {
  const handle = useCallback(
    () =>
      pluginButtonStore.toggleHeaderButton({
        serverId,
        workspaceId,
        pluginId: STICKY_NOTES_PLUGIN_ID,
      }),
    [serverId, workspaceId],
  );

  useKeyboardActionHandler({
    handlerId: buildWorkspaceKeyboardHandlerId({
      name: "workspace-sticky-notes",
      serverId,
      workspaceId,
    }),
    actions: STICKY_NOTES_ACTIONS,
    enabled,
    priority: 100,
    isActive: () => true,
    handle,
  });
}
