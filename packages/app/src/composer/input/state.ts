import type { SendShortcut } from "@/hooks/use-settings";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";
import type { MessagePayload, TextReplacement } from "@/composer/types";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";

export type SendBehavior = ActiveTurnBehavior | "queue";

export function resolveActiveSendBehavior(
  sendBehavior: SendBehavior,
  hasPendingPermission: boolean,
): SendBehavior {
  return sendBehavior === "queue" && hasPendingPermission ? "interrupt" : sendBehavior;
}

interface ComposerSurfaceState {
  opacity: 0 | 1;
  pointerEvents: "auto" | "none";
}

export interface ComposerSurfacePresentation {
  input: ComposerSurfaceState;
  overlay: ComposerSurfaceState;
}

const INPUT_PRESENTATION: ComposerSurfacePresentation = {
  input: { opacity: 1, pointerEvents: "auto" },
  overlay: { opacity: 0, pointerEvents: "none" },
};

const OVERLAY_PRESENTATION: ComposerSurfacePresentation = {
  input: { opacity: 0, pointerEvents: "none" },
  overlay: { opacity: 1, pointerEvents: "auto" },
};

export function resolveComposerSurfacePresentation(
  showOverlay: boolean,
): ComposerSurfacePresentation {
  return showOverlay ? OVERLAY_PRESENTATION : INPUT_PRESENTATION;
}

interface StopRealtimeVoiceContext {
  voice: { stopVoice: () => Promise<unknown> } | null | undefined;
  isRealtimeVoiceForCurrentAgent: boolean;
  isAgentRunning: boolean;
  client: { cancelAgent: (agentId: string) => Promise<unknown> } | null;
  voiceAgentId: string | undefined;
}

interface SendActionContext {
  defaultSendBehavior: SendBehavior;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  handleSendMessage: () => void;
  handleQueueMessage: () => void;
}

interface DictationTranscriptContext {
  value: string;
  defaultSendBehavior: SendBehavior;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onSubmit: (payload: MessagePayload) => void;
  replaceText: (text: string) => void;
  attachments: MessagePayload["attachments"];
  cwd: string;
  autoSend: boolean;
}

export function applyDictationTranscript(text: string, ctx: DictationTranscriptContext): void {
  if (!text) return;
  const shouldPad = ctx.value.length > 0 && !/\s$/.test(ctx.value);
  const nextValue = `${ctx.value}${shouldPad ? " " : ""}${text}`;

  if (!ctx.autoSend) {
    ctx.replaceText(nextValue);
    return;
  }

  ctx.replaceText(nextValue);

  if (ctx.defaultSendBehavior === "queue" && ctx.isAgentRunning && ctx.onQueue) {
    ctx.onQueue({ text: nextValue, attachments: ctx.attachments, cwd: ctx.cwd });
    ctx.replaceText("");
    return;
  }

  ctx.onSubmit({
    text: nextValue,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning || undefined,
  });
}

interface MessageInputKeyboardActions {
  focusInput: () => void;
  isDictationRecording: () => boolean;
  markTranscriptForSend: () => void;
  confirmDictation: () => void | Promise<void>;
  cancelDictation: () => void | Promise<void>;
  startDictation: () => void | Promise<void>;
  toggleRealtimeVoice: () => void;
  isRealtimeVoiceActive: boolean;
  toggleRealtimeVoiceMute: () => void;
}

export function computeCanStartDictation(input: {
  client: DaemonClient | null;
  isReadyForDictation: boolean | undefined;
  disabled: boolean;
  dictationUnavailableMessage: string | null | undefined;
}): boolean {
  const socketConnected = input.client?.isConnected ?? false;
  const readyForDictation = input.isReadyForDictation ?? socketConnected;
  return (
    socketConnected && readyForDictation && !input.disabled && !input.dictationUnavailableMessage
  );
}

export function runDefaultSendAction(ctx: SendActionContext): void {
  if (ctx.defaultSendBehavior === "queue" && ctx.isAgentRunning && ctx.onQueue) {
    ctx.handleQueueMessage();
    return;
  }
  ctx.handleSendMessage();
}

export type AlternateSendAction = "queue" | "send";

/**
 * What Mod+Enter and a long-press on Send do instead of the default send. Null while
 * no turn is running, where both fall back to the default send.
 */
export function resolveAlternateSendAction(
  ctx: Pick<SendActionContext, "defaultSendBehavior" | "isAgentRunning" | "onQueue">,
): AlternateSendAction | null {
  if (!ctx.isAgentRunning || !ctx.onQueue) return null;
  return ctx.defaultSendBehavior === "queue" ? "send" : "queue";
}

export function runAlternateSendAction(ctx: SendActionContext): void {
  const action = resolveAlternateSendAction(ctx);
  if (action === "queue") {
    ctx.handleQueueMessage();
    return;
  }
  if (action === "send") {
    ctx.handleSendMessage();
    return;
  }
  runDefaultSendAction(ctx);
}

export const DEFAULT_MAX_INPUT_HEIGHT = 160;
const MAX_INPUT_VIEWPORT_RATIO = 0.5;
const SPLITTABLE_MAX_INPUT_RATIO = 0.3;
export const SPLITTABLE_MAX_INPUT_FLOOR = 140;

/**
 * The tallest the inline text area grows before it scrolls. Where the dock can split,
 * the cap leaves most of the pane to the conversation, since Expand gives the draft
 * room on demand. Other wide surfaces have no way out of the cap, so they keep half
 * the window. Phones keep a fixed cap.
 */
