#!/usr/bin/env bash
# apply-version.sh — setzt die iOS-Version aus der gemeinsamen Quelle version.json.
#
# Quelle der Wahrheit: frontend/version.json
#   { "version": "1.0.1", "androidVersionCode": 32, "iosBuildNumber": 11 }
#
# Android liest version.json direkt in build.gradle (JsonSlurper). iOS kann das
# nicht zur Build-Zeit, daher setzt dieses Script die Werte vor einem Release.
#
# ACHTUNG, hier steckte lange ein stiller Fehler: `agvtool new-marketing-version`
# schreibt NICHT in die pbxproj, sondern nur CFBundleShortVersionString in die
# Info.plist. MARKETING_VERSION in den Build-Settings blieb dadurch auf einem
# alten Stand stehen (zuletzt 1.5.0, waehrend real 1.5.3 gebaut wurde), obwohl
# das Script "Setze MARKETING_VERSION=..." meldete.
#
# Folgenlos war das nur, weil dieses Projekt eine klassische Info.plist mit
# literalen Werten benutzt (kein GENERATE_INFOPLIST_FILE) — der Build nimmt
# also die Plist. Sobald jemand auf $(MARKETING_VERSION) umstellt, waere still
# die falsche Version im Store gelandet.
#
# Deshalb setzt dieses Script jetzt BEIDE Orte und prueft das Ergebnis nach.
#
# Aufruf (aus frontend/):  ./scripts/apply-version.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"
VERSION_JSON="$FRONTEND_DIR/version.json"
IOS_APP_DIR="$FRONTEND_DIR/ios/App"
PBXPROJ="$IOS_APP_DIR/App.xcodeproj/project.pbxproj"
INFO_PLIST="$IOS_APP_DIR/App/Info.plist"

if [ ! -f "$VERSION_JSON" ]; then
  echo "FEHLER: $VERSION_JSON nicht gefunden." >&2
  exit 1
fi
if [ ! -f "$PBXPROJ" ]; then
  echo "FEHLER: $PBXPROJ nicht gefunden." >&2
  exit 1
fi
if [ ! -f "$INFO_PLIST" ]; then
  echo "FEHLER: $INFO_PLIST nicht gefunden." >&2
  exit 1
fi

# Werte aus JSON lesen (node ist im Frontend-Toolchain ohnehin vorhanden).
VERSION="$(node -p "require('$VERSION_JSON').version")"
IOS_BUILD="$(node -p "require('$VERSION_JSON').iosBuildNumber")"

if [ -z "$VERSION" ] || [ -z "$IOS_BUILD" ]; then
  echo "FEHLER: version oder iosBuildNumber fehlt in version.json." >&2
  exit 1
fi

# Format pruefen, bevor irgendwas geschrieben wird: Apple lehnt eine
# CFBundleShortVersionString ausserhalb von x.y(.z) beim Upload ab — und zwar
# erst nach dem kompletten CI-Build.
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+(\.[0-9]+)?$'; then
  echo "FEHLER: version '$VERSION' ist kein gueltiges x.y bzw. x.y.z." >&2
  exit 1
fi
if ! printf '%s' "$IOS_BUILD" | grep -Eq '^[0-9]+$'; then
  echo "FEHLER: iosBuildNumber '$IOS_BUILD' ist keine ganze Zahl." >&2
  exit 1
fi

echo "Setze iOS-Version aus version.json: $VERSION ($IOS_BUILD)"

# 1. Info.plist — das ist der Wert, den der Build tatsaechlich verwendet,
#    weil dieses Projekt literale Eintraege statt $(MARKETING_VERSION) nutzt.
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $IOS_BUILD" "$INFO_PLIST"

# 2. pbxproj — haelt die Build-Settings in Deckung mit der Plist. Ohne diesen
#    Schritt laufen beide auseinander (genau der Fehler oben). sed statt
#    agvtool, weil agvtool die Marketing-Version hier nicht schreibt.
sed -i '' -E "s/MARKETING_VERSION = [^;]+;/MARKETING_VERSION = $VERSION;/g" "$PBXPROJ"
sed -i '' -E "s/CURRENT_PROJECT_VERSION = [^;]+;/CURRENT_PROJECT_VERSION = $IOS_BUILD;/g" "$PBXPROJ"

# 3. Nachpruefen statt vertrauen — der alte Fehler blieb nur deshalb so lange
#    unentdeckt, weil das Script Erfolg meldete, ohne das Ergebnis zu lesen.
FEHLER=0

PLIST_VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$INFO_PLIST")"
PLIST_BUILD="$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$INFO_PLIST")"
[ "$PLIST_VERSION" = "$VERSION" ]  || { echo "FEHLER: Info.plist CFBundleShortVersionString ist '$PLIST_VERSION', erwartet '$VERSION'." >&2; FEHLER=1; }
[ "$PLIST_BUILD" = "$IOS_BUILD" ]  || { echo "FEHLER: Info.plist CFBundleVersion ist '$PLIST_BUILD', erwartet '$IOS_BUILD'." >&2; FEHLER=1; }

# In der pbxproj darf KEIN abweichender Wert uebrigbleiben (Debug + Release).
if grep -E "MARKETING_VERSION = " "$PBXPROJ" | grep -qv "MARKETING_VERSION = $VERSION;"; then
  echo "FEHLER: pbxproj enthaelt noch abweichende MARKETING_VERSION-Eintraege:" >&2
  grep -nE "MARKETING_VERSION = " "$PBXPROJ" >&2
  FEHLER=1
fi
if grep -E "CURRENT_PROJECT_VERSION = " "$PBXPROJ" | grep -qv "CURRENT_PROJECT_VERSION = $IOS_BUILD;"; then
  echo "FEHLER: pbxproj enthaelt noch abweichende CURRENT_PROJECT_VERSION-Eintraege:" >&2
  grep -nE "CURRENT_PROJECT_VERSION = " "$PBXPROJ" >&2
  FEHLER=1
fi

if [ "$FEHLER" -ne 0 ]; then
  echo "ABBRUCH: Version wurde nicht sauber gesetzt." >&2
  exit 1
fi

echo "Fertig und geprueft: Info.plist und pbxproj stehen auf $VERSION ($IOS_BUILD)."
echo "version.json bleibt die Quelle der Wahrheit."
