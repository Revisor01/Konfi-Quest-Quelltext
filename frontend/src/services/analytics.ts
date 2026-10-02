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
 * In der nativen App gibt es keine Domain, an der das Umami-Script hängen
 * könnte — deshalb sprechen wir die /api/send-Schnittstelle direkt an.
 */

import { BEKANNTE_FEHLERTEXTE, ZUGELASSENE_SERVERTEXTE } from '../utils/bekannteFehlertexte';

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

/**
 * Erlaubte Form eines Bereichsnamens: Kleinbuchstaben und Bindestriche,
 * hoechstens 40 Zeichen. Alle Routen tragen an dieser Stelle einen festen
 * Namen; eine Kennung (`/konfi/42` aus einem alten Link, bevor die Umleitung
 * greift) faellt damit heraus, statt als Bereich im Dashboard zu stehen.
 */
const BEREICH_MUSTER = /^[a-z][a-z-]{0,39}$/;

/**
 * Bereichsname aus einem Pfad — nie die volle Route, die kann Kennungen
 * enthalten (/admin/konfis/42).
 *
 * Grundregel: der zweite Pfadteil (`/admin/konfis/42` -> `konfis`), bei
 * einteiligen Pfaden der erste (`/login`).
 *
 * Liefert `null`, wenn der Name nicht die erlaubte Form hat — dann wird
 * nichts gemeldet.
 */
export function bereichAusPfad(pfad: string): string | null {
  const teile = pfad.split('/').filter(Boolean);
  const bereich = teile[1] === 'profile' && teile[2] ? teile[2] : (teile[1] || teile[0]);
  return bereich && BEREICH_MUSTER.test(bereich) ? bereich : null;
}

/**
 * Ansicht unter „Mitmachen" (Konfi und Team): Events oder Aktivitäten.
 */
export function trackMitmachenAnsicht(ansicht: 'events' | 'antraege'): void {
  trackBereich(ansicht === 'antraege' ? 'activities' : 'events');
}

/**
 * Platzhalter fuer `stelle`, wenn der Meldungstext nicht zu den bekannten
 * Texten gehoert — in der Regel ein Text vom Server, der Namen, Titel oder
 * Dateinamen enthalten kann.
 */
export const STELLE_ANDERE_MELDUNG = 'andere-meldung';

/** Ziffernfolgen zu einem `#`, hoechstens 80 Zeichen. */
function entschaerft(text: string): string {
  return text.replace(/\d+/g, '#').slice(0, 80);
}

/**
 * Die einzigen Werte, die `stelle` je annehmen kann: die bekannten Texte in
 * entschaerfter Form und der Platzhalter. Eine feste, endliche Menge aus
 * Literalen des Quelltextes — was nicht darin steht, geht nicht raus.
 */
export const ERLAUBTE_STELLEN: ReadonlySet<string> = new Set([
  ...[...BEKANNTE_FEHLERTEXTE, ...ZUGELASSENE_SERVERTEXTE].map(entschaerft),
  STELLE_ANDERE_MELDUNG
]);

/**
 * `stelle` fuer die Messung: der Meldungstext, wenn er ein bekannter Text ist
 * (Ziffern zu `#`, gekuerzt), sonst der `ersatz` der Aufrufstelle, wenn DER
 * bekannt ist, sonst `andere-meldung`.
 *
 * Verglichen wird die entschaerfte Form. Das aendert nichts an der Sperre:
 * Gesendet wird immer ein Element von ERLAUBTE_STELLEN, und jedes davon ist
 * ein Text aus dem Quelltext.
 */
export function fehlerStelle(meldung: string, ersatz?: string): string {
  const stelle = entschaerft(meldung);
  if (ERLAUBTE_STELLEN.has(stelle) && stelle !== STELLE_ANDERE_MELDUNG) return stelle;
  if (ersatz) {
    const ersatzStelle = entschaerft(ersatz);
    if (ERLAUBTE_STELLEN.has(ersatzStelle)) return ersatzStelle;
  }
  return STELLE_ANDERE_MELDUNG;
}

/**
 * Fehler, den die nutzende Person zu sehen bekommt.
 *
 * `stelle` ist die Meldung (das WAS) — aber nur, wenn sie zu den bekannten
 * Texten gehoert, siehe `fehlerStelle`. `art` ist die grobe Ursache (das
 * WARUM: `http-404`, `netz`, `timeout` …) und `ort` ein im Code fest
 * vergebenes Kuerzel (das WO). Alle drei sind bewusst grob und niemals
 * rueckfuehrbar — siehe `fehlerArt`/`ORT_MUSTER` unten.
 *
 * `stelle` wird HIER noch einmal gegen die Liste geprueft — die zweite
 * Sperre, falls jemand kuenftig an AppContext vorbei meldet. Ein Wert, den
 * `fehlerStelle` schon geliefert hat, kommt dabei unveraendert durch.
 */
