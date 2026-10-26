import type { StreamItem } from "@/types/stream";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";

/** A launch result identifies a task; only the live provider snapshot establishes liveness. */
export function shellBackgroundTaskId(detail: ToolCallDetail): string | null {
  if (detail.type !== "shell") return null;
  return (
    /^Command running in background with ID: ([\w-]+)\./m.exec(detail.output ?? "")?.[1] ?? null
  );
}

export function isShellCommandRunning(
  item: StreamItem | undefined,
  taskIds?: readonly string[],
): boolean {
  if (item?.kind !== "tool_call" || item.payload.source !== "agent") return false;
  const data = item.payload.data;
  if (data.detail.type !== "shell") return false;
  if (["running", "executing"].includes(data.status)) return true;
  const taskId = shellBackgroundTaskId(data.detail);
  return data.status === "completed" && taskId !== null && taskIds?.includes(taskId) === true;
}
