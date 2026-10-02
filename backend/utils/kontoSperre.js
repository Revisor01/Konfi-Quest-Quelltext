// backend/utils/kontoSperre.js
//
// Anmeldesperre je Konto: Nach 10 falschen Passwoertern innerhalb einer
// Stunde nimmt ein Konto keine Anmeldung mehr an -- auch nicht mit dem
// richtigen Passwort --, bis das Fenster abgelaufen ist oder das Konto ein
// neues Passwort bekommt.
//
// ANLASS: Die Einmalpasswoerter
// der Leitung sind Bibelstellen ("Johannes7,47"), gleichverteilt aus 30 772
// Stellen gezogen -- 14,9 Bit. Die Anmeldung zaehlte Fehlversuche nur je
// Client-IP (authLimiter in server.js: 300 je Viertelstunde). Wer den
// Benutzernamen eines Kindes kennt (vorname.nachname), probierte damit 1 200
// Stellen je Stunde und Adresse: der ganze Raum in 25,6 Stunden, mit zehn
// Adressen in 2,6 Stunden, im Mittel die Haelfte.
//
// ENTSCHEIDUNG: Das Passwortformat bleibt. Gehaertet wird
// der Anmeldeweg. Mit 10 Fehlversuchen je Stunde und Konto sind es hoechstens
// 240 Versuche am Tag, egal von wie vielen Adressen: 128 Tage fuer den ganzen
// Raum, 64 im Mittel. Ein Kind, das sich vertippt, merkt davon nichts.
//
// WARUM AUCH DAS RICHTIGE PASSWORT ABGEWIESEN WIRD: Kaeme es nach der Grenze
// durch, verriete jeder Erfolg weiter, welche Stelle stimmt -- die Sperre
// bremste dann nur die Fehlversuche, nicht das Raten.
//
// WARUM ZEITLICH BEGRENZT: Wer einen Benutzernamen kennt, kann ein Konto
// absichtlich aussperren. Die Sperre endet deshalb spaetestens eine Stunde
// nach dem ersten Fehlversuch von selbst, ein neues Passwort (Leitung,
// "Passwort vergessen", Profil) hebt sie sofort auf, und laufende Sitzungen
// bleiben unberuehrt -- die App auf dem Handy des Kindes bleibt angemeldet.
//
// WAS GEZAEHLT WIRD: nur "falsches Passwort oder unbekannter Name" (401) und
// Anmeldungen, die schon an der Sperre abprallen (429). Leere Felder scheitern
// an der Eingabepruefung davor; ein gesperrtes Konto (403) oder ein
// Serverfehler zaehlen nicht. Unbekannte Namen werden genauso gezaehlt wie
// bekannte -- sonst verriete die Sperre, welche Konten es gibt.
//
// DER SCHLUESSEL ist das Konto, nicht die Adresse: SHA-256 ueber
// LOWER(benutzername). LOWER rechnet die Datenbank, mit derselben Funktion,
// mit der die Anmeldung das Konto sucht (WHERE LOWER(u.username) = LOWER($1)).
// JavaScript und Postgres schreiben nicht jeden Buchstaben gleich klein (das
// tuerkische "İ" etwa); ein in JavaScript gebildeter Schluessel liesse sich
// mit solchen Schreibweisen vervielfachen, waehrend die Anmeldung dasselbe
// Konto findet. Der Hash haelt die Namen -- auch die durchprobierten, die es
// gar nicht gibt -- aus der Tabelle und damit aus jeder Sicherung.
//
// DER ZAEHLER liegt im gemeinsamen Store der Rate-Limiter (Tabelle
// rate_limit_zaehler, Migration 167, utils/rateLimitStore.js) und gilt damit
// ueber alle Backend-Replicas. Das Fenster ist fest: Es beginnt mit dem ersten
// Fehlversuch und wird durch weitere nicht verlaengert.
//
// KEINE NAMEN IM LOG: Die Sperre meldet sich einmal je Fenster
// mit einer festen Zeile, ohne Benutzernamen.

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { PostgresRateLimitStore, TABELLE } = require('./rateLimitStore');

const MAX_FEHLVERSUCHE = 10;
const FENSTER_MS = 60 * 60 * 1000;
const PRAEFIX = 'konto';

