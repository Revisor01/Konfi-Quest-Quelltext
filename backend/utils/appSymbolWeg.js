// backend/utils/appSymbolWeg.js
//
// Wie die Zahl am App-Symbol auf ein Android-Geraet kommt.
//
// Auf dem iPhone setzt aps.badge die Zahl, egal ob die App laeuft. Android
// hat dafuer keine Schnittstelle; es haengt am Startbildschirm des Geraets.
// Die App bestimmt beim Anmelden des Push-Tokens, welcher Weg zu ihrem
// Startbildschirm passt (AppSymbolZahl.java, weg()), und meldet ihn mit:
//
//   anbieter      Der Startbildschirm nimmt eine Zahl von der App an (Sony
//                 ueber seinen Zahl-Anbieter, Huawei). Die App setzt sie
//                 selbst -- bei geschlossener App aus einem stillen
//                 badge_update, das der Server deshalb nach JEDER sichtbaren
//                 Mitteilung zusaetzlich schickt. Die Mitteilungen bleiben
//                 einzeln in der Leiste, wie auf dem iPhone.
//   mitteilungen  Der Startbildschirm rechnet die Zahl aus den liegenden
//                 Mitteilungen (Samsung One UI mit Einstellung "Zahl",
//                 Xiaomi). Einen anderen Weg gibt es dort nicht: Jede
//                 Mitteilung ersetzt die vorige (fester tag) und traegt die
//                 Gesamtzahl (notificationCount). In der Leiste steht dann
//                 nur die neueste.
//   punkt         Kein bekannter Weg zu einer Zahl (Google Pixel und andere
//                 mit Android-Standard): Android zeigt einen Punkt, solange
//                 eine Mitteilung liegt. Es bleibt alles wie bisher.
//
// Ohne Angabe (iOS, Store-Apps 2.2.x, 2.3.0 bis Build 128) bleibt ebenfalls
// alles wie bisher. Unbekannte Werte werden zu "ohne Angabe" -- eine
// kuenftige App mit einem neuen Weg darf ihre Anmeldung nicht an einem 400
// verlieren.

const APP_SYMBOL_WEGE = Object.freeze({
  ANBIETER: 'anbieter',
  MITTEILUNGEN: 'mitteilungen',
  PUNKT: 'punkt',
});

const BEKANNTE_WEGE = new Set(Object.values(APP_SYMBOL_WEGE));

// Kennung, unter der Mitteilungen auf Geraeten mit Weg "mitteilungen" liegen.
// Dieselbe Zeichenkette steht in der App (AppSymbolZahl.java,
// MITTEILUNG_TAG): Dort sucht der stille badge_update die liegende
// Mitteilung, um ihre Zahl nachzufuehren. Test: pushAppSymbolWeg.test.js.
const MITTEILUNG_TAG = 'konfi_app_symbol';

// Paketname eines Startbildschirms, z. B. com.sonymobile.launcher -- nur zum
// Nachsehen im Protokoll und in der Datenbank, welche Geraete es gibt.
const PAKETNAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const PAKETNAME_MAX = 128;

/** Der gemeldete Weg, oder null, wenn keiner oder ein unbekannter kam. */
function wegAusAnmeldung(wert) {
  return typeof wert === 'string' && BEKANNTE_WEGE.has(wert) ? wert : null;
}

/** Der gemeldete Startbildschirm, oder null, wenn er kein Paketname ist. */
function startbildschirmAusAnmeldung(wert) {
  if (typeof wert !== 'string' || wert.length > PAKETNAME_MAX) return null;
  return PAKETNAME.test(wert) ? wert : null;
}

/**
 * Der Weg fuer EIN Geraet aus seiner Zeile in push_tokens. Nur Android kennt
 * einen; iOS setzt die Zahl ueber aps.badge.
 */
function wegFuerGeraet(token) {
  if (!token || token.platform !== 'android') return null;
  return wegAusAnmeldung(token.app_symbol_weg);
}

module.exports = {
  APP_SYMBOL_WEGE,
  MITTEILUNG_TAG,
  wegAusAnmeldung,
  startbildschirmAusAnmeldung,
  wegFuerGeraet,
};
