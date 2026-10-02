import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { istAbbruch, biometrieVerfuegbar } from './biometrics';

// ---------------------------------------------------------------------------
// App-Sperre (Face ID / Touch ID / Fingerabdruck vor der laufenden App)
//
// WAS SIE IST:
// Ein Schloss vor der bereits angemeldeten App. Wer die App nach einer
// einstellbaren Zeit im Hintergrund wieder öffnet, sieht zuerst einen
// Sperrbildschirm und kommt erst nach Face ID / Fingerabdruck an die Inhalte.
//
// WAS SIE NICHT IST — und das steht bewusst hier, damit niemand mehr von ihr
// erwartet, als sie leistet:
// Sie ist ein Sichtschutz, KEINE kryptografische Absicherung. Die Daten auf dem
// Gerät (Cache, Token) liegen genauso da wie vorher; die Sperre verschlüsselt
// nichts und hält niemanden auf, der das Gerät auseinandernimmt. Sie schützt
// gegen das, was im Alltag passiert: Das Handy liegt auf dem Tisch, jemand
// greift danach. Die App enthält Namen, Fotos und Punktestände überwiegend
// Minderjähriger — genau dafür ist das gedacht.
//
// ABGRENZUNG zur biometrischen ANMELDUNG (services/biometrics.ts):
// Die Anmeldung dort ersetzt das Passwort auf der Anmeldeseite und ist an den
// gespeicherten Refresh-Token gebunden. Wer dauerhaft angemeldet bleibt (der
// Normalfall, 90 Tage), kommt auf der Anmeldeseite nie vorbei — dort greift sie
// also nicht. Genau diese Lücke schließt die Sperre hier. Beide Wege sind
// unabhängig voneinander und lassen sich getrennt ein- und ausschalten.
//
// WARUM verifyIdentity() UND NICHT mitBiometrieEntsperren():
// mitBiometrieEntsperren() liest den Refresh-Token aus der Keychain und ist
// damit an die biometrische ANMELDUNG gekoppelt: ohne eingeschalteten
// Anmelde-Schalter liegt dort gar nichts, und das Entsperren liefert
// 'nichts-gespeichert' — die Sperre wäre für alle anderen unbedienbar.
// Zum Entsperren brauchen wir auch keinen Token: die App IST angemeldet, sie
// ist nur verdeckt. NativeBiometric.verifyIdentity() ist genau das — eine reine
// Ja/Nein-Abfrage der Biometrie ohne jeden Bezug zu gespeicherten Daten. Beide
// Funktionen bleiben dadurch unabhängig: Wer die Anmeldung per Face ID
// abschaltet, verliert die Sperre nicht, und umgekehrt.
// ---------------------------------------------------------------------------

/** Wartezeit im Hintergrund, bis die App sich sperrt. */
export type SperrVerzoegerung = 'aus' | 'sofort' | '1min' | '5min' | '15min';

/**
 * Wartezeiten in Millisekunden.
 * 'aus' und 'sofort' stehen hier NICHT: 'aus' sperrt nie, 'sofort' sperrt bei
 * jedem echten Hintergrundwechsel (siehe KARENZ_MS).
 */
const VERZOEGERUNG_MS: Record<'1min' | '5min' | '15min', number> = {
  '1min': 60 * 1000,
  '5min': 5 * 60 * 1000,
  '15min': 15 * 60 * 1000
};

/** Beschriftungen für die Auswahl in den Profil-Ansichten. */
export const VERZOEGERUNG_BEZEICHNUNG: Record<SperrVerzoegerung, string> = {
  aus: 'Aus',
  sofort: 'Sofort',
  '1min': 'Nach 1 Minute',
  '5min': 'Nach 5 Minuten',
  '15min': 'Nach 15 Minuten'
};

/** Reihenfolge der Auswahl in der Oberfläche. */
export const VERZOEGERUNGEN: SperrVerzoegerung[] = ['sofort', '1min', '5min', '15min'];

// Die Einstellung liegt in den normalen Preferences und ist an das GERÄT
// gebunden, nicht an das Konto.
//
// WARUM SIE DAS ABMELDEN ÜBERLEBT (bewusste Entscheidung):
// Sie verrät nichts — es steht nur eine Wartezeit darin, kein Token, kein Name.
// Und sie ist eine Aussage über das Gerät, nicht über das Konto: "Dieses Handy
// gebe ich aus der Hand, es soll sich sperren." Diese Aussage bleibt richtig,
// wenn sich jemand ab- und wieder anmeldet. Würde die Sperre beim Abmelden
// verschwinden, wäre sie danach still aus, ohne dass es jemand merkt — und
// genau dann wäre die Person, die sie eingeschaltet hat, schlechter geschützt
// als sie glaubt. Ein stiller Schutzverlust ist schlimmer als eine Sperre,
// die einmal zu viel fragt; und wer sie loswerden will, schaltet sie im Profil
// mit zwei Antippern ab.
// Die Anmeldung per Biometrie (services/biometrics.ts) wird beim Abmelden
// dagegen sehr wohl vergessen — dort liegt ein Token, hier nur eine Zahl.
const EINSTELLUNG_SCHLUESSEL = 'konfi_app_sperre_verzoegerung';

