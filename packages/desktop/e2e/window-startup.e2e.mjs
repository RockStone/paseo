import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "playwright/test";

const root = await mkdtemp(path.join(tmpdir(), "paseo-window-startup-"));
const modulePath = fileURLToPath(new URL("../dist/window/show-when-ready.js", import.meta.url));
const managerPath = fileURLToPath(new URL("../dist/window/window-manager.js", import.meta.url));
const preloadPath = fileURLToPath(new URL("../dist/preload.js", import.meta.url));

async function launchWindowWithoutHiddenFrames() {
  const main = path.join(root, "main.cjs");
  await writeFile(
    main,
    `const { app, BrowserWindow, screen } = require("electron");
     const { showWindowWhenReady } = require(${JSON.stringify(modulePath)});
     const { registerWindowManager } = require(${JSON.stringify(managerPath)});
     app.setPath("userData", ${JSON.stringify(path.join(root, "user-data"))});
     app.whenReady().then(async () => {
       registerWindowManager({ mode: process.platform === "darwin" ? "native-mac" : "custom-linux" });
       const win = global.mainWindow = new BrowserWindow({
         show: false, paintWhenInitiallyHidden: false,
         webPreferences: { preload: ${JSON.stringify(preloadPath)}, contextIsolation: true, sandbox: true }
       });
       // Controlled screen coordinates exercise the real preload/IPC conversion
       // without moving the user's physical pointer during this isolated test.
       screen.getCursorScreenPoint = () => global.testCursor;
       showWindowWhenReady(win, { showOnLoad: true });
       await win.loadURL("data:text/html,<h1>Desktop ready</h1>");
       global.visibleAfterLoad = win.isVisible();
     });`,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"),
  );
  const displayArgs = process.platform === "linux" ? ["--ozone-platform=x11", "--disable-gpu"] : [];
  return electron.launch({
    args: ["--no-sandbox", ...displayArgs, main],
    env,
  });
}

async function expectOutsideWindowPointerCoordinates(desktop) {
  const page = await desktop.firstWindow();
  await desktop.evaluate(() => {
    const bounds = global.mainWindow.getContentBounds();
    global.testCursor = { x: bounds.x - 24, y: bounds.y + 100 };
  });
  await expect(
    page.evaluate(() => window.paseoDesktop.window.getCurrentWindow().getPointerPosition()),
  ).resolves.toEqual({ x: -24, y: 100 });
  await desktop.evaluate(() => {
    global.mainWindow.webContents.setZoomFactor(2);
    const bounds = global.mainWindow.getContentBounds();
    global.testCursor = { x: bounds.x - 48, y: bounds.y + 200 };
  });
  await expect(
    page.evaluate(() => window.paseoDesktop.window.getCurrentWindow().getPointerPosition()),
  ).resolves.toEqual({ x: -24, y: 100 });
  await desktop.evaluate(() => global.mainWindow.hide());
  await expect(
    page.evaluate(() => window.paseoDesktop.window.getCurrentWindow().getPointerPosition()),
  ).resolves.toBeNull();
}

async function expectLoadedDesktopIsShown(desktop) {
  await expect.poll(() => desktop.evaluate(() => global.visibleAfterLoad)).toBe(true);
  const page = await desktop.firstWindow();
  await expect(page.getByRole("heading", { name: "Desktop ready" })).toBeVisible();
}

let desktop;
try {
  desktop = await launchWindowWithoutHiddenFrames();
  await expectLoadedDesktopIsShown(desktop);
  console.log("Loaded desktop is visible without hidden compositor frames");
  await expectOutsideWindowPointerCoordinates(desktop);
  console.log(
    "Outside-window pointer bridge uses content coordinates and respects zoom/visibility",
  );
} finally {
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
