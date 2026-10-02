/**
 * Losung-Service: Tageslosung abrufen mit DB-Cache
 *
 * Die Losungen-API ist ketiv.de ("was geschrieben steht"). Sie läuft als
 * Container `ketiv-api` auf demselben Server wie dieses Backend, im selben
 * Docker-Netzwerk `traefik`.
 *
 * Deshalb wird zuerst der containerinterne Weg versucht und erst danach die
 * oeffentliche Domain. Gemessener Unterschied: ~19ms intern gegen ~87ms
 * über die oeffentliche Domain — der Aufschlag ist fast vollstaendig der
 * TLS-Handshake, der intern entfaellt.
 *
 * Der Fallback bleibt wichtig: läuft das Backend außerhalb von Docker
 * (lokale Entwicklung, Tests) oder wird der Container umbenannt, ist der
 * interne Name nicht aufloesbar und die oeffentliche Domain uebernimmt.
 */

// Interner Weg zuerst, oeffentliche Domain als Rueckfallebene.
// Per LOSUNG_API_BASE_URL ueberschreibbar (z.B. in Tests).
const LOSUNG_ENDPUNKTE = process.env.LOSUNG_API_BASE_URL
  ? [process.env.LOSUNG_API_BASE_URL]
  : ['http://ketiv-api', 'https://ketiv.de'];

// Intern darf der Timeout knapp sein — kommt keine Antwort, ist der
// Container nicht erreichbar und der oeffentliche Weg soll sofort greifen.
const { formatDatum, heuteBerlin } = require('../utils/zeitformat');
const TIMEOUT_INTERN_MS = 2000;
const TIMEOUT_OEFFENTLICH_MS = 5000;

// Laufende Abrufe je Datum+Uebersetzung. Ohne dieses Register feuert JEDER
// Request bei kaltem Cache einen eigenen externen API-Call: morgens oeffnen
// alle gleichzeitig die App, keiner findet den Cache gefüllt, und die
// Losungen-API bekommt einen Schwall identischer Anfragen (Cache-Stampede).
// Mit Register wartet der zweite bis n-te Request auf denselben Promise.
const laufendeAbrufe = new Map();

// Negativ-Cache: Datum+Uebersetzung, bei denen der externe Abruf gescheitert ist.
// Ohne diesen Merker läuft JEDE Anfrage erneut in beide Timeouts (2s intern +
// 5s oeffentlich = bis zu 7s), solange die Losungen-API nicht erreichbar ist.
// Das Dashboard laedt die Losung beim Oeffnen, also traf das jede Nutzerin bei
// jedem Start. Mit Merker wird der externe Weg für eine Sperrfrist übersprungen
// und sofort der DB-Fallback der aufrufenden Route gezogen.
const gescheiterteAbrufe = new Map();
const NEGATIV_CACHE_MS = 30 * 60 * 1000;

function istGesperrt(schluessel) {
  const bis = gescheiterteAbrufe.get(schluessel);
  if (!bis) return false;
  if (Date.now() >= bis) {
    gescheiterteAbrufe.delete(schluessel);
    return false;
  }
  return true;
}

async function fetchTageslosung(db, translation) {
  // heuteBerlin() statt toISOString(): Letzteres liefert IMMER den UTC-Tag,
  // die Tageslosung wechselte dadurch erst um 02:00 statt um Mitternacht.
  const today = heuteBerlin();
  const schluessel = `${today}:${translation}`;

  const laufend = laufendeAbrufe.get(schluessel);
  if (laufend) return laufend;

  const abruf = holeTageslosung(db, translation, today)
    .finally(() => { laufendeAbrufe.delete(schluessel); });
  laufendeAbrufe.set(schluessel, abruf);
  return abruf;
}

async function holeTageslosung(db, translation, today) {

  // Cache prüfen
  const { rows: [cachedVerse] } = await db.query(
    'SELECT verse_data FROM daily_verses WHERE date = $1 AND translation = $2',
    [today, translation]
  );

  if (cachedVerse) {
    return { data: cachedVerse.verse_data, translation, cached: true };
  }

  // Steht der externe Abruf unter Sperre, gar nicht erst versuchen — sonst
  // wartet die Anfrage wieder die vollen Timeouts ab.
  if (istGesperrt(`${today}:${translation}`)) {
    throw new Error('Losungen API zuletzt nicht erreichbar (Sperrfrist aktiv)');
  }

  const losungApiKey = process.env.LOSUNG_API_KEY;
  if (!losungApiKey) {
    throw new Error('LOSUNG_API_KEY Umgebungsvariable fehlt');
  }

  // Endpunkte der Reihe nach durchgehen: erst intern, dann oeffentlich.
  let losungData = null;
  let letzterFehler = null;

  for (let i = 0; i < LOSUNG_ENDPUNKTE.length; i++) {
    const basis = LOSUNG_ENDPUNKTE[i];
    const istIntern = basis.startsWith('http://');
    const apiUrl = `${basis}/api/?api_key=${losungApiKey}&translation=${translation}`;

    try {
      // Zeitlimit als AbortSignal: Das eingebaute fetch kennt die Option
      // `timeout` von node-fetch nicht und wuerde sie still ignorieren -- ein
      // haengender interner Container hielte dann jede Anfrage unbegrenzt fest.
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Konfi-Quest-App/1.0'
        },
        signal: AbortSignal.timeout(istIntern ? TIMEOUT_INTERN_MS : TIMEOUT_OEFFENTLICH_MS)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const daten = await response.json();
      if (!daten.success) {
        throw new Error('API meldet success=false');
      }

      losungData = daten;
      break;
    } catch (err) {
      letzterFehler = err;
      // Nur protokollieren, wenn es noch einen weiteren Versuch gibt —
      // sonst wirft der Aufruf ohnehin gleich.
      if (i < LOSUNG_ENDPUNKTE.length - 1) {
        console.warn(`Losungen-API ${basis} nicht erreichbar (${err.message}), weiche aus auf ${LOSUNG_ENDPUNKTE[i + 1]}`);
      }
    }
  }

  if (!losungData) {
    // Sperrfrist setzen, damit die nächsten Anfragen nicht erneut in die
    // Timeouts laufen. Faellt die API zurück, greift sie nach Ablauf wieder.
    gescheiterteAbrufe.set(`${today}:${translation}`, Date.now() + NEGATIV_CACHE_MS);
    console.warn(`Losungen-API nicht erreichbar, Sperrfrist ${NEGATIV_CACHE_MS / 60000} Min fuer ${today}:${translation}`);
    throw new Error(`Losungen API nicht erreichbar: ${letzterFehler ? letzterFehler.message : 'unbekannter Fehler'}`);
  }

  // In Cache speichern
  try {
    await db.query(
      'INSERT INTO daily_verses (date, translation, verse_data) VALUES ($1, $2, $3) ON CONFLICT (date, translation) DO UPDATE SET verse_data = $3',
      [today, translation, losungData.data]
    );
  } catch (cacheErr) {
    console.error('Cache write error:', cacheErr.message);
  }

  // Alte Eintraege bereinigen (aelter als 7 Tage)
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    await db.query(
      'DELETE FROM daily_verses WHERE date < $1',
      [heuteBerlin(sevenDaysAgo)]
    );
  } catch (cleanupErr) {
    console.error('Cleanup error:', cleanupErr.message);
  }

  gescheiterteAbrufe.delete(`${today}:${translation}`);

  return { data: losungData.data, translation, cached: false };
}

