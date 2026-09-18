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
 * DAS PROBLEM:
 * Die App wandert bei ganz normaler Bedienung in den Hintergrund, ohne dass die
 * Person sie verlässt. Im Code nachgesehen, welche Abläufe das auslösen:
 *   - Foto auswählen  (verstecktes <input type="file">, ChallengeSubmitModal,
 *     ChatRoomSections, MaterialFormModal)
 *   - Teilen-Dialog   (Share.share / navigator.share in chatTeilen.ts,
 *     shareUtils.ts, FileViewerModal, ChallengeLeitungModal, AdminInvitePage)
 *   - Karten und Links (window.open auf Maps/Store/Weblinks in EventDetailView,
 *     TeamerEventsPage, MessageBubble, StoreUpdateBanner, …)
 *   - die Face-ID-Abfrage SELBST: das Systemfenster legt die App auf iOS kurz
 *     in den Hintergrund. Ohne Gegenmaßnahme sperrt sich die App genau in dem
 *     Moment erneut, in dem man sie entsperrt — eine Schleife, aus der niemand
 *     herauskommt.
 * Bei 'sofort' würde jeder dieser Abläufe sperren und die App unbenutzbar
 * machen.
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
 *   2. KARENZZEIT von 2 Sekunden als Netz darunter.
 *      Sie fängt die Abläufe ab, die niemand angemeldet hat — und das werden
 *      immer welche sein, weil jeder neue Dialog daran denken müsste. Ein
 *      Hintergrundwechsel unter 2 Sekunden ist kein Verlassen der App, sondern
 *      ein Systemfenster, das aufgeht und wieder zugeht.
 *      2 Sekunden sind bewusst knapp: lang genug für das Flackern beim Öffnen
 *      eines Systemdialogs, zu kurz, um daraus ein Schlupfloch zu machen —
 *      in zwei Sekunden legt niemand ein Handy weg und gibt es weiter.
 *      Sie gilt NUR für 'sofort'; bei 1/5/15 Minuten deckt die eingestellte
 *      Wartezeit das ohnehin ab.
 */
export const KARENZ_MS = 2000;

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

  if (verzoegerung === 'sofort') return abwesend >= KARENZ_MS;
  return abwesend >= VERZOEGERUNG_MS[verzoegerung];
};

/** Sperrt die App beim Kaltstart? Bei allem ausser 'aus': ja. */
export const mussBeimStartSperren = (verzoegerung: SperrVerzoegerung): boolean =>
  verzoegerung !== 'aus';

// --- Entsperren -------------------------------------------------------------

export type EntsperrAusgang = 'ok' | 'abgebrochen' | 'fehler';

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
 */
export const sperreOeffnen = async (): Promise<EntsperrAusgang> => {
  if (!Capacitor.isNativePlatform()) return 'fehler';

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
    // Nach der Abfrage kommt die App aus dem Hintergrund zurück. Der Merker
    // darf erst danach fallen, sonst schnappt die Sperre im selben Atemzug
    // wieder zu. Ein Tick reicht: der appStateChange-Rückweg läuft vorher.
    setTimeout(ausflugBeenden, 0);
  }
};
