import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentStreamEvent } from "../agent/agent-sdk-types.js";
import {
  MockLoadTestAgentClient,
  MockLoadTestAgentSession,
} from "../agent/providers/mock-load-test-agent.js";
import { createTestPaseoDaemon } from "./paseo-daemon.js";

const firstResponse = Promise.withResolvers<void>();

const questionInput = z.object({
  questions: z.array(z.object({ question: z.string(), header: z.string() })),
});
const questionAnswers = z.record(z.string(), z.string());

/** Replay the native Claude question tool alongside the permission interaction. */
function questionTranscript() {
  const requests = new Map<string, Extract<AgentStreamEvent, { type: "permission_requested" }>>();
  return (event: AgentStreamEvent): AgentStreamEvent[] => {
    if (event.type === "permission_requested" && event.request.kind === "question") {
      requests.set(event.request.id, event);
      return [
        {
          type: "timeline",
          provider: event.provider,
          turnId: event.turnId,
          item: {
            type: "tool_call",
            callId: event.request.id,
            name: "AskUserQuestion",
            status: "running",
            error: null,
            detail: { type: "unknown", input: event.request.input ?? null, output: null },
          },
        },
        event,
      ];
    }
    if (event.type !== "permission_resolved") return [event];
    const pending = requests.get(event.requestId);
    if (!pending || !event.resolution) return [event];
    requests.delete(event.requestId);
    let text: string | null = null;
    if (event.resolution.behavior === "allow") {
      const questions = questionInput.parse(pending.request.input).questions;
      const answers = questionAnswers.parse(event.resolution.updatedInput?.answers);
      const pairs = questions.map(
        (question) => `"${question.question}"="${answers[question.header]}"`,
      );
      text = `The user answered: ${pairs.join(", ")}. Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.`;
    }
    return [
      {
        type: "timeline",
        provider: event.provider,
        turnId: event.turnId,
        item: {
          type: "tool_call",
          callId: event.requestId,
          name: "AskUserQuestion",
          status: text === null ? "canceled" : "completed",
          error: null,
          detail: {
            type: "unknown",
            input: pending.request.input ?? null,
            output: text === null ? null : { output: text },
          },
        },
      },
      event,
    ];
  };
}

class RetryQuestionSession extends MockLoadTestAgentSession {
  private attempts = 0;

  override subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    const transcript = questionTranscript();
    return super.subscribe((event) => {
      for (const item of transcript(event)) callback(item);
    });
  }

  override async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    const transcript = questionTranscript();
    for await (const event of super.streamHistory()) yield* transcript(event);
  }

  override async respondToPermission(
    requestId: string,
    response: Parameters<MockLoadTestAgentSession["respondToPermission"]>[1],
  ) {
    this.attempts += 1;
    process.send?.({ type: "attempt", requestId, response, sessionId: this.id });
    if (this.attempts === 1) {
      await firstResponse.promise;
      throw new Error("Synthetic question response failure");
    }
    return super.respondToPermission(requestId, response);
  }
}

class RetryQuestionClient extends MockLoadTestAgentClient {
  override async createSession(config: Parameters<MockLoadTestAgentClient["createSession"]>[0]) {
    const session = new RetryQuestionSession({ config, sessionId: randomUUID() });
    session.subscribe((event) => {
      if (event.type === "permission_resolved") {
        process.send?.({
          type: "resolved",
          requestId: event.requestId,
          response: event.resolution,
          sessionId: session.id,
          pendingRequestIds: session.getPendingPermissions().map((request) => request.id),
        });
      }
    });
    return session;
  }
}

async function main(): Promise<void> {
  const daemon = await createTestPaseoDaemon({
    agentClients: { mock: new RetryQuestionClient() },
    isDev: true,
    mcpEnabled: false,
    corsAllowedOrigins: [`http://localhost:${process.env.E2E_METRO_PORT}`],
  });
  process.on("message", (message: unknown) => {
    if (message === "release") firstResponse.resolve();
  });
  const shutdown = async () => {
    firstResponse.resolve();
    await daemon.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  process.once("disconnect", () => void shutdown());
  process.send?.({ type: "ready", port: daemon.port, serverId: daemon.daemon.getServerId() });
}

void main().catch((error: unknown) => {
  process.send?.({ type: "error", error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