/**
 * KARENZZEIT — die heikelste Stelle der ganzen Funktion.
 *
 * DIE LÖSUNG — zwei Ebenen, weil eine allein nicht reicht:
 *
 *   1. AUSFLUG-MERKER (ausflugStarten/ausflugBeenden), die verlässliche Ebene.
 *      Wer einen Systemdialog öffnet, meldet das an. Solange ein Ausflug läuft,
 *      wird gar kein Hintergrund-Zeitstempel gesetzt — die App kann nicht
 *      sperren, egal wie lange der Dialog offen steht. Das deckt genau die
 *      Fälle ab, in denen jemand minutenlang in der Fotoauswahl blättert.
 *      Die Entsperr-Abfrage selbst setzt diesen Merker ebenfalls.
 *
 *   2. KEINE KARENZZEIT mehr bei 'sofort'.
 *      Hier standen 2 Sekunden als Netz unter dem Ausflug-Merker. Die haben
 *      aber genau den Fall verschluckt, für den die Einstellung gemacht ist:
 *      "Die App ist, wenn man sie aus dem App switcher holt, nicht gelockt,
 *      obwohl es auf sofort steht." Wer die App aus dem Umschalter zurückholt,
 *      ist meist unter zwei Sekunden weg — die Sperre griff also nur beim
 *      Kaltstart (dort entscheidet mussBeimStartSperren) und sonst nie.
 *      'Sofort' heißt jetzt sofort: JEDER echte Hintergrundwechsel sperrt.
 *
 *      Die Systemdialoge deckt allein der Ausflug-Merker ab (Punkt 1). Das ist
 *      bewusst die schwächere Absicherung, aber die richtige Abwägung: Eine
 *      Sperre, die den Umschalter durchlässt, ist keine Sperre. Kommt ein neuer
 *      Dialog dazu, der den Merker nicht setzt, sperrt die App einmal zu oft —
 *      ärgerlich, aber harmlos. Der umgekehrte Fehler ist ein Sicherheitsleck.
 *      Bei 1/5/15 Minuten deckt die eingestellte Wartezeit das ohnehin ab.
 *      Damit das nicht wieder passiert, laufen Dateiauswahl, Teilen und das
 *      Öffnen fremder Apps durch services/systemDialoge.ts; für die
 *      Dateiauswahl wacht der Test dateiAuswahlNurUeberHuelle darüber.
 */

/** Einstellung lesen. Voreinstellung ist 'aus' — ein Update darf niemandem eine Sperre vorsetzen. */
export const sperreLesen = async (): Promise<SperrVerzoegerung> => {
  try {
    const { value } = await Preferences.get({ key: EINSTELLUNG_SCHLUESSEL });
    if (value === 'sofort' || value === '1min' || value === '5min' || value === '15min') {
      return value;
    }
    return 'aus';
  } catch {
    // Ohne lesbare Einstellung gilt 'aus'. Lieber keine Sperre als eine, die
    // niemand bestellt hat und die im Zweifel niemand wieder loswird.
    return 'aus';
  }
};

/** Einstellung speichern. 'aus' entfernt den Eintrag, statt ihn zu setzen. */
export const sperreSpeichern = async (wert: SperrVerzoegerung): Promise<void> => {
  try {
    if (wert === 'aus') {
      await Preferences.remove({ key: EINSTELLUNG_SCHLUESSEL });
    } else {
      await Preferences.set({ key: EINSTELLUNG_SCHLUESSEL, value: wert });
    }
  } catch {
    // best-effort: schlägt das Schreiben fehl, bleibt es beim alten Stand.
  }
};

/**
 * Ist die Sperre überhaupt anbietbar?
 * Nur nativ und nur mit eingerichteter Biometrie — ein Schalter, der ins Leere
 * führt, ist schlimmer als gar keiner, und im Browser gäbe es nichts zu fragen.
 */
export const sperreVerfuegbar = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) return false;
  const { verfuegbar } = await biometrieVerfuegbar();
  return verfuegbar;
};

// --- Ausflug-Merker (siehe KARENZ_MS, Ebene 1) ------------------------------

// Zähler statt Ja/Nein: Abläufe können sich überlappen (Teilen-Dialog aus einer
// Datei-Vorschau heraus). Ein Ja/Nein-Merker würde beim Beenden des inneren
// Vorgangs den äußeren mit abräumen.
let ausfluege = 0;

