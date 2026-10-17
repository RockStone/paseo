import { useEffect } from "react";
import { resolveKeyboardFocusScope } from "@/keyboard/focus-scope";
import { hasActiveWebOverlay, hasOpenDomPopover } from "@/lib/overlay-root";
import type { TypingFocusInput } from "./typing-focus";

export function useTypingFocus({ enabled, inputRef }: TypingFocusInput): void {
  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(event: KeyboardEvent): void {
      const isTyping = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isTyping || event.defaultPrevented || event.isComposing) return;
      if (hasActiveWebOverlay() || hasOpenDomPopover()) return;
      const scope = resolveKeyboardFocusScope({ target: event.target, commandCenterOpen: false });
      if (scope !== "other") return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          "button, a[href], [role='button'], [role='textbox'], [role='menuitem']",
        )
      ) {
        return;
      }
      // Let the browser insert the original keystroke after focus moves. Replaying
      // it would bypass the editor's normal text input and composition handling.
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, inputRef]);
}
