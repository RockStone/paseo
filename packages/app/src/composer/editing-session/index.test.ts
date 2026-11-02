import { describe, expect, it } from "vitest";
import { ComposerEditingSession, ComposerEditingSessions } from "./index";

describe("composer editing session", () => {
  it("appends commands to the current editor buffer and focuses it", () => {
    const session = new ComposerEditingSession();
    let text = "draft typed since publication";
    let focuses = 0;
    let selection = { start: 0, end: 0 };
    const detach = session.attachEditor({
      getText: () => text,
      getCaret: () => null,
      replaceText: (next, nextSelection) => {
        text = next;
        selection = nextSelection;
      },
      focus: () => {
        focuses += 1;
      },
    });
    session.insertCommand("/review");
    expect(selection).toEqual({ start: text.length, end: text.length });
    session.insertCommand("/test");
    expect(text).toBe("draft typed since publication /review /test ");
    expect(focuses).toBe(2);
    expect(selection).toEqual({ start: text.length, end: text.length });
    detach();
    session.insertCommand("/ignored");
    expect(text).toBe("draft typed since publication /review /test ");
  });
  it("edits the buffer around the remembered caret without taking focus", () => {
    const session = new ComposerEditingSession();
    let text = "before after";
    let caret: { start: number; end: number } | null = { start: 6, end: 6 };
    let focuses = 0;
    expect(session.editAtCaret(() => ({ text: "ignored", caret: 0 }))).toBe(false);
    const detach = session.attachEditor({
      getText: () => text,
      getCaret: () => caret,
      replaceText: (next, selection) => {
        text = next;
        caret = selection;
      },
      focus: () => {
        focuses += 1;
      },
    });
    const seen: ({ start: number; end: number } | null)[] = [];
    expect(
      session.editAtCaret((current, at) => {
        seen.push(at);
        const position = at?.end ?? current.length;
        return {
          text: `${current.slice(0, position)}[x]${current.slice(position)}`,
          caret: position + 3,
        };
      }),
    ).toBe(true);
    expect(seen).toEqual([{ start: 6, end: 6 }]);
    expect(text).toBe("before[x] after");
    expect(caret).toEqual({ start: 9, end: 9 });
    expect(focuses).toBe(0);
    detach();
    expect(session.editAtCaret(() => ({ text: "ignored", caret: 0 }))).toBe(false);
  });
  it("publishes fullscreen changes once per transition", () => {
    const session = new ComposerEditingSession();
    const changes: boolean[] = [];
    session.subscribe(() => changes.push(session.getFullscreen()));
    session.setFullscreen(true);
    session.setFullscreen(true);
    session.setFullscreen(false);
    expect(changes).toEqual([true, false]);
  });

  it("hands the retained caret and focus intent to exactly one later mount", () => {
    const session = new ComposerEditingSession();
    expect(session.takeEditor()).toBeNull();
    session.retainEditor({ selection: { start: 4, end: 17 }, focused: true });
    expect(session.takeEditor()).toEqual({ selection: { start: 4, end: 17 }, focused: true });
    expect(session.takeEditor()).toBeNull();
  });
});

describe("composer editing sessions", () => {
  const workspace = "server:workspace";
  const target = JSON.stringify({ kind: "agent", agentId: "a" });

  it("keeps one session per tab and purpose until the tab target changes", () => {
    const sessions = new ComposerEditingSessions();
    const chat = sessions.get(workspace, "tab-1", target, "chat");
    expect(sessions.get(workspace, "tab-1", target, "chat")).toBe(chat);
    expect(sessions.get(workspace, "tab-1", target, "terminal")).not.toBe(chat);
    const retargeted = JSON.stringify({ kind: "agent", agentId: "b" });
    expect(sessions.get(workspace, "tab-1", retargeted, "chat")).not.toBe(chat);
  });

  it("reports a tab as fullscreen while any of its composers is fullscreen", () => {
    const sessions = new ComposerEditingSessions();
    const notifications: boolean[] = [];
    sessions.subscribe(() => notifications.push(sessions.isTabFullscreen(workspace, "tab-1")));
    const chat = sessions.get(workspace, "tab-1", target, "chat");
    sessions.get(workspace, "tab-2", target, "chat").setFullscreen(true);
    expect(sessions.isTabFullscreen(workspace, "tab-1")).toBe(false);
    expect(sessions.isTabFullscreen(workspace, null)).toBe(false);
    chat.setFullscreen(true);
    expect(sessions.isTabFullscreen(workspace, "tab-1")).toBe(true);
    chat.setFullscreen(false);
    expect(notifications).toEqual([false, true, false]);
  });

  it("drops sessions for closed tabs and keeps retained ones", () => {
    const sessions = new ComposerEditingSessions();
    const kept = sessions.get(workspace, "tab-1", target, "chat");
    kept.setFullscreen(true);
    sessions.get(workspace, "tab-2", target, "chat").setFullscreen(true);
    sessions.retain(workspace, ["tab-1"]);
    expect(sessions.get(workspace, "tab-1", target, "chat")).toBe(kept);
    expect(sessions.isTabFullscreen(workspace, "tab-2")).toBe(false);
    expect(sessions.get(workspace, "tab-2", target, "chat").getFullscreen()).toBe(false);
  });

  it("keeps each tab's split request apart without marking the tab fullscreen", () => {
    const sessions = new ComposerEditingSessions();
    const tabNotifications: number[] = [];
    sessions.subscribe(() => tabNotifications.push(1));
    const chat = sessions.get(workspace, "tab-1", target, "chat");
    const other = sessions.get(workspace, "tab-2", target, "chat");
    const changes: boolean[] = [];
    chat.subscribe(() => changes.push(chat.getSplit()));
    chat.setSplit(true);
    chat.setSplit(true);
    expect(chat.getSplit()).toBe(true);
    expect(other.getSplit()).toBe(false);
    expect(sessions.get(workspace, "tab-1", target, "chat").getSplit()).toBe(true);
    expect(sessions.isTabFullscreen(workspace, "tab-1")).toBe(false);
    chat.setSplit(false);
    expect(changes).toEqual([true, false]);
    expect(tabNotifications).toEqual([]);
  });

  it("drops the split request once the dock cannot split, so widening again stays normal", () => {
    const sessions = new ComposerEditingSessions();
    const chat = sessions.get(workspace, "tab-1", target, "chat");
    const { syncSplitAvailability } = chat;
    chat.setSplit(true);
    syncSplitAvailability(true);
    expect(chat.getSplit()).toBe(true);
    syncSplitAvailability(false);
    expect(chat.getSplit()).toBe(false);
    syncSplitAvailability(true);
    expect(chat.getSplit()).toBe(false);
  });
});
