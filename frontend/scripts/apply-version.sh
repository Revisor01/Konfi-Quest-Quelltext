#!/usr/bin/env bash
# apply-version.sh — setzt die iOS-Version aus der gemeinsamen Quelle version.json.
#
# Quelle der Wahrheit: frontend/version.json
#   { "version": "1.0.1", "androidVersionCode": 32, "iosBuildNumber": 11 }
#
# Android liest version.json direkt in build.gradle (JsonSlurper). iOS kann das
# nicht zur Build-Zeit, daher setzt dieses Script MARKETING_VERSION (sichtbare
# Version) und CURRENT_PROJECT_VERSION (Build-Nummer) vor einem iOS-Release.
#
# Aufruf (aus frontend/):  ./scripts/apply-version.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"
VERSION_JSON="$FRONTEND_DIR/version.json"
IOS_APP_DIR="$FRONTEND_DIR/ios/App"

if [ ! -f "$VERSION_JSON" ]; then
  echo "FEHLER: $VERSION_JSON nicht gefunden." >&2
  exit 1
fi

# Werte aus JSON lesen (node ist im Frontend-Toolchain ohnehin vorhanden).
VERSION="$(node -p "require('$VERSION_JSON').version")"
IOS_BUILD="$(node -p "require('$VERSION_JSON').iosBuildNumber")"

if [ -z "$VERSION" ] || [ -z "$IOS_BUILD" ]; then
  echo "FEHLER: version oder iosBuildNumber fehlt in version.json." >&2
  exit 1
fi

echo "Setze iOS-Version: MARKETING_VERSION=$VERSION  CURRENT_PROJECT_VERSION=$IOS_BUILD"

cd "$IOS_APP_DIR"
# agvtool schreibt in alle Build-Konfigurationen (Debug+Release) der pbxproj.
agvtool new-marketing-version "$VERSION" >/dev/null
agvtool new-version -all "$IOS_BUILD" >/dev/null

echo "Fertig. iOS pbxproj aktualisiert (version.json bleibt Quelle der Wahrheit)."
