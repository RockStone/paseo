import { handleClaudeAuthenticationRequest } from "../../../session/provider/claude-authentication.js";
import type { SessionOutboundMessage } from "../../../messages.js";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  claudeAuthenticationStatus,
  claudeTokenCanSupplyEnvironment,
  createClaudeOAuthSource,
  readClaudeLogin,
  readClaudeToken,
  saveClaudeToken,
} from "./authentication.js";

const fixture = vi.hoisted(() => ({ output: "", code: 0, input: "", calls: [] as string[][] }));
vi.mock("node:child_process", () => ({
  spawn: (_command: string, args: string[]) => {
    fixture.calls.push(args);
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    stdin.on("data", (chunk) => {
      fixture.input += chunk.toString();
    });
    Object.assign(child, {
      stdout,
      stdin,
      kill() {
        child.emit("close", null);
      },
    });
    stdin.on("finish", () =>
      queueMicrotask(() => {
        stdout.end(fixture.output);
        child.emit("close", fixture.code);
      }),
    );
    return child;
  },
}));

const record = {
  token: "sk-ant-oat01-SYNTHETIC_TEST_ONLY",
  savedAt: "2026-10-23T00:00:00.000Z",
  renewBy: "2027-10-23T00:00:00.000Z",
};
beforeEach(() => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T00:00:00Z"));
  fixture.output = JSON.stringify(record);
  fixture.code = 0;
  fixture.input = "";
  fixture.calls = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("tokens travel through stdin, never command arguments, and saves verify the stored value", async () => {
  await saveClaudeToken(record.token, record.renewBy);
  expect(fixture.calls[0]).toEqual(["-i"]);
  expect(JSON.stringify(fixture.calls)).not.toContain(record.token);
  expect(fixture.input).toContain(record.token);
  expect(fixture.calls[1]?.[0]).toBe("find-generic-password");
});

test("an interactive keychain command that did not save the token fails closed", async () => {
  fixture.output = JSON.stringify({ ...record, token: "sk-ant-oat01-OTHER_SYNTHETIC_VALUE" });
  await expect(saveClaudeToken(record.token, record.renewBy)).rejects.toThrow("Unable to access");
});

test("keychain errors cannot surface credential output", async () => {
  fixture.code = 1;
  await expect(readClaudeToken()).rejects.toThrow("Unable to access");
  await expect(readClaudeToken()).rejects.not.toThrow(record.token);
});

test("a missing credential leaves the normal Claude login available", async () => {
  fixture.code = 44;
  expect(await readClaudeToken()).toBeNull();
});

test("the CLI's own login is read for rotation metadata only", async () => {
  const login = {
    claudeAiOauth: {
      accessToken: "sk-ant-oat01-SYNTHETIC_ACCESS",
      refreshToken: "sk-ant-ort01-SYNTHETIC_REFRESH",
      expiresAt: 1_790_000_000_000,
    },
  };
  fixture.output = JSON.stringify(login);
  const first = await readClaudeLogin();
  expect(first).toEqual({ refreshable: true, fingerprint: expect.any(String) });
  expect(JSON.stringify(first)).not.toContain("SYNTHETIC");
  expect(fixture.calls[0]).toContain("Claude Code-credentials");
  login.claudeAiOauth.expiresAt += 1;
  fixture.output = JSON.stringify(login);
  expect((await readClaudeLogin())?.fingerprint).not.toBe(first?.fingerprint);
  fixture.output = JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-ONLY" } });
  expect((await readClaudeLogin())?.refreshable).toBe(false);
  fixture.code = 44;
  expect(await readClaudeLogin()).toBeNull();
});

test("the setup-token is a fallback for a refreshable login until that login changes", async () => {
  let login: { refreshable: boolean; fingerprint: string } | null = {
    refreshable: true,
    fingerprint: "login-a",
  };
  const readToken = vi.fn(async () => record);
  const source = createClaudeOAuthSource({ readLogin: async () => login, readToken });
  expect(await source.resolve()).toEqual({
    token: null,
    loginFingerprint: "login-a",
    fallbackAvailable: true,
  });
  source.markLoginFailed("login-a");
  expect(await source.resolve()).toEqual({
    token: record.token,
    loginFingerprint: null,
    fallbackAvailable: false,
  });
  login = { refreshable: true, fingerprint: "login-b" };
  expect((await source.resolve()).token).toBeNull();
  login = { refreshable: false, fingerprint: "login-c" };
  expect((await source.resolve()).token).toBe(record.token);
  login = null;
  expect((await source.resolve()).token).toBe(record.token);
  const unreadable = createClaudeOAuthSource({
    readLogin: async () => {
      throw new Error("locked");
    },
    readToken,
  });
  expect((await unreadable.resolve()).token).toBe(record.token);
  const noFallback = createClaudeOAuthSource({
    readLogin: async () => ({ refreshable: true, fingerprint: "login-a" }),
    readToken: async () => null,
  });
  expect((await noFallback.resolve()).fallbackAvailable).toBe(false);
});

test("renewal reminders and authentication failures expose metadata only", async () => {
  fixture.output = JSON.stringify({ ...record, renewBy: "2026-10-25T00:00:00Z" });
  const status = await claudeAuthenticationStatus([]);
  expect(status.warning).toBe("renew_soon");
  expect(JSON.stringify(status)).not.toContain(record.token);
  fixture.output = JSON.stringify({ ...record, renewBy: "2026-10-20T00:00:00Z" });
  expect((await claudeAuthenticationStatus([])).warning).toBe("renewal_due");
});

test("host authentication failures are scoped to open Claude agents", async () => {
  const status = await claudeAuthenticationStatus([
    {
      provider: "claude",
      lifecycle: "error",
      lastError: "Failed to authenticate: OAuth session expired and could not be refreshed",
    },
    { provider: "codex", lifecycle: "error", lastError: "authentication_error" },
    { provider: "claude", lifecycle: "closed", lastError: "authentication_error" },
    { provider: "claude", lifecycle: "error", lastError: "Rate limited" },
  ]);
  expect(status.affectedAgents).toBe(1);
  expect(status.warning).toBe("authentication_failed");
});

test("host tokens never override explicit credentials, profiles, or custom endpoints", () => {
  for (const key of [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_PROFILE",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ]) {
    expect(claudeTokenCanSupplyEnvironment({ [key]: "explicit" })).toBe(false);
  }
  expect(claudeTokenCanSupplyEnvironment({})).toBe(true);
});

test("authentication RPCs return metadata only and redact validation failures", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const manager = { listAgents: () => [] };
  await handleClaudeAuthenticationRequest(
    { type: "provider.claude.authentication.get.request", requestId: "status" },
    manager,
    (message) => emitted.push(message),
  );
  expect(emitted[0]?.type).toBe("provider.claude.authentication.get.response");
  expect(JSON.stringify(emitted)).not.toContain(record.token);
  await handleClaudeAuthenticationRequest(
    {
      type: "provider.claude.authentication.set.request",
      requestId: "save",
      credential: { action: "save", token: "SECRET_INVALID_TOKEN", renewBy: record.renewBy },
    },
    manager,
    (message) => emitted.push(message),
  );
  expect(emitted[1]?.type).toBe("rpc_error");
  expect(JSON.stringify(emitted)).not.toContain("SECRET_INVALID_TOKEN");
});
