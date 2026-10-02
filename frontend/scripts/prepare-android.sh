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

# WARUM DIESELBE PRUEFUNG WIE FUER PUSH: Crashlytics haengt an genau derselben
# google-services.json und braucht ZUSAETZLICH ein eigenes Gradle-Plugin. Und
# es scheitert in derselben Art still — nur noch leiser als beim Push:
#
#   - Fehlt das classpath-Eintrag in android/build.gradle, bricht der Bau
#     zwar ab (unbekanntes Plugin). Das faellt auf.
#   - Fehlt aber der `apply plugin: 'com.google.firebase.crashlytics'` in
#     android/app/build.gradle, laeuft der Bau DURCH. Die App startet, das
#     SDK ist ueber den Pod/das Modul sogar vorhanden — es wird nur keine
#     Build-Kennung erzeugt und keine Mapping-Datei hochgeladen. Ergebnis:
#     Berichte kommen entweder gar nicht an oder zeigen `a.b.c.d()`.
#   - Fehlt der mappingFileUploadEnabled-Block, kommen Berichte an, sind aber
#     bei minifyEnabled true unlesbar. Das merkt man erst, wenn man einen
#     echten Absturz aufklaeren will — also im schlechtesten Moment.
#
# Bei 15.000 Nutzenden ist "wir bekommen keine Absturzberichte" kein
# Schoenheitsfehler, sondern Blindflug. Deshalb hart abbrechen.
grep -q "com.google.firebase.crashlytics" "$FRONTEND_DIR/android/app/build.gradle" \
  || fail "android/app/build.gradle wendet das Crashlytics-Plugin nicht an — es kaeme kein einziger Absturzbericht an (nach prebuild neu einrichten)."

grep -q "firebase-crashlytics-gradle" "$FRONTEND_DIR/android/build.gradle" \
  || fail "android/build.gradle fehlt der classpath fuer firebase-crashlytics-gradle (nach prebuild neu einrichten)."

# Der Upload der Mapping-Datei ist die einzige Absicherung gegen unlesbare
# Berichte, solange minifyEnabled true ist. Nur pruefen, wenn verschleiert
# wird — ohne R8 braucht es kein Mapping.
if grep -q "minifyEnabled true" "$FRONTEND_DIR/android/app/build.gradle"; then
  grep -q "mappingFileUploadEnabled true" "$FRONTEND_DIR/android/app/build.gradle" \
    || fail "minifyEnabled ist an, aber mappingFileUploadEnabled fehlt — Absturzberichte waeren verschleiert und unlesbar."
fi

echo "OK: Firebase-Config fuer '$EXPECTED_PROJECT_ID' / '$EXPECTED_PACKAGE' verifiziert. Android-Push ist build-seitig abgesichert."
echo "OK: Crashlytics-Plugin, classpath und Mapping-Upload vorhanden. Absturzdiagnose ist build-seitig abgesichert."
