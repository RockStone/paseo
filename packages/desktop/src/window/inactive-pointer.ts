import { BrowserWindow, ipcMain, screen } from "electron";

// Chromium drops NSEventTypeMouseMoved for a window that is neither key nor main
// (`shouldIgnoreMouseEvent:` in render_widget_host_view_cocoa.mm, default
// AcceptMouseEvents::kWhenInActiveWindow, which Electron does not override). While the
// window is inactive the renderer sees no pointer events at all, so the main process
// samples the cursor and forwards it as window-relative CSS pixels.
export const INACTIVE_POINTER_POLL_MS = 50;
export const INACTIVE_POINTER_CHANNEL = "paseo:window:inactivePointer";

export interface WindowPoint {
  x: number;
  y: number;
}

export interface InactivePointerWindowState {
  requested: boolean;
  destroyed: boolean;
  focused: boolean;
  visible: boolean;
  minimized: boolean;
}

export function shouldTrackInactivePointer(state: InactivePointerWindowState): boolean {
  return state.requested && !state.destroyed && !state.focused && state.visible && !state.minimized;
}

export function toWindowPoint(
  cursor: WindowPoint,
  contentBounds: { x: number; y: number },
  zoomFactor: number,
): WindowPoint {
  const zoom = zoomFactor > 0 ? zoomFactor : 1;
  return { x: (cursor.x - contentBounds.x) / zoom, y: (cursor.y - contentBounds.y) / zoom };
}

export function readWindowPointer(win: BrowserWindow): WindowPoint | null {
  if (win.isDestroyed() || !win.isVisible() || win.isMinimized()) return null;
  try {
    return toWindowPoint(
      screen.getCursorScreenPoint(),
      win.getContentBounds(),
      win.webContents.getZoomFactor(),
    );
  } catch {
    return null;
  }
}

const controllers = new WeakMap<BrowserWindow, { setRequested(requested: boolean): void }>();

/**
 * Streams the cursor to the renderer while it asks for it and the window is visible but
 * inactive. The poll never focuses or raises the window, and stops as soon as the window
 * is focused, hidden, minimized, closed, or the renderer withdraws the request.
 */
export function setupInactivePointerTracking(win: BrowserWindow): void {
  let requested = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let last: WindowPoint | null = null;

  function stop(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
    last = null;
  }

  function tick(): void {
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      stop();
      return;
    }
    const point = readWindowPointer(win);
    if (!point || (last && last.x === point.x && last.y === point.y)) return;
    last = point;
    win.webContents.send(INACTIVE_POINTER_CHANNEL, point);
  }

  function update(): void {
    const destroyed = win.isDestroyed();
    const track = shouldTrackInactivePointer({
      requested,
      destroyed,
      focused: !destroyed && win.isFocused(),
      visible: !destroyed && win.isVisible(),
      minimized: !destroyed && win.isMinimized(),
    });
    if (!track) {
      stop();
      return;
    }
    if (timer !== null) return;
    timer = setInterval(tick, INACTIVE_POINTER_POLL_MS);
    tick();
  }

  controllers.set(win, {
    setRequested(next) {
      requested = next;
      update();
    },
  });
  win.on("focus", update);
  win.on("blur", update);
  win.on("show", update);
  win.on("hide", update);
  win.on("minimize", update);
  win.on("restore", update);
  win.on("closed", stop);
  // A reloaded renderer starts without listeners; it asks again when it needs the stream.
  win.webContents.on("did-navigate", () => {
    requested = false;
    update();
  });
}

export function registerInactivePointerTracking(): void {
  ipcMain.handle("paseo:window:setInactivePointerTracking", (event, enabled: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || typeof enabled !== "boolean") return;
    controllers.get(win)?.setRequested(enabled);
  });
}
