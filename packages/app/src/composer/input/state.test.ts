import {
  continueNumberedList,
  indentLines,
  numberedListChanges,
  normalizeNumberedList,
} from "./list-continuation";
import { describe, expect, it, vi } from "vitest";
import {
  applyDictationTranscript,
  computeCanStartDictation,
  type MessageInputEnterContext,
  resolveActiveSendBehavior,
  resolveComposerSurfacePresentation,
  resolveComposerSurfaceText,
  resolveExpandedEditorKey,
  resolveGlyphRailOffset,
  resolveMaxInputHeight,
  resolveMessageInputEnterAction,
  resolveRetainedSelection,
  resolveAlternateSendAction,
  runAlternateSendAction,
  runDefaultSendAction,
  runMessageInputKeyboardAction,
  shouldShowSplitControl,
  stopRealtimeVoice,
} from "./state";

const connected = { isConnected: true } as never;
const disconnected = { isConnected: false } as never;

function createDictationKeyboard({ startsRecording }: { startsRecording: boolean }) {
  let isRecording = false;
  const actions: string[] = [];

  return {
    actions,
    pressDictationShortcut: () =>
      runMessageInputKeyboardAction("dictation-toggle", {
        focusInput: () => undefined,
        isDictationRecording: () => isRecording,
        markTranscriptForSend: () => actions.push("send transcript"),
        startDictation: () => {
          actions.push("start");
          isRecording = startsRecording;
        },
        confirmDictation: () => {
          actions.push("confirm");
          isRecording = false;
        },
        cancelDictation: () => undefined,
        toggleRealtimeVoice: () => undefined,
        isRealtimeVoiceActive: false,
        toggleRealtimeVoiceMute: () => undefined,
      }),
  };
}

describe("composer surface presentation", () => {
  it("shows only the input when no voice overlay is active", () => {
    expect(resolveComposerSurfacePresentation(false)).toEqual({
      input: { opacity: 1, pointerEvents: "auto" },
      overlay: { opacity: 0, pointerEvents: "none" },
    });
  });

  it("shows only the voice overlay while voice UI is active", () => {
    expect(resolveComposerSurfacePresentation(true)).toEqual({
      input: { opacity: 0, pointerEvents: "none" },
      overlay: { opacity: 1, pointerEvents: "auto" },
    });
  });
});

