---
title: Claude Code
description: Run Claude Code in Paseo using your existing Claude plan.
nav: Claude Code
order: 23
category: Providers
---

# Claude Code

Paseo runs Claude Code through the official `claude` CLI using the Claude Agent SDK.

## Does Claude Code cost extra in Paseo?

No. Claude Code usage in Paseo counts against your normal Claude plan limits. It does not require a separate pool of Agent SDK credits.

You still need a Claude plan that includes Claude Code, and your plan's usual usage limits apply.

## Getting started

Install and sign in to the Claude Code CLI on the machine running Paseo. Paseo uses that existing installation and account when you start a Claude Code agent.

If your Claude login expires, re-authenticate with the Claude Code CLI, then start a new Claude Code session in Paseo. Existing Paseo sessions keep the authentication they started with, so re-authenticating does not update a session that is already running.

## Unattended sessions in Paseoi

On macOS, the custom Paseoi build can use a long-lived subscription token from
`claude setup-token`. Complete the browser authorization yourself. Paste the result into
**Settings → your host → Providers → Claude → Authentication**, or run
`python3 scripts/store-claude-token.py` on the host. Both store the token in macOS Keychain
(service `sh.paseoi.claude-oauth`, account `default`), outside your repository and agent instructions.
The setup command prints the token but does not save it for you.

The stored token applies when the default Claude provider launches its next process. Saving or
removing it does not interrupt running agents. Explicit credential environment variables,
profiles, custom configuration directories, third-party endpoints, and derived providers retain
their own authentication. Restoring authentication alone does not replay failed work.

Set the renewal reminder to the token's issue date plus one year. The default assumes you generated
it today; this is a reminder date, not a server-verified expiry. Paseoi checks once per hour while
the app is active and warns seven days before that date. Authentication failures in open Claude
and Codex agents use existing agent updates, so they do not wait for the hourly check. A local
status check cannot prove that Anthropic will accept a credential or predict revocation. These checks make no model requests and do not renew tokens.

## Use Claude Code in the Paseo terminal

Claude Code also works great inside the Paseo terminal. If you prefer the standard CLI experience, open a terminal in your workspace and run `claude` as usual.

You can use the terminal from Paseo's desktop, web, or mobile app while keeping access to your workspace, git changes, and other Paseo tools.

## See also

- [Supported providers](/docs/supported-providers), for other agents you can run alongside Claude Code.
- [Custom providers](/docs/custom-providers), for custom binaries, third-party endpoints, or multiple Claude profiles.
- [Paseo vs Claude Desktop](/alternatives/claude-desktop), for a feature comparison.
