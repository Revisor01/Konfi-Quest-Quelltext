// WOFUER: Bis hierher konnte der Betrieb den Geraeten nichts mitteilen —
// weder "Version X wird nicht mehr unterstuetzt" noch "heute Abend Wartung".
// Ab 2.3.0 liest die App zwei zusaetzliche Angaben aus derselben Antwort:
//   - min_version je Plattform: liegt die installierte Version darunter,
//     zeigt die App einen Bildschirm "Bitte aktualisiere Konfi Quest" mit
//     Knopf zum Store (frontend/src/services/betriebsstatus.ts).
//   - wartung {aktiv, text}: ein Hinweis mit diesem Text auf den Startseiten.
//
// QUELLE: Umgebungsvariablen des Stacks,
// bei JEDER Anfrage gelesen, nicht einmal beim Start gemerkt:
//   APP_MIN_VERSION_IOS      Mindestversion iOS, Form x.y.z (z.B. 2.3.0)
//   APP_MIN_VERSION_ANDROID  Mindestversion Android, Form x.y.z
//   WARTUNG_HINWEIS          Klartext des Wartungshinweises
// Leer oder nicht gesetzt heisst: keine Mindestversion, kein Hinweis.
//
// UNGUELTIGE VERSIONEN WERDEN IGNORIERT: Eine falsch getippte Mindestversion
// ("2.3", "v2.3.0") darf nie alle Geraete sperren. Sie gilt als nicht gesetzt
// und steht EINMAL je Wert im Log — der Endpunkt laeuft bei jedem App-Start
// und jeder Rueckkehr in die App, eine Zeile je Anfrage wuerde das Log fluten.
//
// Das env-Objekt ist ein Parameter (Muster wie utils/smtpKonfiguration.js),
// damit sich alles ohne Eingriff in process.env pruefen laesst.

// Nur x.y.z aus Ziffern — die Stores nehmen ohnehin nichts anderes an
// (frontend/scripts/apply-version.sh), und die App vergleicht segmentweise
// (frontend/src/utils/versionVergleich.ts).
const VERSIONS_FORM = /^[0-9]+\.[0-9]+\.[0-9]+$/;

// Schon gemeldete ungueltige Werte ("VARIABLE=wert"), modul-lokal wie der
// Cache in storeVersion.js.
let schonGemeldet = new Set();

function mindestversion(env, variable) {
  const roh = env[variable];
  if (roh === undefined || roh === null) return null;
  const wert = String(roh).trim();
  if (wert === '') return null;
  if (VERSIONS_FORM.test(wert)) return wert;

  const schluessel = `${variable}=${wert}`;
  if (!schonGemeldet.has(schluessel)) {
    schonGemeldet.add(schluessel);
    console.warn(
      `WARNUNG: ${variable}="${wert}" ist keine Version der Form x.y.z -- ` +
      'der Wert wird ignoriert, fuer diese Plattform gilt keine Mindestversion.'
    );
  }
  return null;
}

function wartungshinweis(env) {
  const text = String(env.WARTUNG_HINWEIS ?? '').trim();
  return text ? { aktiv: true, text } : { aktiv: false, text: null };
}

/**
 * Liest Mindestversionen und Wartungshinweis aus der Umgebung.
 *
 * @param {object} [env] - Umgebung (Default process.env)
 * @returns {{ minVersion: { ios: string|null, android: string|null },
 *             wartung: { aktiv: boolean, text: string|null } }}
 */
function betriebshinweise(env = process.env) {
  return {
    minVersion: {
      ios: mindestversion(env, 'APP_MIN_VERSION_IOS'),
      android: mindestversion(env, 'APP_MIN_VERSION_ANDROID'),
    },
    wartung: wartungshinweis(env),
  };
}

// Nur fuer Tests: gemeldete Werte vergessen, damit sich Testfaelle nicht sehen.
function _nurFuerTests_reset() {
  schonGemeldet = new Set();
}

module.exports = { betriebshinweise, _nurFuerTests_reset };
