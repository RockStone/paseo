import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  chatReadMarkerKey,
  useChatReadMarkerStore,
  useChatReadMarkerStoreHydrated,
} from "@/stores/chat-read-marker-store";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";
import { decideReadingRestore, latestLoadedSeq } from "./reading-restore";

// The position is persisted a moment after the reader stops moving, not once per row.
const SAVE_DELAY_MS = 1000;

export interface UseReadingPositionInput {
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
}

/**
 * Paseoi: saves where the reader is in a chat and, when the chat mounts again, scrolls back to it.
 * Nothing is saved before the restore decision, so the landing at the bottom that follows a
 * mount cannot overwrite the saved position.
 */
export function useReadingPosition({
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
}: UseReadingPositionInput): { reportReadingTop: (seq: number | null) => void } {
  const isHydrated = useChatReadMarkerStoreHydrated();
  const setReadingPosition = useChatReadMarkerStore((state) => state.setReadingPosition);
  const key = chatReadMarkerKey(serverId, agentId);
  const restoredKeyRef = useRef<string | null>(null);
  const readingTopSeqRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ tail, head, isNearBottom, timelineEpoch, key });
  latest.current = { tail, head, isNearBottom, timelineEpoch, key };
  const sessionKey = timelineEpoch === null ? null : `${key}|${timelineEpoch}`;

  const flush = useStableEvent(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = latest.current;
    if (!enabled || current.timelineEpoch === null || restoredKeyRef.current === null) return;
    if (restoredKeyRef.current !== `${current.key}|${current.timelineEpoch}`) return;
    if (!current.isNearBottom && readingTopSeqRef.current === null) return;
    setReadingPosition(current.key, {
      epoch: current.timelineEpoch,
      seq: current.isNearBottom ? null : readingTopSeqRef.current,
      latestSeq: latestLoadedSeq([...current.tail, ...(current.head ?? [])], current.timelineEpoch),
    });
  });

  const scheduleSave = useStableEvent(() => {
    if (saveTimerRef.current !== null) return;
    saveTimerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  });

  const isReady = enabled && isActive && isHydrated && isHistoryReady && sessionKey !== null;
  useEffect(() => {
    if (!isReady || sessionKey === null || restoredKeyRef.current === sessionKey) return;
    const epoch = latest.current.timelineEpoch;
    if (epoch === null) return;
    const items = [...tail, ...(head ?? [])];
    const decision = decideReadingRestore({
      saved: useChatReadMarkerStore.getState().positions[key],
      epoch,
      items,
    });
    if (decision.kind === "row") {
      const isMounted =
        mountedHistoryMessageIds === undefined || mountedHistoryMessageIds.has(decision.messageId);
      // Revealing mounts the row on the next render, and this effect scrolls then.
      if (!isMounted && revealLoadedMessage?.(decision.messageId)) return;
      viewportRef.current?.scrollToMessage?.(decision.messageId);
    }
    restoredKeyRef.current = sessionKey;
  }, [
    head,
    isReady,
    key,
    mountedHistoryMessageIds,
    revealLoadedMessage,
    sessionKey,
    tail,
    viewportRef,
  ]);

  // Leaving the chat, or the bottom state changing, saves without waiting for the delay.
  useEffect(() => {
    if (!isActive) flush();
  }, [flush, isActive]);
  useEffect(() => {
    scheduleSave();
  }, [isNearBottom, scheduleSave]);
  useEffect(() => flush, [flush]);

  return useMemo(
    () => ({
      reportReadingTop: (seq: number | null) => {
        if (!enabled || !isActive) return;
        readingTopSeqRef.current = seq;
        scheduleSave();
      },
    }),
    [enabled, isActive, scheduleSave],
  );
}
