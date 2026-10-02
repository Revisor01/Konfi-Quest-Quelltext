/**
 * Helfer, um aus einem gefangenen Fehler (typischerweise von axios) die
 * anzeigbare Meldung zu gewinnen — ohne `any` im Catch-Block.
 *
 * Entspricht dem bisherigen Muster `err.response?.data?.error || fallback`:
 * fehlt das Feld, ist es leer oder kein String, gibt es den Fallback.
 */

/** Fehlerantwort des Backends — durchgaengig `{ error: "..." }`. */
export interface ApiFehlerAntwort {
  error?: string;
  error_code?: string;
  [feld: string]: unknown;
}

interface MitResponse {
  response?: {
    status?: number;
    data?: {
      error?: unknown;
    };
  };
  code?: unknown;
}

function alsObjekt(err: unknown): MitResponse | null {
  return typeof err === 'object' && err !== null ? (err as MitResponse) : null;
}

/**
 * Herkunft der zuletzt gelieferten FREMDEN Texte — nur fuer die anonyme
 * Fehlermessung (`setError` in AppContext).
 *
 * Der fremde Text dient hier nur als Schluessel im Speicher: hoechstens
 * HERKUNFT_MAX Eintraege, jeder HERKUNFT_GUELTIG_MS lang und nur einmal
 * abrufbar. Er verlaesst das Geraet nicht.
 */
const HERKUNFT_MAX = 10;
const HERKUNFT_GUELTIG_MS = 10_000;
const herkunft = new Map<string, { ersatz: string; art: string; zeit: number }>();

function merkeHerkunft(text: string, ersatz: string, err: unknown): void {
  herkunft.delete(text);
  herkunft.set(text, { ersatz, art: fehlerArt(err), zeit: Date.now() });
  while (herkunft.size > HERKUNFT_MAX) {
    const aeltester = herkunft.keys().next().value;
    if (aeltester === undefined) break;
    herkunft.delete(aeltester);
  }
}

/**
 * Hat `fehlerText`/`fehlerTextOderMessage` gerade diesen Text anstelle ihres
 * Ersatztextes geliefert? Dann: der Ersatztext und die grobe Art (`http-409`,
 * `netz` …). Der Eintrag wird dabei verbraucht.
 */
export function herkunftDesFehlertexts(text: string): { ersatz: string; art: string } | undefined {
  const eintrag = herkunft.get(text);
  if (!eintrag) return undefined;
  herkunft.delete(text);
  if (Date.now() - eintrag.zeit > HERKUNFT_GUELTIG_MS) return undefined;
  return { ersatz: eintrag.ersatz, art: eintrag.art };
}

/**
 * Server-Fehlermeldung aus `err.response.data.error`, sonst der Fallback.
 */
export function fehlerText(err: unknown, fallback: string): string {
  const serverfehler = alsObjekt(err)?.response?.data?.error;
  if (typeof serverfehler === 'string' && serverfehler) {
    merkeHerkunft(serverfehler, fallback, err);
    return serverfehler;
  }
  return fallback;
}

/**
 * Wie fehlerText, faellt aber vor dem Fallback noch auf `err.message`
 * zurueck (bisheriges Muster der Upload-Pfade:
 * `err.response?.data?.error || err.message || fallback`).
 */
export function fehlerTextOderMessage(err: unknown, fallback: string): string {
  const serverfehler = alsObjekt(err)?.response?.data?.error;
  if (typeof serverfehler === 'string' && serverfehler) {
    merkeHerkunft(serverfehler, fallback, err);
    return serverfehler;
  }
  const message = (alsObjekt(err) as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message) {
    merkeHerkunft(message, fallback, err);
    return message;
  }
  return fallback;
}

/**
 * HTTP-Status aus `err.response.status`, sonst undefined
 * (auch bei Netzwerkfehlern ohne Response).
 */
