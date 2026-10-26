#!/bin/bash
# Builds ClearDay for this Mac's architecture and installs it into
# /Applications. The build is re-signed locally (scripts/after-pack.js):
# without an Apple Developer certificate, Electron's own signature is all the
# app would carry, and macOS refuses to launch a bundle whose contents no
# longer match it.
#
# Signing identity: $MAC_SIGN_IDENTITY, else the keychain certificate
# "Claude Usage Bar Local Signing" if one exists (shared with the token
# widget), else ad-hoc. A certificate keeps the signature stable across
# rebuilds, so macOS keeps treating each build as the same app.
set -euo pipefail
cd "$(dirname "$0")/.."

arch=$(uname -m)                       # arm64 or x86_64
[ "$arch" = x86_64 ] && arch=x64
name="ClearDay"
out="dist/mac$([ "$arch" = arm64 ] && echo -arm64)/$name.app"

SIGN_ID=${MAC_SIGN_IDENTITY:-}
if [ -z "$SIGN_ID" ] && security find-identity -p codesigning | grep -q "Claude Usage Bar Local Signing"; then
  SIGN_ID="Claude Usage Bar Local Signing"
fi
SIGN_ID=${SIGN_ID:--}
export MAC_SIGN_IDENTITY=$SIGN_ID

npx electron-builder --mac dir "--$arch"

pkill -x "$name" 2>/dev/null || true
rm -rf "/Applications/$name.app"
ditto "$out" "/Applications/$name.app"
open "/Applications/$name.app"
echo "installed /Applications/$name.app"
