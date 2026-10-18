import type { AgentAttachment, AgentProfile } from "@getpaseo/protocol/messages";
import type { AgentProfileComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import type { FileMentionRange } from "@/utils/file-mention-autocomplete";

export function findActiveProfileMention(input: {
  text: string;
  cursorIndex: number;
}): FileMentionRange | null {
  const end = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, end);
  const start = beforeCursor.lastIndexOf("@@");
  if (start < 0) return null;
  if (start > 0 && /[\w+@]/.test(beforeCursor[start - 1]!)) return null;
  const query = beforeCursor.slice(start + 2);
  if (/[\s"'<>@]/.test(query)) return null;
  return { start, end, query };
}

export function filterProfileReferences(
  profiles: readonly AgentProfile[],
  query: string,
): AgentProfile[] {
  const needle = query.toLocaleLowerCase();
  return profiles.filter((profile) =>
    [profile.name, profile.provider, profile.model, profile.notes].some((value) =>
      value?.toLocaleLowerCase().includes(needle),
    ),
  );
}

export function appendProfileReference(
  current: UserComposerAttachment[],
  attachment: AgentProfileComposerAttachment,
): UserComposerAttachment[] {
  const index = current.findIndex(
    (item) =>
      item.kind === "agent_profile" &&
      item.serverId === attachment.serverId &&
      item.profile.id === attachment.profile.id,
  );
  if (index === -1) return [...current, attachment];
  return current.map((item, itemIndex) => (itemIndex === index ? attachment : item));
}

export function profileReferenceToAgentAttachment(
  attachment: AgentProfileComposerAttachment,
): Extract<AgentAttachment, { type: "text" }> {
  const { profile, serverId } = attachment;
  const { provider, model, modeId, thinkingOptionId, featureValues } = profile;
  const config = { provider, model, modeId, thinkingOptionId, featureValues };
  return {
    type: "text",
    title: `Agent profile · ${profile.name}`,
    mimeType: "text/plain",
    text: [
      `Referenced Paseo agent profile: ${profile.name}`,
      `Profile ID: ${profile.id}`,
      `Host ID: ${serverId}`,
      "This is a snapshot selected by the user for delegation. When the user requests subagent work with this profile, keep the current agent as coordinator and use these launch settings with Paseo create_agent. There is no profile parameter. For the current create_agent tool, combine provider and model as provider/model; put modeId and thinkingOptionId under settings, and map featureValues to settings.features. Read the available tool schema before calling it. If this profile omits a model, resolve an available model with inspect_provider rather than inventing one. Do not change the current agent's settings. Resolve this host before creating the subagent; do not silently use another host.",
      "Apply the profile notes to the task instructions and workspace/worktree choice. A reference alone does not request launching an agent.",
      `Launch settings:\n${JSON.stringify(config, null, 2)}`,
      `Profile notes:\n${profile.notes ?? "(none)"}`,
    ].join("\n\n"),
  };
}
