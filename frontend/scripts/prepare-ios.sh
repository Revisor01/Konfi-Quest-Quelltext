#!/usr/bin/env bash
# prepare-ios.sh — stellt die native iOS-Firebase-Config wieder her und BRICHT
# HART AB, wenn sie fehlt, auf das falsche Firebase-Projekt zeigt oder die
# Absturzdiagnose build-seitig nicht greifen wuerde.
#
#   - ios/App/App/GoogleService-Info.plist ist gitignored und wird von
#     `npx cap sync` / `prebuild --clean` NICHT wiederhergestellt.
#   - Fehlt sie, findet FirebaseApp.configure() keine Config. Der Bau laeuft
#     durch, die App startet — es kommt nur kein Push mehr an und kein
#     Absturzbericht raus.
#   - Zeigt sie auf ein ANDERES Firebase-Projekt, gehen Token und Berichte an
#     ein Projekt, in das niemand schaut. Noch leiser.
#
# Dieses Script IMMER vor einem iOS-Release ausfuehren (aus frontend/):
#   npm run build && npx cap sync ios && ./scripts/prepare-ios.sh
# und erst DANN das Archiv bauen.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"

MASTER="$FRONTEND_DIR/config/GoogleService-Info.plist"
TARGET="$FRONTEND_DIR/ios/App/App/GoogleService-Info.plist"
PBXPROJ="$FRONTEND_DIR/ios/App/App.xcodeproj/project.pbxproj"
PODFILE="$FRONTEND_DIR/ios/App/Podfile"

# Muss zum Backend-Service-Account passen (backend/push/firebase-service-account.json:
# project_id "konfiquest-push"). Bei Projektwechsel HIER anpassen — und in
# prepare-android.sh ebenso.
EXPECTED_PROJECT_ID="konfiquest-push"
EXPECTED_BUNDLE_ID="de.godsapp.konfiquest"

fail() { echo "FEHLER: $*" >&2; exit 1; }

[ -f "$MASTER" ] || fail "Master-Kopie fehlt: $MASTER (aus Git wiederherstellen)."
[ -d "$FRONTEND_DIR/ios/App/App" ] || fail "ios/App/App/ fehlt — erst 'npx cap add ios' / 'npx cap sync ios'."

# Master -> native Position kopieren (ueberschreibt eine evtl. veraltete Datei).
cp "$MASTER" "$TARGET"
echo "GoogleService-Info.plist wiederhergestellt -> ios/App/App/"

# Verifizieren, dass die native Datei das ERWARTETE Projekt + Bundle traegt.
# PlistBuddy liegt auf jedem macOS; -c "Print :KEY" liefert den Wert oder
# scheitert. Das `|| true` haelt set -e davon ab, hier schon abzubrechen —
# die Meldung soll aus fail() kommen, nicht aus PlistBuddy.
plist_wert() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$TARGET" 2>/dev/null || true
}

ACTUAL_PROJECT_ID="$(plist_wert PROJECT_ID)"
[ "$ACTUAL_PROJECT_ID" = "$EXPECTED_PROJECT_ID" ] \
  || fail "Falsches Firebase-Projekt in GoogleService-Info.plist: '$ACTUAL_PROJECT_ID' (erwartet '$EXPECTED_PROJECT_ID')."

ACTUAL_BUNDLE_ID="$(plist_wert BUNDLE_ID)"
[ "$ACTUAL_BUNDLE_ID" = "$EXPECTED_BUNDLE_ID" ] \
  || fail "GoogleService-Info.plist gilt fuer Bundle '$ACTUAL_BUNDLE_ID' (erwartet '$EXPECTED_BUNDLE_ID')."

# Die Datei muss auch INS BUNDLE kommen. Steht sie nicht in der
# Resources-Phase, liegt sie beim Bau daneben und FirebaseApp.configure()
# findet sie zur Laufzeit nicht — wieder ein stiller Ausfall.
grep -q "GoogleService-Info.plist in Resources" "$PBXPROJ" \
  || fail "GoogleService-Info.plist ist im Xcode-Projekt nicht als Ressource eingetragen — sie landet nicht im App-Bundle."

echo "OK: Firebase-Config fuer '$EXPECTED_PROJECT_ID' / '$EXPECTED_BUNDLE_ID' verifiziert. iOS-Push ist build-seitig abgesichert."

