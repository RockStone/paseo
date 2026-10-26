import { shellBackgroundTaskId } from "@/tool-calls/shell-task";
import type { TimelineItemTransform } from "@/plugins/timeline/model";
import { projectPluginTimelineItems } from "@/plugins/timeline/projection";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
} from "@/tool-calls/detail-level/projection";
import type { StreamItem, ToolCallItem, UserMessageItem } from "@/types/stream";
import { presentAnsweredQuestion } from "./answered-question";

interface PresentationInput {
  tail: StreamItem[];
  head: StreamItem[];
  transform: TimelineItemTransform | undefined;
  level: ToolCallDetailLevel;
  isTurnActive: boolean;
  backgroundTaskIds?: readonly string[];
}

/** Find and scrolling address a plugin row by the source it replaces. */
export function getStreamItemMessageId(item: StreamItem): string {
  if (item.kind === "plugin") return item.sourceId ?? item.id;
  return item.id;
}

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

  function presentRows(item: StreamItem): StreamItem[] {
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

  return (input: PresentationInput) => {
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
    if (preparedTail !== historyRows || preparedLevel !== input.level) {
      preparedHistory = prepareToolCallHistory(input.level, historyRows);
      preparedTail = historyRows;
      preparedLevel = input.level;
    }
    return projectToolCallDetailLevel({
      level: input.level,
      tail: historyRows,
      head,
      preparedHistory,
      isTurnActive: input.isTurnActive,
    });
  };
}
