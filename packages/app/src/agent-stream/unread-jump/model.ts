import type { StreamItem } from "@/types/stream";

/** What a return to a chat found after the reader's read marker. */
export interface UnreadSummary {
  /** The read marker's timeline seq: the last row the reader saw whole. */
  afterSeq: number;
  /** Messages after the marker among the loaded rows. */
  count: number;
  /** The loaded rows start after the marker, so older unread messages are not counted. */
  countIsPartial: boolean;
  /** The first loaded message after the marker, or null when the loaded rows start after it. */
  firstUnreadSeq: number | null;
}

/** Where the pill is done: the first unread message, or the row right after the marker. */
export function resolveUnreadTargetSeq(summary: UnreadSummary): number {
  return summary.firstUnreadSeq ?? summary.afterSeq + 1;
}

// Tool calls, thoughts and notifications sit inside a turn. Counting them would turn one
// reply into "20 new messages".
function countsAsMessage(item: StreamItem): boolean {
  return item.kind === "user_message" || item.kind === "assistant_message";
}

function seqIn(item: StreamItem, epoch: string): number | null {
  const cursor = item.timelineCursor;
  return cursor && cursor.epoch === epoch ? cursor.seq : null;
}

export function summarizeUnread(
  items: readonly StreamItem[],
  epoch: string,
  readSeq: number,
): UnreadSummary | null {
  let count = 0;
  let firstUnreadSeq: number | null = null;
  let coversMarker = false;
  for (const item of items) {
    const seq = seqIn(item, epoch);
    if (seq === null) continue;
    if (seq <= readSeq) {
      coversMarker = true;
      continue;
    }
    if (!countsAsMessage(item)) continue;
    count += 1;
    if (firstUnreadSeq === null || seq < firstUnreadSeq) firstUnreadSeq = seq;
  }
  if (count === 0) return null;
  return {
    afterSeq: readSeq,
    count,
    countIsPartial: !coversMarker,
    firstUnreadSeq: coversMarker ? firstUnreadSeq : null,
  };
}

export function latestSeqIn(items: readonly StreamItem[], epoch: string): number | null {
  let latest: number | null = null;
  for (const item of items) {
    const seq = seqIn(item, epoch);
    if (seq !== null && (latest === null || seq > latest)) latest = seq;
  }
  return latest;
}

/**
 * The first loaded message after `afterSeq`. Without a loaded row at or before `afterSeq` the
 * loaded rows may start past older unread rows, so this waits for the fetched window unless
 * `acceptUncovered` says the fetch already settled.
 */
export function findFirstMessageAfter(
  items: readonly StreamItem[],
  epoch: string,
  afterSeq: number,
  acceptUncovered: boolean,
): StreamItem | null {
  let first: StreamItem | null = null;
  let firstSeq = Number.POSITIVE_INFINITY;
  let covered = false;
  for (const item of items) {
    const seq = seqIn(item, epoch);
    if (seq === null) continue;
    if (seq <= afterSeq) {
      covered = true;
    } else if (countsAsMessage(item) && seq < firstSeq) {
      first = item;
      firstSeq = seq;
    }
  }
  return covered || acceptUncovered ? first : null;
}

/**
 * Whether the reader reached the first unread row: it is on screen, or the top of the viewport
 * is at or above it. The reader lands at the bottom, so getting there means scrolling past it.
 */
export function hasReachedUnreadTarget(input: {
  targetSeq: number;
  topSeq: number | null;
  readThroughSeq: number | null;
}): boolean {
  const { targetSeq, topSeq, readThroughSeq } = input;
  if (topSeq === null || topSeq > targetSeq) return false;
  return topSeq === targetSeq || (readThroughSeq !== null && readThroughSeq >= targetSeq);
}
