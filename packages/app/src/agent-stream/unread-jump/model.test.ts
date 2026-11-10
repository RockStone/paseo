import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  findFirstMessageAfter,
  hasReachedUnreadTarget,
  latestSeqIn,
  resolveUnreadTargetSeq,
  summarizeUnread,
} from "./model";

const EPOCH = "epoch-1";
const timestamp = new Date(0);

function user(seq: number | null, epoch = EPOCH): StreamItem {
  return {
    kind: "user_message",
    id: `user-${seq}`,
    text: "prompt",
    timestamp,
    ...(seq === null ? {} : { timelineCursor: { epoch, seq } }),
  };
}

function assistant(seq: number): StreamItem {
  return {
    kind: "assistant_message",
    id: `assistant-${seq}`,
    text: "reply",
    timestamp,
    timelineCursor: { epoch: EPOCH, seq },
  };
}

function thought(seq: number): StreamItem {
  return {
    kind: "thought",
    id: `thought-${seq}`,
    text: "thinking",
    timestamp,
    status: "ready",
    timelineCursor: { epoch: EPOCH, seq },
  };
}

describe("summarizeUnread", () => {
  it("counts only messages after the marker and points at the first one", () => {
    const items = [user(1), assistant(2), user(3), thought(4), assistant(5), user(6)];
    expect(summarizeUnread(items, EPOCH, 2)).toEqual({
      afterSeq: 2,
      count: 3,
      countIsPartial: false,
      firstUnreadSeq: 3,
    });
  });

  it("skips rows between the marker and the first unread message", () => {
    const items = [assistant(2), thought(3), thought(4), assistant(5)];
    expect(summarizeUnread(items, EPOCH, 2)?.firstUnreadSeq).toBe(5);
  });

  it("finds nothing when only tool rows or no rows follow the marker", () => {
    expect(summarizeUnread([assistant(2), thought(3)], EPOCH, 2)).toBeNull();
    expect(summarizeUnread([user(1), assistant(2)], EPOCH, 2)).toBeNull();
  });

  it("marks the count partial when the loaded rows start after the marker", () => {
    const summary = summarizeUnread([user(40), assistant(41)], EPOCH, 10);
    expect(summary).toEqual({ afterSeq: 10, count: 2, countIsPartial: true, firstUnreadSeq: null });
    expect(summary && resolveUnreadTargetSeq(summary)).toBe(11);
  });

  it("ignores rows from another epoch and rows without a timeline position", () => {
    expect(summarizeUnread([assistant(2), user(3, "epoch-0"), user(null)], EPOCH, 2)).toBeNull();
  });
});

describe("latestSeqIn", () => {
  it("returns the highest seq in the epoch", () => {
    expect(latestSeqIn([user(3), assistant(7), user(9, "epoch-0"), user(null)], EPOCH)).toBe(7);
    expect(latestSeqIn([], EPOCH)).toBeNull();
  });
});

describe("findFirstMessageAfter", () => {
  it("returns the first message after the marker when the marker row is loaded", () => {
    const items = [assistant(2), thought(3), user(4), assistant(5)];
    expect(findFirstMessageAfter(items, EPOCH, 2, false)?.id).toBe("user-4");
  });

  it("waits for history covering the marker before accepting a later message", () => {
    const items = [user(40), assistant(41)];
    expect(findFirstMessageAfter(items, EPOCH, 10, false)).toBeNull();
    expect(findFirstMessageAfter(items, EPOCH, 10, true)?.id).toBe("user-40");
  });
});

describe("hasReachedUnreadTarget", () => {
  it("is reached once the target is on screen", () => {
    expect(hasReachedUnreadTarget({ targetSeq: 5, topSeq: 3, readThroughSeq: 6 })).toBe(true);
    expect(hasReachedUnreadTarget({ targetSeq: 5, topSeq: 5, readThroughSeq: null })).toBe(true);
  });

  it("is not reached while the target is below or above the viewport", () => {
    // Below: the restored offset of a return, before it lands at the bottom.
    expect(hasReachedUnreadTarget({ targetSeq: 5, topSeq: 2, readThroughSeq: 4 })).toBe(false);
    // Above: the landing at the bottom.
    expect(hasReachedUnreadTarget({ targetSeq: 5, topSeq: 8, readThroughSeq: 9 })).toBe(false);
    expect(hasReachedUnreadTarget({ targetSeq: 5, topSeq: null, readThroughSeq: 9 })).toBe(false);
  });
});