/** Ein Systemdialog geht auf — bis zum passenden ausflugBeenden nicht sperren. */
export const ausflugStarten = (): void => {
  ausfluege += 1;
};

/** Der Systemdialog ist zu. Fällt nie unter null, auch bei unpaarigen Aufrufen. */
export const ausflugBeenden = (): void => {
  ausfluege = Math.max(0, ausfluege - 1);
};

export const laeuftAusflug = (): boolean => ausfluege > 0;

/**
 * Klammert einen Ablauf, der die App in den Hintergrund schickt.
 * Das `finally` ist der Grund für diese Hülle: ein Teilen-Dialog, den jemand
 * abbricht, wirft — ohne `finally` bliebe der Merker für immer stehen und die
 * Sperre wäre ab da tot.
 */
export const ohneSperre = async <T>(ablauf: () => Promise<T>): Promise<T> => {
  ausflugStarten();
  try {
    return await ablauf();
  } finally {
    ausflugBeenden();
  }
};

// --- Zeitmessung ------------------------------------------------------------

/**
 * Entscheidet, ob beim Zurückkommen gesperrt werden muss.
 *
 * Reine Rechnung ohne Seiteneffekte, damit sie sich mit festen Zeiten prüfen
 * lässt, statt auf echte Uhren warten zu müssen.
 *
 * @param verzoegerung  die eingestellte Wartezeit
 * @param hintergrundSeit  Zeitstempel des Wechsels in den Hintergrund, oder
 *   null, wenn keiner gesetzt wurde (Ausflug lief) — dann wird nie gesperrt.
 * @param jetzt  Zeitpunkt der Rückkehr
 */
export const mussSperren = (
  verzoegerung: SperrVerzoegerung,
  hintergrundSeit: number | null,
  jetzt: number
): boolean => {
  if (verzoegerung === 'aus') return false;
  if (hintergrundSeit === null) return false;

  const abwesend = jetzt - hintergrundSeit;
  // Negative Werte (Uhr zurückgestellt) zählen als "gerade eben" und sperren
  // nicht — eine verstellte Uhr darf niemanden aussperren.
  if (!Number.isFinite(abwesend) || abwesend < 0) return false;

  // 'sofort' ohne Karenzzeit: jeder echte Hintergrundwechsel sperrt (siehe oben).
  if (verzoegerung === 'sofort') return true;
  return abwesend >= VERZOEGERUNG_MS[verzoegerung];
};

/** Sperrt die App beim Kaltstart? Bei allem ausser 'aus': ja. */
export const mussBeimStartSperren = (verzoegerung: SperrVerzoegerung): boolean =>
  verzoegerung !== 'aus';

// --- Entsperren -------------------------------------------------------------

export type EntsperrAusgang = 'ok' | 'abgebrochen' | 'fehler';

/**
 * Die gerade laufende Abfrage, oder null.
 *
 * Die Ursache lag in App.tsx: Der Sperrbildschirm stand in zwei
 * Rückgabezweigen an unterschiedlicher Stelle und wurde beim Zweigwechsel neu
 * montiert — sein Effekt beim Einblenden fragte die Biometrie deshalb zweimal.
 * Das ist dort behoben (ein einziger Einhängepunkt).
 *
 * WARUM HIER TROTZDEM EINE ZWEITE EBENE: Auf Android ist eine zweite,
 * gleichzeitige Abfrage nicht bloß doppelt, sie ist SCHÄDLICH. Der Prompt läuft
 * in einer eigenen Activity; ein zweiter Start verdrängt den ersten, und
 * AndroidX beendet ihn mit ERROR_CANCELED ("another pending operation prevents
 * it"). Das Plugin bildet das auf SYSTEM_CANCEL ab, und wir zählen SYSTEM_CANCEL
 * zu den Abbruch-Codes — die Person sieht "Nicht erkannt", ohne abgebrochen zu
 * haben. Ein Aufrufer, der das versehentlich auslöst, darf die Sperre nicht
 * unbedienbar machen. Deshalb liegt der Schutz an der Stelle, an der ALLE
 * Aufrufer vorbeikommen, nicht nur in der einen Komponente.
 *
 * DAS WEICHT DIE SPERRE NICHT AUF: Der zweite Aufruf bekommt das Ergebnis der
 * laufenden Abfrage — also 'ok' nur dann, wenn die Biometrie tatsächlich
 * gelungen ist. Es entsteht kein Weg, der ohne erfolgreiche Prüfung 'ok'
 * liefert, und es wird keine Prüfung übersprungen: Nach dem Ende ist der Merker
 * wieder leer, jeder neue Versuch fragt das Gerät erneut.
 *
 * KANN DER MERKER HÄNGEN BLEIBEN? Nein. Er wird in einem `finally` geleert, das
 * auch bei einem geworfenen Fehler läuft — und `verifyIdentity()` antwortet
 * immer, mit Erfolg oder mit einem Fehlercode. Die eine Lage, in der er stehen
 * bliebe, wäre ein Versprechen, das nie erfüllt wird; das gibt es auf dem Gerät
 * nicht (der Prompt hat ein eigenes Zeitlimit und meldet ERROR_TIMEOUT).
 */
