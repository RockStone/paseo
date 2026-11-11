export type TextSegment =
  | { kind: "text"; text: string; start: number }
  | { kind: "link"; text: string; url: string; start: number }
  | { kind: "path"; text: string; path: string; line?: number; start: number };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
// Punctuation that usually ends a sentence rather than a URL.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/**
 * A workspace-relative file path: either slash-separated with a file extension or a trailing
 * slash (`docs/owner-todo.md`, `packages/app/`), or a bare file name with a common extension
 * (`README.md`). An optional `:line` suffix follows. Absolute and home paths are left as text: they
 * may sit outside the workspace.
 */
const PATH_PATTERN =
  /(?<![\w/.~@:-])(?:\.{1,2}\/)?(?:[\w@-][\w.@-]*\/)+(?:[\w@-][\w.@-]*\.[A-Za-z0-9]{1,8})?(?::\d+)?(?![\w/])|(?<![\w/.~@:-])[\w-][\w.-]*\.(?:md|mdx|ts|tsx|js|mjs|cjs|json|jsonl|sh|py|yml|yaml|toml|txt|swift|kt|go|rs|css|html|sql|png|jpg|jpeg|gif|svg|webp)(?::\d+)?(?![\w/])/g;

function splitPaths(text: string, offset: number): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(PATH_PATTERN)) {
    const start = match.index ?? 0;
    const token = match[0].replace(/\.+$/, "");
    // A path needs a file extension or a trailing slash, so "and/or" stays text.
    const last = token.replace(/:\d+$/, "").split("/").pop() ?? "";
    if (!token.replace(/:\d+$/, "").endsWith("/") && !/\.[A-Za-z0-9]+$/.test(last)) continue;
    const line = /:(\d+)$/.exec(token)?.[1];
    const path = token.replace(/:\d+$/, "");
    if (start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, start), start: offset + cursor });
    }
    segments.push({
      kind: "path",
      text: token,
      path,
      ...(line ? { line: Number(line) } : {}),
      start: offset + start,
    });
    cursor = start + token.length;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor), start: offset + cursor });
  }
  return segments;
}

/** Splits text into plain runs, http(s) links and workspace file paths so each can be tapped. */
export function splitLinksAndPaths(text: string): TextSegment[] {
  return splitLinks(text).flatMap((segment) =>
    segment.kind === "text" ? splitPaths(segment.text, segment.start) : [segment],
  );
}

/** Splits text into plain runs and http(s) links so each link can be tapped. */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trailing = TRAILING_PUNCTUATION.exec(url)?.[0] ?? "";
    // Keep a closing parenthesis that balances one inside the URL, as in Wikipedia links.
    const keepParen = trailing.startsWith(")") && url.slice(0, -trailing.length).includes("(");
    const cut = keepParen ? trailing.length - 1 : trailing.length;
    if (cut > 0) url = url.slice(0, -cut);
    if (start > cursor)
      segments.push({ kind: "text", text: text.slice(cursor, start), start: cursor });
    segments.push({ kind: "link", text: url, url, start });
    cursor = start + url.length;
  }
  if (cursor < text.length)
    segments.push({ kind: "text", text: text.slice(cursor), start: cursor });
  return segments;
}

/** Short relative time such as "just now", "5m ago", "3h ago", "2d ago", or a date. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const time = then.getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - time) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toISOString().slice(0, 10);
}