export function fehlerStatus(err: unknown): number | undefined {
  const status = alsObjekt(err)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Hat der Server endgueltig abgelehnt, sodass ein neuer Versuch nichts
 * aendert? 4xx ausser 408 (Zeitueberschreitung) und 429 (zu viele Anfragen).
 * Dieselbe Regel gilt fuer die Warteschlange (services/writeQueue.ts, flush)
 * und den direkten Versand im Chat (components/chat/ChatRoom.tsx) -- an einer
 * Stelle, damit sie nicht auseinanderlaufen.
 */
export function endgueltigAbgelehnt(status: number | undefined): boolean {
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Netzwerkfehler: keine Response vorhanden oder axios-Code ERR_NETWORK.
 * (Ein plain `Error` ohne response zählt wie bisher als Netzwerkfehler.)
 */
export function istNetzwerkfehler(err: unknown): boolean {
  const obj = alsObjekt(err);
  return !obj?.response || obj.code === 'ERR_NETWORK';
}

/**
 * Rohdaten der Fehlerantwort (`err.response.data`), sonst undefined.
 *
 * Fuer die Stellen, die neben der Meldung noch Begleitfelder auswerten —
 * etwa `error_code`, `canForceDelete` oder `next_tier` bei den Tarifgrenzen.
 */
export function fehlerDaten(err: unknown): ApiFehlerAntwort | undefined {
  const daten = alsObjekt(err)?.response?.data;
  return typeof daten === 'object' && daten !== null ? (daten as ApiFehlerAntwort) : undefined;
}

/**
 * Engt einen `unknown` aus dem Catch auf die gelesene Form ein. Gibt immer
 * ein Objekt zurueck, damit Aufrufer gefahrlos `?.` benutzen koennen.
 */
export function alsApiFehler(err: unknown): { response?: { status?: number; data?: ApiFehlerAntwort }; message?: string; code?: string } {
  return alsObjekt(err) !== null ? (err as { response?: { status?: number; data?: ApiFehlerAntwort }; message?: string; code?: string }) : {};
}

/** Was `fehlerFuersProtokoll` von einem Fehler uebrig laesst. */
export interface ProtokollFehler {
  /** HTTP-Status der Antwort, falls es eine gab. */
  status?: number;
  /** Fehlercode von axios (`ERR_NETWORK`, `ECONNABORTED` …) oder eines Plugins. */
  code?: string;
  /** Fehlertext des Servers aus `response.data.error`. */
  fehler?: string;
  /** `err.message` — bei axios allgemein ("Request failed with status code 401"). */
  meldung?: string;
}

/**
 * Die unkritischen Felder eines gefangenen Fehlers, fuer `console.*`.
 *
 * WARUM: Ein axios-Fehler traegt
 * die gesendete Anfrage mit. `config.data` ist der Koerper im Klartext — bei
 * der Anmeldung Benutzername UND Passwort, beim Refresh und Abmelden der
 * Refresh-Token —, `config.headers.Authorization` das Zugangs-Token, dazu
 * `request` und `response.config` mit denselben Daten. Wer den ganzen Fehler
 * an die Konsole gibt, schreibt das alles ins Protokoll des Geraets.
 *
 * Deshalb nur, was zum Eingrenzen reicht: Status, Code, Server-Fehlertext und
 * die Meldung. Niemals `config`, `request` oder das Fehlerobjekt selbst.
 */
export function fehlerFuersProtokoll(err: unknown): ProtokollFehler {
  const obj = alsObjekt(err) as (MitResponse & { message?: unknown }) | null;
  const ergebnis: ProtokollFehler = {};

  const status = fehlerStatus(err);
  if (status !== undefined) ergebnis.status = status;
  if (typeof obj?.code === 'string' && obj.code) ergebnis.code = obj.code;
  const serverfehler = obj?.response?.data?.error;
  if (typeof serverfehler === 'string' && serverfehler) ergebnis.fehler = serverfehler;
  if (typeof obj?.message === 'string' && obj.message) ergebnis.meldung = obj.message;

  return ergebnis;
}

// Fehler, die `fehlerEntschaerfen` schon behandelt hat. Ein WeakSet statt
// eines Feldes am Fehler: Es haelt nichts am Leben und taucht in keiner
// Ausgabe auf.
const entschaerfteFehler = new WeakSet<object>();

/** true, wenn der Fehler schon entschaerft (und damit endgueltig) ist. */
export function istEntschaerft(err: unknown): boolean {
  return typeof err === 'object' && err !== null && entschaerfteFehler.has(err);
}

type Kopfzeilen = { delete?: (name: string) => unknown; [name: string]: unknown };

function konfigurationEntschaerfen(config: unknown): void {
  if (typeof config !== 'object' || config === null) return;
  const c = config as { headers?: Kopfzeilen; data?: unknown };
  const headers = c.headers;
  if (headers && typeof headers === 'object') {
    // AxiosHeaders loescht ohne Ruecksicht auf Gross-/Kleinschreibung;
    // ein schlichtes Objekt (Tests, aeltere Aufrufer) Feld fuer Feld.
    if (typeof headers.delete === 'function') headers.delete('Authorization');
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'authorization') delete headers[name];
    }
  }
  if ('data' in c) delete c.data;
}

