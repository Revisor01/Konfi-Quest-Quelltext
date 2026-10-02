/**
 * Absturzdiagnose (Firebase Crashlytics, nur auf den Geraeten).
 *
 * WARUM DAS UEBERHAUPT GEBRAUCHT WIRD:
 * Von Abstuerzen erfahren wir bisher zufaellig und Tage spaeter. Android
 * Vitals meldete vier betroffene Nutzende und 16 Abstuerze in 28 Tagen — die
 * Ursache lag NATIV im Push-Plugin, also an einer Stelle, an der kein
 * JavaScript mehr laeuft, das etwas melden koennte. Gleichzeitig blieb ein
 * reproduzierbarer Absturz eines einzelnen Testgeraetes in der Play
 * Developer Reporting API vollstaendig unsichtbar: Google aggregiert und
 * blendet aus, was zu selten vorkommt ("Version von 81 bis 81"). Bei einem
 * Testgeraet also: Stille.
 *
 * Crashlytics laeuft nativ und meldet pro Geraet, ohne Aggregationsschwelle.
 * Genau diese Luecke schliesst es — und nur die.
 *
 * NUR AUF DEN GERAETEN: Crashlytics gibt es im Browser nicht. Jeder Aufruf
 * hier liegt hinter `Capacitor.isNativePlatform()`, wie es notifications.ts
 * durchgehend macht. Im Web ist jede Funktion ein no-op; der Web-Zweig des
 * Plugins wuerde sonst `unimplemented()` WERFEN.
 *
 * ---------------------------------------------------------------------------
 * DATENSPARSAMKEIT — was hier bewusst NICHT uebertragen wird
 * ---------------------------------------------------------------------------
 * Die App wird ueberwiegend von Jugendlichen genutzt. Uebertragen wird
 * deshalb ausschliesslich, was zum EINGRENZEN eines Absturzes noetig ist:
 *
 *   - Rolle in grober Einteilung (konfi/teamer/admin/sonstige) — dieselbe
 *     Normalisierung wie bei der Nutzungsmessung.
 *   - Organisations-ID als ZAHL. Bei 15.000 Nutzenden ueber viele Gemeinden
 *     ist "welche Gemeinde ist betroffen" die erste Frage bei einem Absturz;
 *     ohne sie laesst sich nicht unterscheiden, ob ein Fehler ueberall oder
 *     nur bei einer besonderen Datenlage auftritt. Die reine Zahl sagt
 *     nichts ueber eine Person aus und steht nirgends im Klartext.
 *   - Plattform und App-Fassung.
 *
 * NICHT uebertragen: Name, E-Mail, Benutzername, Nutzer-ID, Jahrgang,
 * Gemeindename, Inhalte, Chat-Nachrichten, Push-Token. `setUserId` wird
 * bewusst NICHT aufgerufen — auch nicht mit der device_id. Crashlytics
 * gruppiert Abstuerze schon von sich aus pro Installation, eine eigene
 * Kennung braucht es dafuer nicht; sie waere die einzige Angabe, die sich
 * ueber Sitzungen und Konten hinweg auf ein GERAET zurueckfuehren liesse
 * (und ueber die Tabelle der Push-Tokens sogar auf eine Person, denn dort
 * steht device_id neben der Nutzer-ID). Der Nutzen rechtfertigt das nicht.
 *
 * ---------------------------------------------------------------------------
 * ABSCHALTBARKEIT
 * ---------------------------------------------------------------------------
 * Im Profil steht in allen drei Rollen der Schalter "Absturzberichte senden"
 * (shared/AbsturzberichteSchalter.tsx). Die Wahl gilt fuer das GERAET, nicht
 * fuer das Konto, und liegt in den Preferences (`DIAGNOSE_SCHLUESSEL`): steht
 * dort 'aus', ist die Diagnose aus; fehlt der Eintrag, ist sie an.
 *
 * WAS "AUS" HEISST -- zwei Ebenen, weil eine allein nicht reicht:
 *   1. In JavaScript sendet keine Funktion dieses Moduls mehr etwas: kein
 *      Bericht, keine Wegmarke, keine Merkmale (`diagnoseErlaubt`). Das wirkt
 *      sofort.
 *   2. Nativ: `setEnabled(false)` schaltet das Sammeln von Crashlytics ab, und
 *      `deleteUnsentReports` verwirft, was noch auf dem Geraet liegt. Das
 *      Firebase-SDK wendet `setEnabled` erst beim NAECHSTEN Start an; ein
 *      Absturz im selben Lauf wird zwar noch aufgezeichnet, geht aber nicht
 *      mehr hinaus: Beim naechsten Start ist das Sammeln aus, und
 *      `diagnoseStarten` verwirft den Bericht, bevor er gesendet wird.
 *
 * Laesst sich die Einstellung nicht lesen, gilt "aus" -- lieber ein Bericht zu
 * wenig als einer gegen den erklaerten Willen.
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { FirebaseCrashlytics } from '@capacitor-firebase/crashlytics';

/**
 * Preferences-Schluessel der Geraete-Einstellung. 'aus' = keine
 * Absturzberichte; fehlt der Eintrag, ist die Diagnose an (siehe
 * ABSCHALTBARKEIT oben). Ueberlebt das Abmelden -- wie die App-Sperre ist es
 * eine Aussage ueber das Geraet, nicht ueber das Konto.
 */