export function trackFehler(stelle: string, art?: string, ort?: string): void {
  track('fehler', {
    stelle: fehlerStelle(stelle),
    ...(art ? { art } : {}),
    ...(ort ? { ort } : {})
  });
}

/**
 * Erlaubte Form eines Ort-Kuerzels: nur Kleinbuchstaben, Ziffern und
 * Bindestriche, hoechstens 40 Zeichen. Die Kuerzel stehen fest im Code
 * (`material-teamer-liste`, `chat-datei` …) und enthalten nie Daten aus einer
 * Antwort, einem Dateinamen oder einer Eingabe. Die Pruefung ist die zweite
 * Sperre: selbst wenn irgendwo versehentlich ein Dateiname durchgereicht
 * wuerde, faellt er hier raus statt bei Umami zu landen.
 */
const ORT_MUSTER = /^[a-z0-9-]{1,40}$/;

/** Erlaubte Werte fuer `art` — eine feste, kurze Liste. */
const ART_MUSTER = /^(http-[1-5][0-9]{2}|netz|timeout|abbruch|intern)$/;

export function istGueltigerOrt(ort: string): boolean {
  return ORT_MUSTER.test(ort);
}

export function istGueltigeArt(art: string): boolean {
  return ART_MUSTER.test(art);
}

/* ------------------------------------------------------------------ *
 * Nutzungstiefe: WAS wird in der App getan, nicht nur DASS jemand da war
 * ------------------------------------------------------------------ */

/**
 * Die Handlungen, die gezaehlt werden. Bewusst eine KURZE, feste Liste — sie
 * beantwortet die Frage, die eine Landeskirche vor einem Rollout stellt:
 * arbeiten Gemeinden wirklich mit der App, oder melden sich Leute nur an?
 *
 *  - `punkte-vergeben`      Die Kernhandlung der Leitung: eine Aktivitaet oder
 *                           Bonuspunkte bei einer Konfi verbucht.
 *  - `anwesenheit-erfasst`  Ein Termin wurde nachbereitet statt nur angelegt.
 *  - `beitrag-moderiert`    Jemand hat einen Challenge-Beitrag durchgesehen.
 *  - `termin-angelegt`      Die Gemeinde plant ihre Arbeit in der App.
 *  - `material-bereitgestellt` Inhalte fuer das Team eingestellt.
 *
 *  - `antrag-entschieden`   Die Leitung nimmt einen Antrag an oder lehnt ihn ab.
 *  - `material-angesehen`   Die Detailansicht eines Materials ist geoeffnet.
 *  - `material-abgerufen`   Eine Datei oder ein Link daraus ist geoeffnet.
 *  - `konfispruch-gespeichert` Ein Spruch aus den Vorschlaegen oder ein eigener.
 *                           Bewusst OHNE Bibelstelle: ein Konfirmationsspruch
 *                           ist oeffentlich und machte die Sitzung einer Konfi
 *                           wiedererkennbar.
 *
 * NICHT dabei und bewusst nicht: Chat-Nachrichten (Zahl sagt ueber die
 * paedagogische Nutzung nichts aus und liegt inhaltlich zu nah an den
 * Beteiligten), Jahresrueckblick-Aufrufe (wird an sechs Stellen geoeffnet,
 * "angesehen" ist keine Arbeit), Anmeldungen zu Terminen und
 * Challenge-Beitraege (werden bereits als `event-angemeldet` und
 * `challenge-beitrag` gezaehlt — nicht doppelt zaehlen).
 */
export type Handlung =
  | 'punkte-vergeben'
  | 'anwesenheit-erfasst'
  | 'beitrag-moderiert'
  | 'termin-angelegt'
  | 'material-bereitgestellt'
  | 'antrag-entschieden'
  | 'material-angesehen'
  | 'material-abgerufen'
  | 'konfispruch-gespeichert';

/**
 * Erlaubte Auspraegungen je Handlung. Diese Liste ist die harte Grenze: was
 * hier nicht steht, geht NICHT raus.
 *
 * WARUM eine Positivliste und kein Muster wie bei `ort`: Ein Muster laesst
 * jede Zeichenkette durch, die zufaellig aus Kleinbuchstaben besteht — ein
 * Aktivitaetsname ("gottesdienst-in-huesby"), ein Titel, ein Dateiname. Hier
 * werden aber Werte aus Formularen weitergereicht; da genuegt eine Formregel
 * nicht. Steht ein Wert nicht in der Liste, wird das Merkmal weggelassen —
 * das Ereignis selbst geht trotzdem raus, damit die Zaehlung stimmt.
 */
