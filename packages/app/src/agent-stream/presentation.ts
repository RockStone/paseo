import { shellBackgroundTaskId } from "@/tool-calls/shell-task";
import { isTurnBoundary } from "./turn-membership";
import type { ChatDisplay } from "@/hooks/use-settings";
import type { TimelineItemTransform } from "@/plugins/timeline/model";
import { projectPluginTimelineItems } from "@/plugins/timeline/projection";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
  type ToolCallDetailProjection,
} from "@/tool-calls/detail-level/projection";
import type { StreamItem, ToolCallItem, UserMessageItem } from "@/types/stream";
import { presentAnsweredQuestion } from "./answered-question";
import { collapseTurns, type TurnCollapse } from "./turn-collapse/model";
import type { ReadingRowReplacements } from "./reading-anchor";

interface PresentationInput {
  tail: StreamItem[];
  head: StreamItem[];
  transform: TimelineItemTransform | undefined;
  display: ChatDisplay;
  autoExpandReasoning?: boolean;
  /** User messages whose collapsed turn the reader opened. */
  expandedTurnHostIds: ReadonlySet<string>;
  isTurnActive: boolean;
  backgroundTaskIds?: readonly string[];
  activeTurnId?: string | null;
}

export interface StreamPresentation extends ToolCallDetailProjection {
  turns: Omit<TurnCollapse, "tail">;
  readingRowReplacements: ReadingRowReplacements;
}

function groupedRowHosts(
  rows: readonly StreamItem[],
  groups: ToolCallDetailProjection["groupsByHostId"],
): ReadonlyMap<string, string> {
  const hosts = new Map<string, string>();
  for (const row of rows) {
    const group = groups.get(row.id);
    if (!group) continue;
    for (const call of group.run.calls) {
      if (call.id !== row.id) hosts.set(call.id, row.id);
    }
  }
  return hosts;
}

const NO_COLLAPSED_TURNS: StreamPresentation["turns"] = collapseTurns({
  tail: [],
  isLatestTurnOpen: false,
  expandedHostIds: new Set(),
  getGroupedCalls: () => undefined,
});

