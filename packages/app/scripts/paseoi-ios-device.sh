#!/usr/bin/env bash
# Paseoi: release build of the iOS app, installed on a USB-connected device.
# Usage: paseoi-ios-device.sh [device-udid]   (default: the first connected physical iPhone/iPad)
# `expo run:ios` can't pass -allowProvisioningUpdates, and without it Xcode signs with the wildcard
# team profile, which has no push entitlement. So build with xcodebuild and install with devicectl.
set -euo pipefail
cd "$(dirname "$0")/.."
export APP_VARIANT=paseoi
device="${1:-$(xcrun devicectl list devices 2>/dev/null | awk '/ connected / && /physical/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) { print $i; exit } }')}"
if [[ -z "$device" ]]; then
  echo "No connected device. Plug one in, unlock it, or pass its UDID." >&2
  exit 1
fi
npm --prefix ../.. run build:client
# prebuild --clean can leave ios/ half-deleted (ENOTEMPTY on Pods) and then find no Podfile.
rm -rf ios
CI=1 npx expo prebuild --platform ios
xcodebuild -workspace ios/Paseoi.xcworkspace -scheme Paseoi -configuration Release \
  -destination "id=$device" -derivedDataPath ios/build/dd -allowProvisioningUpdates build
xcrun devicectl device install app --device "$device" \
  ios/build/dd/Build/Products/Release-iphoneos/Paseoi.app
