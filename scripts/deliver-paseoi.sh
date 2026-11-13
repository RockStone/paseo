#!/usr/bin/env bash
# Paseoi delivery: desktop app, hydrodojo web app, iPhone/iPad (OTA or cable). See docs/development.md.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

skip_desktop=0 skip_web=0 skip_mobile=0 ios_device=0 revision="" message=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-desktop) skip_desktop=1 ;;
    --skip-web) skip_web=1 ;;
    --skip-mobile) skip_mobile=1 ;;
    --ios-device) ios_device=1 ;;
    --revision) revision="${2:?--revision needs a number}"; shift ;;
    --message) message="${2:?--message needs text}"; shift ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

APP=/Applications/Paseoi.app
PLIST="$APP/Contents/Info.plist"
summary=()
log() { echo "==> $*"; }

daemon_started_at() {
  npm run --silent cli -- daemon status --home "$HOME/.paseo" --json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const j = JSON.parse(s); console.log(j.startedAt ?? j.daemon?.startedAt ?? "unknown"); }
      catch { console.log("unknown"); }
    });'
}

deliver_desktop() {
  local current n
  if [[ -n "$revision" ]]; then
    n="$revision"
  else
    current="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST" 2>/dev/null || true)"
    if [[ "$current" =~ -paseoi\.([0-9]+)$ ]]; then
      n=$((BASH_REMATCH[1] + 1))
    else
      echo "Cannot read the installed -paseoi.N version (got '$current'); pass --revision N." >&2
      return 1
    fi
  fi
  [[ "$n" =~ ^[0-9]+$ ]] || { echo "Revision must be a whole number: $n" >&2; return 1; }

  log "Desktop: building revision $n"
  env -u PASEO_HOME -u PASEO_CLI PASEO_CUSTOM_REVISION="$n" npm run build:custom:desktop

  local built="$ROOT_DIR/packages/desktop/release/mac-arm64/Paseoi.app" attempt ok=0
  for attempt in 1 2 3; do
    log "Desktop: smoke test, attempt $attempt/3"
    if node packages/desktop/e2e/packaged-app-smoke.js --app "$built"; then ok=1; break; fi
  done
  [[ "$ok" == 1 ]] || { echo "Packaged app smoke test failed 3 times." >&2; return 1; }

  codesign --verify --deep --strict "$built"
  local before after
  before="$(daemon_started_at)"
  [[ "$before" != "unknown" ]] || { echo "Cannot read the daemon startedAt; refusing to install blind." >&2; return 1; }
  log "Desktop: installing (daemon startedAt before: $before)"
  rm -rf "$APP.new" "$APP.old"
  ditto "$built" "$APP.new"
  if [[ -d "$APP" ]]; then mv "$APP" "$APP.old"; fi
  mv "$APP.new" "$APP"
  rm -rf "$APP.old"
  cmp "$built/Contents/Resources/app.asar" "$APP/Contents/Resources/app.asar"
  codesign --verify --deep --strict "$APP"
  after="$(daemon_started_at)"
  if [[ "$before" != "$after" ]]; then
    echo "DAEMON STARTEDAT CHANGED: $before -> $after. Something restarted the daemon." >&2
    return 1
  fi
  rm -rf packages/desktop/release
  summary+=("desktop: $(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$PLIST") installed, daemon unchanged")
}

web_bundle() {
  curl -fsS "https://app.hydrodojo.com/?v=$RANDOM" | grep -oE '/_expo/static/js/web/[^"]+\.js' | head -1
}

deliver_web() {
  local config=packages/app/wrangler.hydrodojo.toml
  if [[ ! -f "$config" ]]; then
    log "Web: skipped, $config is missing (local-only config)"
    summary+=("web: skipped (no wrangler.hydrodojo.toml)")
    return 0
  fi
  local before after out
  before="$(web_bundle || true)"
  log "Web: building (bundle before: ${before:-none})"
  npm run build:web --workspace=@getpaseo/app
  out="$(cd packages/app && npx wrangler deploy -c wrangler.hydrodojo.toml 2>&1)"
  echo "$out"
  # The edge can serve the old index for a few seconds after deploy.
  for _ in 1 2 3 4 5 6; do
    after="$(web_bundle || true)"
    [[ -n "$after" && "$before" != "$after" ]] && break
    sleep 5
  done
  [[ -n "$after" && "$before" != "$after" ]] || { echo "Web bundle did not change after deploy ($before)." >&2; return 1; }
  summary+=("web: $(grep -oE 'Current Version ID: [0-9a-f-]+' <<<"$out" | head -1 || true) bundle $after")
}

deliver_mobile() {
  if [[ "$ios_device" == 1 ]]; then
    log "Mobile: cable build and install"
    local out
    out="$(bash packages/app/scripts/paseoi-ios-device.sh 2>&1 | tee /dev/stderr)"
    summary+=("devices: $(grep -E 'DEVICE_INSTALL_(OK|FAILED)' <<<"$out" | tr '\n' ' ')")
    return 0
  fi
  local token_file="$HOME/.config/paseoi/expo-token"
  [[ -r "$token_file" ]] || { echo "Missing $token_file (Expo robot token)." >&2; return 1; }
  EXPO_TOKEN="$(<"$token_file")"
  export EXPO_TOKEN
  [[ -n "$message" ]] || message="$(git log -1 --format=%s)"

  # eas introspects the config and fails while packages/app/ios exists (the generated Info.plist
  # already declares scenes). Move it aside and always restore it.
  # Globals, not locals: the EXIT trap runs after this function has returned.
  IOS_DIR="$ROOT_DIR/packages/app/ios"
  IOS_ASIDE="$ROOT_DIR/packages/app/.ios-aside"
  IOS_MOVED=0
  trap restore_ios EXIT
  if [[ -d "$IOS_DIR" ]]; then rm -rf "$IOS_ASIDE"; mv "$IOS_DIR" "$IOS_ASIDE"; IOS_MOVED=1; fi

  log "Mobile: publishing OTA update"
  local out
  out="$(cd packages/app && APP_VARIANT=paseoi npx eas-cli@latest update --channel paseoi \
    --platform ios --environment production --message "$message" --non-interactive 2>&1 | tee /dev/stderr)"
  restore_ios
  trap - EXIT
  summary+=("ota: $(grep -iE 'group id' <<<"$out" | head -1 | sed 's/^ *//' || true)")
}

restore_ios() {
  if [[ "${IOS_MOVED:-0}" == 1 && -d "$IOS_ASIDE" && ! -e "$IOS_DIR" ]]; then
    mv "$IOS_ASIDE" "$IOS_DIR"
    IOS_MOVED=0
  fi
}

[[ "$skip_desktop" == 1 ]] || deliver_desktop
[[ "$skip_web" == 1 ]] || deliver_web
[[ "$skip_mobile" == 1 ]] || deliver_mobile

echo
echo "Paseoi delivery summary"
for line in "${summary[@]}"; do echo "  $line"; done
