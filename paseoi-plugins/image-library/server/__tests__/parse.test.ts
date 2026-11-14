import { describe, expect, it } from "vitest";
import { imageRefsFromEntries, localImagePath, markdownImagePaths } from "../parse";

const entry = (item: Record<string, unknown>, timestamp = "2026-11-13T10:00:00.000Z") => ({
  timestamp,
  seqEnd: 1,
  item: item as { type: string },
});

describe("localImagePath", () => {
  it("decodes file URIs and keeps absolute paths", () => {
    expect(localImagePath("file:///tmp/paseo-attachments-x/a%20b.png")).toBe(
      "/tmp/paseo-attachments-x/a b.png",
    );
    expect(localImagePath("/Users/me/shot.JPG")).toBe("/Users/me/shot.JPG");
  });

  it("skips web, data, relative and non-image sources", () => {
    expect(localImagePath("https://example.com/a.png")).toBeNull();
    expect(localImagePath("data:image/png;base64,AAAA")).toBeNull();
    expect(localImagePath("images/a.png")).toBeNull();
    expect(localImagePath("/tmp/notes.txt")).toBeNull();
  });
});

describe("markdownImagePaths", () => {
  it("finds every local image and unescapes the source", () => {
    const text =
      "Done.\n\n![Image](file:///tmp/a.png)\n\ntext ![x](/tmp/b\\)c.webp) ![w](https://x/y.png)";
    expect(markdownImagePaths(text)).toEqual(["/tmp/a.png", "/tmp/b)c.webp"]);
  });
});

describe("imageRefsFromEntries", () => {
  it("attributes user image sources to the owner and assistant images to the agent", () => {
    const refs = imageRefsFromEntries([
      entry({
        type: "user_message",
        text: "look",
        clientMessageId: "msg_1_a",
        imageSources: ["file:///tmp/u.png"],
      }),
      entry({ type: "tool_call", name: "Read" }),
      entry(
        { type: "assistant_message", text: "\n\n![Image](file:///tmp/s.png)\n\n" },
        "2026-11-13T10:01:00.000Z",
      ),
      entry({ type: "assistant_message", text: "no images here" }),
    ]);
    expect(refs).toEqual([
      {
        path: "/tmp/u.png",
        source: "you",
        timestamp: "2026-11-13T10:00:00.000Z",
        clientMessageId: "msg_1_a",
      },
      { path: "/tmp/s.png", source: "agent", timestamp: "2026-11-13T10:01:00.000Z" },
    ]);
  });

  it("prefers stored desktop attachments over temporary copies", () => {
    const refs = imageRefsFromEntries(
      [
        entry({
          type: "user_message",
          text: "",
          clientMessageId: "msg_2_b",
          imageSources: ["file:///tmp/tmp.png"],
        }),
      ],
      (id) => (id === "msg_2_b" ? ["/home/.paseo/desktop-attachments/att_msg_2_b.png"] : []),
    );
    expect(refs.map((ref) => ref.path)).toEqual([
      "/home/.paseo/desktop-attachments/att_msg_2_b.png",
    ]);
  });

  it("ignores user messages without images", () => {
    expect(
      imageRefsFromEntries([
        entry({ type: "user_message", text: "hi", clientMessageId: "msg_3_c" }),
      ]),
    ).toEqual([]);
  });
});
