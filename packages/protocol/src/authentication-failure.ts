/** Only provider authentication failures, not quota, billing, or tool permission errors. */
export function isProviderAuthenticationFailure(
  provider: string,
  error: string | null | undefined,
): boolean {
  if (!error) return false;
  if (provider === "claude")
    return /OAuth session expired|OAuth token.*(?:expired|revoked)|Login expired|Failed to authenticate|authentication_error|Invalid authentication credentials/i.test(
      error,
    );
  if (provider === "codex")
    return /(?:refresh token|refresh_token).*(?:expired|revoked|already(?: been)? used|reused|invalidated)|access token.*could not be refreshed|authentication token.*(?:expired|revoked|invalidated)|not (?:authenticated|logged in)|please (?:sign|log) in|authentication_error|401\b.*(?:auth|token)|(?:auth|token).*\b401/i.test(
      error,
    );
  return false;
}
