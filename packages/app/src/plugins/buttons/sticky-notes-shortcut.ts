import { useCallback } from "react";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { buildWorkspaceKeyboardHandlerId } from "@/keyboard/handler-id";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { pluginButtonStore } from "./store";

// Paseoi: the plugin API has no keyboard hook, so the host owns the Driveboard's shortcut and
// presses the plugin's own header button. The action and hook names predate the Driveboard
// replacing the sticky notes plugin; renaming the action would drop customized bindings.
const STICKY_NOTES_PLUGIN_ID = "driveboard";
const STICKY_NOTES_ACTIONS: readonly KeyboardActionId[] = ["workspace.sticky-notes.toggle"];

interface StickyNotesShortcutInput {
  serverId: string;
  workspaceId: string;
  enabled: boolean;
}

/** Toggles the Driveboard of the workspace this screen shows. A no-op without the plugin. */
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
