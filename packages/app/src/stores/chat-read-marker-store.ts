import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const CHAT_READ_MARKER_STORAGE_KEY = "chat-read-markers";
const CHAT_READ_MARKER_STORE_VERSION = 1;
// One marker per agent chat ever opened. Old ones only matter for chats you reopen, so the
// least recently read go first.
const MAX_CHAT_READ_MARKERS = 500;

const ChatReadMarkerSchema = z.object({
  epoch: z.string(),
  seq: z.number().int(),
  readAt: z.number(),
});

const ChatReadMarkerPersistedStateSchema = z.object({
  markers: z.record(z.string(), ChatReadMarkerSchema),
});

export type ChatReadMarker = z.infer<typeof ChatReadMarkerSchema>;
type ChatReadMarkerPersistedState = z.infer<typeof ChatReadMarkerPersistedStateSchema>;

interface ChatReadMarkerStoreState extends ChatReadMarkerPersistedState {
  markRead: (key: string, epoch: string, seq: number, now?: number) => void;
}

export function chatReadMarkerKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

export function pruneChatReadMarkers(
  markers: Record<string, ChatReadMarker>,
  limit: number = MAX_CHAT_READ_MARKERS,
): Record<string, ChatReadMarker> {
  const entries = Object.entries(markers);
  if (entries.length <= limit) return markers;
  entries.sort(([, a], [, b]) => b.readAt - a.readAt);
  return Object.fromEntries(entries.slice(0, limit));
}

export const useChatReadMarkerStore = create<ChatReadMarkerStoreState>()(
  persist(
    (set) => ({
      markers: {},
      // The marker only moves forward within a timeline epoch. A new epoch restarts the
      // timeline's seqs, so its first read replaces the old marker.
      markRead: (key, epoch, seq, now = Date.now()) =>
        set((state) => {
          const existing = state.markers[key];
          if (existing && existing.epoch === epoch && existing.seq >= seq) return state;
          return {
            markers: pruneChatReadMarkers({
              ...state.markers,
              [key]: { epoch, seq, readAt: now },
            }),
          };
        }),
    }),
    {
      name: CHAT_READ_MARKER_STORAGE_KEY,
      version: CHAT_READ_MARKER_STORE_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, ChatReadMarkerPersistedStateSchema),
      partialize: (state) => ({ markers: state.markers }),
    },
  ),
);

export function useChatReadMarkerStoreHydrated(): boolean {
  const [hasHydrated, setHasHydrated] = useState(() =>
    useChatReadMarkerStore.persist.hasHydrated(),
  );
  useEffect(() => {
    if (useChatReadMarkerStore.persist.hasHydrated()) {
      setHasHydrated(true);
      return;
    }
    return useChatReadMarkerStore.persist.onFinishHydration(() => setHasHydrated(true));
  }, []);
  return hasHydrated;
}
