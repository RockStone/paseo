import { describe, expect, it } from "vitest";
import type {
  WorkspaceComposerAttachment,
  ChatHistoryContextAttachment,
} from "@/attachments/types";
import { addContextReference, renumberContextReferences } from "./attachment-reference";
import { splitComposerAttachmentsForSubmit } from "./submit";
import { messageReferenceDetails } from "@/attachments/reference-details";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  resetWorkspaceAttachmentsStore,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { removeSentContextAttachments } from "./workspace-cleanup";

function chatHistoryAttachment(): ChatHistoryContextAttachment {
  return {
    kind: "chat_history",
    id: "chat_history:draft-1",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Chat history",
      text: "Previous chat.",
    },
    source: {
      serverId: "local",
      agentId: "agent-1",
    },
  };
}

function pullRequestContextAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "github.pull_request_comment",
    id: "comment-1",
    title: "Comment",
    text: "Please check this.",
  };
}

function browserElementAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "browser_element",
    attachment: {
      url: "https://example.com",
      selector: "button.primary",
      tag: "button",
      text: "Click me",
      outerHTML: '<button class="primary">Click me</button>',
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      reactSource: null,
      parentChain: [],
      children: [],
      formatted: "button.primary\nClick me",
    },
  };
}

describe("workspace composer attachment cleanup", () => {
  it("maps an inline context reference to the exact submitted snapshot and saved message details", () => {
    const context = addContextReference([], chatHistoryAttachment());
    expect(context.inlineMention).toBe("[@Context 1](attachment://chat_history%3Adraft-1)");
    const submitted = splitComposerAttachmentsForSubmit([context]);
    const expectedText = `Attached context reference: ${context.inlineMention}\n\nPrevious chat.`;
    expect(submitted.attachments).toEqual([
      {
        ...context.attachment,
        text: expectedText,
      },
    ]);
    const details = messageReferenceDetails(
      `Please check ${context.inlineMention}`,
      submitted.attachments,
    );
    expect(details.visibleAttachments).toEqual([]);
    expect(details.details.get("attachment://chat_history%3Adraft-1")).toEqual({
      title: "Chat history",
      text: expectedText,
      imagePosition: undefined,
    });
    expect(splitComposerAttachmentsForSubmit([chatHistoryAttachment()]).attachments).toEqual([
      chatHistoryAttachment().attachment,
    ]);
  });

  it("removes context mentions and renumbers remaining mentions without changing IDs or code", () => {
    const first = addContextReference([], chatHistoryAttachment());
    const second = addContextReference([first], {
      ...chatHistoryAttachment(),
      id: "other-context",
    });
    const text = `Read ${first.inlineMention} then ${second.inlineMention} twice ${second.inlineMention}; literal \`${second.inlineMention}\`.`;
    const result = renumberContextReferences({
      attachments: [second],
      removed: first,
      text,
      selection: { start: text.length, end: text.length },
    });
    const expectedMention = "[@Context 1](attachment://other-context)";
    expect(result.text).toBe(
      `Read  then ${expectedMention} twice ${expectedMention}; literal \`${second.inlineMention}\`.`,
    );
    expect(result.attachments).toEqual([{ ...second, inlineMention: expectedMention }]);
    expect(result.selection).toEqual({ start: result.text.length, end: result.text.length });
    expect(addContextReference([first, second], second)).toEqual(second);
  });

  it("clears sent scoped context attachments from their stores", () => {
    resetWorkspaceAttachmentsStore();
    const scopeKey = buildDraftWorkspaceAttachmentScopeKey("draft-1");
    const chatHistory = chatHistoryAttachment();
    const pullRequestContext = pullRequestContextAttachment();
    const browserElement = browserElementAttachment();
    useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
      scopeKey,
      attachments: [chatHistory, pullRequestContext, browserElement],
    });

    removeSentContextAttachments([chatHistory, pullRequestContext, browserElement]);

    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
  });
});