// Fester Text ohne Namen; die Apps zeigen `error` an (auch 2.2.x).
const MELDUNG = 'Zu viele falsche Anmeldeversuche für dieses Konto. Versuche es in einer Stunde wieder oder bitte die Leitung deiner Gemeinde um ein neues Passwort.';
const FEHLERCODE = 'account_locked';
const LOGZEILE = `Anmeldung gesperrt: ${MAX_FEHLVERSUCHE} falsche Passwörter innerhalb einer Stunde für ein Konto`;

// Hash ueber den klein geschriebenen Namen. $1 ist der Name (Anmeldung) bzw.
// die Spalte username (Aufheben) -- in beiden Faellen rechnet Postgres LOWER.
const hashSql = (ausdruck) => `encode(sha256(convert_to(LOWER(${ausdruck}), 'UTF8')), 'hex')`;

/**
 * Schluessel des Kontos, unter dem die Fehlversuche zaehlen (ohne Praefix).
 * Faellt die Datenbank aus, rechnet JavaScript -- die Anmeldung scheitert
 * dann ohnehin, und der Store zaehlt im Speicher weiter.
 */
async function kontoSchluessel(db, benutzername) {
  try {
    const { rows: [r] } = await db.query(`SELECT ${hashSql('$1::text')} AS k`, [benutzername]);
    return r.k;
  } catch {
    return crypto.createHash('sha256').update(benutzername.toLowerCase(), 'utf8').digest('hex');
  }
}

/**
 * Middleware fuer POST /api/auth/login, HINTER der Eingabepruefung
 * (validateLogin trimmt den Namen und weist leere Felder ab).
 * Nach erfolgreicher Anmeldung ruft die Route `sperre.resetKey(req.kontoSperre.key)`.
 */
function erzeugeKontoSperre(db) {
  return rateLimit({
    store: new PostgresRateLimitStore(db, { prefix: PRAEFIX }),
    windowMs: FENSTER_MS,
    limit: MAX_FEHLVERSUCHE,
    // Eigener Name am Request: req.rateLimit gehoert dem IP-Limiter davor.
    requestPropertyName: 'kontoSperre',
    // Nicht-Zeichenketten erreichen die Passwortpruefung nicht (die Route
    // bricht an .trim() ab); zu zaehlen gibt es dort nichts.
    skip: (req) => typeof req.body?.username !== 'string' || !req.body.username.trim(),
    keyGenerator: (req) => kontoSchluessel(db, req.body.username.trim()),
    // Nur falsches Passwort (401) und abgeprallte Versuche (429) zaehlen;
    // alles andere nimmt express-rate-limit nach der Antwort wieder zurueck.
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401 && res.statusCode !== 429,
    // Keine RateLimit-*-Kopfzeilen: Sie verrieten jedem, wie oft ein Konto
    // gerade durchprobiert wurde. Retry-After setzt der Handler selbst.
    standardHeaders: false,
    legacyHeaders: false,
    handler: (req, res) => {
      const info = req.kontoSperre;
      if (info.used === MAX_FEHLVERSUCHE + 1) console.warn(LOGZEILE);
      if (info.resetTime) {
        const sekunden = Math.max(1, Math.ceil((info.resetTime.getTime() - Date.now()) / 1000));
        res.set('Retry-After', String(sekunden));
      }
      res.status(429).json({ error: MELDUNG, error_code: FEHLERCODE });
    },
  });
}

/**
 * Hebt die Sperre eines Kontos auf -- bei jedem neu gesetzten Passwort und bei
 * jedem neu angelegten Konto (ein vorher durchprobierter Name startet frei).
 * Nimmt den Pool oder einen Transaktions-Client.
 */
async function kontoSperreAufheben(db, userId) {
  await db.query(
    `DELETE FROM ${TABELLE}
      WHERE schluessel = (SELECT '${PRAEFIX}:' || ${hashSql('username')} FROM users WHERE id = $1)`,
    [userId]
  );
}

module.exports = {
  erzeugeKontoSperre,
  kontoSperreAufheben,
  kontoSchluessel,
  MAX_FEHLVERSUCHE,
  FENSTER_MS,
  MELDUNG,
  FEHLERCODE,
};
