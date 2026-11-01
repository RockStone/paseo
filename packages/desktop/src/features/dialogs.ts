import { app, dialog, ipcMain, BrowserWindow } from "electron";
import log from "electron-log";

interface AskOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  kind?: "info" | "warning" | "error";
}

interface AskWithCheckboxOptions extends AskOptions {
  checkboxLabel: string;
  checkboxChecked?: boolean;
}

interface OpenOptions {
  title?: string;
  defaultPath?: string;
  directory?: boolean;
  createDirectory?: boolean;
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}

function resolveDialogType(kind: AskOptions["kind"]): "warning" | "error" | "question" {
  if (kind === "warning") return "warning";
  if (kind === "error") return "error";
  return "question";
}

const OPEN_DIALOG_PRESENTATION_TIMEOUT_MS = 10_000;
const pendingOpenDialogs = new WeakSet<BrowserWindow>();

function showOpenDialog(
  win: BrowserWindow,
  options: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  if (process.platform !== "darwin") return dialog.showOpenDialog(win, options);

  // AppKit can fail to connect to openAndSavePanelService without settling
  // Electron's promise. Time presentation only; choosing in a visible sheet has no deadline.
  let timer: ReturnType<typeof setTimeout>;
  let cleanup = () => {};
  const result = new Promise<Electron.OpenDialogReturnValue>((resolve, reject) => {
    const clear = () => clearTimeout(timer);
    const arm = () => {
      clear();
      timer = setTimeout(
        () => reject(new Error("The native file picker did not respond.")),
        OPEN_DIALOG_PRESENTATION_TIMEOUT_MS,
      );
    };
    const closed = () => reject(new Error("The file picker window was closed."));
    win.on("sheet-begin", clear);
    win.on("sheet-end", arm);
    win.on("closed", closed);
    cleanup = () => {
      clear();
      win.removeListener("sheet-begin", clear);
      win.removeListener("sheet-end", arm);
      win.removeListener("closed", closed);
    };
    arm();
    dialog.showOpenDialog(win, options).then(resolve, reject);
  });
  return result.finally(() => cleanup());
}

export function registerDialogHandlers(): void {
  ipcMain.handle("paseo:dialog:ask", async (event, message: string, options?: AskOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showMessageBox(win ?? BrowserWindow.getFocusedWindow()!, {
      type: resolveDialogType(options?.kind),
      title: options?.title ?? "Confirm",
      message,
      buttons: [options?.cancelLabel ?? "Cancel", options?.okLabel ?? "OK"],
      defaultId: 1,
      cancelId: 0,
    });
    return result.response === 1;
  });

  ipcMain.handle(
    "paseo:dialog:askWithCheckbox",
    async (event, message: string, options: AskWithCheckboxOptions) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showMessageBox(win ?? BrowserWindow.getFocusedWindow()!, {
        type: resolveDialogType(options.kind),
        title: options.title ?? "Confirm",
        message,
        buttons: [options.cancelLabel ?? "Cancel", options.okLabel ?? "OK"],
        defaultId: 1,
        cancelId: 0,
        checkboxLabel: options.checkboxLabel,
        checkboxChecked: options.checkboxChecked ?? false,
      });
      return {
        confirmed: result.response === 1,
        dontAskAgain: result.checkboxChecked,
      };
    },
  );

  ipcMain.handle("paseo:dialog:open", async (event, options: OpenOptions = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) {
      throw new Error("The window requesting the file picker is no longer available.");
    }
    if (pendingOpenDialogs.has(win)) {
      throw new Error("A file picker is already open for this window.");
    }
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    if (process.platform === "darwin") app.focus({ steal: true });
    win.focus();
    const properties: Electron.OpenDialogOptions["properties"] = [];
    if (options.directory) properties.push("openDirectory");
    if (options.createDirectory) properties.push("createDirectory");
    if (options.multiple) properties.push("multiSelections");
    if (!options.directory) properties.push("openFile");

    const startedAt = Date.now();
    log.info("[dialog] open requested", {
      windowId: win.id,
      directory: options.directory === true,
    });
    let result: Electron.OpenDialogReturnValue;
    pendingOpenDialogs.add(win);
    try {
      result = await showOpenDialog(win, {
        title: options.title,
        // Electron 43+ otherwise starts in Downloads, even for directory pickers.
        defaultPath: options.defaultPath ?? (options.directory ? app.getPath("home") : undefined),
        properties,
        filters: options.filters,
      });
    } catch (error) {
      log.error(
        "[dialog] open failed",
        { windowId: win.id, elapsedMs: Date.now() - startedAt },
        error,
      );
      throw error;
    } finally {
      pendingOpenDialogs.delete(win);
    }
    log.info("[dialog] open settled", {
      windowId: win.id,
      canceled: result.canceled,
      elapsedMs: Date.now() - startedAt,
    });

    if (result.canceled) return null;
    return options.multiple ? result.filePaths : (result.filePaths[0] ?? null);
  });
}
