import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { collectResponseFileChanges } from "./response-file-changes";
import { runPluginClientBundle, type PluginClientRuntime } from "@/plugins/evaluate";
import { transformTimelineItem, type TimelineItemTransform } from "@/plugins/timeline/model";
import type { InstalledPlugin } from "@/plugins/types";
import {
  applyStreamEvent,
  hydrateStreamState,
  type StreamItem,
  type ToolCallItem,
  type UserMessageItem,
} from "@/types/stream";
import type { AgentStreamEventPayload } from "@getpaseo/protocol/messages";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { buildAgentStreamRenderModel } from "./model";
import { createStreamPresentation, getStreamItemMessageId } from "./presentation";
import { transcriptDisplayKey, useSectionExpansionStore } from "./section-expansion";

const runtime = {
  paseo: {},
  async rpc() {},
  openSettings() {},
  openSurface() {},
  openPanel() {},
  addHeaderButton() {
    return { update() {}, remove() {} };
  },
  addComposerPill() {
    return { update() {}, remove() {} };
  },
} as unknown as PluginClientRuntime;

function installProbe(
  itemType: "user_message" | "assistant_message" | "tool_call" | "reasoning",
  condition = "true",
): InstalledPlugin {
  const clientBundle = `(function() {
    return { default: function(client) {
      client.addTimelineTransformer({
        id: "probe",
        query: { itemType: ${JSON.stringify(itemType)} },
        transform: function({ item, phase }) {
          if (!(${condition})) return undefined;
          return {
            items: [{
              type: "plugin",
              kind: "probe",
              version: 1,
              data: item.type === "tool_call"
                ? { callId: item.callId, name: item.name, status: item.status,
                    detail: item.detail, ...(item.metadata ? { metadata: item.metadata } : {}), error: item.error, phase: phase }
                : { text: item.text, phase: phase }
            }]
          };
        }
      });
      return function() {};
    } };
  })`;
  const evaluated = runPluginClientBundle("probe-plugin", clientBundle, runtime);
  return {
    ...evaluated,
    serverId: "host-1",
    clientBundle,
    lifetime: new AbortController(),
    queryClient: new QueryClient(),
    paseo: {} as InstalledPlugin["paseo"],
    invoke: async () => undefined,
  };
}

function installedTransform(plugin: InstalledPlugin): TimelineItemTransform {
  return (input) => transformTimelineItem({ ...input, plugins: [plugin] });
}

function toolCall(callId: string, name: string): ToolCallItem {
  return {
    kind: "tool_call",
    id: `tool-${callId}`,
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId,
        name,
        status: "completed",
        error: null,
        detail: { type: "unknown", input: { callId }, output: { callId } },
      },
    },
  };
}

function pluginData(items: StreamItem[]): unknown[] {
  return items.flatMap((item) => (item.kind === "plugin" ? [item.data] : []));
}

const presentationOptions = { level: "overview" as const, isTurnActive: true };

