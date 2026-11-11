import type { TrackerItem } from "./board";

const DAY_MS = 24 * 60 * 60 * 1000;

function replyTime(reply: { date: string; time: string | null }): number {
  return Date.parse(`${reply.date}T${reply.time ?? "00:00"}:00Z`);
}

/** First sight of a project: replies older than a day count as handled, so nothing floods. */
export function notifiedBaseline(owners: readonly TrackerItem[], now: number): string[] {
  return owners.flatMap((item) =>
    item.replies.filter((reply) => now - replyTime(reply) >= DAY_MS).map((reply) => reply.id),
  );
}

/** Replies the agent has not heard about yet, on valid owner items. */
export function pendingReplyIds(owners: readonly TrackerItem[], notified: readonly string[]) {
  const sent = new Set(notified);
  return owners
    .filter((item) => item.warnings.length === 0)
    .flatMap((item) =>
      item.replies.filter((reply) => !sent.has(reply.id)).map((reply) => reply.id),
    );
}

/** The prompt sent to the agent: each item's new replies, in board order. */
export function notificationText(items: readonly TrackerItem[], replyIds: readonly string[]) {
  const requested = new Set(replyIds);
  const sections = items.flatMap((item) => {
    const replies = item.replies.filter((reply) => requested.has(reply.id));
    if (replies.length === 0) return [];
    const quoted = replies.map((reply) => {
      const at = reply.date + (reply.time ? ` ${reply.time} UTC` : "");
      return `${at}\n${reply.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}`;
    });
    return [`${item.id} — ${item.title}\n${quoted.join("\n\n")}`];
  });
  const ids = items.filter((item) => item.replies.some((reply) => requested.has(reply.id)));
  return `Owner replied on ${ids.map((item) => item.id).join(", ")}. Read docs/owner-todo.md for full context.\n\n${sections.join("\n\n")}`;
}
