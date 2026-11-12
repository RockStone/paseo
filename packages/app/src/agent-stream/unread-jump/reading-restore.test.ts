import { describe, expect, it } from "vitest";
import type { ChatReadingPosition } from "@/stores/chat-read-marker-store";
import type { StreamItem } from "@/types/stream";
import { decideReadingRestore } from "./reading-restore";

const EPOCH = "epoch-1";

function assistant(seq: number): StreamItem {
  return {
    kind: "assistant_message",
    id: `assistant-${seq}`,
    text: "reply",
    timestamp: new Date(0),
    timelineCursor: { epoch: EPOCH, seq },
  };
}

function saved(overrides: Partial<ChatReadingPosition> = {}): ChatReadingPosition {
  return { epoch: EPOCH, seq: 3, latestSeq: 5, savedAt: 0, ...overrides };
}

const items = [1, 2, 3, 4, 5].map(assistant);

describe("decideReadingRestore", () => {
  it("returns to the saved row", () => {
    expect(decideReadingRestore({ saved: saved(), epoch: EPOCH, items })).toEqual({
      kind: "row",
      messageId: "assistant-3",
    });
  });

  it("lands at the bottom without a saved position", () => {
    expect(decideReadingRestore({ saved: undefined, epoch: EPOCH, items })).toEqual({
      kind: "bottom",
    });
  });

  it("lands at the bottom when the reader was at the bottom", () => {
    expect(decideReadingRestore({ saved: saved({ seq: null }), epoch: EPOCH, items })).toEqual({
      kind: "bottom",
    });
  });

  it("lands at the bottom when a message arrived while away", () => {
    expect(
      decideReadingRestore({ saved: saved(), epoch: EPOCH, items: [...items, assistant(6)] }),
    ).toEqual({ kind: "bottom" });
  });

  it("lands at the bottom when the timeline restarted", () => {
    expect(decideReadingRestore({ saved: saved({ epoch: "old" }), epoch: EPOCH, items })).toEqual({
      kind: "bottom",
    });
  });

  it("lands at the bottom when the saved row is not loaded", () => {
    expect(
      decideReadingRestore({ saved: saved({ seq: 1 }), epoch: EPOCH, items: items.slice(2) }),
    ).toEqual({ kind: "bottom" });
  });
});