let laufendeAbfrage: Promise<EntsperrAusgang> | null = null;

/**
 * NUR FÜR TESTS: setzt den Merker der laufenden Abfrage zurück.
 *
 * Er liegt auf Modulebene und überlebt deshalb das Aufräumen zwischen zwei
 * Testfällen. Ein Test, der eine Abfrage absichtlich offen lässt (um den
 * Wettlauf nachzustellen), würde sonst alle folgenden blockieren — und die
 * würden grün aussehen, weil gar nichts mehr beim Gerät ankommt.
 *
 * Im Betrieb wird das nicht gebraucht und auch nirgends aufgerufen: dort leert
 * das `finally` in sperreOeffnen den Merker.
 */
export const _abfrageMerkerZuruecksetzenFuerTests = (): void => {
  laufendeAbfrage = null;
};

/**
 * Fragt die Biometrie ab. Reine Ja/Nein-Prüfung, ohne jeden Bezug zu
 * gespeicherten Token (siehe Kopfkommentar).
 *
 * Der Aufruf ist in einen Ausflug geklammert: das Systemfenster legt die App
 * selbst in den Hintergrund, und ohne diese Klammer sperrte sie sich beim
 * Entsperren sofort wieder.
 *
 * GERÄTECODE ALS RÜCKWEG:
 * `useFallback: true` lässt iOS nach Fehlversuchen den Gerätecode anbieten —
 * dort ist der Weg also da. Auf Android reicht die Bibliothek das NICHT durch:
 * verifyIdentity() ignoriert die Option, weil BiometricPrompt den
 * DEVICE_CREDENTIAL-Authenticator und die Abbrechen-Schaltfläche nicht
 * gleichzeitig erlaubt (steht so in den Typdefinitionen des Plugins). Auf
 * Android bleiben deshalb der erneute Versuch und das Abmelden — beides ist auf
 * dem Sperrbildschirm sichtbar.
 *
 * Es gibt hier bewusst KEINEN Wiederholungs-Automatismus: scheitert die
 * Abfrage, bleibt der Sperrbildschirm stehen und die Person entscheidet selbst,
 * ob sie es noch einmal versucht oder sich abmeldet.
 *
 * Läuft schon eine Abfrage, wird KEINE zweite gestartet — siehe
 * `laufendeAbfrage`. Der Aufrufer bekommt das Ergebnis der laufenden.
 */
export const sperreOeffnen = async (): Promise<EntsperrAusgang> => {
  if (!Capacitor.isNativePlatform()) return 'fehler';

  // Kein zweiter Prompt neben einem offenen. Auf Android würde er den offenen
  // verdrängen und beide Versuche scheitern lassen.
  if (laufendeAbfrage) return laufendeAbfrage;

  const abfrage = (async (): Promise<EntsperrAusgang> => {
    ausflugStarten();
    try {
      await NativeBiometric.verifyIdentity({
        reason: 'Konfi Quest entsperren',
        title: 'Konfi Quest entsperren',
        subtitle: 'Bestätige, dass du es bist',
        negativeButtonText: 'Abbrechen',
        useFallback: true,
        fallbackTitle: 'Code eingeben',
        maxAttempts: 3
      });
      return 'ok';
    } catch (fehler) {
      if (istAbbruch(fehler)) return 'abgebrochen';
      // Nur die grobe Tatsache ins Log — kein Token, keine Kennung, kein Name.
      console.warn('App-Sperre: Entsperren fehlgeschlagen');
      return 'fehler';
    } finally {
      // Der Merker fällt SOFORT, nicht erst einen Tick später: Sonst käme ein
      // Antippen direkt nach einem Fehlversuch noch an die alte, längst
      // beantwortete Abfrage und der Knopf wäre scheinbar tot.
      laufendeAbfrage = null;
      // Nach der Abfrage kommt die App aus dem Hintergrund zurück. Der
      // Ausflug-Merker darf erst danach fallen, sonst schnappt die Sperre im
      // selben Atemzug wieder zu. Ein Tick reicht: der appStateChange-Rückweg
      // läuft vorher.
      setTimeout(ausflugBeenden, 0);
    }
  })();

  laufendeAbfrage = abfrage;
  return abfrage;
};
