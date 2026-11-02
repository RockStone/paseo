import { isProviderAuthenticationFailure } from "@getpaseo/protocol/authentication-failure";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { userInfo } from "node:os";
import { z } from "zod";
import type { ManagedAgent } from "../../agent-manager.js";

export const CLAUDE_TOKEN_SERVICE = "sh.paseoi.claude-oauth";
export const CLAUDE_TOKEN_ACCOUNT = "default";
const TokenRecordSchema = z.object({
  token: z
    .string()
    .regex(/^sk-ant-oat01-[A-Za-z0-9_-]+$/)
    .max(8192),
  savedAt: z.iso.datetime(),
  renewBy: z.iso.datetime(),
});
type TokenRecord = z.infer<typeof TokenRecordSchema>;

export class ClaudeCredentialError extends Error {
  constructor() {
    super(
      "Unable to access the Claude token in macOS Keychain. Unlock your login keychain and try again.",
    );
    this.name = "ClaudeCredentialError";
  }
}

// Never put a token in argv or propagate subprocess errors containing stdin/stdout.
function security(args: string[], input?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    const timeout = setTimeout(() => child.kill(), 10_000);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", () => {
      clearTimeout(timeout);
      reject(new ClaudeCredentialError());
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim());
      else if (code === 44) resolve(null);
      else reject(new ClaudeCredentialError());
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export async function readClaudeToken(): Promise<TokenRecord | null> {
  if (process.platform !== "darwin") return null;
  const value = await security([
    "find-generic-password",
    "-s",
    CLAUDE_TOKEN_SERVICE,
    "-a",
    CLAUDE_TOKEN_ACCOUNT,
    "-w",
  ]);
  if (value === null) return null;
  try {
    return TokenRecordSchema.parse(JSON.parse(value));
  } catch {
    throw new ClaudeCredentialError();
  }
}

export async function saveClaudeToken(token: string, renewBy: string): Promise<void> {
  if (process.platform !== "darwin") throw new ClaudeCredentialError();
  const record = TokenRecordSchema.safeParse({
    token: token.trim(),
    savedAt: new Date().toISOString(),
    renewBy,
  });
  if (!record.success || Date.parse(renewBy) <= Date.now()) {
    throw new Error("Enter a Claude setup-token and a future renewal date.");
  }
  const password = JSON.stringify(record.data).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  await security(
    ["-i"],
    `add-generic-password -U -s ${CLAUDE_TOKEN_SERVICE} -a ${CLAUDE_TOKEN_ACCOUNT} -w "${password}"\n`,
  );
  const stored = await readClaudeToken();
  if (stored?.token !== record.data.token || stored.renewBy !== renewBy)
    throw new ClaudeCredentialError();
}

export async function removeClaudeToken(): Promise<void> {
  if (process.platform !== "darwin") throw new ClaudeCredentialError();
  await security([
    "delete-generic-password",
    "-s",
    CLAUDE_TOKEN_SERVICE,
    "-a",
    CLAUDE_TOKEN_ACCOUNT,
  ]);
}

// The Claude CLI's own login. Only presence and rotation matter here, never the token values.
const CLAUDE_LOGIN_SERVICE = "Claude Code-credentials";
const ClaudeLoginRecordSchema = z.object({
  claudeAiOauth: z
    .object({ refreshToken: z.string().optional(), expiresAt: z.number().optional() })
    .optional(),
});

export interface ClaudeLogin {
  refreshable: boolean;
  /** Changes whenever the CLI refreshes the login or the user signs in again. */
  fingerprint: string;
}