export function resolveMaxInputHeight(input: {
  windowHeight: number;
  paneHeight: number | undefined;
  compact: boolean;
  splitAvailable: boolean;
}): number {
  if (input.compact) return DEFAULT_MAX_INPUT_HEIGHT;
  if (input.splitAvailable) {
    const height = input.paneHeight ?? input.windowHeight;
    if (!Number.isFinite(height) || height <= 0) return SPLITTABLE_MAX_INPUT_FLOOR;
    return Math.max(SPLITTABLE_MAX_INPUT_FLOOR, Math.floor(height * SPLITTABLE_MAX_INPUT_RATIO));
  }
  const { windowHeight } = input;
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return DEFAULT_MAX_INPUT_HEIGHT;
  return Math.max(DEFAULT_MAX_INPUT_HEIGHT, Math.floor(windowHeight * MAX_INPUT_VIEWPORT_RATIO));
}

/** Expand appears once the draft reaches the cap; Collapse stays for as long as it is split. */
export function shouldShowSplitControl(input: {
  splitAvailable: boolean;
  split: boolean;
  overflowing: boolean;
  readOnly: boolean;
  overlayVisible: boolean;
}): boolean {
  if (!input.splitAvailable || input.readOnly || input.overlayVisible) return false;
  return input.split || input.overflowing;
}

export type ExpandedEditorKey = "collapse" | "indent" | "outdent" | "newline";

/**
 * Keys the expanded composer takes as an editor before the inline composer's handling.
 * An open suggestion popover has already claimed its keys by the time this runs.
 */
export function resolveExpandedEditorKey(event: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): ExpandedEditorKey | null {
  const command = event.metaKey || event.ctrlKey;
  if (event.key === "Escape" && !command && !event.shiftKey && !event.altKey) return "collapse";
  if (event.key === "Tab" && !command && !event.altKey)
    return event.shiftKey ? "outdent" : "indent";
  if (event.key === "Enter" && !command) return "newline";
  return null;
}

export type MessageInputEnterAction = "alternate-send" | "default-send";

export interface MessageInputEnterContext {
  submitOnEnter: boolean;
  sendShortcut: SendShortcut;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
}

export function resolveMessageInputEnterAction(
  ctx: MessageInputEnterContext,
): MessageInputEnterAction | null {
  if (!ctx.submitOnEnter) return null;
  if (ctx.shiftKey) return null;
  const hasModifier = ctx.metaKey || ctx.ctrlKey;
  if (ctx.sendShortcut === "mod-enter") return hasModifier ? "default-send" : null;
  if (hasModifier && ctx.isAgentRunning && ctx.onQueue) return "alternate-send";
  return "default-send";
}

export function runMessageInputKeyboardAction(
  action: MessageInputKeyboardActionKind,
  actions: MessageInputKeyboardActions,
): boolean {
  if (action === "focus") {
    actions.focusInput();
    return true;
  }
  if (action === "send" || action === "dictation-confirm") {
    if (actions.isDictationRecording()) {
      actions.markTranscriptForSend();
      void actions.confirmDictation();
      return true;
    }
    return false;
  }
  if (action === "voice-toggle") {
    actions.toggleRealtimeVoice();
    return true;
  }
  if (action === "voice-mute-toggle") {
    if (actions.isRealtimeVoiceActive) {
      actions.toggleRealtimeVoiceMute();
    }
    return true;
  }
  if (action === "dictation-cancel") {
    if (actions.isDictationRecording()) {
      void actions.cancelDictation();
      return true;
    }
    return false;
  }
  if (action === "dictation-toggle") {
    if (actions.isDictationRecording()) {
      actions.markTranscriptForSend();
      void actions.confirmDictation();
    } else {
      void actions.startDictation();
    }
    return true;
  }
  return false;
}

export async function stopRealtimeVoice(ctx: StopRealtimeVoiceContext): Promise<void> {
  if (!ctx.voice || !ctx.isRealtimeVoiceForCurrentAgent) return;

  if (ctx.isAgentRunning) {
    if (!ctx.client || !ctx.voiceAgentId) {
      throw new Error("Cannot stop the running voice agent while the host is unavailable");
    }
    await ctx.client.cancelAgent(ctx.voiceAgentId);
  }

  await ctx.voice.stopVoice();
}

/**
 * Offset that aligns a glyph's visible ink with the Send arrow's ink when both sit in
 * equal controls on the same right rail. In Lucide's 24px viewBox ArrowUp ends at
 * x19 while Maximize2/Minimize2 end at x21, so equal boxes leave the fullscreen
 * glyphs visibly past the arrow.
 */
export function resolveGlyphRailOffset(input: {
  controlSize: number;
  sendIconSize: number;
  glyphIconSize: number;
}): number {
  const arrowInkInset =
    (input.controlSize - input.sendIconSize) / 2 + (5 * input.sendIconSize) / 24;
  const glyphInkInset =
    (input.controlSize - input.glyphIconSize) / 2 + (3 * input.glyphIconSize) / 24;
  return arrowInkInset - glyphInkInset;
}

export function resolveComposerSurfaceText(
  liveText: string,
  replacement: TextReplacement,
  appliedReplacementKey: string,
): string {
  return replacement.key === appliedReplacementKey ? liveText : replacement.text;
}

/** A retained caret must fit the text the remounted editor shows. */
export function resolveRetainedSelection(
  retained: { start: number; end: number },
  textLength: number,
): { start: number; end: number } {
  const end = Math.min(Math.max(retained.end, 0), textLength);
  const start = Math.min(Math.max(retained.start, 0), end);
  return { start, end };
}
