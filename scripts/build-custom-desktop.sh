#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
BASE_VERSION="$(node -p 'require("./package.json").version')"
CUSTOM_VERSION="${BASE_VERSION}-rockstone.${PASEO_CUSTOM_REVISION:-13}"

CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:desktop -- \
  --publish never --mac --dir \
  --config.appId=sh.rockstone.paseo \
  --config.productName=Paseo \
  --config.extraMetadata.productName=Paseoi \
  --config.mac.extendInfo.CFBundleDisplayName=Paseoi \
  --config.mac.icon="$ROOT_DIR/Paseoi.icns" \
  --config.extraMetadata.version="$CUSTOM_VERSION" \
  --config.mac.identity=null \
  --config.mac.notarize=false \
  "$@"

for CUSTOM_ARCH_DIR in mac mac-arm64; do
  CUSTOM_OUTPUT_DIR="$ROOT_DIR/packages/desktop/release/$CUSTOM_ARCH_DIR"
  if [[ -d "$CUSTOM_OUTPUT_DIR/Paseo.app" ]]; then
    rm -rf -- "$CUSTOM_OUTPUT_DIR/Paseoi.app"
    mv -- "$CUSTOM_OUTPUT_DIR/Paseo.app" "$CUSTOM_OUTPUT_DIR/Paseoi.app"
    /usr/libexec/PlistBuddy -c "Set :CFBundleName Paseoi" \
      "$CUSTOM_OUTPUT_DIR/Paseoi.app/Contents/Info.plist"
    sips -s format png "$ROOT_DIR/Paseoi.icns" \
      --out "$CUSTOM_OUTPUT_DIR/Paseoi.app/Contents/Resources/icon.png" >/dev/null
    # Electron locates UI helpers by CFBundleName. Retain the original helpers
    # too: the bundled CLI and daemon resolve them from the main executable name.
    for CUSTOM_HELPER_SUFFIX in "" " (GPU)" " (Plugin)" " (Renderer)"; do
      CUSTOM_HELPER_NAME="Paseoi Helper${CUSTOM_HELPER_SUFFIX}"
      CUSTOM_HELPER_DIR="$CUSTOM_OUTPUT_DIR/Paseoi.app/Contents/Frameworks/$CUSTOM_HELPER_NAME.app"
      ditto "$CUSTOM_OUTPUT_DIR/Paseoi.app/Contents/Frameworks/Paseo Helper${CUSTOM_HELPER_SUFFIX}.app" \
        "$CUSTOM_HELPER_DIR"
      mv -- "$CUSTOM_HELPER_DIR/Contents/MacOS/Paseo Helper${CUSTOM_HELPER_SUFFIX}" \
        "$CUSTOM_HELPER_DIR/Contents/MacOS/$CUSTOM_HELPER_NAME"
      /usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $CUSTOM_HELPER_NAME" \
        "$CUSTOM_HELPER_DIR/Contents/Info.plist"
      /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $CUSTOM_HELPER_NAME" \
        "$CUSTOM_HELPER_DIR/Contents/Info.plist"
    done
    codesign --force --deep --sign - "$CUSTOM_OUTPUT_DIR/Paseoi.app"
  fi
done