/**
 * Entfernt aus einem ENDGUELTIG abgelehnten axios-Fehler, was nicht ins
 * Protokoll gehoert, und gibt denselben Fehler zurueck.
 *
 * WARUM ZENTRAL: Rund 100
 * Stellen in etwa 40 Dateien geben gefangene Fehler roh an die Konsole
 * (`console.error('…', err)`). Ein axios-Fehler traegt die gesendete Anfrage
 * mit: `config.headers.Authorization` ist das Zugangs-Token, `config.data`
 * der Koerper (beim Anmelden das Passwort, beim Refresh der Refresh-Token,
 * sonst Chat-Texte, Begruendungen, Namen), `request` die Leitung samt
 * Kopfzeilen. Nach einem gescheiterten Refresh bekamen die wartenden Anfragen
 * sogar den Refresh-Fehler mit dem Refresh-Token im Koerper. Statt jede Stelle
 * einzeln umzubauen, entschaerft die API-Instanz (api.ts) jeden Fehler, bevor
 * sie ihn an den Aufrufer weitergibt.
 *
 * Entfernt: `config.headers.Authorization`, `config.data`, `request`,
 * `response.request` (und dieselben Felder an `response.config`, falls das
 * ein eigenes Objekt ist). Bleibt: Status, Code, Meldung, `response.data`
 * (die Antwort des Servers -- danach richten sich die Fehlermeldungen der
 * App), `response.headers` (etwa `retry-after`), `config.url`/`method`.
 *
 * NUR fuer endgueltige Fehler: Eine Wiederholung nach dem Refresh oder durch
 * axios-retry braucht Kopfzeilen und Koerper noch. Mehrfaches Anwenden
 * schadet nicht.
 */
export function fehlerEntschaerfen<T>(err: T): T {
  if (typeof err !== 'object' || err === null) return err;
  const f = err as unknown as {
    config?: unknown;
    request?: unknown;
    response?: { config?: unknown; request?: unknown };
  };
  konfigurationEntschaerfen(f.config);
  if ('request' in f) delete f.request;
  if (f.response && typeof f.response === 'object') {
    if (f.response.config !== f.config) konfigurationEntschaerfen(f.response.config);
    if ('request' in f.response) delete f.response.request;
  }
  entschaerfteFehler.add(err as unknown as object);
  return err;
}

/**
 * Grobe Ursache eines gefangenen Fehlers, fuer die anonyme Messung.
 *
 * Beantwortet das WARUM, ohne irgendetwas ueber die Person oder ihre Daten zu
 * verraten. Das Ergebnis ist IMMER einer von wenigen festen Werten:
 *
 * - `http-403`, `http-404`, `http-500` …  — der Status, sonst nichts. Kein
 *   Text der Antwort, keine URL, keine Kennung.
 * - `timeout`                              — die Anfrage lief in die Zeitgrenze.
 * - `netz`                                 — offline oder Verbindung abgerissen.
 * - `abbruch`                              — die Anfrage wurde abgebrochen
 *                                            (Seitenwechsel), kein echter Fehler.
 * - `intern`                               — im Browser aufgetreten, keine
 *                                            Anfrage im Spiel (z.B. ein
 *                                            fehlgeschlagenes natives Plugin).
 *
 * Niemals uebertragen werden `err.message`, `err.response.data`, Dateinamen,
 * Kennungen oder URLs — die enthalten Namen und Freitext. Der Status ist eine
 * dreistellige Zahl aus einer festen Menge und damit nicht rueckfuehrbar.
 */
export function fehlerArt(err: unknown): string {
  const obj = alsObjekt(err) as { code?: unknown; name?: unknown } | null;
  const code = typeof obj?.code === 'string' ? obj.code : '';
  const name = typeof obj?.name === 'string' ? obj.name : '';

  // Zeitgrenze VOR dem Netzwerkfehler pruefen: axios liefert bei einem Timeout
  // ebenfalls keine Response, `istNetzwerkfehler` wuerde es sonst schlucken.
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || name === 'TimeoutError') {
    return 'timeout';
  }
  if (code === 'ERR_CANCELED' || name === 'CanceledError' || name === 'AbortError') {
    return 'abbruch';
  }

  const status = fehlerStatus(err);
  if (typeof status === 'number' && status >= 100 && status <= 599) {
    return `http-${status}`;
  }

  // axios meldet einen abgerissenen Transport als ERR_NETWORK; ein `fetch`
  // scheitert stattdessen mit einem TypeError ohne jede Kennzeichnung.
  if (code === 'ERR_NETWORK') return 'netz';

  // Kein axios-Fehler mit Status: entweder ein Netzwerkproblem ohne
  // Kennzeichnung oder ein Fehler im Browser selbst. Ist das Geraet offline,
  // ist es das Netz.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'netz';
  }
  return 'intern';
}
