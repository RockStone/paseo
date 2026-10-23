import { parseQuestionFormQuestions } from "@/components/question-form-card-core";
import type { ToolCallItem, UserMessageItem } from "@/types/stream";
import { normalizeToolName } from "@getpaseo/protocol/tool-name-normalization";

const ANSWER_ENVELOPES = [
  {
    prefix: "The user answered: ",
    suffix:
      ". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.",
  },
  {
    prefix: "User has answered your questions: ",
    suffix: ". You can now continue with the user's answers in mind.",
  },
];

function answeredQuestionText(input: unknown, output: unknown): string | null {
  const questions = parseQuestionFormQuestions(input);
  if (!questions || typeof output !== "object" || output === null || !("output" in output))
    return null;
  const text = output.output;
  if (typeof text !== "string") return null;
  const envelope = ANSWER_ENVELOPES.find(
    ({ prefix, suffix }) => text.startsWith(prefix) && text.endsWith(suffix),
  );
  if (!envelope) return null;
  let remaining = text.slice(envelope.prefix.length, -envelope.suffix.length);
  const blocks: string[] = [];
  for (const [index, question] of questions.entries()) {
    const marker = `"${question.question}"="`;
    if (!remaining.startsWith(marker)) return null;
    remaining = remaining.slice(marker.length);
    const nextQuestion = questions[index + 1];
    // Claude's answer envelope does not escape quotes in questions or free text.
    // Match the known next question rather than splitting on arbitrary quote pairs.
    const boundary = nextQuestion ? `", "${nextQuestion.question}"="` : '"';
    const end = nextQuestion ? remaining.indexOf(boundary) : remaining.length - 1;
    if (end < 0 || !remaining.slice(end).startsWith(boundary)) return null;
    const answer = remaining.slice(0, end);
    if (!answer.trim()) return null;
    const quote = question.question
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    blocks.push(`${quote}\n\n${answer}`);
    remaining = remaining.slice(end + (nextQuestion ? '", '.length : 1));
  }
  if (remaining.length > 0) return null;
  return blocks.join("\n\n");
}

export function presentAnsweredQuestion(item: ToolCallItem): UserMessageItem | null {
  if (item.payload.source !== "agent") return null;
  const { data } = item.payload;
  if (data.detail.type !== "unknown") return null;
  const isAnsweredQuestion =
    normalizeToolName(data.name) === "askuserquestion" &&
    data.status === "completed" &&
    !data.error;
  if (!isAnsweredQuestion) return null;
  const text = answeredQuestionText(data.detail.input, data.detail.output);
  if (!text) return null;
  // Keep the tool's turn; Rewind requires the identity of a real provider prompt.
  return {
    kind: "user_message",
    id: item.id,
    timestamp: item.timestamp,
    turnId: item.turnId,
    timelineCursor: item.timelineCursor,
    text,
  };
}
