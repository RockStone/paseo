import { describe, expect, it } from "vitest";
import type { TrackerItem } from "../../shared/board";
import type { Note } from "../../shared/notes";
import { filterItems, filterNotes } from "../../shared/search";

function item(patch: Partial<TrackerItem>): TrackerItem {
  return {
    id: "N-1",
    line: 1,
    section: "",
    title: "Title",
    text: "",
    detailBlocks: [],
    rank: 1,
    status: "open",
    replies: [],
    warnings: [],
    contentVersion: "v",
    ...patch,
  };
}

describe("filterItems", () => {
  const items = [
    item({ id: "N-9", title: "Alpha" }),
    item({ id: "N-10", title: "Beta", text: "needs Postgres" }),
    item({ id: "OT-1", detailBlocks: [{ text: "Rotate the KEY", bold: false }] }),
    item({
      id: "OT-2",
      replies: [{ id: "r", date: "2026-01-01", time: null, text: "ship it" }],
    }),
  ];
  const ids = (query: string) => filterItems(items, query).map((i) => i.id);

  it("returns everything for an empty or blank query", () => {
    expect(ids("")).toHaveLength(4);
    expect(ids("   ")).toHaveLength(4);
  });
  it("matches id, title, text, detail blocks and replies case-insensitively", () => {
    expect(ids("n-9")).toEqual(["N-9"]);
    expect(ids("ALPHA")).toEqual(["N-9"]);
    expect(ids("postgres")).toEqual(["N-10"]);
    expect(ids("rotate the key")).toEqual(["OT-1"]);
    expect(ids("SHIP")).toEqual(["OT-2"]);
  });
  it("returns nothing when no field matches", () => {
    expect(ids("zzz")).toEqual([]);
  });
});

describe("filterNotes", () => {
  const note = (id: string, text: string, title?: string): Note => ({
    id,
    text,
    title,
    author: { kind: "user" },
    createdAt: "2026-01-01T00:00:00Z",
    seenAt: null,
  });
  it("matches note text and title", () => {
    const notes = [note("a", "Buy milk"), note("b", "x", "Deploy plan")];
    expect(filterNotes(notes, "MILK").map((n) => n.id)).toEqual(["a"]);
    expect(filterNotes(notes, "deploy").map((n) => n.id)).toEqual(["b"]);
    expect(filterNotes(notes, "")).toHaveLength(2);
  });
});
