import { createHash } from "node:crypto";
import { readReply, sortReplies } from "./replies.mjs";
const clean = (text) =>
  text
    .replace(/<!--\s*priority:[\s\S]*?-->/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|`/g, "")
    .trim();

// Preserve body emphasis as plain, structured text for native rendering.
export function parseDetailBlocks(source) {
  const blocks = [];
  let cursor = 0;
  const add = (text, bold) => {
    const value = clean(text);
    if (value) blocks.push({ text: value, bold });
  };
  for (const match of source.matchAll(/`[^`]*`|\*\*([\s\S]+?)\*\*/g)) {
    if (match[1] === undefined) continue;
    const before = source.slice(cursor, match.index);
    const bullet = before.match(/(?:^|\n)([ \t]*(?:[-*+]|\d+\.)[ \t]+)$/)?.[1] ?? "";
    add(bullet ? before.slice(0, -bullet.length) : before, false);
    add(bullet + match[1], true);
    cursor = match.index + match[0].length;
  }
  add(source.slice(cursor), false);
  return blocks;
}

/** Top-level checkboxes own subsequent blank/indented lines, up to the next block. */
export function parse(text, owner = false) {
  const items = [],
    lines = text.split(/\r?\n/);
  let section = "";
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line];
    if (/^#{1,6} /.test(raw)) section = raw.replace(/^#+ /, "");
    if (!/^- \[/.test(raw)) continue;
    const first = line,
      match = raw.match(/^- \[([ ~x])\] (.*)$/),
      body = match?.[2] ?? raw.replace(/^- \[[^\]]*\]\s*/, ""),
      details = [],
      replies = [];
    while (line + 1 < lines.length && (!lines[line + 1].trim() || /^[ \t]/.test(lines[line + 1]))) {
      line++;
      const reply = owner ? readReply(lines, line) : null;
      if (reply) {
        const duplicates = replies.filter((r) => r.id.startsWith(reply.id + "-")).length;
        reply.id += `-${duplicates}`;
        replies.push(reply);
        line = reply.lastLine;
      } else details.push(lines[line].replace(/^ {2}|^\t/, ""));
    }
    // Plain checkboxes are standing authorizations, not owner tasks.
    if (owner && !body.startsWith("**") && !/^OT-/.test(body)) continue;
    const ownerMatch = owner ? body.match(/^\*\*(OT-\d+) (.+?)\*\*(.*)$/) : null;
    const idMatch = owner ? ownerMatch?.[1] : body.match(/^([A-Z]+-\d+)\s+\S/)?.[1];
    const content = [body, ...details].join("\n");
    const starts = [...content.matchAll(/<!--\s*priority:/g)],
      markers = [...content.matchAll(/<!--\s*priority:\s*([1-3])\s*-->/g)];
    const warnings = [];
    if (!match) warnings.push(`Invalid checkbox status on line ${first + 1}; use [ ], [~] or [x]`);
    if (!idMatch)
      warnings.push(
        `Expected ${owner ? "**OT-nn Title.**" : "task ID (e.g. Y-1) and title"} on line ${first + 1}`,
      );
    if (starts.length !== 1 || markers.length !== 1)
      warnings.push(
        `Expected exactly one priority:1, 2 or 3 marker in item starting on line ${first + 1}`,
      );
    const detailSource = [ownerMatch ? ownerMatch[3] : body, ...details].join("\n");
    items.push({
      id: idMatch ?? `invalid-line-${first + 1}`,
      line: first,
      lastLine: line,
      section,
      title: clean(ownerMatch ? ownerMatch[2] : body.split(/(?<=\.)\s/)[0]) || "(Missing title)",
      text: clean(detailSource),
      detailBlocks: owner ? parseDetailBlocks(detailSource) : [],
      rank: starts.length === 1 && markers.length === 1 ? Number(markers[0][1]) : 0,
      status: { " ": "open", "~": "in progress", x: "done" }[match?.[1]] ?? "open",
      replies: replies.sort(sortReplies),
      warnings,
    });
  }
  for (const item of items)
    item.contentVersion = createHash("sha256")
      .update(JSON.stringify([item.title, item.text, item.detailBlocks, item.rank, item.status]))
      .digest("hex");
  const byId = new Map();
  for (const item of items) {
    if (item.id.startsWith("invalid-line-")) continue;
    const group = byId.get(item.id) ?? [];
    group.push(item);
    byId.set(item.id, group);
  }
  for (const [id, group] of byId)
    if (group.length > 1)
      for (const item of group)
        item.warnings.push(`Duplicate ${id} on lines ${group.map((i) => i.line + 1).join(", ")}`);
  return items;
}
