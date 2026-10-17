import { createSessionContextAttachment, parseSessionDragPayload } from "./session-drag";
import { describe, expect, it } from "vitest";
import { createWorkspaceFileAttachment } from "./workspace-file";
import {
  parseWorkspaceFileDragPayload,
  resolveWorkspaceFileDrop,
  serializeWorkspaceFileDragPayload,
  type WorkspaceFileDragPayload,
} from "./workspace-file-drag";

function payload(): WorkspaceFileDragPayload {
  return {
    version: 1,
    serverId: "server-1",
    workspaceId: "workspace-1",
    attachment: createWorkspaceFileAttachment({
      path: "src/app.ts",
      selection: { kind: "line_range", startLine: 12, endLine: 24 },
    }),
  };
}

describe("workspace file drag payload", () => {
  it("round-trips workspace identity and future line selections", () => {
    expect(parseWorkspaceFileDragPayload(serializeWorkspaceFileDragPayload(payload()))).toEqual(
      payload(),
    );
  });

  it("rejects malformed and invalid payloads", () => {
    expect(parseWorkspaceFileDragPayload("not json")).toBeNull();
    expect(
      parseWorkspaceFileDragPayload(
        JSON.stringify({
          ...payload(),
          attachment: {
            kind: "workspace_file",
            path: "src/app.ts",
            selection: { kind: "line_range", startLine: 24, endLine: 12 },
          },
        }),
      ),
    ).toBeNull();
  });

  it("accepts drops only within the originating server and workspace", () => {
    const dragged = payload();
    expect(
      resolveWorkspaceFileDrop({
        payload: dragged,
        serverId: "server-1",
        workspaceId: "workspace-1",
      }),
    ).toEqual(dragged.attachment);
    expect(
      resolveWorkspaceFileDrop({
        payload: dragged,
        serverId: "server-1",
        workspaceId: "workspace-2",
      }),
    ).toBeNull();
  });
});

describe("conversation drag context", () => {
  const source = {
    version: 1 as const,
    serverId: "remote-host",
    agentId: "claude-source",
    title: "Review owner TODO items",
  };
  it("validates the host and exact source session", () => {
    expect(parseSessionDragPayload(JSON.stringify(source))).toEqual(source);
    for (const value of [
      "invalid",
      "{}",
      JSON.stringify({ ...source, version: 2 }),
      JSON.stringify({ ...source, agentId: "" }),
    ]) {
      expect(parseSessionDragPayload(value)).toBeNull();
    }
  });
  it("attaches actual context and stable source identity without title searching", () => {
    const attachment = createSessionContextAttachment({
      source,
      payload: {
        agentId: source.agentId,
        requestId: "request",
        error: null,
        attachment: {
          type: "text",
          mimeType: "text/plain",
          contextKind: "chat_history",
          text: "user: Specific context from Claude",
        },
        itemCount: 2,
        boundaryCursor: null,
        boundaryMessageId: null,
      },
    });
    expect(attachment.attachment.title).toBe(source.title);
    expect(attachment.attachment.text).toContain("Specific context from Claude");
    expect(attachment.attachment.text).toContain(
      '"hostId":"remote-host","agentId":"claude-source"',
    );
    expect(attachment.source.serverId).toBe("remote-host");
  });
});
