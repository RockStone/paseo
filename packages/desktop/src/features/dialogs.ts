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
    try {
      result = await dialog.showOpenDialog(win, {
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