/** Reads the Claude CLI's Keychain login the way the CLI resolves it (account item, then any). */
export async function readClaudeLogin(): Promise<ClaudeLogin | null> {
  if (process.platform !== "darwin") return null;
  const user = process.env["USER"] || userInfo().username;
  // Keep in sync with Claude Code's Keychain account derivation.
  const account = /^[a-zA-Z0-9._-]+$/.test(user) ? user : "claude-code-user";
  for (const args of [
    ["find-generic-password", "-a", account, "-w", "-s", CLAUDE_LOGIN_SERVICE],
    ["find-generic-password", "-w", "-s", CLAUDE_LOGIN_SERVICE],
  ]) {
    const value = await security(args);
    if (value === null) continue;
    let oauth: z.infer<typeof ClaudeLoginRecordSchema>["claudeAiOauth"];
    try {
      oauth = ClaudeLoginRecordSchema.parse(JSON.parse(value)).claudeAiOauth;
    } catch {
      throw new ClaudeCredentialError();
    }
    if (!oauth) continue;
    return {
      refreshable: Boolean(oauth.refreshToken),
      fingerprint: createHash("sha256")
        .update(`${oauth.expiresAt ?? ""}:${oauth.refreshToken ?? ""}`)
        .digest("hex")
        .slice(0, 16),
    };
  }
  return null;
}

export interface ClaudeOAuthLaunch {
  /** Setup-token to inject, or null so the CLI uses and refreshes its own login. */
  token: string | null;
  /** The regular login this launch relies on; null when a token is injected or none exists. */
  loginFingerprint: string | null;
  /** Whether a stored setup-token can take over when that login fails. */
  fallbackAvailable: boolean;
}

export interface ClaudeOAuthSource {
  resolve(): Promise<ClaudeOAuthLaunch>;
  /** The CLI could not use or refresh this login; use the setup-token until it changes. */
  markLoginFailed(fingerprint: string): void;
}

/**
 * Prefers the Claude CLI's refreshable login so the CLI keeps it fresh (Usage reads it), and
 * falls back to the stored setup-token when that login is missing or has failed.
 */
export function createClaudeOAuthSource(
  lookup: {
    readLogin?: () => Promise<ClaudeLogin | null>;
    readToken?: () => Promise<TokenRecord | null>;
  } = {},
): ClaudeOAuthSource {
  const readLogin = lookup.readLogin ?? readClaudeLogin;
  const readToken = lookup.readToken ?? readClaudeToken;
  let failedLogin: string | null = null;
  return {
    async resolve() {
      const login = await readLogin().catch(() => null);
      if (login?.refreshable && login.fingerprint !== failedLogin) {
        const fallbackAvailable = await readToken().then(
          (record) => record !== null,
          () => false,
        );
        return { token: null, loginFingerprint: login.fingerprint, fallbackAvailable };
      }
      const record = await readToken();
      return { token: record?.token ?? null, loginFingerprint: null, fallbackAvailable: false };
    },
    markLoginFailed(fingerprint) {
      failedLogin = fingerprint;
    },
  };
}

export function claudeTokenCanSupplyEnvironment(env: NodeJS.ProcessEnv): boolean {
  const overrides = [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_PROFILE",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ];
  return !overrides.some((key) => Boolean(env[key]));
}

export async function claudeAuthenticationStatus(
  agents: Pick<ManagedAgent, "provider" | "lifecycle" | "lastError">[],
) {
  const record = await readClaudeToken();
  const affectedAgents = agents.filter(
    (agent) =>
      agent.provider === "claude" &&
      agent.lifecycle !== "closed" &&
      isProviderAuthenticationFailure("claude", agent.lastError),
  ).length;
  let warning: "authentication_failed" | "renew_soon" | "renewal_due" | null = null;
  if (record && Date.parse(record.renewBy) <= Date.now()) warning = "renewal_due";
  else if (record && Date.parse(record.renewBy) - Date.now() <= 7 * 24 * 60 * 60 * 1000)
    warning = "renew_soon";
  if (affectedAgents > 0) warning = "authentication_failed";
  return {
    tokenStored: record !== null,
    renewBy: record?.renewBy ?? null,
    warning,
    affectedAgents,
  };
}