function answeredQuestion(): ToolCallItem {
  const item = toolCall("question-1", "AskUserQuestion");
  if (item.payload.source !== "agent") throw new Error("Expected agent tool");
  item.turnId = "turn-1";
  item.timelineCursor = { epoch: "epoch-1", seq: 7 };
  item.payload.data.provider = "claude";
  item.payload.data.detail = {
    type: "unknown",
    input: {
      questions: [
        { question: 'Which "profile" should open?', header: "Profile", options: [] },
        { question: "Which fields?\nList them.", header: "Fields", options: [] },
      ],
    },
    output: {
      output:
        'The user answered: "Which "profile" should open?"="New scenes, always", "Which fields?\nList them."="Social name, languages, **level**.\nLeave out "XP" and streaks.". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    },
  };
  return item;
}

describe("answered inline questions", () => {
  it.each(["overview", "detailed"] as const)(
    "shows answered questions as one user bubble in %s history and live rows",
    (level) => {
      const item = answeredQuestion();
      for (const source of ["tail", "head"] as const) {
        const result = createStreamPresentation()({
          ...presentationOptions,
          level,
          tail: source === "tail" ? [item] : [],
          head: source === "head" ? [item] : [],
          transform: undefined,
        });
        expect(rows(result)).toEqual([
          {
            kind: "user_message",
            id: item.id,
            timestamp: item.timestamp,
            turnId: item.turnId,
            timelineCursor: item.timelineCursor,
            text: '> Which "profile" should open?\n\nNew scenes, always\n\n> Which fields?\n> List them.\n\nSocial name, languages, **level**.\nLeave out "XP" and streaks.',
          },
        ]);
        expect(item.kind).toBe("tool_call");
      }
    },
  );

  it("recognizes the earlier Claude answer envelope", () => {
    const item = answeredQuestion();
    if (item.payload.source !== "agent" || item.payload.data.detail.type !== "unknown")
      throw new Error("Expected question detail");
    item.payload.data.detail.output = {
      output:
        'User has answered your questions: "Which "profile" should open?"="New scenes", "Which fields?\nList them."="Name, languages". You can now continue with the user\'s answers in mind.',
    };
    const result = createStreamPresentation()({
      ...presentationOptions,
      tail: [item],
      head: [],
      transform: undefined,
    });
    expect(rows(result)).toMatchObject([
      { kind: "user_message", text: expect.stringContaining("Name, languages") },
    ]);
  });

  it("shows a single question with the custom answer rather than an option label", () => {
    const item = answeredQuestion();
    if (item.payload.source !== "agent" || item.payload.data.detail.type !== "unknown")
      throw new Error("Expected question detail");
    item.payload.data.detail = {
      type: "unknown",
      input: {
        questions: [
          { question: "Which scenes?", header: "Scenes", options: [{ label: "All scenes" }] },
        ],
      },
      output: {
        output:
          'The user answered: "Which scenes?"="New scenes, but **always** show the creator.\nLeave out XP.". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
      },
    };
    const result = createStreamPresentation()({
      ...presentationOptions,
      tail: [item],
      head: [],
      transform: undefined,
    });
    expect(rows(result)).toMatchObject([
      {
        kind: "user_message",
        text: "> Which scenes?\n\nNew scenes, but **always** show the creator.\nLeave out XP.",
      },
    ]);
    expect(rows(result)[0]).not.toHaveProperty("messageId");
  });

  it.each(["running", "failed", "canceled"] as const)(
    "keeps %s questions as tool calls",
    (status) => {
      const item = answeredQuestion();
      if (item.payload.source !== "agent") throw new Error("Expected agent tool");
      item.payload.data.status = status;
      const result = createStreamPresentation()({
        ...presentationOptions,
        level: "detailed",
        tail: [item],
        head: [],
        transform: undefined,
      });
      expect(rows(result)).toEqual([item]);
    },
  );

  it.each([
    { output: "Dismissed by user" },
    {
      output:
        'The user answered: "An unrelated question?"="Yes". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    },
    {
      output:
        'The user answered: "Which "profile" should open?"="Yes". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    },
    {
      output:
        'The user answered: "Which "profile" should open?"="New scenes", "Which fields?\nList them."="". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    },
  ])("leaves unrecognized or incomplete answers readable as tool details: %j", (output) => {
    const item = answeredQuestion();
    if (item.payload.source !== "agent" || item.payload.data.detail.type !== "unknown")
      throw new Error("Expected question detail");
    item.payload.data.detail.output = output;
    const result = createStreamPresentation()({
      ...presentationOptions,
      level: "detailed",
      tail: [item],
      head: [],
      transform: undefined,
    });
    expect(rows(result)).toEqual([item]);
  });

  it("lets an installed plugin own the original question tool", () => {
    const result = createStreamPresentation()({
      ...presentationOptions,
      tail: [answeredQuestion()],
      head: [],
      transform: installedTransform(installProbe("tool_call")),
    });
    expect(rows(result)).toMatchObject([{ kind: "plugin" }]);
  });
});

function streamHarness(transform?: TimelineItemTransform) {
  let state: { tail: StreamItem[]; head: StreamItem[] } = { tail: [], head: [] };
  const present = createStreamPresentation();
  return {
    send(event: AgentStreamEventPayload) {
      state = applyStreamEvent({ ...state, event, timestamp: new Date(1000) });
      return this.render();
    },
    render(nextTransform = transform) {
      return present({ ...presentationOptions, ...state, transform: nextTransform });
    },
    source: () => state,
  };
}

function assistant(text: string, messageId = "message-1"): AgentStreamEventPayload {
  return {
    type: "timeline",
    provider: "claude",
    item: { type: "assistant_message", messageId, text },
  };
}

function rows(result: { tail: StreamItem[]; head: StreamItem[] }): StreamItem[] {
  return [...result.tail, ...result.head];
}

describe("whole-message Markdown presentation", () => {
  it("keeps paragraphs, fences and quotes in one progressively updated row", () => {
    const present = createStreamPresentation();
    const text = "First paragraph.\n\nSecond paragraph.\n\n```ts\nconst n = 1;\n```\n\n> Quote";
    for (const length of [10, 30, text.length]) {
      const source = hydrateStreamState([
        { event: assistant(text.slice(0, length)), timestamp: new Date(1000) },
      ]);
      const result = present({
        ...presentationOptions,
        tail: [],
        head: source,
        transform: undefined,
      });
      expect(rows(result)).toEqual(source);
    }
  });
});

describe("stream presentation through installed plugins", () => {
  it("offers every source tool call to an installed transformer in Overview mode", () => {
    const calls = [toolCall("call-1", "bash"), toolCall("call-2", "read")];
    const rendered = createStreamPresentation()({
      ...presentationOptions,
      tail: calls,
      head: [],
      transform: installedTransform(installProbe("tool_call")),
    });
    expect(pluginData([...rendered.tail, ...rendered.head])).toMatchObject([
      { callId: "call-1", name: "bash", phase: "complete" },
      { callId: "call-2", name: "read", phase: "complete" },
    ]);
  });

  it.each([
    { type: "turn_completed", provider: "claude" },
    { type: "turn_canceled", provider: "claude", reason: "test cancellation" },
    { type: "turn_failed", provider: "claude", error: "test failure" },
  ] satisfies AgentStreamEventPayload[])(
    "streams accumulated assistant text with one identity through $type",
    (completion) => {
      const harness = streamHarness(installedTransform(installProbe("assistant_message")));
      const first = rows(harness.send(assistant("Header")));
      const fullText = "Header\n\n\n# Body\n\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n";
      const live = rows(harness.send(assistant(fullText.slice("Header".length))));
      const completed = rows(harness.send(completion));

      expect(pluginData(first)).toEqual([{ text: "Header", phase: "streaming" }]);
      expect(pluginData(live)).toEqual([{ text: fullText, phase: "streaming" }]);
      expect(pluginData(completed)).toEqual([{ text: fullText, phase: "complete" }]);
      expect(live.map((item) => item.id)).toEqual(first.map((item) => item.id));
      expect(completed.map((item) => item.id)).toEqual(first.map((item) => item.id));
      expect(rows(harness.source())).toMatchObject([{ kind: "assistant_message", text: fullText }]);
    },
  );

  it("addresses a prompt a plugin replaced by the prompt's own id", () => {
    const harness = streamHarness(installedTransform(installProbe("user_message")));
    const rendered = rows(
      harness.send({
        type: "timeline",
        provider: "claude",
        item: { type: "user_message", messageId: "prompt-1", text: "Earlier prompt" },
      }),
    );
    const source = rows(harness.source());

    expect(source).toMatchObject([{ kind: "user_message", id: "prompt-1" }]);
    expect(rendered).toMatchObject([{ kind: "plugin", id: "probe-plugin/prompt-1/0" }]);
    // The chat outline jumps to the source id; the row it lands on is the plugin's.
    expect(rendered.map(getStreamItemMessageId)).toEqual(["prompt-1"]);
  });

  it("finishes one message before streaming a different message ID", () => {
    const harness = streamHarness(installedTransform(installProbe("assistant_message")));
    harness.send(assistant("First\n\nBody", "first"));
    const result = harness.send(assistant("Second", "second"));
    expect(pluginData(rows(result))).toEqual([
      { text: "First\n\nBody", phase: "complete" },
      { text: "Second", phase: "streaming" },
    ]);
    expect(new Set(rows(result).map((item) => item.id)).size).toBe(2);
  });

  it("lets a plugin claim the accumulated message after earlier text used native Markdown", () => {
    const harness = streamHarness();
    harness.send(assistant("Header\n\nBody"));
    const transform = installedTransform(
      installProbe("assistant_message", 'item.text.includes("Body")'),
    );
    expect(pluginData(rows(harness.render(transform)))).toEqual([
      { text: "Header\n\nBody", phase: "streaming" },
    ]);
    expect(rows(harness.render(transform))).toHaveLength(1);
    expect(rows(harness.render()).map((item) => item.kind)).toEqual(["assistant_message"]);
  });

  it("retains the complete message when streaming finishes", () => {
    const harness = streamHarness();
    harness.send(assistant("Intro\n\n![Image](image.png)"));
    const last = harness.send(assistant("\n\nAfter\n- item"));
    const completed = harness.send({ type: "turn_completed", provider: "claude" });
    expect(last.tail).toEqual([]);
    expect(last.head).toMatchObject([{ text: "Intro\n\n![Image](image.png)\n\nAfter\n- item" }]);
    expect(completed.tail).toEqual(last.head);
    expect(completed.head).toEqual([]);
  });

  it("keeps blank lines inside an open native code fence", () => {
    const harness = streamHarness();
    harness.send(assistant("Intro\n\n```ts\nconst a = 1;"));
    const result = harness.send(assistant("\n\nconst b = 2;"));
    expect(result.tail).toEqual([]);
    expect(result.head).toMatchObject([{ text: "Intro\n\n```ts\nconst a = 1;\n\nconst b = 2;" }]);
  });

  // Codex streams a line break and the next line's indent as their own chunks.
  it("keeps a line break when a chunk ends in the next line's indent", () => {
    const harness = streamHarness();
    harness.send(assistant("```mermaid\nflowchart TD\n    A[Start] --> B[Review]\n"));
    harness.send(assistant("   "));
    const result = harness.send(assistant(" B --> C[Finish]\n```"));
    expect(result.head).toMatchObject([
      { text: "```mermaid\nflowchart TD\n    A[Start] --> B[Review]\n    B --> C[Finish]\n```" },
    ]);
  });

  // One rendering path: a fetched message is the same block group as a streamed one,
  // which is what lets find, scroll-to-message and history reveal address it by id.
  // A link reference definition stays with the paragraph that uses it, so the split
  // never leaves an empty row behind and the reference still resolves.
  it("preserves source identity through history and the live head", () => {
    const source = hydrateStreamState([
      {
        event: assistant("[Link][docs]\n\n[docs]: https://example.com\n\nClosing paragraph."),
        timestamp: new Date(1000),
      },
    ]);
    const present = (placement: "tail" | "head") =>
      rows(
        createStreamPresentation()({
          ...presentationOptions,
          tail: placement === "tail" ? source : [],
          head: placement === "head" ? source : [],
          transform: undefined,
        }),
      );
    expect(present("tail")).toEqual(source);
    const blocks = (items: StreamItem[]) =>
      items.map((item) => [item.id, item.kind === "assistant_message" ? item.text : null]);
    expect(blocks(present("head"))).toEqual(blocks(present("tail")));
  });

  // Rows are addressed by id from outside presentation, so the same text has to land on
  // the same ids whether the reader watched it arrive or opened the chat afterwards.
  it("gives a streamed message the same id as its hydrated text", () => {
    const text = "Intro paragraph.\n\n# Heading\n\n- first\n- second\n\nClosing paragraph.";
    const harness = streamHarness();
    for (let end = 8; end < text.length; end += 8) {
      harness.send(assistant(text.slice(end - 8, end)));
    }
    harness.send(assistant(text.slice(text.length - (text.length % 8 || 8))));
    const streamed = rows(harness.send({ type: "turn_completed", provider: "claude" }));
    const hydrated = rows(
      createStreamPresentation()({
        ...presentationOptions,
        tail: hydrateStreamState([{ event: assistant(text), timestamp: new Date(1000) }]),
        head: [],
        transform: undefined,
      }),
    );
    expect(streamed.map((item) => item.id)).toEqual(hydrated.map((item) => item.id));
    expect(streamed.map((item) => item.kind === "assistant_message" && item.text)).toEqual(
      hydrated.map((item) => item.kind === "assistant_message" && item.text),
    );
  });

  it("uses the canonical source that replaced the streamed message", () => {
    const harness = streamHarness();
    harness.send(assistant("Streamed answer"));
    const streamed = rows(harness.render());
    expect(streamed[0]).not.toHaveProperty("timelineCursor");
    const source = harness.source();
    const live = source.head[0];
    if (live?.kind !== "assistant_message") throw new Error("Expected a live assistant message");
    const canonical = { ...live, timelineCursor: { epoch: "epoch-1", seq: 42 } };
    const present = createStreamPresentation();
    present({ ...presentationOptions, tail: [], head: [live], transform: undefined });
    const repointed = rows(
      present({ ...presentationOptions, tail: [], head: [canonical], transform: undefined }),
    );
    expect(repointed).toMatchObject([
      {
        id: streamed[0]!.id,
        text: "Streamed answer",
        timelineCursor: { epoch: "epoch-1", seq: 42 },
      },
    ]);
  });

  it("keeps a single-paragraph message a one-block group", () => {
    const source = hydrateStreamState([
      { event: assistant("Only one paragraph."), timestamp: new Date(1000) },
    ]);
    const messageId = source[0]!.id;
    const result = createStreamPresentation()({
      ...presentationOptions,
      tail: source,
      head: [],
      transform: undefined,
    });
    expect(result.tail).toEqual(source);
    expect(result.tail[0]!.id).toBe(messageId);
  });

  it("continues to stream inline reasoning with a stable plugin row", () => {
    const harness = streamHarness(installedTransform(installProbe("reasoning")));
    const first = harness.send({
      type: "timeline",
      provider: "claude",
      item: { type: "reasoning", text: "First" },
    });
    const second = harness.send({
      type: "timeline",
      provider: "claude",
      item: { type: "reasoning", text: "\n\nSecond" },
    });
    const done = harness.send({ type: "turn_completed", provider: "claude" });
    expect(pluginData(rows(second))).toEqual([{ text: "First\n\nSecond", phase: "streaming" }]);
    expect(pluginData(rows(done))).toEqual([{ text: "First\n\nSecond", phase: "complete" }]);
    expect(rows(first)[0]?.id).toBe(rows(done)[0]?.id);
  });

  it("groups only unclaimed tools and passes unchanged tool details to the callback", () => {
    const calls = [
      toolCall("call-1", "read"),
      toolCall("call-2", "read"),
      toolCall("call-3", "bash"),
    ];
    const result = createStreamPresentation()({
      ...presentationOptions,
      isTurnActive: false,
      tail: calls,
      head: [],
      transform: installedTransform(installProbe("tool_call", 'item.name === "bash"')),
    });
    expect(result.groupsByHostId.get(result.tail[0]!.id)?.run.calls).toEqual(calls.slice(0, 2));
    expect(pluginData(rows(result))).toEqual([
      {
        callId: "call-3",
        name: "bash",
        status: "completed",
        error: null,
        detail: { type: "unknown", input: { callId: "call-3" }, output: { callId: "call-3" } },
        phase: "complete",
      },
    ]);
  });

  it.each([
    { status: "completed", error: null },
    { status: "failed", error: { message: "Command failed" } },
    { status: "canceled", error: null },
  ] as const)("keeps a tool card's identity and full payload through $status", (completion) => {
    const harness = streamHarness(installedTransform(installProbe("tool_call")));
    const source = {
      type: "tool_call" as const,
      callId: "call-1",
      name: "bash",
      detail: { type: "shell" as const, command: "pwd", cwd: "/repo" },
      metadata: { sequence: 1 },
    };
    const running = rows(
      harness.send({
        type: "timeline",
        provider: "claude",
        item: {
          ...source,
          status: "running",
          error: null,
        },
      }),
    );
    const terminalItem = { ...source, ...completion };
    const terminal = rows(
      harness.send({
        type: "timeline",
        provider: "claude",
        item: {
          ...terminalItem,
        },
      }),
    );
    expect(pluginData(running)).toMatchObject([
      { callId: "call-1", status: "running", phase: "streaming" },
    ]);
    expect(pluginData(terminal)).toEqual([
      {
        callId: source.callId,
        name: source.name,
        detail: source.detail,
        metadata: source.metadata,
        phase: "complete",
        status: completion.status,
        error: terminalItem.error,
      },
    ]);
    expect(terminal.map((item) => item.id)).toEqual(running.map((item) => item.id));
  });

  it("offers one complete live source assistant message to an installed transformer", () => {
    const sourceText =
      '[IMPORTANT: User invoked the "diagnose" skill; follow its instructions. Full skill below.]\n\n# Diagnose\n\nFind the root cause.';
    const event = {
      type: "timeline" as const,
      provider: "opencode" as const,
      item: { type: "assistant_message" as const, messageId: "message-1", text: sourceText },
    };
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    const transform = installedTransform(installProbe("assistant_message"));
    const present = createStreamPresentation();

    const fetched = hydrateStreamState([{ event, timestamp }]);
    const history = present({ ...presentationOptions, tail: fetched, head: [], transform });
    expect(pluginData(history.tail)).toEqual([{ text: sourceText, phase: "complete" }]);

    const stream = applyStreamEvent({
      tail: [],
      head: [],
      event,
      timestamp,
    });

    const rendered = present({ ...presentationOptions, ...stream, transform });
    expect(pluginData([...rendered.tail, ...rendered.head])).toEqual([
      { text: sourceText, phase: "streaming" },
    ]);
  });
});

function createTimestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function userMessage(id: string, seed: number): UserMessageItem {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

function assistantMessage(
  id: string,
  seed: number,
): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

describe("timeline presentation", () => {
  it("scopes section expansion to its host and conversation", () => {
    useSectionExpansionStore.setState({ thinkingExpanded: {}, sections: {}, revision: {} });
    const key = transcriptDisplayKey("host", "agent");
    useSectionExpansionStore.getState().toggle(key, true);
    expect(useSectionExpansionStore.getState().thinkingExpanded[key]).toBe(false);
    expect(
      useSectionExpansionStore.getState().thinkingExpanded[transcriptDisplayKey("other", "agent")],
    ).toBeUndefined();
    expect(
      useSectionExpansionStore.getState().thinkingExpanded[transcriptDisplayKey("host", "other")],
    ).toBeUndefined();
    useSectionExpansionStore.getState().toggle(key, true);
    expect(useSectionExpansionStore.getState().thinkingExpanded[key]).toBe(true);
    useSectionExpansionStore.setState({ thinkingExpanded: {}, sections: {}, revision: {} });
  });

  it("collapses individually reopened sections again and keeps other agents unchanged", () => {
    useSectionExpansionStore.setState({ thinkingExpanded: {}, sections: {}, revision: {} });
    const key = transcriptDisplayKey("host", "agent");
    const other = transcriptDisplayKey("host", "other");
    const store = useSectionExpansionStore.getState();
    store.register(key, "shell", false);
    store.register(key, "notification", false);
    store.register(other, "thinking", true, true);
    store.setSection(key, "shell", false, true);
    store.setSection(key, "notification", false, true);
    store.toggle(key, true);
    expect(useSectionExpansionStore.getState().sections[key]).toEqual({
      shell: { expanded: false, thinking: false },
      notification: { expanded: false, thinking: false },
    });
    store.setSection(key, "shell", false, true);
    store.toggle(key, true);
    expect(useSectionExpansionStore.getState().sections[key]).toEqual({
      shell: { expanded: false, thinking: false },
      notification: { expanded: false, thinking: false },
    });
    expect(useSectionExpansionStore.getState().revision[key]).toBe(2);
    expect(useSectionExpansionStore.getState().sections[other]).toEqual({
      thinking: { expanded: true, thinking: true },
    });
    store.toggle(key, true);
    store.register(key, "later-tool", false);
    store.register(key, "later-thinking", false, true);
    expect(useSectionExpansionStore.getState().sections[key]).toEqual({
      shell: { expanded: false, thinking: false },
      notification: { expanded: false, thinking: false },
      "later-tool": { expanded: false, thinking: false },
      "later-thinking": { expanded: true, thinking: true },
    });
    useSectionExpansionStore.setState({ thinkingExpanded: {}, sections: {}, revision: {} });
  });

  it("folds recognized long assistant continuations and preserves ordinary replies", () => {
    const summary = {
      ...assistantMessage("intro", 2),
      text: "This session is being continued from a previous conversation. ".repeat(100),
    };
    const compaction: StreamItem = {
      kind: "compaction",
      id: "compact",
      timestamp: new Date(0),
      status: "completed",
    };
    const present = createStreamPresentation();
    const result = present({
      level: "detailed",
      isTurnActive: false,
      transform: undefined,
      tail: [compaction],
      head: [summary, assistantMessage("reply", 3)],
    });
    expect(result.head).toEqual([
      { ...summary, isCompactionIntro: true },
      assistantMessage("reply", 3),
    ]);
    expect(
      present({
        level: "detailed",
        isTurnActive: false,
        transform: undefined,
        tail: [compaction, summary],
        head: [],
      }).tail,
    ).toEqual([compaction, { ...summary, isCompactionIntro: true }]);
    expect(summary).not.toHaveProperty("isCompactionIntro");
    const reply = {
      ...assistantMessage("answer", 4),
      text: "The implementation now handles this correctly. ".repeat(100),
    };
    expect(
      present({
        level: "detailed",
        isTurnActive: false,
        transform: undefined,
        tail: [compaction, reply],
        head: [],
      }).tail,
    ).toEqual([compaction, reply]);
  });

  it.each(["live", "history"])("folds a continuation after intervening tools in %s", (source) => {
    const summary = {
      ...assistantMessage("intro", 2),
      text: "Attribution for git commits and pull requests you create from here on. ".repeat(100),
    };
    const compaction: StreamItem = {
      kind: "compaction",
      id: "compact",
      timestamp: new Date(0),
      status: "completed",
    };
    const shell = toolCall("intervening-shell", "Bash");
    const items = [compaction, shell, summary];
    const result = createStreamPresentation()({
      level: "detailed",
      isTurnActive: source === "live",
      transform: undefined,
      tail: source === "history" ? items : [],
      head: source === "live" ? items : [],
    });
    expect(rows(result)).toEqual([compaction, shell, { ...summary, isCompactionIntro: true }]);
  });

  it("folds a recognized continuation when its divider is outside loaded history", () => {
    const summary = {
      ...assistantMessage("intro", 2),
      text: "Attribution for git commits and pull requests you create from here on. ".repeat(100),
    };
    const shell = toolCall("intervening-shell", "Bash");
    const result = createStreamPresentation()({
      level: "detailed",
      isTurnActive: false,
      transform: undefined,
      tail: [shell, summary],
      head: [],
    });
    expect(result.tail).toEqual([shell, { ...summary, isCompactionIntro: true }]);
  });

  it.each(["live", "history"])("folds Claude's XML-wrapped restored intro in %s", (source) => {
    const summary = {
      ...assistantMessage("wrapped-intro", 2),
      text:
        "<system-reminder>\nAttribution for git commits and pull requests you create from here on.\n</system-reminder>\n\n" +
        "Restored context and tool results. ".repeat(2000),
    };
    const result = createStreamPresentation()({
      level: "detailed",
      isTurnActive: source === "live",
      transform: undefined,
      tail: source === "history" ? [summary] : [],
      head: source === "live" ? [summary] : [],
    });
    expect(rows(result)).toEqual([{ ...summary, isCompactionIntro: true }]);
    expect(summary).not.toHaveProperty("isCompactionIntro");
  });

  it("does not fold unrelated system reminders", () => {
    const message = {
      ...assistantMessage("ordinary-reminder", 2),
      text:
        "<system-reminder>\n" +
        "Use the existing test commands. ".repeat(100) +
        "</system-reminder>",
    };
    const result = createStreamPresentation()({
      level: "detailed",
      isTurnActive: false,
      transform: undefined,
      tail: [message],
      head: [],
    });
    expect(result.tail).toEqual([message]);
  });

  it.each(["live", "history"])("folds a restored token-budget envelope in %s", (source) => {
    const summary = {
      ...assistantMessage("token-intro", 2),
      text:
        "<total_tokens>15000000 tokens left</total_tokens>\n\n" +
        "Concise output style is active.\n\n" +
        "Called the Read tool with the following input: restored context.\n".repeat(100),
    };
    const result = createStreamPresentation()({
      level: "detailed",
      isTurnActive: source === "live",
      transform: undefined,
      tail: source === "history" ? [summary] : [],
      head: source === "live" ? [summary] : [],
    });
    expect(rows(result)).toEqual([{ ...summary, isCompactionIntro: true }]);
    expect(summary).not.toHaveProperty("isCompactionIntro");
  });

  it("keeps quoted token budgets, short envelopes and user messages visible", () => {
    const envelope = "<total_tokens>15000000 tokens left</total_tokens>\n";
    const items = [
      { ...assistantMessage("quoted", 1), text: "Here is the example: " + envelope.repeat(30) },
      { ...assistantMessage("short", 2), text: envelope },
      { ...userMessage("user-envelope", 3), text: envelope + "User context. ".repeat(100) },
    ];
    const result = createStreamPresentation()({
      level: "detailed",
      isTurnActive: false,
      transform: undefined,
      tail: items,
      head: [],
    });
    expect(result.tail).toEqual(items);
  });
  const present = createStreamPresentation();
  function projectTimelineItems(items: StreamItem[], transform?: TimelineItemTransform) {
    return present({ ...presentationOptions, tail: items, head: [], transform }).tail;
  }
  const envelope =
    "<spoken-input>\nPlease fix the voice chat.\n</spoken-input>\n<instruction>This message was spoken by the user. Respond using the speak tool only, not normal messages, because the user may not be looking at the chat.</instruction>";

  it.each(["live", "history"])("keeps Claude task notification cards visible in %s", (source) => {
    const notification = toolCall("background-complete", "task_notification");
    if (notification.payload.source !== "agent") throw new Error("Expected agent tool");
    notification.payload.data.provider = "claude";
    const ordinaryTool = toolCall("shell", "Bash");
    const user = { ...userMessage("quoted", 1), text: "Explain <task-notification>" };
    const reply = assistantMessage("reply", 2);
    const items = [notification, notification, ordinaryTool, user, reply];
    const result = createStreamPresentation()({
      level: "detailed",
      isTurnActive: source === "live",
      tail: source === "history" ? items : [],
      head: source === "live" ? items : [],
      transform: undefined,
    });
    expect(rows(result)).toEqual(items);
    expect(items).toHaveLength(5);
    expect(notification.payload.data.name).toBe("task_notification");
  });

  it.each(["live", "history"])(
    "shows only spoken words from a %s user message without mutating its source",
    (source) => {
      const item: UserMessageItem = Object.freeze({
        ...userMessage(source, 1),
        text: envelope,
        messageId: "provider-message",
        clientMessageId: "client-message",
        turnId: "turn-1",
        timelineCursor: { epoch: "epoch", seq: 12 },
      });
      const presentMessage = () =>
        present({
          ...presentationOptions,
          tail: source === "history" ? [item] : [],
          head: source === "live" ? [item] : [],
          transform: undefined,
        });
      const projected = rows(presentMessage());
      expect(projected).toEqual([{ ...item, text: "Please fix the voice chat." }]);
      const model = buildAgentStreamRenderModel({
        tail: source === "history" ? projected : [],
        head: source === "live" ? projected : [],
        isTurnActive: source === "live",
        activeTurnStartedAt: item.timestamp,
        platform: "native",
        isMobileBreakpoint: true,
      });
      const rendered = [...model.history, ...model.segments.liveHead];
      expect(rendered).toContainEqual({ ...item, text: "Please fix the voice chat." });
      expect(item.text).toBe(envelope);
      expect(rows(presentMessage())[0]).toBe(projected[0]);
    },
  );

  it("supports older envelopes and preserves multiline spoken content", () => {
    const item = {
      ...userMessage("legacy", 1),
      text: "<spoken-input>\nFirst line.\nSecond line with <example>XML</example>.\n</spoken-input>",
    };
    expect(projectTimelineItems([item])).toEqual([
      { ...item, text: "First line.\nSecond line with <example>XML</example>." },
    ]);
  });

  it("leaves ordinary messages, assistant examples and incomplete wrappers unchanged", () => {
    const items: StreamItem[] = [
      userMessage("ordinary", 1),
      { ...assistantMessage("example", 2), text: envelope },
      { ...userMessage("incomplete", 3), text: "<spoken-input>unfinished" },
      { ...userMessage("quoted", 4), text: "Explain this example: " + envelope },
      {
        ...userMessage("xml", 5),
        text: "<spoken-input>Example</spoken-input><instruction>Explain this XML.</instruction>",
      },
    ];
    expect(projectTimelineItems(items)).toEqual(items);
    expect(projectTimelineItems(items)[0]).toBe(items[0]);
  });

  it("keeps plugin transforms on the original source and respects replacements", () => {
    const source: StreamItem = { ...userMessage("spoken", 1), text: envelope };
    const inputs: string[] = [];
    const transformed = projectTimelineItems([source], ({ item, sourceId }) => {
      if (item.type === "user_message") inputs.push(item.text);
      return [
        {
          type: "plugin",
          pluginId: "test",
          id: sourceId,
          kind: "voice",
          version: 1,
          data: { text: "Custom voice row" },
        },
      ];
    });
    expect(inputs).toEqual([envelope]);
    expect(transformed).toMatchObject([{ kind: "plugin", data: { text: "Custom voice row" } }]);
    expect(projectTimelineItems([source], () => undefined)).toEqual([
      { ...source, text: "Please fix the voice chat." },
    ]);
    expect(projectTimelineItems([source], () => [])).toEqual([]);
  });
});

describe("response changed-files summaries", () => {
  it("summarizes successful Codex and Claude edits under the final reply", () => {
    const edit = (id: string, provider: "codex" | "claude", filePath: string): StreamItem => ({
      kind: "tool_call",
      id,
      turnId: "turn",
      timestamp: new Date(0),
      payload: {
        source: "agent",
        data: {
          provider,
          callId: id,
          name: "Edit",
          status: "completed",
          error: null,
          detail: { type: "edit", filePath, oldString: "before\n", newString: "after\nextra\n" },
        },
      },
    });
    const items: StreamItem[] = [
      {
        kind: "user_message",
        id: "prompt",
        text: "Change files",
        turnId: "turn",
        timestamp: new Date(0),
      },
      edit("codex", "codex", "/repo/src/a.ts"),
      {
        kind: "assistant_message",
        id: "intermediate",
        text: "Working",
        turnId: "turn",
        timestamp: new Date(0),
      },
      edit("claude", "claude", "src/b.ts"),
      {
        kind: "assistant_message",
        id: "final",
        text: "Done",
        turnId: "turn",
        timestamp: new Date(0),
      },
    ];
    const summaries = collectResponseFileChanges(items, "/repo");
    expect(summaries.has("intermediate")).toBe(false);
    expect(
      summaries.get("final")?.files.map((file) => ({ path: file.path, counts: file.counts })),
    ).toEqual([
      { path: "src/a.ts", counts: { additions: 2, deletions: 1 } },
      { path: "src/b.ts", counts: { additions: 2, deletions: 1 } },
    ]);
  });
});

function changeResponse(details: ToolCallDetail[]): StreamItem[] {
  return [
    {
      kind: "user_message",
      id: "prompt",
      turnId: "change-turn",
      text: "Edit",
      timestamp: new Date(0),
    },
    ...details.map(
      (detail, index): StreamItem => ({
        kind: "tool_call",
        id: `edit-${index}`,
        turnId: "change-turn",
        timestamp: new Date(0),
        payload: {
          source: "agent",
          data: {
            provider: "claude",
            callId: `edit-${index}`,
            name: "Edit",
            status: "completed",
            error: null,
            detail,
          },
        },
      }),
    ),
    {
      kind: "assistant_message",
      id: "reply",
      turnId: "change-turn",
      text: "Done",
      timestamp: new Date(0),
    },
  ];
}

describe("recorded file-change accuracy", () => {
  it("labels summed repeated snippets as recorded edit volume rather than net totals", () => {
    const details: ToolCallDetail[] = [
      { type: "edit", filePath: "/repo/a", oldString: "old\n", newString: "middle\n" },
      { type: "edit", filePath: "a", oldString: "middle\n", newString: "new\nextra\n" },
    ];
    expect(
      collectResponseFileChanges(changeResponse(details), "/repo").get("reply")?.counts,
    ).toEqual({ additions: 3, deletions: 2 });
    expect(
      collectResponseFileChanges(changeResponse(details), "/repo").get("reply")?.recordedTotals,
    ).toBe(true);
    details.push({ type: "edit", filePath: "a", oldString: "new\nextra\n", newString: "old\n" });
    expect(
      collectResponseFileChanges(changeResponse(details), "/repo").get("reply")?.counts,
    ).toEqual({ additions: 4, deletions: 4 });
  });

  it("does not invent net totals for unrelated repeated snippets or a file overwrite", () => {
    const summary = collectResponseFileChanges(
      changeResponse([
        { type: "edit", filePath: "a", oldString: "one", newString: "two" },
        { type: "edit", filePath: "a", oldString: "three", newString: "four" },
        { type: "write", filePath: "b", content: "new content\n" },
      ]),
      "/repo",
    ).get("reply");
    expect(summary?.files.map((file) => [file.path, file.counts])).toEqual([
      ["a", { additions: 2, deletions: 2 }],
      ["b", null],
    ]);
    expect(summary?.counts).toBeNull();
  });

  it("uses saved workspace net diffs instead of double-counting provider snippets", () => {
    const items = changeResponse([
      { type: "edit", filePath: "/repo/a", oldString: "old", newString: "middle" },
      { type: "edit", filePath: "/repo/a", oldString: "middle", newString: "new" },
      {
        type: "edit",
        filePath: "/repo/a",
        unifiedDiff: '--- "a//repo/a"\n+++ "b//repo/a"\n@@ -1 +1 @@\n-old\n+new\n',
      },
      { type: "plain_text", text: "Workspace changes" },
    ]);
    for (const item of items.slice(3, 5)) {
      if (item.kind === "tool_call" && item.payload.source === "agent")
        item.payload.data.metadata = {
          paseoiWorkspaceSnapshot: true,
          complete: true,
          root: "/repo",
        };
    }
    const summary = collectResponseFileChanges(items, "/repo").get("reply");
    expect(summary).toMatchObject({ scope: "workspace", counts: { additions: 1, deletions: 1 } });
    expect(summary?.files[0]?.edits).toHaveLength(1);
    const present = createStreamPresentation()({
      tail: items,
      head: [],
      level: "detailed",
      transform: undefined,
      isTurnActive: false,
    });
    expect(JSON.stringify(present)).not.toContain("paseoiWorkspaceSnapshot");
    items.splice(3, 1);
    expect(collectResponseFileChanges(items, "/repo").size).toBe(0);
  });

  it("splits multi-file patches and counts changed lines that look like file headers", () => {
    const patch = [
      "diff --git a/a b/a",
      "--- a/a",
      "+++ b/a",
      "@@ -1 +1,2 @@",
      "---old",
      "+++new",
      "+extra",
      "diff --git a/deleted b/deleted",
      "--- a/deleted",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-removed",
    ].join("\n");
    const summary = collectResponseFileChanges(
      changeResponse([{ type: "edit", filePath: "a", unifiedDiff: patch }]),
      "/repo",
    ).get("reply");
    expect(summary?.files.map((file) => [file.path, file.counts])).toEqual([
      ["a", { additions: 2, deletions: 1 }],
      ["deleted", { additions: 0, deletions: 1 }],
    ]);
    expect(summary?.counts).toEqual({ additions: 2, deletions: 2 });
  });

  it("keeps truncated patches visible without reporting partial counts", () => {
    const summary = collectResponseFileChanges(
      changeResponse([
        {
          type: "edit",
          filePath: "a",
          unifiedDiff: "--- a/a\n+++ b/a\n@@ -1,3 +1,3 @@\n-old\n+new",
        },
      ]),
      "/repo",
    ).get("reply");
    expect(summary?.files[0]?.counts).toBeNull();
  });

  it("deduplicates replayed tool events and excludes failed or running edits", () => {
    const items = changeResponse([
      { type: "edit", filePath: "a", oldString: "old", newString: "new" },
    ]);
    const edit = items[1]!;
    expect(
      collectResponseFileChanges([items[0]!, edit, edit, items[2]!], "/repo").get("reply")?.counts,
    ).toEqual({ additions: 1, deletions: 1 });
    if (edit.kind !== "tool_call" || edit.payload.source !== "agent")
      throw new Error("Expected edit");
    edit.payload.data.status = "failed";
    expect(collectResponseFileChanges(items, "/repo").size).toBe(0);
    edit.payload.data.status = "running";
    expect(collectResponseFileChanges(items, "/repo").size).toBe(0);
  });

  it("never carries a previous response's files into a later response", () => {
    const items = changeResponse([{ type: "write", filePath: "a", content: "content" }]);
    items.push(
      {
        kind: "user_message",
        id: "second",
        turnId: "second",
        text: "Just explain",
        timestamp: new Date(1),
      },
      {
        kind: "assistant_message",
        id: "second-reply",
        turnId: "second",
        text: "Explanation",
        timestamp: new Date(2),
      },
    );
    const summaries = collectResponseFileChanges(items, "/repo");
    expect(Array.from(summaries.keys())).toEqual(["reply"]);
  });
});

it("uses patch metadata rather than hunk contents to identify files", () => {
  const summary = collectResponseFileChanges(
    changeResponse([
      {
        type: "edit",
        filePath: "actual.ts",
        unifiedDiff: "@@ -1 +1 @@\n--- old code\n+++ new code",
      },
      {
        type: "edit",
        filePath: "binary.dat",
        unifiedDiff:
          "diff --git a/binary.dat b/binary.dat\nBinary files differ\ndiff --git a/mode.sh b/mode.sh\nold mode 100644\nnew mode 100755",
      },
    ]),
    "/repo",
  ).get("reply");
  expect(summary?.files.map((file) => file.path)).toEqual(["actual.ts", "binary.dat", "mode.sh"]);
  expect(summary?.files[0]?.counts).toEqual({ additions: 1, deletions: 1 });
  expect(summary?.files[1]?.counts).toBeNull();
});
