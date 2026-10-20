# Legacy handoff: Paseoi storage migration (completed)

**Status: completed and archived on October 16, 2026. Do not execute the migration instructions below.**

The user confirmed that the migration is complete. A read-only check found installed version `0.12.0-beta.1-rockstone.5`, the host directory `~/.paseo`, and desktop settings at `~/Library/Application Support/Paseoi`. The old `~/Library/Application Support/Paseo Custom` directory no longer exists.

Use [the custom-build documentation](docs/development.md#paseoi-custom-desktop-build) for the current setup. This file preserves the original migration plan and its pre-migration paths for historical reference. Any sizes, versions, or pending actions below describe that earlier state.

Typing-to-focus is a separate change; this archived migration plan does not establish whether that feature is included in an installed build.

## Original handoff (historical)

The original plan required a separate Codex session independent of the Paseo daemon, because the final migration quit Paseoi and stopped its daemon.

## Requested outcome

The user wants to keep using the custom **Paseoi.app**, including its selected-text Reply feature, with:

- Host data, configuration, plugins, and history in `~/.paseo`.
- Desktop preferences and saved connections in `~/Library/Application Support/Paseoi`, replacing the old `Paseo Custom` directory name.
- One saved local host, on `127.0.0.1:6770`, and one copy of each workspace in the UI.
- A desktop-managed daemon that starts with Paseoi and stops when the user quits Paseoi. No always-on service.
- The latest active Paseoi state preserved. Do not restore the older original host over it.

At the time this plan was written, the migration had not been executed.

## Current state, verified October 16, 2026

Checkout: `/Users/zono/Projects/paseo`.

- Fork: `https://github.com/RockStone/paseo`, remote `origin`.
- Upstream: `https://github.com/getpaseo/paseo`, remote `upstream`.
- Branch: `custom/reply-selection`.
- Last implementation commit when this handoff was written: `40cebd22f`, `fix(app): anchor selection replies to the active text endpoint`.
- Installed custom app: `/Applications/Paseoi.app`, version `0.12.0-beta.1-rockstone.4`, bundle ID `sh.rockstone.paseo`.
- Original `/Applications/Paseo.app` was moved to the Trash. The original daemon was stopped.
- This conversation now runs on Paseoi's daemon. Its current data is newer than the original copy.
- The user was instructed to remove the original `localhost:6767` saved host from Paseoi. Verify that only `6770` remains; do not assume it.

| Path                                                                          | Role                                                            | Approximate size      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------- |
| `~/Library/Application Support/Paseo Custom/daemon`                           | **Active, authoritative host data**                             | 986 MB                |
| `~/Library/Application Support/Paseo Custom`                                  | Active Electron userData, including the nested daemon directory | Inspect before moving |
| `~/.paseo`                                                                    | Older original host state; preserve as a dated rollback backup  | 991 MB                |
| `~/Library/Application Support/Paseo`                                         | Older original desktop preferences/browser storage              | 11 MB                 |
| `~/Library/Application Support/Paseo Custom/migration-backup-20261016-171948` | Pre-migration custom host backup                                | 985 MB                |

Most space is downloaded local speech models, about 984 MB per host copy. Report allocated and apparent sizes if assessing space savings on APFS; copies can share storage extents.

The previous migration copied five agent records and five projects into the custom host, preserved its separate server identity, and loaded `paseo-drive` successfully. Quitting and reopening Paseoi was tested: `6770` stopped on quit while original `6767` remained available at that time. Recheck counts against the current source; they can have changed.

## Read first

Read `AGENTS.md` / `CLAUDE.md` and relevant local docs: `docs/development.md` (custom build section), `docs/data-model.md`, `docs/testing.md`, and `docs/qa.md`. These contain build, persistence, and verification constraints.

Key implementation locations:

- `packages/desktop/src/main.ts`: custom-build detection, app name, Electron userData override, and current `PASEO_HOME` default.
- `packages/desktop/src/daemon/custom-build.ts` and its test: persists listener `127.0.0.1:6770`. Managed launches discard `PASEO_LISTEN`, so set the listener in `config.json`.
- `packages/desktop/src/daemon/daemon-manager.ts`: managed daemon ownership and version normalization.
- `packages/desktop/src/daemon/quit-lifecycle.ts` and its test: stop-on-quit behavior.
- `packages/desktop/src/settings/desktop-settings.ts`: `desktop-settings.json` persistence.
- `packages/app/src/runtime/daemon-start-service.ts`: startup skips connection registration if the server ID already exists. Preserve the active host's identity and port to avoid stale saved endpoints.
- `scripts/build-custom-desktop.sh`: custom packaging; default revision is currently 4.
- `packages/desktop/e2e/packaged-app-smoke.js`: packaged smoke harness with isolated home and userData.

## Source changes

1. For packaged custom builds, set Electron userData to `appData/Paseoi` and default the daemon home to `~/.paseo`. Preserve deliberate `PASEO_HOME` overrides and the test userData override. Avoid importing the caller's old home accidentally during validation.
2. Keep `6770` for this migration. Keeping the active port and server identity preserves the existing host connection. The home directory does not require port `6767`.
3. Keep daemon management enabled and `keepRunningAfterQuit: false`. Do not install a LaunchAgent or background service.
4. Update the existing custom-build section in `docs/development.md` to describe the final paths and ownership. Remove obsolete statements that the custom app must always isolate itself from an installed original app.
5. Increment the custom revision to 5 or the next unused revision. Preserve the Reply feature and its endpoint-based popup positioning. Keep official update installation disabled for custom builds.
6. Finish the user-facing rename to Paseoi. Preserve the established bundle ID. Internal executable/helper names, npm package names, and the `paseo` protocol/CLI are separate compatibility concerns: do not rename them as a text replacement. The current build deliberately uses `--config.productName=Paseo`, `extraMetadata.productName=Paseoi`, and a post-build bundle rename; previous attempts to change internal packaging names broke the bundled runtime. Audit dependencies and test any additional internal rename before shipping it.

Migrate this machine once while the apps are stopped. Avoid adding a permanent startup copy/merge mechanism that might overwrite live data on every launch.

## Prepare before quitting anything

- Confirm the Codex agent is independent of Paseoi. Inspect `PASEO_HOME`, the process ancestry, and how the agent was launched; a changed environment variable alone does not move the agent out of the daemon.
- Check current listeners and daemon status for both homes. Do not stop unrelated daemons or assume a stale PID file identifies a live process.
- Build and test the updated app using disposable homes and userData. Do not let an isolated test select production `~/.paseo` through an inherited environment variable.
- Prepare a migration script and rollback instructions. Ensure sufficient free space and backup permissions. Do not print config secrets, keypairs, or local credentials.
- Tell the user before the final quit: active agents and terminals will be interrupted. The requested end state includes a controlled restart; if any additional destructive cleanup is needed, obtain separate approval.

## Offline migration sequence

1. Quit only Paseoi gracefully. Wait for its app process and listener on `6770` to exit. Do not use a broad process-name kill. If the independent agent cannot establish which process owns a listener, stop and investigate.
2. Make dated backups of the current host, desktop userData, and installed app. Preserve permissions and symlinks. Avoid recursively copying a backup into itself: the existing backup and active daemon are both nested in `Paseo Custom`.
3. Rename the older `~/.paseo` to a dated backup. Move the **current custom daemon directory** to `~/.paseo`. Moving the authoritative directory preserves its server ID, relay keypair, profiles, projects, plugins, attachments, and latest agent records without merging histories.
4. Move the remaining current desktop userData from `Paseo Custom` to `Paseoi`. Keep its current desktop settings and Chromium storage, including saved host connections. Do not replace them with the older `Application Support/Paseo` contents. Handle any existing destination explicitly; never silently overwrite it.
5. Audit persisted absolute paths. The earlier migration rewrote plugin paths under `~/.paseo` to `Paseo Custom/daemon`; those need to point back to `~/.paseo`. Also check managed attachments, creations, workspace/worktree paths, and plugin-source metadata. Rewrite actual path fields, not arbitrary conversation text. External plugin sources such as `/Users/zono/Projects/paseo-drive` stay where they are. Check persisted references to Electron userData too.
6. Leave stopped-process lock files, per-run credentials, and managed-process records out of the new runtime as appropriate to the repository's daemon-control behavior. Preserve durable identity files. Never copy a live process's runtime ownership records into another running host.
7. Install the validated replacement at `/Applications/Paseoi.app`. Preserve a rollback copy of revision 4.
8. Launch with an explicit `PASEO_HOME=/Users/zono/.paseo` for initial verification. `open --env PASEO_HOME=/Users/zono/.paseo -a /Applications/Paseoi.app` is available on this Mac. Wait for app exit before relaunching; immediate reopening during shutdown previously returned LaunchServices error `-600`.
9. Test a normal Finder/Dock launch too. It must use the new default paths without a temporary launcher or environment setting. Do not leave aliases/symlinks masking a failed migration unless explicitly chosen and documented.

## Validation

Use the repo npm scripts for linting/formatting. Do not run the full test suite.

- Add or adjust focused tests for home selection, explicit overrides, and stop-on-quit where behavior changes. Use existing suites.
- Run `npm run typecheck` and `npm run lint`. If workspace declarations are stale, build the owning stack before diagnosing type errors.
- Run `npm run format:files -- <changed-files>` while working and `npm run format` before a commit; review unrelated changes rather than including them blindly.
- Build with `PASEO_CUSTOM_REVISION=5 npm run build:custom:desktop` (adjust revision if needed). Verify the local ad-hoc signature. This build is not notarized.
- Run the packaged smoke harness using temporary home/userData. Avoid `--custom-defaults` while real `6770` is occupied; that mode deliberately uses `6770`.
- After migration, verify status reports home `/Users/zono/.paseo`, listener `127.0.0.1:6770`, the active custom host's original server ID, and the bundled custom runtime.
- Verify Electron userData is `~/Library/Application Support/Paseoi` and `desktop-settings.json` retains daemon management enabled with keep-running disabled.
- Check existing conversations, current projects/workspaces, profiles, model availability, attachments, and plugin readiness. Verify one local host and no duplicated workspace list. Test Reply insertion and popup placement.
- Quit Paseoi: `6770` must stop. Reopen it: the host and saved state must return. Nothing should listen on `6767` unless the user intentionally starts another host.

Keep the dated backups until the user has accepted the result. Do not delete `~/.paseo` after this migration: it becomes the live Paseoi home. Stop writing to the old paths after migration.

## Rollback and delivery

If validation fails, quit the replacement, retain any new data for recovery, restore the prior app and directory layout from the dated backups, and relaunch with the previous custom home explicitly selected. Do not merge older state over newer conversations.

Report the installed version, final paths, daemon ownership/quit behavior, checks actually performed, backup locations and sizes, and remaining limitations. Distinguish source changes, a built artifact, an installed app, and live UI verification. Commit/push only if requested by the user; preserve unrelated work.
