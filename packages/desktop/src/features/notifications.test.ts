import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input?: unknown) => Promise<boolean>>(),
  settings: { notifications: { playSound: false, playChime: true } },
  supported: true,
  notifications: [] as Array<{ silent: boolean }>,
  beep: vi.fn(),
  execFile: vi.fn((_command: string, _args: string[], callback: (error: Error | null) => void) =>
    callback(null),
  ),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({ get: async () => mocks.settings }),
}));
vi.mock("electron", () => ({
  app: { name: "Paseoi", isPackaged: false },
  BrowserWindow: {},
  ipcMain: {
    handle: (name: string, handler: (event: unknown, input?: unknown) => Promise<boolean>) =>
      mocks.handlers.set(name, handler),
  },
  nativeImage: {},
  shell: { beep: mocks.beep },
  Notification: class {
    static isSupported() {
      return mocks.supported;
    }
    constructor(options: { silent: boolean }) {
      mocks.notifications.push(options);
    }
    on() {}
    show() {}
  },
}));

import { registerNotificationHandlers } from "./notifications.js";

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
let timestamp = 100_000;

beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  timestamp += 2_000;
  vi.setSystemTime(timestamp);
  mocks.execFile.mockClear();
  mocks.beep.mockClear();
  mocks.handlers.clear();
  mocks.notifications.length = 0;
  mocks.supported = true;
  Object.assign(mocks.settings.notifications, {
    playSound: false,
    playChime: true,
  });
  registerNotificationHandlers();
});

afterEach(() => {
  Object.defineProperty(process, "platform", platformDescriptor);
  vi.useRealTimers();
});

function send(reason = "permission") {
  return mocks.handlers.get("paseo:notification:send")!(
    {},
    { title: "Agent needs an answer", data: { reason } },
  );
}

describe("desktop notification chimes", () => {
  it("plays Funky independently of a silent system notification", async () => {
    await send();
    expect(mocks.execFile.mock.calls[0]?.slice(0, 2)).toEqual([
      "/usr/bin/afplay",
      ["/System/Library/Sounds/Funk.aiff"],
    ]);
    expect(mocks.notifications[0]?.silent).toBe(true);
  });

  it("plays Funky when a system error needs attention", async () => {
    await send("error");
    expect(mocks.execFile.mock.calls[0]?.[1]).toEqual(["/System/Library/Sounds/Funk.aiff"]);
    expect(mocks.notifications).toHaveLength(1);
  });

  it("uses the bundled completion clip for finished tasks", async () => {
    await send("finished");
    expect(mocks.execFile.mock.calls[0]?.[1][0]).toMatch(/assets\/sounds\/complete\.mp3$/);
  });

  it("does not suppress a question immediately following a completion", async () => {
    await send("finished");
    await send("permission");
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
    expect(mocks.execFile.mock.calls[1]?.[1]).toEqual(["/System/Library/Sounds/Funk.aiff"]);
  });

  it("allows system sound without an app chime", async () => {
    Object.assign(mocks.settings.notifications, { playSound: true, playChime: false });
    await send();
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.notifications[0]?.silent).toBe(false);
  });

  it("plays a chime even when system notifications are unavailable", async () => {
    mocks.supported = false;
    expect(await send()).toBe(true);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.notifications).toEqual([]);
  });

  it("coalesces simultaneous agent alerts to one chime", async () => {
    await send();
    await send();
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.notifications).toHaveLength(2);
  });

  it("can play a local-only chime without showing a duplicate system banner", async () => {
    await mocks.handlers.get("paseo:notification:send")!(
      {},
      { title: "Agent finished", chimeOnly: true },
    );
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.notifications).toEqual([]);
  });
});