export const DIAGNOSE_SCHLUESSEL = 'konfi_absturzberichte';

/** Gelesene Einstellung, einmal je App-Lauf (der Schalter setzt sie neu). */
let erlaubtStand: Promise<boolean> | null = null;

/** Nur fuer Tests: gelesene Einstellung vergessen (entspricht einem Neustart). */
export function diagnoseEinstellungVergessen(): void {
  erlaubtStand = null;
}

/**
 * Darf die Diagnose senden? Liest die Geraete-Einstellung einmal je Lauf.
 * Nicht lesbar -> false (siehe ABSCHALTBARKEIT: lieber ein Bericht zu wenig).
 */
export function diagnoseErlaubt(): Promise<boolean> {
  if (!erlaubtStand) {
    erlaubtStand = (async () => {
      try {
        const { value } = await Preferences.get({ key: DIAGNOSE_SCHLUESSEL });
        return value !== 'aus';
      } catch {
        return false;
      }
    })();
  }
  return erlaubtStand;
}

/**
 * Obergrenze fuer nicht-fatale Meldungen JE APP-SITZUNG.
 *
 * WARUM EINE GRENZE: Ein Renderfehler in einer Liste wiederholt sich bei
 * jedem Render. Ein einzelnes Geraet kann so in Minuten hunderte Meldungen
 * erzeugen; bei 15.000 Nutzenden und einem verbreiteten Fehler waeren das
 * Millionen. Crashlytics verwirft dann selbst (serverseitige Drosselung) —
 * und zwar unvorhersehbar, sodass am Ende gerade die seltenen Berichte
 * fehlen, um die es hier eigentlich geht.
 *
 * ZWEI SPERREN, absichtlich:
 *   1. Je Fehlerart (gleiche Meldung) nur EINE Uebertragung pro Sitzung. Der
 *      zweite Bericht derselben Ursache bringt keine neue Erkenntnis.
 *   2. Insgesamt hoechstens 20 je Sitzung, als harte Kappe gegen eine
 *      Fehlerschleife mit staendig neuen Meldungstexten.
 *
 * Die Zaehler leben nur im Speicher: Ein App-Neustart darf wieder melden,
 * sonst faellt ein Fehler, der genau beim Start auftritt, nach dem ersten Mal
 * dauerhaft aus der Messung.
 */
const MELDUNGEN_JE_SITZUNG_MAX = 20;
const bereitsGemeldet = new Set<string>();
let gemeldetInsgesamt = 0;

/** Nur fuer Tests: Drosselungszaehler zuruecksetzen. */
export function drosselungZuruecksetzen(): void {
  bereitsGemeldet.clear();
  gemeldetInsgesamt = 0;
}

/**
 * Laenge einer Meldung, die an Crashlytics geht. Lange Texte enthalten
 * erfahrungsgemaess Nutzdaten (Antworten, Dateinamen, Eingaben) — gekuerzt
 * wird deshalb hart, nicht "bei Bedarf".
 */
const MELDUNG_MAX_ZEICHEN = 200;

function gekuerzt(text: string): string {
  const eine = text.replace(/\s+/g, ' ').trim();
  return eine.length > MELDUNG_MAX_ZEICHEN ? eine.slice(0, MELDUNG_MAX_ZEICHEN) : eine;
}

/**
 * Rolle auf die vier bekannten Gruppen normalisieren.
 *
 * Bewusst dieselbe Regel wie in analytics.ts `setAnalyticsRole`: Ein in einer
 * Gemeinde selbst vergebener Rollentitel darf nicht durchsickern, sonst
 * stuende in Crashlytics ploetzlich "Jugendreferentin Nord" als Merkmal.
 */
function rolleNormalisiert(rollenname: string): string {
  const r = rollenname.toLowerCase();
  if (r === 'konfi' || r === 'teamer' || r === 'admin') return r;
  if (r === 'org_admin') return 'admin';
  return 'sonstige';
}

