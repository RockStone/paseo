import { formatDuration } from "@/utils/time";

export function getTurnFooterLabel(input: {
  durationMs?: number | null;
  timestamp: string;
  age: string;
}): string {
  const duration = input.durationMs == null ? "" : formatDuration(input.durationMs);
  const timestamp = input.timestamp
    ? `${input.timestamp}${input.age ? ` (${input.age})` : ""}`
    : "";
  return [duration, timestamp].filter(Boolean).join(" @ ");
}
