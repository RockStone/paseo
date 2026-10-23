import { buildRewoundComposerMessage } from "./attachments";
import { describe, expect, test } from "vitest";
import { restoreComposerDraftIfEmpty } from "./composer-restore";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";

const image = {
  id: "local-image",
  mimeType: "image/png",
  storageType: "web-indexeddb" as const,
  storageKey: "local-image",
  createdAt: 1,
};
const file = {
  type: "uploaded_file" as const,
  id: "file-1",
  fileName: "log.txt",
  mimeType: "text/plain",
  size: 5,
  path: "/tmp/log.txt",
};

describe("rewind composer restoration", () => {
  test("restores text, images and files together into an empty composer", () => {
    const rewound = buildRewoundComposerMessage({
      text: "Check [@Image 1](attachment://local-image) [@File 1](attachment://file-1)",
      images: [image],
      attachments: [file],
    });
    expect(
      restoreComposerDraftIfEmpty({ currentText: "", currentAttachments: [], rewound }),
    ).toEqual({
      text: rewound.text,
      attachments: [
        { kind: "image", metadata: image, inlineMention: "[@Image 1](attachment://local-image)" },
        { kind: "file", attachment: file, inlineMention: "[@File 1](attachment://file-1)" },
      ],
    });
  });
  test("preserves an existing text draft or an attachment-only draft", () => {
    const rewound = { text: "old message", attachments: [] };
    expect(
      restoreComposerDraftIfEmpty({
        currentText: "keep this draft",
        currentAttachments: [],
        rewound,
      }),
    ).toBeNull();
    expect(
      restoreComposerDraftIfEmpty({
        currentText: "",
        currentAttachments: [{ kind: "image", metadata: image }],
        rewound,
      }),
    ).toBeNull();
  });
  test("rewrites a replayed image reference to its recovered attachment ID", () => {
    const restored = buildRewoundComposerMessage({
      text: "Look at [@Image 1](attachment://original-image)",
      images: [image],
      attachments: [
        {
          type: "text",
          mimeType: "text/plain",
          title: "Image",
          text: "Attached image 1: attachment://original-image",
        },
      ],
    });
    expect(restored.text).toBe("Look at [@Image 1](attachment://local-image)");
    expect(restored.attachments).toEqual([
      { kind: "image", metadata: image, inlineMention: "[@Image 1](attachment://local-image)" },
    ]);
  });
  test("recovers an imported image mention when its reference context was flattened into text", () => {
    const restored = buildRewoundComposerMessage({
      text: "[@Image 1](attachment://old-image)\nAttached image 1: attachment://old-image",
      images: [image],
      attachments: [],
    });
    expect(restored.text).toBe(
      "[@Image 1](attachment://local-image)\nAttached image 1: attachment://local-image",
    );
    expect(restored.attachments).toEqual([
      { kind: "image", metadata: image, inlineMention: "[@Image 1](attachment://local-image)" },
    ]);
  });
  test("restores older image and file attachments without adding new mentions", () => {
    expect(
      buildRewoundComposerMessage({ text: "Older prompt", images: [image], attachments: [file] }),
    ).toEqual({
      text: "Older prompt",
      attachments: [
        { kind: "image", metadata: image },
        { kind: "file", attachment: file },
      ],
    });
  });
});

describe("shouldRestoreComposerForRewindMode", () => {
  test("restores only conversation-mutating rewind modes", () => {
    expect(shouldRestoreComposerForRewindMode("conversation")).toBe(true);
    expect(shouldRestoreComposerForRewindMode("files")).toBe(false);
    expect(shouldRestoreComposerForRewindMode("both")).toBe(true);
  });
});