/**
 * Einen eigenen Fehler NIE weiterwerfen.
 *
 * Diagnose darf die App nie stoeren — genau wie die Nutzungsmessung. Ein
 * fehlendes Plugin (alter Build ohne den Pod) oder ein `unimplemented()`
 * darf keinen Renderpfad abbrechen. Deshalb faengt jede exportierte Funktion
 * ihren eigenen Fehler ab und schweigt.
 */
async function still(arbeit: () => Promise<unknown>): Promise<void> {
  try {
    await arbeit();
  } catch {
    /* Diagnose darf nie stoeren */
  }
}

/**
 * Merkmale setzen, mit denen sich ein Absturz eingrenzen laesst.
 *
 * Aufrufregel: bei jeder Anmeldung, jedem Abmelden und jedem
 * Organisationswechsel — also dort, wo auch `setAnalyticsRole` gesetzt wird.
 * Ohne Rolle (abgemeldet) werden die Merkmale auf leere Werte gesetzt statt
 * gelassen, sonst haengt die Rolle der vorigen Sitzung weiter an jedem
 * Bericht.
 */
export async function diagnoseMerkmaleSetzen(angaben: {
  rolle?: string | null;
  organisationId?: number | null;
  appFassung?: string | null;
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!(await diagnoseErlaubt())) return;

  await still(async () => {
    await FirebaseCrashlytics.setCustomKey({
      key: 'rolle',
      value: angaben.rolle ? rolleNormalisiert(angaben.rolle) : '',
      type: 'string',
    });
    // Organisation als ZAHL. Nicht der Name — der waere bei einer kleinen
    // Gemeinde faktisch personenbezogen (siehe analytics.ts, gleiche
    // Ueberlegung).
    await FirebaseCrashlytics.setCustomKey({
      key: 'organisation',
      value: typeof angaben.organisationId === 'number' ? angaben.organisationId : 0,
      type: 'int',
    });
    await FirebaseCrashlytics.setCustomKey({
      key: 'plattform',
      value: Capacitor.getPlatform(),
      type: 'string',
    });
    if (angaben.appFassung) {
      // Crashlytics kennt die Fassung des BUNDLES ohnehin. Diese Angabe ist
      // die des WEB-Teils: Bei einem Live-Reload-Build oder einem Web-Deploy
      // ohne neuen Store-Build laufen beide auseinander, und genau dann will
      // man wissen, welcher Oberflaechen-Stand abgestuerzt ist.
      await FirebaseCrashlytics.setCustomKey({
        key: 'app_fassung',
        value: angaben.appFassung,
        type: 'string',
      });
    }
  });
}

/**
 * Einen JS-Fehler als NICHT-FATALEN Bericht melden.
 *
 * Gedacht fuer Fehler, die die App abfaengt und ueberlebt: ein Render, der in
 * der ErrorBoundary landet, eine nicht behandelte Promise-Ablehnung. Ohne das
 * stehen solche Fehler nur in der Konsole eines Geraetes, das niemand ansieht.
 *
 * `herkunft` ist ein im Code FEST vergebenes Kuerzel (`error-boundary`,
 * `promise-unbehandelt` …) und wird zur Gruppierung vorangestellt. Werte aus
 * Antworten oder Eingaben gehoeren dort nicht hinein.
 *
 * Rueckgabe: true, wenn gemeldet wurde; false, wenn die Drosselung oder der
 * Web-Zweig es verhindert hat. Nur fuer Tests und Diagnose interessant.
 */
export async function fehlerMelden(
  herkunft: string,
  fehler: unknown,
  zusatz?: { komponente?: string },
): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  // Ausgeschaltet zaehlt auch nicht gegen die Drosselung: Wer die Diagnose
  // spaeter wieder einschaltet, bekommt ab dann die volle Zahl Berichte.
  if (!(await diagnoseErlaubt())) return false;

  const text = fehler instanceof Error
    ? `${fehler.name}: ${fehler.message}`
    : String(fehler);
  const meldung = gekuerzt(`[${herkunft}] ${text}`);

  // Drosselung (siehe MELDUNGEN_JE_SITZUNG_MAX): dieselbe Ursache nur einmal,
  // insgesamt begrenzt.
  if (bereitsGemeldet.has(meldung)) return false;
  if (gemeldetInsgesamt >= MELDUNGEN_JE_SITZUNG_MAX) return false;
  bereitsGemeldet.add(meldung);
  gemeldetInsgesamt += 1;

  let gemeldet = false;
  await still(async () => {
    await FirebaseCrashlytics.recordException({
      message: meldung,
      // Die Komponente ist ein Klassen-/Funktionsname aus dem Build, kein
      // Nutzerinhalt — sie sagt, WO es brach. Gekuerzt wie die Meldung.
      ...(zusatz?.komponente
        ? { keysAndValues: [{ key: 'komponente', value: gekuerzt(zusatz.komponente), type: 'string' as const }] }
        : {}),
    });
    gemeldet = true;
  });
  return gemeldet;
}

