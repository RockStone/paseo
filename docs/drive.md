# Drive: Paseoi on the native iPhone/iPad app

Goal: a release build of Paseoi installed directly on the owner's iPhone and iPad (paid Apple
developer account, no TestFlight), with the Paseoi features that matter on touch ported from the
web-only code paths.

Coordinator: the Paseoi agent in this workspace. Development: Sonnet 5.5 agents, one task at a time
per file area. Each task lands on `paseoi/v0.16.0` with typecheck, lint, format and its focused tests,
then the Paseoi desktop build and app.hydrodojo.com are redelivered as usual.

Already native and out of scope: Driveboard, multi-select, reply to a response, galleries and
lightbox, composer git pills, sidebar tree and multi-select, usage bars, heartbeats, Run menu.
Desktop-only and out of scope: edge-reveal sidebar, title bar, hover cards, Electron chimes.

## Step 1: small native fixes, then the first device build

- [x] N-1 Sidebar agent row menu on native. Archive, copy IDs, rename and the rest are unreachable on native because `components/sidebar/sidebar-agent-menu.tsx` sets `enabledOnMobile={false}` and agent rows have no kebab. Open it by long-press and show a kebab when `useHoverControlsAlwaysVisible()` is true. <!-- priority:3 -->
- [x] N-2 Context meter Compact/Refresh on native iPad. `components/context-window-meter.tsx` uses a Tooltip that takes no presses on wide native layouts; use the sheet path whenever there is no fine pointer. <!-- priority:3 -->
- [x] N-3 "Paste as file" in the composer attachment menu. Today it only fires from the keyboard shortcut (`composer/attachments/paste-text-action.tsx`); add a menu entry so touch users reach it. <!-- priority:2 -->
- [x] N-4 Paseoi iOS app identity. Own bundle ID (e.g. `…paseoi`), Paseoi name and icon through the existing `APP_VARIANT` config in `packages/app/app.config.js`, so it installs beside the official Paseo app. Document the release device-build command in `docs/development.md`. <!-- priority:3 -->
- [ ] N-5 First release build on the owner's iPhone and iPad. `expo run:ios --configuration Release --device`, signed with the owner's team; verify pairing through relay.hydrodojo.com, Driveboard, multi-select, host password. Needs the owner's devices plugged in (see OT items). <!-- priority:3 -->

## Step 2: reading position on native

- [ ] N-6 Native unread pill, jump and first-unread highlight. `agent-stream/view.tsx` enables `useUnreadJump` only on web; the native viewport (`agent-stream/strategy-native.tsx`) needs reading-row reporting (LegendList `onViewableItemsChanged`) and a `scrollToMessage` on its handle. <!-- priority:3 -->
- [ ] N-7 Native read-position restore and land-at-bottom on return, reusing the N-6 viewport work. <!-- priority:2 -->
- [ ] N-8 Rebuild and reinstall on the devices after step 2. <!-- priority:2 -->

## Later (owner decides)

- [ ] N-9 Composer references render as pills on native instead of raw `[label](thread:…)` Markdown (`composer/input/decorated-input.tsx` is a plain input on native). Large for real inline styling; a pill strip is medium. <!-- priority:1 -->
- [ ] N-10 Reply/Copy on selected text on native (needs custom items in the native text-selection menu). Large. <!-- priority:1 -->
- [ ] N-11 Composer split beside the transcript on iPad. Medium. <!-- priority:1 -->
- [ ] N-12 Web links open in an in-app browser on native instead of Safari. <!-- priority:1 -->
- [ ] N-13 Small extras: table copy, long-press file-link menu, foreground chime. <!-- priority:1 -->
