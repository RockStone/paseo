import type { ChatReadingPosition } from "@/stores/chat-read-marker-store";
import { getStreamItemMessageId, type StreamItem } from "@/types/stream";

// Paseoi: native read-position restore. The native viewport keeps a hidden chat mounted, so this
// covers a remount or a relaunch: land where the reader left, or at the bottom.

export type ReadingRestoreDecision = { kind: "bottom" } | { kind: "row"; messageId: string };

const BOTTOM: ReadingRestoreDecision = { kind: "bottom" };

function seqIn(item: StreamItem, epoch: string): number | null {
  const cursor = item.timelineCursor;
  return cursor && cursor.epoch === epoch ? cursor.seq : null;
}

export function latestLoadedSeq(items: readonly StreamItem[], epoch: string): number | null {
  let latest: number | null = null;
  for (const item of items) {
    const seq = seqIn(item, epoch);
    if (seq !== null && (latest === null || seq > latest)) latest = seq;
  }
  return latest;
}

/**
 * The reader returns to the saved row unless they were at the bottom, a message arrived while
 * they were away (the unread pill covers it), the timeline restarted, or the row is not loaded.
 */
export function decideReadingRestore(input: {
  saved: ChatReadingPosition | undefined;
  epoch: string;
  items: readonly StreamItem[];
}): ReadingRestoreDecision {
  const { saved, epoch, items } = input;
  if (!saved || saved.epoch !== epoch || saved.seq === null) return BOTTOM;
  const latestSeq = latestLoadedSeq(items, epoch);
  if (latestSeq !== null && saved.latestSeq !== null && latestSeq > saved.latestSeq) return BOTTOM;
  const row = items.find((item) => seqIn(item, epoch) === saved.seq);
  return row ? { kind: "row", messageId: getStreamItemMessageId(row) } : BOTTOM;
}
