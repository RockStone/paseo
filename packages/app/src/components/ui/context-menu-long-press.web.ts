import { LongPressRecognizer, type LongPressPoint } from "@/components/ui/long-press-recognizer";

/**
 * Long press opens context menus on touch browsers (iPadOS Safari and Chrome at desktop width),
 * which never fire `contextmenu` for a long press.
 *
 * One document-level recognizer, not one per trigger: when the hold elapses it dispatches a
 * synthetic `contextmenu` at the touched element with the touch point. Every right-click path
 * in the app — `ContextMenuTrigger`, and the few raw `onContextMenu` handlers — then runs
 * unchanged, nesting resolves the way it does for a right click (the innermost handler stops
 * propagation), and handlers that only `preventDefault` or `stopPropagation` keep doing so.
 *
 * Only touch and pen pointers are recognized, per gesture. A mouse never starts one, so a mouse +
 * touch hybrid keeps right click for the mouse and gets long press for the finger.
 *
 * Listeners are passive and the pointer move/up/cancel listeners exist only while a finger is
 * down; pointerdown does one timer and three listener registrations. Nothing here can block a
 * scroll: when the browser takes the gesture for scrolling it fires `pointercancel`, which drops
 * the press.
 *
 * Drag coexistence: tabs (dnd-kit PointerSensor, 8px distance) and sidebar rows (TouchSensor,
 * 180ms hold) are draggable with the same finger. Moving past 10px before the hold elapses
 * cancels the long press, so that gesture is purely a drag. Holding still opens the menu; moving
 * past 10px after it opened means the hold was the start of a drag, so the menu closes and the
 * drag carries on (the iOS home-screen convention). Lifting without moving leaves the menu open
 * and swallows the click, so the row is not also activated.
 */

const TRIGGER_STYLE_ID = "paseo-context-menu-long-press-styles";

// `data-context-menu-trigger="row"` marks controls (rows, tabs, chips) whose text nobody selects:
// iOS would otherwise start a text selection or a link callout under the finger before the menu
// opens. `"text"` marks surfaces whose text stays selectable (file links in chat, the diff
// canvas); only the callout is removed there. Scoped to coarse pointers so a mouse keeps
// selecting row text on desktop. Fields keep their own selection.
const TRIGGER_STYLES = `
@media (any-pointer: coarse) {
  [data-context-menu-trigger] {
    -webkit-touch-callout: none;
  }
  [data-context-menu-trigger="row"],
  [data-context-menu-trigger="row"] *:not(input):not(textarea):not([contenteditable]):not([contenteditable] *) {
    -webkit-user-select: none !important;
    user-select: none !important;
  }
}
`;

const syntheticEvents = new WeakSet<Event>();
let dismissActiveMenu: (() => void) | null = null;
let activeTarget: EventTarget | null = null;

function eventOf(event: unknown): Event | null {
  if (typeof event !== "object" || event === null) return null;
  const nativeEvent = Reflect.get(event, "nativeEvent");
  const candidate = typeof nativeEvent === "object" && nativeEvent !== null ? nativeEvent : event;
  return candidate instanceof Event ? candidate : null;
}

/**
 * Registers how to close the menu a long press just opened, so a drag that follows the hold can
 * close it. Call it from a `contextmenu` handler that opened a menu; it ignores right clicks.
 */
export function bindLongPressMenuDismiss(event: unknown, dismiss: () => void): void {
  const nativeEvent = eventOf(event);
  if (nativeEvent && syntheticEvents.has(nativeEvent)) dismissActiveMenu = dismiss;
}

function openAt(point: LongPressPoint): boolean {
  const target = activeTarget;
  if (!(target instanceof Element) || !target.isConnected) return false;
  dismissActiveMenu = null;
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 2,
    clientX: point.x,
    clientY: point.y,
    screenX: point.x + window.screenX,
    screenY: point.y + window.screenY,
    view: window,
  });
  syntheticEvents.add(event);
  // A handler that opened a menu prevented the default. Nobody preventing it means the press
  // landed on something without a menu, and its click must go through.
  return !target.dispatchEvent(event);
}

export function installContextMenuLongPress(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};
  if (typeof window.PointerEvent === "undefined") return () => {};

  const recognizer = new LongPressRecognizer({
    onLongPress: openAt,
    onMoveAfterLongPress: () => {
      const dismiss = dismissActiveMenu;
      dismissActiveMenu = null;
      dismiss?.();
    },
  });

  const listenerOptions: AddEventListenerOptions = { capture: true, passive: true };

  function stopTracking(): void {
    window.removeEventListener("pointermove", handleMove, listenerOptions);
    window.removeEventListener("pointerup", handleUp, listenerOptions);
    window.removeEventListener("pointercancel", handleCancel, listenerOptions);
    activeTarget = null;
  }

  function handleMove(event: PointerEvent): void {
    recognizer.pointerMove(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function handleUp(event: PointerEvent): void {
    recognizer.pointerUp(event.pointerId);
    if (!recognizer.isTracking()) stopTracking();
  }

  function handleCancel(event: PointerEvent): void {
    recognizer.pointerCancel(event.pointerId);
    if (!recognizer.isTracking()) stopTracking();
  }

  function handleDown(event: PointerEvent): void {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const wasTracking = recognizer.isTracking();
    recognizer.pointerDown(event.pointerId, { x: event.clientX, y: event.clientY });
    if (wasTracking) return;
    activeTarget = event.target;
    window.addEventListener("pointermove", handleMove, listenerOptions);
    window.addEventListener("pointerup", handleUp, listenerOptions);
    window.addEventListener("pointercancel", handleCancel, listenerOptions);
  }

  // Not passive: these cancel events. Neither is a scroll-blocking event type.
  function handleClick(event: MouseEvent): void {
    if (!recognizer.consumeClick()) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleNativeContextMenu(event: MouseEvent): void {
    if (!event.isTrusted || syntheticEvents.has(event)) return;
    if (!recognizer.nativeContextMenu()) return;
    event.preventDefault();
    event.stopPropagation();
  }

  document.addEventListener("pointerdown", handleDown, listenerOptions);
  window.addEventListener("click", handleClick, { capture: true });
  window.addEventListener("contextmenu", handleNativeContextMenu, { capture: true });

  let style = document.getElementById(TRIGGER_STYLE_ID);
  const ownsStyle = style === null;
  if (!style) {
    style = document.createElement("style");
    style.id = TRIGGER_STYLE_ID;
    style.textContent = TRIGGER_STYLES;
    document.head.append(style);
  }

  return () => {
    document.removeEventListener("pointerdown", handleDown, listenerOptions);
    window.removeEventListener("click", handleClick, { capture: true });
    window.removeEventListener("contextmenu", handleNativeContextMenu, { capture: true });
    stopTracking();
    recognizer.dispose();
    if (ownsStyle) style?.remove();
  };
}