const ERLAUBTE_MERKMALE: Record<Handlung, Record<string, readonly string[]>> = {
  'punkte-vergeben': {
    // Aktivitaet aus der Liste oder frei vergebene Bonuspunkte.
    weg: ['aktivitaet', 'bonus'],
    // Punkteart des Jahrgangs. 'ohne' = Teamer-Aktivitaet ohne Punkteart.
    punkteart: ['gottesdienst', 'gemeinde', 'ohne']
  },
  'anwesenheit-erfasst': {
    // Einzeln abgehakt oder der ganze Termin auf einmal.
    umfang: ['einzeln', 'alle'],
    // Ob Konfis oder das Team verbucht wurden.
    gruppe: ['konfi', 'teamer']
  },
  'beitrag-moderiert': {
    entscheidung: ['freigegeben', 'ausgeblendet', 'wieder-sichtbar', 'anonymisiert']
  },
  'termin-angelegt': {
    // Einzeltermin oder Serie — zeigt, ob laufende Arbeit geplant wird.
    form: ['einzeln', 'serie'],
    zielgruppe: ['konfi', 'teamer']
  },
  'material-bereitgestellt': {
    inhalt: ['datei', 'link', 'beides', 'nur-text']
  },
  'antrag-entschieden': {
    entscheidung: ['angenommen', 'abgelehnt'],
    // Wer den Antrag gestellt hat — aus der Zielgruppe der Aktivitaet, nie
    // die Person. Kein Grund, keine Aktivitaet, keine Punktzahl.
    antrag_von: ['konfi', 'teamer']
  },
  'material-angesehen': {
    // Dieselben Werte wie beim Bereitstellen (materialInhalt), damit sich
    // Eingestelltes und Angesehenes nebeneinanderlegen lassen.
    inhalt: ['datei', 'link', 'beides', 'nur-text']
  },
  'material-abgerufen': {
    // Was geoeffnet wurde — nie Dateiname, Dateityp oder Adresse.
    inhalt: ['datei', 'link']
  },
  'konfispruch-gespeichert': {
    quelle: ['vorschlag', 'eigen'],
    bibel: ['luther', 'gute-nachricht', 'bigs', 'elberfelder']
  }
};

/**
 * Art des Material-Inhalts, fuer `material-bereitgestellt` und
 * `material-angesehen` aus derselben Hand.
 */
export function materialInhalt(
  hatDatei: boolean,
  hatLink: boolean
): 'datei' | 'link' | 'beides' | 'nur-text' {
  if (hatDatei && hatLink) return 'beides';
  if (hatDatei) return 'datei';
  if (hatLink) return 'link';
  return 'nur-text';
}

/**
 * Eine Handlung melden, die auf dem Server GELUNGEN ist.
 *
 * Aufrufregel: erst nach der erfolgreichen Antwort, nie beim Klick. Ein Klick,
 * der in einem Fehler endet, ist keine Nutzung — und wuerde die Zahlen genau
 * dort schoenen, wo sie ehrlich sein muessen.
 *
 * DATENSCHUTZ: Uebertragen werden ausschliesslich die Art der Handlung, die
 * groben Merkmale aus der Liste oben und die Rolle (haengt `track` an). Kein
 * Name, keine Kennung, kein Jahrgang, keine Gemeinde, kein Titel, kein
 * Dateiname, keine Punktzahl und keine Anzahl — bei einer Gemeinde mit drei
 * Teamer:innen waere schon eine Anzahl ein Fingerabdruck. Werte ausserhalb der
 * Liste werden verworfen, nicht gesendet.
 *
 * KEINE LAST: `track` sendet fire-and-forget mit `keepalive`; ein
 * fehlgeschlagener Versand wird still verworfen. Zusaetzlich faengt diese
 * Funktion jeden eigenen Fehler ab — ein kaputtes Merkmal darf niemals
 * verhindern, dass Punkte vergeben werden.
 */
export function trackHandlung(
  handlung: Handlung,
  merkmale?: Record<string, string | undefined | null>
): void {
  try {
    const erlaubt = ERLAUBTE_MERKMALE[handlung];
    // Unbekannte Handlung: gar nicht senden. Sonst waere jeder Tippfehler
    // ein neuer Ereignisname im Dashboard.
    if (!erlaubt) return;

    const gefiltert: Record<string, string> = {};
    for (const [schluessel, werte] of Object.entries(erlaubt)) {
      const wert = merkmale?.[schluessel];
      if (typeof wert === 'string' && (werte as readonly string[]).includes(wert)) {
        gefiltert[schluessel] = wert;
      }
    }

    track(handlung, gefiltert);
  } catch {
    /* Messung darf nie stoeren */
  }
}
