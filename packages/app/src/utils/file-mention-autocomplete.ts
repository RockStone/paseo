export interface FileMentionRange {
  start: number;
  end: number;
  query: string;
}

interface FindActiveFileMentionInput {
  text: string;
  cursorIndex: number;
}

interface ApplyFileMentionReplacementInput {
  text: string;
  mention: FileMentionRange;
  relativePath: string;
}

const INVALID_MENTION_QUERY_CHARS = /[\s\n\r\t"'<>]/;

export function findActiveFileMention(input: FindActiveFileMentionInput): FileMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);

  for (
    let atIndex = beforeCursor.lastIndexOf("@");
    atIndex >= 0;
    atIndex = atIndex === 0 ? -1 : beforeCursor.lastIndexOf("@", atIndex - 1)
  ) {
    if (beforeCursor[atIndex - 1] === "@" || beforeCursor[atIndex + 1] === "@") continue;
    // Skip @ that looks like part of an email address (local-part char immediately before @).
    if (atIndex > 0 && /[\w+]/.test(beforeCursor[atIndex - 1]!)) {
      continue;
    }

    const query = beforeCursor.slice(atIndex + 1);
    if (beforeCursor[atIndex - 1] === "[" && query.includes("](")) continue;
    if (INVALID_MENTION_QUERY_CHARS.test(query)) {
      continue;
    }
    return {
      start: atIndex,
      end: clampedCursor,
      query,
    };
  }

  return null;
}

export function formatFileMentionPath(relativePath: string): string {
  const label = `@${relativePath}`.replace(/[\\[\]]/g, "\\$&");
  const target = relativePath
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(
        /[()]/g,
        (character) => `%${character.charCodeAt(0).toString(16)}`,
      ),
    )
    .join("/");
  return `[${label}](${target})`;
}

export function applyFileMentionReplacement(input: ApplyFileMentionReplacementInput): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}${formatFileMentionPath(input.relativePath)}${after.startsWith(" ") ? "" : " "}${after}`;
}
