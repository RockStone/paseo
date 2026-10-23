import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { AgentManager } from "../../agent/agent-manager.js";
import {
  claudeAuthenticationStatus,
  removeClaudeToken,
  saveClaudeToken,
} from "../../agent/providers/claude/authentication.js";

type AuthenticationRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "provider.claude.authentication.get.request"
      | "provider.claude.authentication.set.request";
  }
>;

export async function handleClaudeAuthenticationRequest(
  message: AuthenticationRequest,
  manager: Pick<AgentManager, "listAgents">,
  emit: (message: SessionOutboundMessage) => void,
): Promise<void> {
  try {
    if (message.type === "provider.claude.authentication.get.request") {
      const status = await claudeAuthenticationStatus(manager.listAgents());
      emit({
        type: "provider.claude.authentication.get.response",
        payload: { requestId: message.requestId, ...status },
      });
      return;
    }
    if (message.credential.action === "save") {
      await saveClaudeToken(message.credential.token, message.credential.renewBy);
    } else await removeClaudeToken();
    emit({
      type: "provider.claude.authentication.set.response",
      payload: { requestId: message.requestId, acknowledged: true },
    });
  } catch {
    // The request and underlying process output can contain credentials.
    emit({
      type: "rpc_error",
      payload: {
        requestId: message.requestId,
        requestType: message.type,
        error:
          "Unable to access Claude authentication. Check the token, renewal date, and unlocked macOS Keychain.",
        code: "claude_authentication_failed",
      },
    });
  }
}
