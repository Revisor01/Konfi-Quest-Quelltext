/**
 * Anonyme Nutzungsmessung (Umami, self-hosted auf t.godsapp.de).
 *
 * WAS ERFASST WIRD: ausschliesslich Ereignisse ohne Personenbezug — welcher
 * Bereich wurde geoeffnet, welche Funktion genutzt, wo bricht etwas ab. Dazu
 * die ROLLE (konfi/teamer/admin), damit sich die Zahlen nach Gruppe filtern
 * lassen.
 *
 * WAS NICHT ERFASST WIRD: keine Nutzer-ID, kein Name, kein Jahrgang, keine
 * Organisation, keine Beitragsinhalte, keine Chat-Nachrichten. Die Nutzenden
 * sind ueberwiegend minderjaehrig — die Zahlen sollen zeigen, was die App
 * taugt, nicht was einzelne Personen tun. Bewusst auch KEINE Organisation:
 * bei einer Gemeinde mit drei Teamern wäre das faktisch personenbezogen.
 *
 * Umami setzt keine Cookies und speichert keine IP-Adressen; die Zuordnung
 * einer Sitzung passiert serverseitig über einen täglich wechselnden Hash.
 *
 * In der nativen App gibt es keine Domain, an der das Umami-Script hängen
 * könnte — deshalb sprechen wir die /api/send-Schnittstelle direkt an.
 */

const UMAMI_URL = 'https://t.godsapp.de/api/send';
const WEBSITE_ID = '72da966c-4b34-41f8-9dbe-e7fb7397f6d6';

// Rolle der aktuellen Sitzung. Wird beim Login gesetzt und ist die EINZIGE
// Eigenschaft, die etwas über die Person aussagt — bewusst grob gehalten.
let aktuelleRolle: string | null = null;

// Messung abschaltbar (z.B. Entwicklung), ohne alle Aufrufe anzufassen.
const AKTIV = import.meta.env.PROD;

export function setAnalyticsRole(roleName?: string | null): void {
  if (!roleName) { aktuelleRolle = null; return; }
  // Auf die drei bekannten Gruppen normalisieren; alles andere wird "sonstige",
  // damit keine selbst vergebenen Rollentitel aus einer Gemeinde durchsickern.
  const r = roleName.toLowerCase();
  aktuelleRolle = (r === 'konfi' || r === 'teamer' || r === 'admin' || r === 'org_admin')
    ? (r === 'org_admin' ? 'admin' : r)
    : 'sonstige';
}

/**
 * Ereignis melden. Schlaegt der Versand fehl (offline, Blocker, Server weg),
 * wird das still verworfen — Messung darf die App nie stoeren oder bremsen.
 */
/**
 * Gemeinsamer Sendeweg. keepalive: Die Anfrage geht auch dann noch raus,
 * wenn die App direkt danach in den Hintergrund wechselt.
 */
function sende(typ: 'event', nutzlast: Record<string, unknown>): void {
  try {
    fetch(UMAMI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: typ, payload: nutzlast }),
      keepalive: true
    }).catch(() => { /* Messung darf nie stoeren */ });
  } catch {
    /* Messung darf nie stoeren */
  }
}

export function track(ereignis: string, daten?: Record<string, string | number | boolean>): void {
  if (!AKTIV) return;

  sende('event', {
    website: WEBSITE_ID,
    name: ereignis,
    data: { ...(daten || {}), ...(aktuelleRolle ? { rolle: aktuelleRolle } : {}) },
    // Ohne Domain/URL ordnet Umami das Ereignis keiner Seite zu. Feste Werte
    // statt echter Routen: die Route kann Namen oder IDs enthalten.
    hostname: 'app.konfi-quest.de',
    url: '/app',
    language: 'de',
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`
  });
}

/**
 * Sitzungsbeginn als Seitenaufruf melden.
 *
 * WARUM DAS NOETIG IST: Umami zählt Besucher und Sitzungen ausschliesslich
 * über SEITENAUFRUFE. Wir haben anfangs nur benannte Ereignisse gesendet —
 * die kamen alle an, aber das Dashboard zeigte 0 Besucher und 0 Seitenaufrufe,
 * weil dort nichts zu zählen war (nachgesehen 11.08.: 130 Ereignisse, 0
 * Seitenaufrufe).
 *
 * WIE EIN SEITENAUFRUF GESENDET WIRD: als `type: 'event'` OHNE `name`.
 * Das ist der Unterschied — mit `name` wird daraus ein benanntes Ereignis
 * (event_type=2), ohne `name` ein Seitenaufruf (event_type=1). Ein
 * `type: 'pageview'` lehnt diese Umami-Version mit HTTP 400 ab; erlaubt sind
 * nur 'event', 'identify' und 'performance' (am Server geprüft 11.08.).
 *
 * Ein Aufruf je Sitzung genuegt; die Ereignisse hängen sich über die
 * Session daran. Bewusst dieselbe feste URL wie bei den Ereignissen — echte
 * Routen können Namen oder IDs enthalten.
 */
export function trackSitzungsstart(): void {
  if (!AKTIV) return;
  sende('event', {
    website: WEBSITE_ID,
    // KEIN `name` — genau das macht daraus einen Seitenaufruf.
    hostname: 'app.konfi-quest.de',
    url: '/app',
    language: 'de',
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    ...(aktuelleRolle ? { data: { rolle: aktuelleRolle } } : {})
  });
}

/** Aufruf eines Bereichs (Tab, Hauptansicht). */
export function trackBereich(bereich: string): void {
  track('bereich-geoeffnet', { bereich });
}

/** Fehler, den die nutzende Person zu sehen bekommt. */
export function trackFehler(stelle: string, art?: string): void {
  track('fehler', { stelle, ...(art ? { art } : {}) });
}
