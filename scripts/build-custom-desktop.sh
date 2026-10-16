#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
BASE_VERSION="$(node -p 'require("./package.json").version')"
CUSTOM_VERSION="${BASE_VERSION}-rockstone.${PASEO_CUSTOM_REVISION:-2}"

CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:desktop -- \
  --publish never --mac --dir \
  --config.appId=sh.rockstone.paseo \
  --config.productName=Paseo \
  --config.extraMetadata.productName=Paseoi \
  --config.mac.extendInfo.CFBundleDisplayName=Paseoi \
  --config.extraMetadata.version="$CUSTOM_VERSION" \
  --config.mac.identity=null \
  --config.mac.notarize=false \
  "$@"

for CUSTOM_ARCH_DIR in mac mac-arm64; do
  CUSTOM_OUTPUT_DIR="$ROOT_DIR/packages/desktop/release/$CUSTOM_ARCH_DIR"
  if [[ -d "$CUSTOM_OUTPUT_DIR/Paseo.app" ]]; then
    rm -rf -- "$CUSTOM_OUTPUT_DIR/Paseoi.app"
    mv -- "$CUSTOM_OUTPUT_DIR/Paseo.app" "$CUSTOM_OUTPUT_DIR/Paseoi.app"
    codesign --force --deep --sign - "$CUSTOM_OUTPUT_DIR/Paseoi.app"
  fi
done
