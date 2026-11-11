import { createHash } from "node:crypto";
const header =
  /^  > Owner reply \((\d{4}-\d{2}-\d{2})(?: ((?:[01]\d|2[0-3]):[0-5]\d)(?: UTC)?)?\): (.*)$/;
export const replyStamp = () => new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
export function normalizeReply(text) {
  if (!text.trim() || text.length > 4000 || text.includes("\0"))
    throw new Error("Reply must contain text, at most 4000 characters, without NUL");
  return text.replace(/\r\n|\r|\u2028|\u2029/g, "\n");
}
export function readReply(lines, line) {
  const match = lines[line].match(header);
  if (!match) return null;
  const text = [match[3]];
  let lastLine = line;
  while (lastLine + 1 < lines.length) {
    const continuation = lines[lastLine + 1].match(/^  > \| (.*)$/);
    if (!continuation) break;
    text.push(continuation[1]);
    lastLine++;
  }
  const hash = createHash("sha256")
    .update(lines.slice(line, lastLine + 1).join("\n"))
    .digest("hex")
    .slice(0, 24);
  return {
    id: `reply-${hash}`,
    date: match[1],
    time: match[2] ?? null,
    text: text.join("\n"),
    line,
    lastLine,
    stamp:
      match[1] + (match[2] ? ` ${match[2]}${lines[line].includes(" UTC): ") ? " UTC" : ""}` : ""),
  };
}
export function encodeReply(text, stamp, eol) {
  if (!/^\d{4}-\d{2}-\d{2}(?: (?:[01]\d|2[0-3]):[0-5]\d(?: UTC)?)?$/.test(stamp))
    throw new Error("Invalid reply timestamp");
  const [first, ...rest] = normalizeReply(text).split("\n");
  return [`  > Owner reply (${stamp}): ${first}`, ...rest.map((line) => `  > | ${line}`)].join(eol);
}
export function sortReplies(a, b) {
  const timeA = `${a.date} ${a.time ?? "00:00"}`,
    timeB = `${b.date} ${b.time ?? "00:00"}`;
  // Writers insert newest first. For minute/date-only ties, reverse that file order.
  return timeA.localeCompare(timeB) || b.line - a.line;
}
