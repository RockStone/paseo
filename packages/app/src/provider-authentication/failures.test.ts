import { expect, test } from "vitest";
import { groupAuthenticationFailures } from "./failures";
import { isProviderAuthenticationFailure } from "@getpaseo/protocol/authentication-failure";

test.each([
  "Your access token could not be refreshed because your refresh token was already used. Please sign in again.",
  "Your refresh token has already been used.",
  "Your refresh token has expired. Please sign in again.",
  "Your refresh token was revoked.",
  "refresh_token_reused",
  "Your authentication token has been invalidated.",
  "401 Unauthorized",
])("recognizes Codex authentication failures: %s", (error) => {
  expect(isProviderAuthenticationFailure("codex", error)).toBe(true);
});

test("ignores non-authentication errors and other providers", () => {
  for (const error of [
    "429 rate limit exceeded",
    "Billing limit exceeded",
    "Tool permission denied",
    "Could not resolve hostname",
    "Model not found",
  ]) {
    expect(isProviderAuthenticationFailure("codex", error)).toBe(false);
  }
  expect(isProviderAuthenticationFailure("other-provider", "401 Unauthorized")).toBe(false);
});

test("groups open agent failures by host and provider, and removes recovered failures", () => {
  const agents = [
    {
      serverId: "mac",
      provider: "codex",
      status: "error" as const,
      lastError: "refresh_token_reused",
    },
    {
      serverId: "mac",
      provider: "codex",
      status: "error" as const,
      lastError: "refresh_token_reused",
    },
    {
      serverId: "remote",
      provider: "codex",
      status: "error" as const,
      lastError: "refresh_token_reused",
    },
    {
      serverId: "mac",
      provider: "claude",
      status: "error" as const,
      lastError: "Failed to authenticate",
    },
    {
      serverId: "mac",
      provider: "claude",
      status: "closed" as const,
      lastError: "Failed to authenticate",
    },
    {
      serverId: "mac",
      provider: "codex",
      status: "error" as const,
      archivedAt: new Date(),
      lastError: "refresh_token_reused",
    },
  ];
  expect(groupAuthenticationFailures(agents)).toEqual([
    { serverId: "mac", provider: "codex", count: 2 },
    { serverId: "remote", provider: "codex", count: 1 },
    { serverId: "mac", provider: "claude", count: 1 },
  ]);
  agents[0]!.lastError = "";
  agents[1]!.lastError = "";
  expect(
    groupAuthenticationFailures(agents).find(
      (group) => group.serverId === "mac" && group.provider === "codex",
    ),
  ).toBeUndefined();
});