/** Source messages reach plugins before display projection. */
export function createStreamPresentation() {
  const userMessageCache = new WeakMap<UserMessageItem, UserMessageItem>();

  function presentUserMessage(item: UserMessageItem): UserMessageItem {
    const cached = userMessageCache.get(item);
    if (cached) return cached;

    // Recognize the complete voice envelope, including older messages without the
    // instruction suffix. Leave quoted examples and unrelated XML untouched.
    const spokenInput =
      /^\s*<spoken-input>([\s\S]*?)<\/spoken-input>(?:\s*<instruction>This message was spoken by the user\.[\s\S]*?<\/instruction>)?\s*$/.exec(
        item.text,
      );
    const projected = spokenInput ? { ...item, text: spokenInput[1].trim() } : item;
    userMessageCache.set(item, projected);
    return projected;
  }

  let historySource: StreamItem[] | undefined;
  let historyTransform: TimelineItemTransform | undefined;
  let historyRows: StreamItem[] = [];
  let preparedTail: StreamItem[] | undefined;
  let preparedAutoExpandReasoning: boolean | undefined;
  let preparedLevel: ToolCallDetailLevel | undefined;
  let preparedHistory: PreparedToolCallHistory | null = null;
  let backgroundTaskIds: readonly string[] | undefined;
  let liveBackgroundTasks = new Set<string>();
  const backgroundTaskCache = new WeakMap<ToolCallItem, ToolCallItem>();

  function presentBackgroundTask(item: StreamItem): StreamItem {
    if (item.kind !== "tool_call" || item.payload.source !== "agent") return item;
    const { data } = item.payload;
    if (data.status !== "completed" || data.detail.type !== "shell") return item;
    // Claude's launch result identifies the job whose liveness comes from the
    // provider snapshot. Never infer liveness from this historical text alone.
    const taskId = shellBackgroundTaskId(data.detail);
    if (!taskId || !liveBackgroundTasks.has(taskId)) return item;
    const cached = backgroundTaskCache.get(item);
    if (cached) return cached;
    const projected = { ...item, isBackgroundRunning: true };
    backgroundTaskCache.set(item, projected);
    return projected;
  }

  let historyGroupHosts: ReadonlyMap<string, string> = new Map();
  let collapsedSource: StreamItem[] | undefined;
  let collapsedIsLatestTurnOpen = false;
  let collapsedExpandedHostIds: ReadonlySet<string> | undefined;
  let collapsed: TurnCollapse | undefined;

  function presentRows(item: StreamItem): StreamItem[] {
    if (item.kind === "tool_call" && item.payload.source === "agent") {
      const message = item.payload.data.agentMessage;
      if (message?.event === "message") {
        return [
          {
            kind: "user_message",
            id: item.id,
            turnId: item.turnId,
            timelineCursor: item.timelineCursor,
            timestamp: item.timestamp,
            text: message.text,
            sender: message.sender,
          },
        ];
      }
    }
    if (item.kind === "tool_call") {
      const answer = presentAnsweredQuestion(item);
      if (answer) return [answer];
    }
    if (
      item.kind === "tool_call" &&
      item.payload.source === "agent" &&
      item.payload.data.metadata?.paseoiWorkspaceSnapshot === true
    )
      return [];
    if (
      item.kind === "assistant_message" &&
      item.text.length > 1000 &&
      // Restored Claude instructions can lead with either attribution or a token-budget
      // envelope; Markdown does not show the optional system-reminder wrapper.
      /^(?:<system-reminder>\s*)?(?:Attribution for git commits and pull requests|This session is being continued from a previous conversation|<total_tokens>\s*\d+\s+tokens left\s*<\/total_tokens>)/.test(
        item.text.trimStart(),
      )
    )
      return [{ ...item, isCompactionIntro: true }];
    return [item.kind === "user_message" ? presentUserMessage(item) : presentBackgroundTask(item)];
  }

  function collapse(
    projection: ToolCallDetailProjection,
    input: PresentationInput,
  ): Omit<StreamPresentation, "readingRowReplacements"> {
    if (input.display !== "collapseTurns") {
      return { ...projection, turns: NO_COLLAPSED_TURNS };
    }
    // Live text updates reach the head only, so the folded history is reused until the
    // retained rows, the latest turn's liveness, or the reader's expanded turns change.
    const isLatestTurnOpen =
      (input.isTurnActive || projection.head.length > 0) &&
      !isTurnBoundary(projection.tail.at(-1) ?? null, projection.head[0] ?? null) &&
      !(
        input.activeTurnId &&
        projection.tail.at(-1)?.turnId &&
        input.activeTurnId !== projection.tail.at(-1)?.turnId
      );
    if (
      !collapsed ||
      collapsedSource !== projection.tail ||
      collapsedIsLatestTurnOpen !== isLatestTurnOpen ||
      collapsedExpandedHostIds !== input.expandedTurnHostIds
    ) {
      collapsed = collapseTurns({
        tail: projection.tail,
        isLatestTurnOpen,
        expandedHostIds: input.expandedTurnHostIds,
        getGroupedCalls: (itemId) => projection.groupsByHostId.get(itemId)?.run.calls,
      });
      collapsedSource = projection.tail;
      collapsedIsLatestTurnOpen = isLatestTurnOpen;
      collapsedExpandedHostIds = input.expandedTurnHostIds;
    }
    const { tail, ...turns } = collapsed;
    if (turns.nestedItemIds.size === 0) return { ...projection, tail, turns };
    // Opening a turn reveals its raw calls; those rows must not become group hosts again.
    const withoutExpandedRows = (groups: StreamPresentation["groupsByHostId"]) => ({
      size: groups.size - [...turns.nestedItemIds].filter((id) => groups.has(id)).length,
      get: (id: string) => (turns.nestedItemIds.has(id) ? undefined : groups.get(id)),
      has: (id: string) => !turns.nestedItemIds.has(id) && groups.has(id),
    });
    return {
      ...projection,
      tail,
      turns,
      groupsByHostId: withoutExpandedRows(projection.groupsByHostId),
      historyGroupUpdatesByHostId: withoutExpandedRows(projection.historyGroupUpdatesByHostId),
    };
  }

  return (input: PresentationInput): StreamPresentation => {
    const level: ToolCallDetailLevel = input.display === "full" ? "detailed" : "overview";
    if (backgroundTaskIds !== input.backgroundTaskIds) {
      backgroundTaskIds = input.backgroundTaskIds;
      liveBackgroundTasks = new Set(backgroundTaskIds);
      historySource = undefined;
    }
    // Retained history is not reprojected or regrouped on each live text update.
    if (historySource !== input.tail || historyTransform !== input.transform) {
      historyRows = projectPluginTimelineItems(input.tail, input.transform).flatMap<StreamItem>(
        (item) => presentRows(item),
      );
      historySource = input.tail;
      historyTransform = input.transform;
    }
    const head: StreamItem[] = [];
    for (const item of projectPluginTimelineItems(input.head, input.transform, "streaming")) {
      const blocks = presentRows(item);
      head.push(...blocks);
    }
    if (
      preparedTail !== historyRows ||
      preparedLevel !== level ||
      preparedAutoExpandReasoning !== input.autoExpandReasoning
    ) {
      preparedHistory = prepareToolCallHistory(level, historyRows, input.autoExpandReasoning);
      historyGroupHosts = preparedHistory
        ? groupedRowHosts(preparedHistory.grouped.tail, preparedHistory.grouped.groupsByHostId)
        : new Map();
      preparedTail = historyRows;
      preparedLevel = level;
      preparedAutoExpandReasoning = input.autoExpandReasoning;
    }
    const projection = projectToolCallDetailLevel({
      level,
      tail: historyRows,
      head,
      preparedHistory,
      isTurnActive: input.isTurnActive,
    });
    const result = collapse(projection, input);
    // Only the trailing retained group can absorb head rows. Reuse the retained
    // index across streaming updates rather than walking the full history again.
    const last = projection.tail.at(-1);
    const liveGroupHosts = groupedRowHosts(
      last ? [last, ...projection.head] : projection.head,
      projection.groupsByHostId,
    );
    const retainedGroupHosts = historyGroupHosts;
    return {
      ...result,
      readingRowReplacements: {
        get(id) {
          if (result.turns.nestedItemIds.has(id)) return undefined;
          const groupHost = liveGroupHosts.get(id) ?? retainedGroupHosts.get(id) ?? id;
          return (
            result.turns.hostIdByHiddenRowId.get(id) ??
            result.turns.hostIdByHiddenRowId.get(groupHost) ??
            (groupHost === id ? undefined : groupHost)
          );
        },
      },
    };
  };
}
