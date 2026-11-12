#!/usr/bin/env bash
# Paseoi: release build of the iOS app, installed on every paired iPhone/iPad (USB or same Wi-Fi).
# Usage: paseoi-ios-device.sh [device-udid ...]   (default: all connected or paired physical devices)
# `expo run:ios` can't pass -allowProvisioningUpdates, and without it Xcode signs with the wildcard
# team profile, which has no push entitlement. So build with xcodebuild and install with devicectl.
# One generic-iOS build is installed on each device.
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_VARIANT=paseoi
if [[ $# -gt 0 ]]; then
  devices=("$@")
else
  devices=()
  while IFS= read -r udid; do
    [[ -n "$udid" ]] && devices+=("$udid")
  done < <(xcrun devicectl list devices 2>/dev/null | awk '(/ connected / || /available \(paired\)/) && /physical/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) { print $i; break } }')
fi
if [[ ${#devices[@]} -eq 0 ]]; then
  echo "No connected device. Plug one in, unlock it, or pass its UDID." >&2
  exit 1
fi
npm --prefix ../.. run build:client
# prebuild --clean can leave ios/ half-deleted (ENOTEMPTY on Pods) and then find no Podfile.
rm -rf ios
CI=1 npx expo prebuild --platform ios
xcodebuild -workspace ios/Paseoi.xcworkspace -scheme Paseoi -configuration Release \
  -destination "generic/platform=iOS" -derivedDataPath ios/build/dd -allowProvisioningUpdates build
failed=0
for device in "${devices[@]}"; do
  if xcrun devicectl device install app --device "$device" \
    ios/build/dd/Build/Products/Release-iphoneos/Paseoi.app; then
    echo "DEVICE_INSTALL_OK $device"
  else
    echo "DEVICE_INSTALL_FAILED $device" >&2
    failed=1
  fi
done
exit "$failed"