/**
 * Eine Wegmarke ins Absturzprotokoll schreiben (`log`).
 *
 * Die letzten Zeilen davor stehen bei einem Absturz im Bericht und sagen, was
 * die App zuletzt getan hat. Bewusst nur feste Kuerzel aus dem Code —
 * derselbe Grundsatz wie bei `ort` in der Nutzungsmessung.
 */
export async function wegmarke(text: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!(await diagnoseErlaubt())) return;
  await still(() => FirebaseCrashlytics.log({ message: gekuerzt(text) }));
}

/**
 * Absturzdiagnose ein- oder ausschalten (Schalter im Profil).
 *
 * Merkt die Wahl auf dem Geraet und wirkt in JavaScript sofort; nativ greift
 * `setEnabled` ab dem naechsten Start, bis dahin verwirft
 * `deleteUnsentReports` beim Ausschalten, was noch auf dem Geraet liegt
 * (siehe ABSCHALTBARKEIT oben). Im Web ein no-op -- dort gibt es weder
 * Crashlytics noch den Schalter.
 */
export async function diagnoseSchalten(aktiv: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  erlaubtStand = Promise.resolve(aktiv);
  try {
    if (aktiv) await Preferences.remove({ key: DIAGNOSE_SCHLUESSEL });
    else await Preferences.set({ key: DIAGNOSE_SCHLUESSEL, value: 'aus' });
  } catch {
    // best-effort: Fuer diesen Lauf gilt die Wahl trotzdem (erlaubtStand).
  }
  await still(() => FirebaseCrashlytics.setEnabled({ enabled: aktiv }));
  if (!aktiv) await still(() => FirebaseCrashlytics.deleteUnsentReports());
}

/**
 * Beim App-Start: die gemerkte Wahl an Crashlytics geben.
 *
 * Ist die Diagnose aus, verwirft das die Berichte, die noch auf dem Geraet
 * liegen -- auch den eines Absturzes aus dem Lauf, in dem ausgeschaltet
 * wurde. Ist sie an, bleibt alles wie gehabt. Im Web ein no-op.
 */
export async function diagnoseStarten(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const aktiv = await diagnoseErlaubt();
  await still(() => FirebaseCrashlytics.setEnabled({ enabled: aktiv }));
  if (!aktiv) await still(() => FirebaseCrashlytics.deleteUnsentReports());
}

/**
 * Hat die App beim VORIGEN Start abgestuerzt?
 *
 * Nuetzlich, um nach einem Absturz einmal aufzuraeumen (Cache leeren o.ae.)
 * statt in dieselbe Falle zu laufen. Im Web immer false.
 */
export async function istVorigerStartAbgestuerzt(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { crashed } = await FirebaseCrashlytics.didCrashOnPreviousExecution();
    return crashed === true;
  } catch {
    return false;
  }
}

/**
 * Globale Fehlerkanaele an die Diagnose haengen.
 *
 * DIE LUECKE, DIE DAS SCHLIESST: Das Projekt hatte bis hierher WEDER einen
 * `unhandledrejection`- noch einen `window.onerror`-Handler (im Code an
 * mehreren Stellen als bekannt vermerkt, u.a. in TerminAbsagenModal). Eine
 * abgelehnte Promise ohne catch verschwand damit vollstaendig — kein Eintrag,
 * keine Meldung, nichts. Bei 15.000 Nutzenden ist das ein Blindflug.
 *
 * Bewusst NICHT: die Fehler unterdruecken oder eine Oberflaeche zeigen. Hier
 * wird nur gemeldet; `preventDefault` bleibt aus, damit sich am Verhalten der
 * App nichts aendert und die Konsole weiterhin alles zeigt.
 *
 * Rueckgabe: eine Funktion, die die Handler wieder abmeldet (fuer Tests).
 */
export function globaleFehlerkanaeleAnhaengen(): () => void {
  const aufAblehnung = (ereignis: PromiseRejectionEvent) => {
    void fehlerMelden('promise-unbehandelt', ereignis.reason);
  };
  const aufFehler = (ereignis: ErrorEvent) => {
    void fehlerMelden('window-onerror', ereignis.error ?? ereignis.message);
  };

  window.addEventListener('unhandledrejection', aufAblehnung);
  window.addEventListener('error', aufFehler);

  return () => {
    window.removeEventListener('unhandledrejection', aufAblehnung);
    window.removeEventListener('error', aufFehler);
  };
}
