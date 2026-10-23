import { isProviderAuthenticationFailure } from "@getpaseo/protocol/authentication-failure";
import { spawn } from "node:child_process";
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
