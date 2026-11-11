// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import { chatReadMarkerKey, useChatReadMarkerStore } from "@/stores/chat-read-marker-store";
import type { StreamViewportHandle } from "../strategy";
import { useUnreadJump, type UseUnreadJumpInput } from "./use-unread-jump";

const visibility = vi.hoisted(() => ({ visible: true }));
const runtime = vi.hoisted(() => ({ fetchAgentTimeline: vi.fn() }));

vi.mock("@/hooks/use-app-visible", () => ({ useAppVisible: () => visibility.visible }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ fetchAgentTimeline: runtime.fetchAgentTimeline }),
}));

const EPOCH = "epoch-1";
const KEY = chatReadMarkerKey("server-1", "agent-1");
const timestamp = new Date(0);

function user(seq: number): StreamItem {
  return {
    kind: "user_message",
    id: `user-${seq}`,
    text: "prompt",
    timestamp,
    timelineCursor: { epoch: EPOCH, seq },
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

type Props = Pick<UseUnreadJumpInput, "tail" | "isActive" | "isNearBottom">;

function renderUnreadJump(initialProps: Props) {
  const scrollToMessage = vi.fn();
  const viewportRef = createRef<StreamViewportHandle>() as RefObject<StreamViewportHandle | null>;
  viewportRef.current = {
    scrollToBottom: vi.fn(),
    prepareForViewportChange: vi.fn(),
    holdRow: vi.fn(),
    scrollToMessage,
  };
  const onJumpError = vi.fn();
  const hook = renderHook(
    (props: Props) =>
      useUnreadJump({
        enabled: true,
        serverId: "server-1",
        agentId: "agent-1",
        timelineEpoch: EPOCH,
        head: [],
        isHistoryReady: true,
        viewportRef,
        onJumpError,
        ...props,
      }),
    { initialProps },
  );
  return { ...hook, scrollToMessage, onJumpError };
}

const readSeq = () => useChatReadMarkerStore.getState().markers[KEY]?.seq;

describe("useUnreadJump", () => {
  beforeEach(async () => {
    visibility.visible = true;
    runtime.fetchAgentTimeline.mockReset();
    await useChatReadMarkerStore.persist.rehydrate();
    useChatReadMarkerStore.setState({ markers: {} });
  });

  it("shows nothing on a first visit and marks a followed chat read", async () => {
    const tail = [user(1), assistant(2)];
    const { result } = renderUnreadJump({ tail, isActive: true, isNearBottom: true });
    await waitFor(() => expect(readSeq()).toBe(2));
    expect(result.current.summary).toBeNull();
  });

  it("summarizes messages that arrived while the chat was in the background", async () => {
    const read = [user(1), assistant(2)];
    const { result, rerender } = renderUnreadJump({
      tail: read,
      isActive: true,
      isNearBottom: true,
    });
    await waitFor(() => expect(readSeq()).toBe(2));

    rerender({ tail: read, isActive: false, isNearBottom: true });
    const arrived = [...read, user(3), assistant(4), user(5), assistant(6)];
    rerender({ tail: arrived, isActive: false, isNearBottom: true });
    expect(readSeq()).toBe(2);

    // The return lands at the bottom and marks everything read; the summary stays.
    rerender({ tail: arrived, isActive: true, isNearBottom: true });
    expect(result.current.summary).toEqual({
      afterSeq: 2,
      count: 4,
      countIsPartial: false,
      firstUnreadSeq: 3,
    });
    expect(readSeq()).toBe(6);

    // Scrolling up until the first unread message is on screen dismisses it.
    act(() => {
      result.current.reportReadingTop(5);
      result.current.reportReadThrough(6);
    });
    expect(result.current.summary).not.toBeNull();
    act(() => {
      result.current.reportReadingTop(2);
      result.current.reportReadThrough(4);
    });
    expect(result.current.summary).toBeNull();
  });

  it("keeps output that streamed into a hidden app unread", async () => {
    const read = [user(1), assistant(2)];
    const { result, rerender } = renderUnreadJump({
      tail: read,
      isActive: true,
      isNearBottom: true,
    });
    await waitFor(() => expect(readSeq()).toBe(2));

    visibility.visible = false;
    rerender({ tail: read, isActive: true, isNearBottom: true });
    const arrived = [...read, assistant(3)];
    rerender({ tail: arrived, isActive: true, isNearBottom: true });
    act(() => result.current.reportReadThrough(3));
    expect(readSeq()).toBe(2);

    visibility.visible = true;
    rerender({ tail: arrived, isActive: true, isNearBottom: true });
    expect(result.current.summary?.count).toBe(1);
  });

  it("restores the persisted marker when the chat mounts again", async () => {
    useChatReadMarkerStore.getState().markRead(KEY, EPOCH, 2);
    const { result } = renderUnreadJump({
      tail: [user(1), assistant(2), user(3), assistant(4)],
      isActive: true,
      isNearBottom: true,
    });
    await waitFor(() => expect(result.current.summary?.count).toBe(2));
  });

  it("ignores a marker from an earlier timeline epoch", async () => {
    useChatReadMarkerStore.getState().markRead(KEY, "epoch-0", 2);
    const { result } = renderUnreadJump({
      tail: [user(1), assistant(2), user(3)],
      isActive: true,
      isNearBottom: true,
    });
    await waitFor(() => expect(readSeq()).toBe(3));
    expect(result.current.summary).toBeNull();
  });

  it("jumps to the first unread message", async () => {
    useChatReadMarkerStore.getState().markRead(KEY, EPOCH, 2);
    const { result, scrollToMessage } = renderUnreadJump({
      tail: [user(1), assistant(2), user(3), assistant(4)],
      isActive: true,
      isNearBottom: false,
    });
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    act(() => result.current.jump());
    expect(scrollToMessage).toHaveBeenCalledWith("user-3");
    expect(result.current.summary).toBeNull();
    expect(runtime.fetchAgentTimeline).not.toHaveBeenCalled();
  });

  it("loads history around the marker before jumping when it is not loaded", async () => {
    let resolveFetch!: () => void;
    runtime.fetchAgentTimeline.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    useChatReadMarkerStore.getState().markRead(KEY, EPOCH, 10);
    const { result, rerender, scrollToMessage } = renderUnreadJump({
      tail: [user(40), assistant(41)],
      isActive: true,
      isNearBottom: false,
    });
    await waitFor(() => expect(result.current.summary?.countIsPartial).toBe(true));
    act(() => result.current.jump());
    expect(runtime.fetchAgentTimeline).toHaveBeenCalledWith(
      "server-1",
      "agent-1",
      expect.objectContaining({ direction: "before" }),
    );
    expect(scrollToMessage).not.toHaveBeenCalled();

    rerender({
      tail: [assistant(10), user(11), assistant(12), user(40), assistant(41)],
      isActive: true,
      isNearBottom: false,
    });
    expect(scrollToMessage).toHaveBeenCalledWith("user-11");
    await act(async () => resolveFetch());
    expect(scrollToMessage).toHaveBeenCalledTimes(1);
  });
});