# --- Absturzdiagnose (Crashlytics) ----------------------------------------
#
# Drei Dinge muessen build-seitig stimmen, und alle drei scheitern still:
#   1. Der Pod. Fehlt er, fehlt das SDK — die App laeuft, meldet aber nichts.
#   2. Die dSYM-Upload-Phase. Fehlt sie, kommen Berichte an, zeigen aber nur
#      Speicheradressen statt Funktionsnamen. Unbrauchbar genau dann, wenn man
#      sie braucht.
#   3. Der Swift-Import. Der Pod allein genuegt NICHT: Auf Apple-Plattformen
#      registriert sich Crashlytics erst, wenn das Framework geladen wird —
#      und geladen wird es nur, wenn es importiert ist. Ohne den Import blieb
#      die Firebase-Konsole bei "SDK hinzufuegen" stehen, obwohl die App lief
#      und Push-Token registrierte.
#
#   a) Podfile          — der Pod ist GEWOLLT.
#   b) Podfile.lock     — CocoaPods hat ihn AUFGELOEST (welche Fassung).
#                         Die Datei ist getrackt, beweist also nichts ueber
#                         diesen Rechner; sie faengt nur ein Podfile ab, das
#                         nach der letzten Aufloesung geaendert wurde.
#   c) Pods/            — der Pod ist INSTALLIERT. Zwei Belege:
#        - Pods/Manifest.lock ist byte-gleich mit Podfile.lock. Das ist
#          derselbe Abgleich, den Xcode in "[CP] Check Pods Manifest.lock"
#          macht — nur dort erst beim Bau, hier vorher und mit Anleitung.
#        - Pods/FirebaseCrashlytics/run und .../upload-symbols liegen vor und
#          sind ausfuehrbar. `run` ruft die Build-Phase im Xcode-Projekt,
#          `upload-symbols` der Schritt "Absturz-Symbole (dSYM) nachreichen"
#          im Release-Workflow. Genau diese zwei Dateien werden spaeter
#          gebraucht, also werden genau sie geprueft.
#
# Die Pruefung ist UEBERALL hart, lokal wie in der CI. Im Release-Workflow
# laeuft `npx cap sync ios` (und damit `pod install`) VOR diesem Skript; die
# Pods liegen also vor. Wer die Reihenfolge dort umstellt, bekommt hier
# sofort einen roten Lauf — das ist gewollt, nicht zu umgehen.
PODS_DIR="$FRONTEND_DIR/ios/App/Pods"
PODFILE_LOCK="$FRONTEND_DIR/ios/App/Podfile.lock"
MANIFEST_LOCK="$PODS_DIR/Manifest.lock"
CRASHLYTICS_RUN="$PODS_DIR/FirebaseCrashlytics/run"
CRASHLYTICS_UPLOAD="$PODS_DIR/FirebaseCrashlytics/upload-symbols"

# Auf diesem Entwicklungs-Mac scheitert `pod install` ueber `cap sync` an
# einem Ruby-Konflikt (Homebrew-Ruby 4 gegen die Gems fuer 3.1.3: "Could not
# find 'bigdecimal'"). Der Weg, der funktioniert, steht deshalb in JEDER
# Pod-Fehlermeldung — wer hier landet, soll nicht erst suchen muessen.
POD_INSTALL_HINWEIS="Beheben: in frontend/ios/App ausfuehren:
  pod install
Scheitert das an Ruby (\"Could not find 'bigdecimal'\" o.ae.), die passende
Ruby-Umgebung mitgeben:
  PATH=\$HOME/.rubies/ruby-3.1.3/bin:\$PATH GEM_HOME=\$HOME/.gem/ruby/3.1.3 pod install"

pod_fail() { fail "$*
$POD_INSTALL_HINWEIS"; }

# a) gewollt
grep -q "CapacitorFirebaseCrashlytics" "$PODFILE" \
  || fail "Podfile enthaelt den CapacitorFirebaseCrashlytics-Pod nicht — es kaeme kein Absturzbericht an."

# b) aufgeloest
[ -f "$PODFILE_LOCK" ] \
  || pod_fail "Podfile.lock fehlt — CocoaPods hat das Podfile noch nie aufgeloest."
grep -q "^  - FirebaseCrashlytics (" "$PODFILE_LOCK" \
  || pod_fail "Podfile.lock kennt den FirebaseCrashlytics-Pod nicht — das Podfile wurde nach der letzten Aufloesung geaendert."

# c) installiert
[ -d "$PODS_DIR" ] \
  || pod_fail "ios/App/Pods/ fehlt — 'pod install' ist auf diesem Rechner nie gelaufen. Das Xcode-Projekt haette keinen einzigen Pod."
[ -f "$MANIFEST_LOCK" ] \
  || pod_fail "ios/App/Pods/Manifest.lock fehlt — die Pods-Installation ist unvollstaendig."
cmp -s "$PODFILE_LOCK" "$MANIFEST_LOCK" \
  || pod_fail "Pods/Manifest.lock stimmt nicht mit Podfile.lock ueberein — die installierten Pods sind veraltet. Xcode wuerde beim Bau mit 'The sandbox is not in sync with the Podfile.lock' abbrechen."
[ -x "$CRASHLYTICS_RUN" ] \
  || pod_fail "Pods/FirebaseCrashlytics/run fehlt oder ist nicht ausfuehrbar — der Crashlytics-Pod ist NICHT installiert. Die dSYM-Build-Phase haette nichts aufzurufen."
[ -x "$CRASHLYTICS_UPLOAD" ] \
  || pod_fail "Pods/FirebaseCrashlytics/upload-symbols fehlt oder ist nicht ausfuehrbar — der Release-Workflow koennte keine Absturz-Symbole nachreichen."

# 2. dSYM-Upload-Phase im Xcode-Projekt
grep -q "FirebaseCrashlytics/run" "$PBXPROJ" \
  || fail "Im Xcode-Projekt fehlt die dSYM-Upload-Phase — Absturzberichte waeren nicht lesbar (nur Adressen)."

# Ohne dSYM-Erzeugung hat die Upload-Phase nichts hochzuladen. Die
# Release-Konfiguration MUSS 'dwarf-with-dsym' sagen.
grep -q 'DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym"' "$PBXPROJ" \
  || fail "Keine Release-Konfiguration mit DEBUG_INFORMATION_FORMAT=dwarf-with-dsym — es entstehen keine dSYM-Dateien."

# 3. Swift-Import
APPDELEGATE="$FRONTEND_DIR/ios/App/App/AppDelegate.swift"
grep -q "^import FirebaseCrashlytics" "$APPDELEGATE" \
  || fail "AppDelegate.swift importiert FirebaseCrashlytics nicht — ohne den Import meldet sich die App nie bei Crashlytics."

echo "OK: Crashlytics-Pod installiert (Podfile.lock = Pods/Manifest.lock, run + upload-symbols vorhanden), dSYM-Upload und Import vorhanden. Absturzdiagnose ist build-seitig abgesichert."
