import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useStableEvent } from "@/hooks/use-stable-event";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  chatReadMarkerKey,
  useChatReadMarkerStore,
  useChatReadMarkerStoreHydrated,
} from "@/stores/chat-read-marker-store";
import { planTimelinePromptJump } from "@/timeline/timeline-sync-plan";
import { getStreamItemMessageId, type StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";
import {
  findFirstMessageAfter,
  hasReachedUnreadTarget,
  latestSeqIn,
  resolveUnreadTargetSeq,
  summarizeUnread,
  type UnreadSummary,
} from "./model";

const NO_STREAM_ITEMS: StreamItem[] = [];

// Joined on demand: the head changes per streamed delta, and only a return or a jump reads both.
function joinLoaded(tail: StreamItem[], head: StreamItem[]): StreamItem[] {
  return [...tail, ...head];
}

interface PendingUnreadJump {
  requestId: number;
  afterSeq: number;
  fetchSettled: boolean;
}

export interface UseUnreadJumpInput {
  enabled: boolean;
  serverId: string;
  agentId: string;
  timelineEpoch: string | null;
  tail: StreamItem[];
  head: StreamItem[] | undefined;
  isActive: boolean;
  isNearBottom: boolean;
  isHistoryReady: boolean;
  viewportRef: RefObject<StreamViewportHandle | null>;
  mountedHistoryMessageIds?: ReadonlySet<string>;
  revealLoadedMessage?: (messageId: string) => boolean;
  onJumpError: () => void;
}

export interface UnreadJump {
  /** What the latest return found after the read marker, until the reader reaches it. */
  summary: UnreadSummary | null;
  jump: () => void;
  /** Timeline seq of the row under the top of the viewport. */
  reportReadingTop: (seq: number | null) => void;
  /** Timeline seq of the last row the reader has seen whole. */
  reportReadThrough: (seq: number | null) => void;
}

/**
 * Keeps a per-chat read marker and, on each return to the chat, the unread rows after it.
 * A return is the chat panel becoming active with the app visible. The marker only advances
 * while the reader is attending, so output that streamed into a hidden or background chat
 * stays unread.
 */
export function useUnreadJump({
  enabled,
  serverId,
  agentId,
  timelineEpoch,
  tail,
  head,
  isActive,
  isNearBottom,
  isHistoryReady,
  viewportRef,
  mountedHistoryMessageIds,
  revealLoadedMessage,
  onJumpError,
}: UseUnreadJumpInput): UnreadJump {
  const isAppVisible = useAppVisible();
  const isHydrated = useChatReadMarkerStoreHydrated();
  const markRead = useChatReadMarkerStore((state) => state.markRead);
  const [summary, setSummary] = useState<UnreadSummary | null>(null);
  const [pendingJump, setPendingJump] = useState<PendingUnreadJump | null>(null);
  const attendingRef = useRef(false);
  const sessionKeyRef = useRef<string | null>(null);
  const readingTopSeqRef = useRef<number | null>(null);
  const nextJumpRequestIdRef = useRef(0);
  const markerKey = chatReadMarkerKey(serverId, agentId);
  const loadedTail = enabled ? tail : NO_STREAM_ITEMS;
  const loadedHead = enabled ? (head ?? NO_STREAM_ITEMS) : NO_STREAM_ITEMS;
  const epoch = timelineEpoch;
  const isAttending =
    enabled && isActive && isAppVisible && isHistoryReady && isHydrated && epoch !== null;

  // Only the head changes per streamed delta, so the tail's latest seq is memoized.
  const tailLatestSeq = useMemo(
    () => (epoch === null ? null : latestSeqIn(loadedTail, epoch)),
    [loadedTail, epoch],
  );

  // A layout effect, so the snapshot precedes the scroll events of the return's own landing.
  // Reports that arrive before it belong to the restored offset and are dropped.
  useLayoutEffect(() => {
    const sessionKey = `${markerKey}|${epoch ?? ""}`;
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      attendingRef.current = false;
      setSummary(null);
      setPendingJump(null);
    }
    if (!isAttending || epoch === null) {
      attendingRef.current = false;
      return;
    }
    if (!attendingRef.current) {
      attendingRef.current = true;
      readingTopSeqRef.current = null;
      const marker = useChatReadMarkerStore.getState().markers[markerKey];
      setSummary(
        marker && marker.epoch === epoch
          ? summarizeUnread(joinLoaded(loadedTail, loadedHead), epoch, marker.seq)
          : null,
      );
    }
    if (!isNearBottom) return;
    const headLatestSeq = latestSeqIn(loadedHead, epoch);
    if (tailLatestSeq !== null) markRead(markerKey, epoch, tailLatestSeq);
    if (headLatestSeq !== null) markRead(markerKey, epoch, headLatestSeq);
  }, [
    epoch,
    isAttending,
    isNearBottom,
    loadedTail,
    loadedHead,
    markRead,
    markerKey,
    tailLatestSeq,
  ]);

  const reportReadingTop = useStableEvent((seq: number | null) => {
    if (!attendingRef.current) return;
    readingTopSeqRef.current = seq;
  });

  const reportReadThrough = useStableEvent((seq: number | null) => {
    if (!attendingRef.current || epoch === null) return;
    if (seq !== null) markRead(markerKey, epoch, seq);
    if (
      summary &&
      hasReachedUnreadTarget({
        targetSeq: resolveUnreadTargetSeq(summary),
        topSeq: readingTopSeqRef.current,
        readThroughSeq: seq,
      })
    ) {
      setSummary(null);
    }
  });

  useEffect(() => {
    if (pendingJump === null || epoch === null) return;
    const target = findFirstMessageAfter(
      joinLoaded(loadedTail, loadedHead),
      epoch,
      pendingJump.afterSeq,
      pendingJump.fetchSettled,
    );
    if (!target) {
      if (pendingJump.fetchSettled) setPendingJump(null);
      return;
    }
    const messageId = getStreamItemMessageId(target);
    const isMounted =
      mountedHistoryMessageIds === undefined ||
      mountedHistoryMessageIds.has(messageId) ||
      loadedHead.includes(target);
    // Revealing mounts it on the next render, and this effect scrolls then.
    if (!isMounted && revealLoadedMessage?.(messageId)) return;
    viewportRef.current?.scrollToMessage?.(messageId);
    setPendingJump(null);
  }, [
    epoch,
    loadedTail,
    loadedHead,
    mountedHistoryMessageIds,
    pendingJump,
    revealLoadedMessage,
    viewportRef,
  ]);

  const jump = useStableEvent(() => {
    if (!summary || epoch === null) return;
    const afterSeq = summary.afterSeq;
    setSummary(null);
    nextJumpRequestIdRef.current += 1;
    const requestId = nextJumpRequestIdRef.current;
    const isCovered =
      findFirstMessageAfter(joinLoaded(loadedTail, loadedHead), epoch, afterSeq, false) !== null;
    setPendingJump({ requestId, afterSeq, fetchSettled: isCovered });
    if (isCovered) return;
    void getHostRuntimeStore()
      .fetchAgentTimeline(serverId, agentId, planTimelinePromptJump({ epoch, seq: afterSeq + 1 }))
      .catch((error: unknown) => {
        console.warn("Failed to load the first unread message", error);
        onJumpError();
      })
      .finally(() => {
        setPendingJump((current) =>
          current?.requestId === requestId ? { ...current, fetchSettled: true } : current,
        );
      });
  });

  return { summary, jump, reportReadingTop, reportReadThrough };
}
