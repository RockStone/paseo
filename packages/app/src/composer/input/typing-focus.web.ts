import { useEffect } from "react";
import { resolveKeyboardFocusScope } from "@/keyboard/focus-scope";
import { hasFocusManagingWebOverlay, hasOpenDomPopover } from "@/lib/overlay-root";
import type { TypingFocusInput } from "./typing-focus";

export function useTypingFocus({ enabled, inputRef }: TypingFocusInput): void {
  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(event: KeyboardEvent): void {
      const isTyping = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isPaste =
        event.key.toLowerCase() === "v" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey;
      if ((!isTyping && !isPaste) || event.defaultPrevented || event.isComposing) return;
      if (hasFocusManagingWebOverlay() || hasOpenDomPopover()) return;
      const scope = resolveKeyboardFocusScope({ target: event.target, commandCenterOpen: false });
      if (scope !== "other") return;
      if (
        event.target instanceof Element &&
        !isComposerPillTyping(event.target, event.key) &&
        event.target.closest(
          "button, a[href], [role='button'], [role='textbox'], [role='menuitem']",
        )
      ) {
        return;
      }
      // Move focus before the browser performs typing or paste. The original
      // paste reaches the composer's normal image/text handler exactly once;
      // reading the clipboard or replaying the event here would bypass it.
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, inputRef]);
}

// A pill above the composer keeps focus after its panel closes, but a letter typed there
// belongs to the draft. Space still activates the pill.
function isComposerPillTyping(target: Element, key: string): boolean {
  return key !== " " && target.closest("[data-composer-pills]") !== null;
}
