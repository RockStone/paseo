import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  owner: {
    id: 7,
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  },
  fromWebContents: vi.fn(),
  showOpenDialog: vi.fn(),
  appFocus: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { focus: mocks.appFocus, getPath: () => "/home/test" },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      mocks.handlers.set(channel, handler),
  },
  dialog: { showOpenDialog: mocks.showOpenDialog },
}));
vi.mock("electron-log", () => ({ default: { info: mocks.info, error: mocks.error } }));

import { registerDialogHandlers } from "./dialogs.js";

const sender = {};
const open = (options: object = { directory: true }) =>
  mocks.handlers.get("paseo:dialog:open")!({ sender }, options);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owner.isDestroyed.mockReturnValue(false);
  mocks.owner.isMinimized.mockReturnValue(false);
  mocks.owner.isVisible.mockReturnValue(true);
  mocks.fromWebContents.mockReturnValue(mocks.owner);
  mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/repo/project"] });
  registerDialogHandlers();
});

describe("native file picker", () => {
  it("focuses the requesting window before opening its sheet at Home", async () => {
    mocks.owner.isMinimized.mockReturnValue(true);
    mocks.owner.isVisible.mockReturnValue(false);
    mocks.showOpenDialog.mockImplementation(async (owner, options) => {
      expect(owner).toBe(mocks.owner);
      expect(mocks.owner.restore).toHaveBeenCalledOnce();
      expect(mocks.owner.show).toHaveBeenCalledOnce();
      expect(mocks.owner.focus).toHaveBeenCalledOnce();
      expect(mocks.appFocus.mock.calls).toEqual(
        process.platform === "darwin" ? [[{ steal: true }]] : [],
      );
      expect(options).toMatchObject({ defaultPath: "/home/test", properties: ["openDirectory"] });
      return { canceled: false, filePaths: ["/repo/project"] };
    });
    await expect(open()).resolves.toBe("/repo/project");
    expect(mocks.fromWebContents).toHaveBeenCalledWith(sender);
  });

  it("preserves explicit locations, filters, and multiple selection", async () => {
    const filters = [{ name: "Images", extensions: ["png"] }];
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/one.png", "/two.png"],
    });
    await expect(open({ defaultPath: "/images", multiple: true, filters })).resolves.toEqual([
      "/one.png",
      "/two.png",
    ]);
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(
      mocks.owner,
      expect.objectContaining({
        defaultPath: "/images",
        properties: ["multiSelections", "openFile"],
        filters,
      }),
    );
  });

  it("returns cancellation and permits another request", async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(open()).resolves.toBeNull();
    await expect(open()).resolves.toBe("/repo/project");
    expect(mocks.showOpenDialog).toHaveBeenCalledTimes(2);
  });

  it("surfaces native failures and permits retry", async () => {
    mocks.showOpenDialog.mockRejectedValueOnce(new Error("Native picker failed"));
    await expect(open()).rejects.toThrow("Native picker failed");
    expect(mocks.error).toHaveBeenCalledOnce();
    await expect(open()).resolves.toBe("/repo/project");
  });

  it("does not attach a request from a closed window to a different window", async () => {
    mocks.fromWebContents.mockReturnValue(null);
    await expect(open()).rejects.toThrow("no longer available");
    expect(mocks.showOpenDialog).not.toHaveBeenCalled();
  });
});