describe("computeCanStartDictation", () => {
  it("returns false when socket is disconnected", () => {
    expect(
      computeCanStartDictation({
        client: disconnected,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns false when isReadyForDictation is explicitly false", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: false,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns true when connected and ready", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(true);
  });

  it("falls back to socket connected state when isReadyForDictation is undefined", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: undefined,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(true);

    expect(
      computeCanStartDictation({
        client: disconnected,
        isReadyForDictation: undefined,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns false when the input is disabled", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: true,
        disabled: true,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });

  it("returns false when a dictation unavailable message is present", () => {
    expect(
      computeCanStartDictation({
        client: connected,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: "Microphone unavailable",
      }),
    ).toBe(false);
  });

  it("returns false when client is null", () => {
    expect(
      computeCanStartDictation({
        client: null,
        isReadyForDictation: true,
        disabled: false,
        dictationUnavailableMessage: null,
      }),
    ).toBe(false);
  });
});

describe("dictation keyboard behavior", () => {
  it("starts dictation again after the previous dictation finishes", () => {
    const keyboard = createDictationKeyboard({ startsRecording: true });

    keyboard.pressDictationShortcut();
    keyboard.pressDictationShortcut();
    keyboard.pressDictationShortcut();

    expect(keyboard.actions).toEqual(["start", "send transcript", "confirm", "start"]);
  });

  it("can retry when starting dictation does not enter the recording state", () => {
    const keyboard = createDictationKeyboard({ startsRecording: false });

    keyboard.pressDictationShortcut();
    keyboard.pressDictationShortcut();

    expect(keyboard.actions).toEqual(["start", "start"]);
  });
});

describe("dictation transcript behavior", () => {
  it("publishes an auto-sent transcript to the composer before submitting it", () => {
    const actions: string[] = [];

    applyDictationTranscript("spoken prompt", {
      value: "typed context",
      defaultSendBehavior: "interrupt",
      isAgentRunning: false,
      onQueue: undefined,
      replaceText: (text) => actions.push(`replace:${text}`),
      onSubmit: (payload) => actions.push(`submit:${payload.text}`),
      attachments: [],
      cwd: "/repo",
      autoSend: true,
    });

    expect(actions).toEqual([
      "replace:typed context spoken prompt",
      "submit:typed context spoken prompt",
    ]);
  });
});

describe("composer send behavior", () => {
  it("sends immediately when queue mode cannot advance past a permission", () => {
    expect(resolveActiveSendBehavior("queue", true)).toBe("interrupt");
    expect(resolveActiveSendBehavior("queue", false)).toBe("queue");
    expect(resolveActiveSendBehavior("steer", true)).toBe("steer");
  });

  function actions() {
    const calls: string[] = [];
    return {
      calls,
      handleSendMessage: () => calls.push("send"),
      handleQueueMessage: () => calls.push("queue"),
      onQueue: () => undefined,
    };
  }

  it("uses Enter to interrupt and Mod+Enter to queue when interrupt is selected", () => {
    const defaultAction = actions();
    runDefaultSendAction({
      defaultSendBehavior: "interrupt",
      isAgentRunning: true,
      onQueue: defaultAction.onQueue,
      handleSendMessage: defaultAction.handleSendMessage,
      handleQueueMessage: defaultAction.handleQueueMessage,
    });

    const alternateAction = actions();
    runAlternateSendAction({
      defaultSendBehavior: "interrupt",
      isAgentRunning: true,
      onQueue: alternateAction.onQueue,
      handleSendMessage: alternateAction.handleSendMessage,
      handleQueueMessage: alternateAction.handleQueueMessage,
    });

    expect(defaultAction.calls).toEqual(["send"]);
    expect(alternateAction.calls).toEqual(["queue"]);
  });

  it("uses Enter to steer and Mod+Enter to queue when steer is selected", () => {
    const defaultAction = actions();
    runDefaultSendAction({
      defaultSendBehavior: "steer",
      isAgentRunning: true,
      onQueue: defaultAction.onQueue,
      handleSendMessage: defaultAction.handleSendMessage,
      handleQueueMessage: defaultAction.handleQueueMessage,
    });

    const alternateAction = actions();
    runAlternateSendAction({
      defaultSendBehavior: "steer",
      isAgentRunning: true,
      onQueue: alternateAction.onQueue,
      handleSendMessage: alternateAction.handleSendMessage,
      handleQueueMessage: alternateAction.handleQueueMessage,
    });

    expect(defaultAction.calls).toEqual(["send"]);
    expect(alternateAction.calls).toEqual(["queue"]);
  });

  it("uses Enter to queue and Mod+Enter to submit when queue is selected", () => {
    const defaultAction = actions();
    runDefaultSendAction({
      defaultSendBehavior: "queue",
      isAgentRunning: true,
      onQueue: defaultAction.onQueue,
      handleSendMessage: defaultAction.handleSendMessage,
      handleQueueMessage: defaultAction.handleQueueMessage,
    });

    const alternateAction = actions();
    runAlternateSendAction({
      defaultSendBehavior: "queue",
      isAgentRunning: true,
      onQueue: alternateAction.onQueue,
      handleSendMessage: alternateAction.handleSendMessage,
      handleQueueMessage: alternateAction.handleQueueMessage,
    });

    expect(defaultAction.calls).toEqual(["queue"]);
    expect(alternateAction.calls).toEqual(["send"]);
  });

  it("sends with the alternate action while no turn is running", () => {
    for (const defaultSendBehavior of ["steer", "interrupt", "queue"] as const) {
      const alternateAction = actions();
      runAlternateSendAction({
        defaultSendBehavior,
        isAgentRunning: false,
        onQueue: alternateAction.onQueue,
        handleSendMessage: alternateAction.handleSendMessage,
        handleQueueMessage: alternateAction.handleQueueMessage,
      });
      expect(alternateAction.calls).toEqual(["send"]);
    }
  });

  it("offers an alternate action only while a turn runs and the composer can queue", () => {
    const onQueue = () => undefined;
    expect(
      resolveAlternateSendAction({ defaultSendBehavior: "steer", isAgentRunning: true, onQueue }),
    ).toBe("queue");
    expect(
      resolveAlternateSendAction({
        defaultSendBehavior: "interrupt",
        isAgentRunning: true,
        onQueue,
      }),
    ).toBe("queue");
    expect(
      resolveAlternateSendAction({ defaultSendBehavior: "queue", isAgentRunning: true, onQueue }),
    ).toBe("send");
    expect(
      resolveAlternateSendAction({ defaultSendBehavior: "steer", isAgentRunning: false, onQueue }),
    ).toBeNull();
    expect(
      resolveAlternateSendAction({
        defaultSendBehavior: "queue",
        isAgentRunning: true,
        onQueue: undefined,
      }),
    ).toBeNull();
  });
});

describe("resolveMessageInputEnterAction", () => {
  function enterContext(
    overrides: Partial<MessageInputEnterContext> = {},
  ): MessageInputEnterContext {
    return {
      submitOnEnter: true,
      sendShortcut: "enter",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      isAgentRunning: false,
      onQueue: () => undefined,
      ...overrides,
    };
  }

  it("returns null for plain, Shift, and modifier Enter when submit on enter is disabled", () => {
    expect(resolveMessageInputEnterAction(enterContext({ submitOnEnter: false }))).toBeNull();
    expect(
      resolveMessageInputEnterAction(enterContext({ submitOnEnter: false, shiftKey: true })),
    ).toBeNull();
    expect(
      resolveMessageInputEnterAction(enterContext({ submitOnEnter: false, metaKey: true })),
    ).toBeNull();
    expect(
      resolveMessageInputEnterAction(enterContext({ submitOnEnter: false, ctrlKey: true })),
    ).toBeNull();
  });

  it("still returns null when modifier Enter sends and submit on enter is disabled", () => {
    expect(
      resolveMessageInputEnterAction(
        enterContext({ sendShortcut: "mod-enter", submitOnEnter: false, metaKey: true }),
      ),
    ).toBeNull();
    expect(
      resolveMessageInputEnterAction(
        enterContext({ sendShortcut: "mod-enter", submitOnEnter: false }),
      ),
    ).toBeNull();
  });

  it("sends on plain Enter when Enter sends", () => {
    expect(resolveMessageInputEnterAction(enterContext())).toBe("default-send");
  });

  it("returns null for Shift+Enter when Enter sends", () => {
    expect(resolveMessageInputEnterAction(enterContext({ shiftKey: true }))).toBeNull();
  });

  it("returns null for Shift+Cmd+Enter and Shift+Ctrl+Enter so Shift keeps its newline", () => {
    expect(
      resolveMessageInputEnterAction(
        enterContext({ shiftKey: true, metaKey: true, isAgentRunning: true }),
      ),
    ).toBeNull();
    expect(
      resolveMessageInputEnterAction(
        enterContext({ shiftKey: true, ctrlKey: true, isAgentRunning: true }),
      ),
    ).toBeNull();
  });

  it("sends on Cmd+Enter and Ctrl+Enter while idle even with a queue handler", () => {
    expect(resolveMessageInputEnterAction(enterContext({ metaKey: true }))).toBe("default-send");
    expect(resolveMessageInputEnterAction(enterContext({ ctrlKey: true }))).toBe("default-send");
  });

  it("queues on Cmd+Enter and Ctrl+Enter while the agent is running with a queue handler", () => {
    expect(
      resolveMessageInputEnterAction(enterContext({ metaKey: true, isAgentRunning: true })),
    ).toBe("alternate-send");
    expect(
      resolveMessageInputEnterAction(enterContext({ ctrlKey: true, isAgentRunning: true })),
    ).toBe("alternate-send");
  });

  it("sends on Cmd+Enter and Ctrl+Enter while running when no queue handler exists", () => {
    expect(
      resolveMessageInputEnterAction(
        enterContext({ metaKey: true, isAgentRunning: true, onQueue: undefined }),
      ),
    ).toBe("default-send");
    expect(
      resolveMessageInputEnterAction(
        enterContext({ ctrlKey: true, isAgentRunning: true, onQueue: undefined }),
      ),
    ).toBe("default-send");
  });

  it("returns null for plain and Shift+Enter when modifier Enter sends", () => {
    expect(resolveMessageInputEnterAction(enterContext({ sendShortcut: "mod-enter" }))).toBeNull();
    expect(
      resolveMessageInputEnterAction(enterContext({ sendShortcut: "mod-enter", shiftKey: true })),
    ).toBeNull();
  });

  it("returns null for Shift+Cmd+Enter and Shift+Ctrl+Enter when modifier Enter sends", () => {
    expect(
      resolveMessageInputEnterAction(
        enterContext({ sendShortcut: "mod-enter", shiftKey: true, metaKey: true }),
      ),
    ).toBeNull();
    expect(
      resolveMessageInputEnterAction(
        enterContext({ sendShortcut: "mod-enter", shiftKey: true, ctrlKey: true }),
      ),
    ).toBeNull();
  });

  it("sends on Cmd+Enter and Ctrl+Enter while idle when modifier Enter sends", () => {
    expect(
      resolveMessageInputEnterAction(enterContext({ sendShortcut: "mod-enter", metaKey: true })),
    ).toBe("default-send");
    expect(
      resolveMessageInputEnterAction(enterContext({ sendShortcut: "mod-enter", ctrlKey: true })),
    ).toBe("default-send");
  });

  it("uses the default action on modifier Enter while running when modifier Enter sends", () => {
    expect(
      resolveMessageInputEnterAction(
        enterContext({ sendShortcut: "mod-enter", metaKey: true, isAgentRunning: true }),
      ),
    ).toBe("default-send");
    expect(
      resolveMessageInputEnterAction(
        enterContext({ sendShortcut: "mod-enter", ctrlKey: true, isAgentRunning: true }),
      ),
    ).toBe("default-send");
  });

  describe("composed with the send actions", () => {
    function actions() {
      const calls: string[] = [];
      return {
        calls,
        handleSendMessage: () => calls.push("send"),
        handleQueueMessage: () => calls.push("queue"),
        onQueue: () => undefined,
      };
    }

    function resolveCommandEnterToSendModifierEnter() {
      return resolveMessageInputEnterAction(
        enterContext({ sendShortcut: "mod-enter", metaKey: true, isAgentRunning: true }),
      );
    }

    it("queues through the default send action when queue behavior is selected and the agent is running", () => {
      const sendAction = actions();

      expect(resolveCommandEnterToSendModifierEnter()).toBe("default-send");

      runDefaultSendAction({
        defaultSendBehavior: "queue",
        isAgentRunning: true,
        onQueue: sendAction.onQueue,
        handleSendMessage: sendAction.handleSendMessage,
        handleQueueMessage: sendAction.handleQueueMessage,
      });

      expect(sendAction.calls).toEqual(["queue"]);
    });

    it("sends through the default send action when queue behavior is selected and the agent is idle", () => {
      const sendAction = actions();

      expect(
        resolveMessageInputEnterAction(
          enterContext({ sendShortcut: "mod-enter", metaKey: true, isAgentRunning: false }),
        ),
      ).toBe("default-send");

      runDefaultSendAction({
        defaultSendBehavior: "queue",
        isAgentRunning: false,
        onQueue: sendAction.onQueue,
        handleSendMessage: sendAction.handleSendMessage,
        handleQueueMessage: sendAction.handleQueueMessage,
      });

      expect(sendAction.calls).toEqual(["send"]);
    });

    it.each([{ defaultSendBehavior: "steer" }, { defaultSendBehavior: "interrupt" }] as const)(
      "sends through the default send action when $defaultSendBehavior behavior is selected and the agent is running",
      ({ defaultSendBehavior }) => {
        const sendAction = actions();

        expect(resolveCommandEnterToSendModifierEnter()).toBe("default-send");

        runDefaultSendAction({
          defaultSendBehavior,
          isAgentRunning: true,
          onQueue: sendAction.onQueue,
          handleSendMessage: sendAction.handleSendMessage,
          handleQueueMessage: sendAction.handleQueueMessage,
        });

        expect(sendAction.calls).toEqual(["send"]);
      },
    );
  });
});

describe("stopRealtimeVoice", () => {
  it("keeps voice mode active when the running agent refuses cancellation", async () => {
    const cancellationError = new Error("active run cancellation was not acknowledged");
    const cancelAgent = vi.fn().mockRejectedValue(cancellationError);
    const stopVoice = vi.fn().mockResolvedValue(undefined);

    await expect(
      stopRealtimeVoice({
        voice: { stopVoice },
        isRealtimeVoiceForCurrentAgent: true,
        isAgentRunning: true,
        client: { cancelAgent },
        voiceAgentId: "agent-1",
      }),
    ).rejects.toBe(cancellationError);

    expect(stopVoice).not.toHaveBeenCalled();
  });

  it("stops voice mode after the running agent acknowledges cancellation", async () => {
    const calls: string[] = [];

    await stopRealtimeVoice({
      voice: {
        stopVoice: async () => {
          calls.push("stop voice");
        },
      },
      isRealtimeVoiceForCurrentAgent: true,
      isAgentRunning: true,
      client: {
        cancelAgent: async () => {
          calls.push("cancel agent");
        },
      },
      voiceAgentId: "agent-1",
    });

    expect(calls).toEqual(["cancel agent", "stop voice"]);
  });
});

describe("composer surface text", () => {
  it("measures a new nonempty replacement before it reaches the editing handle", () => {
    const replacement = { kind: "replace" as const, key: "draft:2", text: "First\nSecond\nThird" };
    expect(resolveComposerSurfaceText("Short draft", replacement, "draft:1")).toBe(
      replacement.text,
    );
  });

  it("keeps live typing once the replacement is applied", () => {
    const replacement = { kind: "replace" as const, key: "draft:2", text: "First\nSecond\nThird" };
    expect(resolveComposerSurfaceText("Edited live draft", replacement, "draft:2")).toBe(
      "Edited live draft",
    );
  });

  it("keeps the live buffer when the initial publication is already applied", () => {
    const replacement = { kind: "initial" as const, key: "draft:0", text: "Stale publication" };
    expect(resolveComposerSurfaceText("Live edited draft", replacement, "draft:0")).toBe(
      "Live edited draft",
    );
  });
});

describe("retained selection", () => {
  it("keeps a caret that fits and clamps one that no longer does", () => {
    expect(resolveRetainedSelection({ start: 4, end: 17 }, 40)).toEqual({ start: 4, end: 17 });
    expect(resolveRetainedSelection({ start: 4, end: 17 }, 10)).toEqual({ start: 4, end: 10 });
    expect(resolveRetainedSelection({ start: 12, end: 17 }, 10)).toEqual({ start: 10, end: 10 });
    expect(resolveRetainedSelection({ start: -1, end: 3 }, 10)).toEqual({ start: 0, end: 3 });
  });
});

describe("fullscreen glyph rail", () => {
  it("nudges 16px fullscreen glyphs onto the Send arrow's ink edge", () => {
    expect(
      resolveGlyphRailOffset({ controlSize: 28, sendIconSize: 16, glyphIconSize: 16 }),
    ).toBeCloseTo(4 / 3);
    expect(
      resolveGlyphRailOffset({ controlSize: 28, sendIconSize: 20, glyphIconSize: 16 }),
    ).toBeCloseTo(1 / 6);
  });
});

describe("numbered composer lists", () => {
  it("renumbers following items when inserting in the middle", () => {
    const text = "1. first\n2. second\n3. third";
    const caret = text.indexOf("\n3.");
    expect(continueNumberedList(text, { start: caret, end: caret })).toEqual({
      text: "1. first\n2. second\n3. \n4. third",
      selection: { start: caret + 4, end: caret + 4 },
    });
  });

  it.each([
    ["1. first\n2. second\n3. third", "1. first\n3. third", "1. first\n2. third"],
    ["1. first\n2. second\n3. third", "2. second\n3. third", "1. second\n2. third"],
    ["7) first\n8) second\n9) third", "7) first\n9) third", "7) first\n8) third"],
    ["1. first\n2. second\n3. third\n4. fourth", "1. first\n4. fourth", "1. first\n2. fourth"],
  ])("closes numbering gaps after deleting items: %s", (before, text, expected) => {
    expect(normalizeNumberedList({ before, text, selection: { start: 0, end: 0 } }).text).toBe(
      expected,
    );
  });

  it("keeps nested numbering and other lists independent", () => {
    const before =
      "1. parent\n   1. child\n   2. next\n2. sibling\n\nSeparate\n\n5. other\n8. deliberate";
    const caret = before.indexOf("\n   2.");
    expect(continueNumberedList(before, { start: caret, end: caret })?.text).toBe(
      "1. parent\n   1. child\n   2. \n   3. next\n2. sibling\n\nSeparate\n\n5. other\n8. deliberate",
    );
  });

  it("keeps the caret at the inserted item across double-digit numbering", () => {
    const before = "8. first\n9. second\n10. third";
    const caret = before.indexOf("\n10.");
    expect(continueNumberedList(before, { start: caret, end: caret })).toEqual({
      text: "8. first\n9. second\n10. \n11. third",
      selection: { start: caret + 5, end: caret + 5 },
    });
  });

  it("maps a selection after number widths shrink", () => {
    const before = "9. first\n10. second\n11. third";
    const text = "10. second\n11. third";
    const result = normalizeNumberedList({
      before,
      text,
      selection: { start: 4, end: text.length },
    });
    expect(result).toEqual({
      text: "9. second\n10. third",
      selection: { start: 3, end: text.length - 1 },
    });
  });

  it("derives the native caret from the edit when selection arrives later", () => {
    expect(
      normalizeNumberedList({
        before: "1. first\n2. second\n3. third",
        text: "1. first\n3. third",
      }),
    ).toEqual({
      text: "1. first\n2. third",
      selection: { start: 9, end: 9 },
    });
  });

  it("renumbers following items after removing an empty middle marker", () => {
    const before = "1. first\n2. \n3. third";
    const caret = before.indexOf("\n3.");
    expect(continueNumberedList(before, { start: caret, end: caret })?.text).toBe(
      "1. first\n\n2. third",
    );
  });

  it("does not rewrite pasted documents, literal code, or intentionally edited numbers", () => {
    expect(numberedListChanges("", "1. first\n7. deliberate")).toEqual([]);
    expect(numberedListChanges("1. first\n3. second", "1. first\n7. second")).toEqual([]);
    expect(
      numberedListChanges("```\n1. code\n3. code\n```", "```\n1. code\n2. inserted\n3. code\n```"),
    ).toEqual([]);
    expect(numberedListChanges("1. first\n7. deliberate", "1. first\n7. deliberate edit")).toEqual(
      [],
    );
  });

  it("continues list numbers and indentation without sending", () => {
    expect(continueNumberedList("  9) hello", { start: 10, end: 10 })).toEqual({
      text: "  9) hello\n  10) ",
      selection: { start: 17, end: 17 },
    });
  });
  it("ends an empty item and leaves ordinary messages alone", () => {
    expect(continueNumberedList("1. hello\n2. ", { start: 12, end: 12 })).toEqual({
      text: "1. hello\n",
      selection: { start: 9, end: 9 },
    });
    expect(continueNumberedList("hello", { start: 5, end: 5 })).toBeNull();
  });
});

it("keeps literal code and splits a numbered item at its cursor", () => {
  const code = "```\n1. literal\n```";
  expect(continueNumberedList(code, { start: 14, end: 14 })).toBeNull();
  expect(continueNumberedList("1. word", { start: 3, end: 3 })).toEqual({
    text: "1. \n2. word",
    selection: { start: 7, end: 7 },
  });
});

describe("composer height cap", () => {
  const wide = { compact: false, windowHeight: 1000 };

  it("caps a splittable composer at thirty percent of the pane, not the window", () => {
    expect(resolveMaxInputHeight({ ...wide, paneHeight: 900, splitAvailable: true })).toBe(270);
    expect(resolveMaxInputHeight({ ...wide, paneHeight: 620, splitAvailable: true })).toBe(186);
  });

  it("never caps a splittable composer below the floor", () => {
    expect(resolveMaxInputHeight({ ...wide, paneHeight: 300, splitAvailable: true })).toBe(140);
    expect(resolveMaxInputHeight({ ...wide, paneHeight: 0, splitAvailable: true })).toBe(140);
  });

  it("measures the window until the pane has laid out", () => {
    expect(resolveMaxInputHeight({ ...wide, paneHeight: undefined, splitAvailable: true })).toBe(
      300,
    );
  });

  it("keeps half the window where the composer cannot split, and a fixed cap on phones", () => {
    expect(resolveMaxInputHeight({ ...wide, paneHeight: 900, splitAvailable: false })).toBe(500);
    expect(
      resolveMaxInputHeight({
        compact: true,
        windowHeight: 800,
        paneHeight: 700,
        splitAvailable: false,
      }),
    ).toBe(160);
  });
});

describe("split control", () => {
  const base = {
    splitAvailable: true,
    split: false,
    overflowing: false,
    readOnly: false,
    overlayVisible: false,
  };

  it("offers Expand only once the draft reaches the cap", () => {
    expect(shouldShowSplitControl(base)).toBe(false);
    expect(shouldShowSplitControl({ ...base, overflowing: true })).toBe(true);
  });

  it("keeps Collapse while split, whatever the draft's length", () => {
    expect(shouldShowSplitControl({ ...base, split: true })).toBe(true);
  });

  it("hides on surfaces that cannot split, read-only drafts, and voice overlays", () => {
    expect(shouldShowSplitControl({ ...base, overflowing: true, splitAvailable: false })).toBe(
      false,
    );
    expect(shouldShowSplitControl({ ...base, overflowing: true, readOnly: true })).toBe(false);
    expect(shouldShowSplitControl({ ...base, split: true, overlayVisible: true })).toBe(false);
  });
});

describe("expanded editor keys", () => {
  const key = (name: string, modifiers: Partial<Record<string, boolean>> = {}) =>
    resolveExpandedEditorKey({
      key: name,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...modifiers,
    });

  it("writes a newline on Enter and Shift+Enter and leaves Cmd/Ctrl+Enter to send", () => {
    expect(key("Enter")).toBe("newline");
    expect(key("Enter", { shiftKey: true })).toBe("newline");
    expect(key("Enter", { metaKey: true })).toBeNull();
    expect(key("Enter", { ctrlKey: true })).toBeNull();
    expect(
      resolveMessageInputEnterAction({
        submitOnEnter: true,
        sendShortcut: "mod-enter",
        shiftKey: false,
        metaKey: true,
        ctrlKey: false,
        isAgentRunning: true,
        onQueue: () => undefined,
      }),
    ).toBe("default-send");
  });

  it("indents on Tab, outdents on Shift+Tab, and collapses on Escape", () => {
    expect(key("Tab")).toBe("indent");
    expect(key("Tab", { shiftKey: true })).toBe("outdent");
    expect(key("Tab", { metaKey: true })).toBeNull();
    expect(key("Escape")).toBe("collapse");
    expect(key("Escape", { metaKey: true })).toBeNull();
    expect(key("a")).toBeNull();
  });
});

describe("indentLines", () => {
  it("moves the list item under the caret by two spaces and keeps the caret on its text", () => {
    expect(indentLines("1. one\n2. two", { start: 12, end: 12 }, "in")).toEqual({
      text: "1. one\n  2. two",
      selection: { start: 14, end: 14 },
    });
    expect(indentLines("1. one\n  2. two", { start: 14, end: 14 }, "out")).toEqual({
      text: "1. one\n2. two",
      selection: { start: 12, end: 12 },
    });
  });

  it("inserts two spaces at a caret in plain text", () => {
    expect(indentLines("ab", { start: 1, end: 1 }, "in")).toEqual({
      text: "a  b",
      selection: { start: 3, end: 3 },
    });
  });

  it("moves every selected line, but not a line the selection only touches at its start", () => {
    const text = "a\n b\nc";
    expect(indentLines(text, { start: 0, end: 5 }, "in")).toEqual({
      text: "  a\n   b\nc",
      selection: { start: 2, end: 9 },
    });
    expect(indentLines("  a\n   b\nc", { start: 2, end: 9 }, "out")).toEqual({
      text: "a\n b\nc",
      selection: { start: 0, end: 5 },
    });
  });

  it("returns null when there is nothing to outdent", () => {
    expect(indentLines("- item", { start: 3, end: 3 }, "out")).toBeNull();
  });
});
