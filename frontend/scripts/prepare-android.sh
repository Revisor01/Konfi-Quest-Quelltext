#!/usr/bin/env bash
# prepare-android.sh — stellt die native Android-Firebase-Config wieder her und
# BRICHT HART AB, wenn sie fehlt oder auf das falsche Firebase-Projekt zeigt.
#
# Dieses Script IMMER vor einem Android-Release ausfuehren (aus frontend/):
#   npm run build && npx cap sync android && ./scripts/prepare-android.sh
# und erst DANN `./gradlew bundleRelease ...`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"

MASTER="$FRONTEND_DIR/config/google-services.json"
TARGET="$FRONTEND_DIR/android/app/google-services.json"

# Muss zum Backend-Service-Account passen (backend/push/firebase-service-account.json:
# project_id "konfiquest-push"). Bei Projektwechsel HIER anpassen.
EXPECTED_PROJECT_ID="konfiquest-push"
EXPECTED_PACKAGE="de.godsapp.konfiquest"

fail() { echo "FEHLER: $*" >&2; exit 1; }

[ -f "$MASTER" ] || fail "Master-Kopie fehlt: $MASTER (aus Git wiederherstellen)."
[ -d "$FRONTEND_DIR/android/app" ] || fail "android/app/ fehlt — erst 'npx cap add android' / 'npx cap sync android'."

# Master -> native Position kopieren (ueberschreibt eine evtl. veraltete Datei).
cp "$MASTER" "$TARGET"
echo "google-services.json wiederhergestellt -> android/app/"

# Verifizieren, dass die native Datei das ERWARTETE Projekt + Package traegt.
ACTUAL_PROJECT_ID="$(node -p "require('$TARGET').project_info.project_id" 2>/dev/null || true)"
[ "$ACTUAL_PROJECT_ID" = "$EXPECTED_PROJECT_ID" ] \
  || fail "Falsches Firebase-Projekt in google-services.json: '$ACTUAL_PROJECT_ID' (erwartet '$EXPECTED_PROJECT_ID')."

PACKAGE_MATCH="$(node -e "
  const j = require('$TARGET');
  const ok = (j.client||[]).some(c => c.client_info?.android_client_info?.package_name === '$EXPECTED_PACKAGE');
  process.stdout.write(ok ? 'yes' : 'no');
" 2>/dev/null || echo "no")"
[ "$PACKAGE_MATCH" = "yes" ] \
  || fail "google-services.json enthaelt keinen Client fuer Package '$EXPECTED_PACKAGE'."

# Sicherstellen, dass build.gradle das Plugin ueberhaupt anwenden WUERDE.
grep -q "com.google.gms.google-services" "$FRONTEND_DIR/android/app/build.gradle" \
  || fail "android/app/build.gradle wendet das google-services-Plugin nicht an (nach prebuild neu einrichten)."

echo "OK: Firebase-Config fuer '$EXPECTED_PROJECT_ID' / '$EXPECTED_PACKAGE' verifiziert. Android-Push ist build-seitig abgesichert."