/**
 * Statischer Notfall-Text, wenn die Losungs-Schnittstelle nicht erreichbar ist
 * UND der Zwischenspeicher leer ist.
 *
 * Psalm 23 bewusst gewaehlt: der wohl bekannteste Trosttext, passt zu jedem
 * Anlass und wirkt auch dann nicht deplatziert, wenn jemand die Notlage nicht
 * bemerkt.
 */
function tageslosungFallback() {
  return {
    date: formatDatum(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    losung: { text: "Der HERR ist mein Hirte, mir wird nichts mangeln.", reference: "Psalm 23,1", testament: "AT" },
    lehrtext: { text: "Jesus spricht: Ich bin der gute Hirte. Der gute Hirte lässt sein Leben für die Schafe.", reference: "Johannes 10,11", testament: "NT" },
    translation: { code: "LUT", name: "Lutherbibel 2017", language: "German" },
    source: "Fallback"
  };
}

/**
 * Die Tageslosung fuer eine Route beantworten -- EINE Quelle fuer Konfis und
 * Teamer:innen.
 *
 * Was sich je Rolle WIRKLICH unterscheidet, ist genau eins: der Schluessel des
 * Abschalters in `settings`. Deshalb ist er der einzige Parameter.
 *
 * ANTWORTFORM UNVERAENDERT. Ausgelieferte Store-Apps lesen beide Routen; die
 * Felder (success, data, translation, fallback, error) und der 204er bei
 * abgeschalteter Losung bleiben exakt wie bisher.
 *
 * @param {object} db
 * @param {object} req  Express-Request mit req.user (aus rbacVerifier)
 * @param {object} res
 * @param {string} einstellungsSchluessel  Zeile in `settings`, die die Losung
 *   fuer diese Rolle abschaltet ('dashboard_show_losung' fuer Konfis,
 *   'teamer_dashboard_show_losung' fuer Teamer:innen).
 */
async function beantworteTageslosung(db, req, res, einstellungsSchluessel) {
  try {
    const { rows: [losungSetting] } = await db.query(
      'SELECT value FROM settings WHERE organization_id = $1 AND key = $2',
      [req.user.organization_id, einstellungsSchluessel]
    );
    if (losungSetting && (losungSetting.value === 'false' || losungSetting.value === '0')) {
      return res.status(204).end();
    }

    const { rows: [nutzer] } = await db.query(
      'SELECT bible_translation FROM users WHERE id = $1',
      [req.user.id]
    );
    const translation = nutzer?.bible_translation || 'LUT';
    const result = await fetchTageslosung(db, translation);

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('Tageslosung fehlgeschlagen:', err);

    // Erste Rueckfallebene: die zuletzt gecachte Losung aus der Datenbank.
    try {
      const { rows: [gecacht] } = await db.query(
        'SELECT verse_data, translation FROM daily_verses ORDER BY date DESC LIMIT 1'
      );
      if (gecacht) {
        return res.json({
          success: true,
          data: gecacht.verse_data,
          translation: gecacht.translation,
          fallback: true,
          error: 'Aktuelle Tageslosung nicht verfügbar - verwende letzte verfügbare Losung'
        });
      }
    } catch (fallbackErr) {
      console.error('Fallback cache error:', fallbackErr.message);
    }

    // Zweite Rueckfallebene: ein fester Psalm statt HTTP 500. Eine leere
    // Startseite ist schlechter als ein bekannter Vers.
    return res.json({
      success: true,
      data: tageslosungFallback(),
      fallback: true,
      error: 'Losungen API nicht erreichbar - Fallback verwendet'
    });
  }
}

module.exports = {
  fetchTageslosung,
  tageslosungFallback,
  beantworteTageslosung,
  _resetNegativCache: () => gescheiterteAbrufe.clear()
};
