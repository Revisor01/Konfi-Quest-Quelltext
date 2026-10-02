import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  NativeBiometric,
  AccessControl,
  BiometryType,
  BiometricAuthError
} from '@capgo/capacitor-native-biometric';
import { getRefreshToken, getUser, setRefreshToken } from './tokenStore';
import { BaseUser } from '../types/user';

// ---------------------------------------------------------------------------
// Biometrische Anmeldung (Face ID / Touch ID / Fingerabdruck)
//
// WAS HIER PASSIERT — und was NICHT:
// Die App war auch vorher schon dauerhaft angemeldet: der 90 Tage gueltige
// Refresh-Token lag im Klartext in den Capacitor Preferences. Diese Funktion
// macht die Sitzung also nicht laenger haltbar, sie macht zwei andere Dinge:
//   1. Der Refresh-Token wandert aus den Preferences in den vom Betriebssystem
//      verschluesselten Speicher (iOS Keychain / Android Keystore), abgesichert
//      mit AccessControl.BIOMETRY_ANY. Ohne erfolgreiche Biometrie gibt das
//      Betriebssystem den Wert gar nicht erst heraus — das ist eine Huerde in
//      der Hardware, kein abfragbarer Schalter in unserem JavaScript.
//   2. Beim App-Start wird die Sitzung erst nach Face ID / Fingerabdruck
//      wiederhergestellt.

// Schluessel im sicheren Speicher (Keychain-Service bzw. Keystore-Alias).
const SICHERER_SCHLUESSEL = 'konfi_quest_biometrie_sitzung';
// Schalterzustand: unkritisch, darf in den normalen Preferences liegen. Er
// verraet nichts — der Token selbst liegt im sicheren Speicher.
const SCHALTER_SCHLUESSEL = 'konfi_biometrie_aktiv';
// Klartext-Ablage des Refresh-Tokens (tokenStore). Wird beim Aktivieren
// entfernt, damit nicht dieselbe Sitzung ungeschuetzt daneben liegt.
const KLARTEXT_REFRESH_SCHLUESSEL = 'konfi_refresh_token';
// Zeitpunkt des letzten Anmeldevorgangs, ZUSAETZLICH ausserhalb des sicheren
// Speichers. Das ist kein Geheimnis (nur ein Datum) und erspart der laufenden
// Auffrischung eine biometrische Abfrage, nur um den alten Wert zu lesen.
const ZEITSTEMPEL_SCHLUESSEL = 'konfi_biometrie_gespeichert_am';

// Siehe Sicherheitsabwaegung b) oben. 90 Tage = dieselbe Gueltigkeit wie der
// Refresh-Token des Servers; die gespeicherte Sitzung ueberlebt ihn also nicht.
export const GESPEICHERTE_SITZUNG_MAX_TAGE = 90;

// Nur Android: Zeitfenster, in dem der Keystore-Schluessel nach einer
// erfolgreichen Pruefung ohne erneute Abfrage benutzbar ist.
//
// WARUM UEBERHAUPT EIN FENSTER (und nicht 0 = jedes Mal fragen)?
// Der Server rotiert den Refresh-Token bei JEDEM Refresh und macht den alten
// nach 5 Minuten endgueltig ungueltig. Der gespeicherte Token muss also direkt
// nach dem Entsperren durch den frisch rotierten ersetzt werden. Auf Android
// verlangt aber auch das SCHREIBEN eine biometrische Bestaetigung — mit einem
// Fenster von 0 saehe die Person beim Entsperren ZWEI Abfragen hintereinander
// (einmal lesen, einmal schreiben). Mit dem Fenster deckt die eine Abfrage
// beim Lesen das unmittelbar folgende Schreiben mit ab.
// 60 Sekunden sind knapp bemessen: lang genug fuer Entsperren plus einen
// Netzwerk-Roundtrip auf schlechter Verbindung, zu kurz, um daraus ein
// dauerhaft offenes Zeitfenster zu machen. Auf iOS ist der Wert wirkungslos —
// dort verlangt nur das Lesen eine Abfrage, das Schreiben nie.
const ANDROID_FENSTER_SEKUNDEN = 60;

// Was im sicheren Speicher landet. Bewusst NUR der Refresh-Token und das
// Noetigste zur Zuordnung — kein Passwort, keine Profildaten.
interface GespeicherteSitzung {
  refreshToken: string;
  userId: number;
  // Anzeigename/Rolle nur, damit die App direkt nach dem Entsperren etwas
  // anzeigen kann, bevor /auth/me antwortet.
  user: BaseUser;
  gespeichertAm: number;
}

export type BiometrieArt =
  | 'faceId'
  | 'touchId'
  | 'fingerabdruck'
  | 'gesichtserkennung'
  | 'biometrie';

/**
 * Welches Sinnbild zum erkannten Verfahren gehoert.
 *
 * Bewusst KEIN Ionicons-Name, sondern eine eigene kleine Menge: die
 * Oberflaechen (Sperrbildschirm, Schalter, Anmeldung) uebersetzen sie in ihre
 * Icons. So steht die Zuordnung "Gesicht -> Gesichts-Symbol" an genau einer
 * Stelle und der Dienst bleibt frei von Ionic.
 */
export type BiometrieSinnbild = 'gesicht' | 'finger' | 'schloss';

export interface BiometrieVerfuegbarkeit {
  verfuegbar: boolean;
  art: BiometrieArt;
  /** Anzeigename fuer die Oberflaeche, z.B. "Face ID". */
  bezeichnung: string;
  /** Passendes Sinnbild — nie geraten, im Zweifel das neutrale Schloss. */
  sinnbild: BiometrieSinnbild;
}

// Fehler, die ein normaler Bedienvorgang ausloest (Abbrechen, Fehlversuch) —
// hier ist nichts kaputt, es geht nur den normalen Weg ueber das Passwort.
const ABBRUCH_CODES: number[] = [
  BiometricAuthError.USER_CANCEL,
  BiometricAuthError.SYSTEM_CANCEL,
  BiometricAuthError.APP_CANCEL,
  BiometricAuthError.USER_FALLBACK,
  BiometricAuthError.AUTHENTICATION_FAILED
];

const fehlerCode = (fehler: unknown): number | null => {
  const code = (fehler as { code?: string | number })?.code;
  if (typeof code === 'number') return code;
  if (typeof code === 'string' && code.trim() !== '' && !Number.isNaN(Number(code))) {
    return Number(code);
  }
  return null;
};

/** true, wenn die Person abgebrochen hat oder die Erkennung fehlschlug. */
export const istAbbruch = (fehler: unknown): boolean => {
  const code = fehlerCode(fehler);
  return code !== null && ABBRUCH_CODES.includes(code);
};

/** true, wenn schlicht nichts (mehr) gespeichert ist. */
export const istNichtsGespeichert = (fehler: unknown): boolean =>
  fehlerCode(fehler) === BiometricAuthError.NO_PROTECTED_CREDENTIALS_FOUND;

const bezeichnungFuer = (art: BiometrieArt): string => {
  switch (art) {
    case 'faceId': return 'Face ID';
    case 'touchId': return 'Touch ID';
    case 'fingerabdruck': return 'Fingerabdruck';
    case 'gesichtserkennung': return 'Gesichtserkennung';
    default: return 'Biometrie';
  }
};

/**
 * Sinnbild zur erkannten Art.
 *
 * Im Zweifel das SCHLOSS, nicht der Finger: Ein falsches Symbol ist schlimmer
 * als ein neutrales. Wer ein Fingerabdruck-Symbol sieht und das Gesicht
 * hinhalten soll, glaubt eher an einen Fehler der App als an das eigene
 * Missverstaendnis.
 */
const sinnbildFuer = (art: BiometrieArt): BiometrieSinnbild => {
  switch (art) {
    case 'faceId':
    case 'gesichtserkennung':
      return 'gesicht';
    case 'touchId':
    case 'fingerabdruck':
      return 'finger';
    default:
      return 'schloss';
  }
};

const NICHT_VERFUEGBAR: BiometrieVerfuegbarkeit = {
  verfuegbar: false,
  art: 'biometrie',
  bezeichnung: 'Biometrie',
  sinnbild: 'schloss'
};

// Gemeinsame Schreib-Optionen, damit Aktivieren und Auffrischen NICHT
// auseinanderlaufen koennen. Ein abweichendes authValidityDuration wuerde auf
// Android den Keystore-Schluessel neu erzeugen und den Eintrag entwerten.
const schreibOptionen = (wert: string) => ({
  key: SICHERER_SCHLUESSEL,
  value: wert,
  // BIOMETRY_ANY statt BIOMETRY_CURRENT_SET: bei CURRENT_SET wird der Eintrag
  // ungueltig, sobald jemand einen weiteren Finger anlernt. Das sieht fuer die
  // Nutzer:in wie ein Fehler aus ("ploetzlich abgemeldet"), ohne dass ein
  // Angreifer dabei etwas gewonnen haette — zum Anlernen braucht er ohnehin
  // schon die Geraete-PIN.
  accessControl: AccessControl.BIOMETRY_ANY,
  authValidityDuration: ANDROID_FENSTER_SEKUNDEN,
  title: 'Anmeldung sichern',
  negativeButtonText: 'Abbrechen'
});

/**
 * Prueft, ob das Geraet Biometrie hat UND ob sie eingerichtet ist.
 *
 * WICHTIG — Web: Die Web-Implementierung des Plugins meldet immer
 * `isAvailable: true` und laesst `verifyIdentity()` immer durchgehen (eine
 * Attrappe fuer die Browser-Entwicklung). Verliessen wir uns darauf, haette
 * der Browser einen Schalter, der nichts absichert. Deshalb ist hier bei
 * allem, was kein natives Capacitor-Ziel ist, hart Schluss.
 */
export const biometrieVerfuegbar = async (): Promise<BiometrieVerfuegbarkeit> => {
  if (!Capacitor.isNativePlatform()) return NICHT_VERFUEGBAR;

  try {
    // useFallback: false — die Geraete-PIN zaehlt bewusst NICHT als Biometrie.
    // Sonst boeten wir den Schalter auch dort an, wo weder Finger noch Gesicht
    // hinterlegt ist, und die Sitzung haenge allein an einer PIN.
    const ergebnis = await NativeBiometric.isAvailable({ useFallback: false });
    if (!ergebnis?.isAvailable) return NICHT_VERFUEGBAR;

    // Welche Werte hier ankommen koennen, steht in den Plugin-Typen
    // (@capgo/capacitor-native-biometric, BiometryType): NONE, TOUCH_ID,
    // FACE_ID (beide nur iOS), FINGERPRINT, FACE_AUTHENTICATION,
    // IRIS_AUTHENTICATION, MULTIPLE, DEVICE_CREDENTIAL (alle nur Android).
    //
    // MULTIPLE und IRIS_AUTHENTICATION bleiben bewusst beim neutralen Rueckfall:
    // Bei MULTIPLE weiss das Geraet selbst nicht, womit entsperrt wird, und ein
    // Iris-Scan ist weder Gesicht noch Finger. Lieber "Biometrie" und ein
    // Schloss als ein Symbol, das die falsche Geste nahelegt.
    let art: BiometrieArt = 'biometrie';
    switch (ergebnis.biometryType) {
      case BiometryType.FACE_ID:
        art = 'faceId';
        break;
      case BiometryType.TOUCH_ID:
        art = 'touchId';
        break;
      case BiometryType.FINGERPRINT:
        art = 'fingerabdruck';
        break;
      case BiometryType.FACE_AUTHENTICATION:
        art = 'gesichtserkennung';
        break;
      default:
        art = 'biometrie';
    }
    return {
      verfuegbar: true,
      art,
      bezeichnung: bezeichnungFuer(art),
      sinnbild: sinnbildFuer(art)
    };
  } catch {
    // Kein Hard-Fail: ohne verlaessliche Auskunft gilt "nicht verfuegbar",
    // dann erscheint der Schalter gar nicht erst.
    return NICHT_VERFUEGBAR;
  }
};

/** Zustand des Schalters (nicht: ob tatsaechlich etwas gespeichert ist). */
export const istBiometrieAktiv = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { value } = await Preferences.get({ key: SCHALTER_SCHLUESSEL });
    return value === '1';
  } catch {
    return false;
  }
};

/**
 * Schaltet die biometrische Anmeldung ein: legt den aktuellen Refresh-Token
 * biometrie-geschuetzt ab. Gibt false zurueck, wenn nichts zu speichern ist
 * oder das Betriebssystem den Vorgang abgelehnt hat.
 */
export const biometrieAktivieren = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) return false;

  const refreshToken = getRefreshToken();
  const user = getUser();
  if (!refreshToken || !user) return false;

  const sitzung: GespeicherteSitzung = {
    refreshToken,
    userId: user.id,
    user,
    gespeichertAm: Date.now()
  };

  try {
    await NativeBiometric.setData(schreibOptionen(JSON.stringify(sitzung)));
    await Preferences.set({ key: SCHALTER_SCHLUESSEL, value: '1' });
    await Preferences.set({
      key: ZEITSTEMPEL_SCHLUESSEL,
      value: String(sitzung.gespeichertAm)
    });
    // Klartext-Kopie entfernen: sonst laege derselbe Token weiter ungeschuetzt
    // daneben und die Biometrie waere reine Zierde (Sicherheitsabwaegung a).
    await Preferences.remove({ key: KLARTEXT_REFRESH_SCHLUESSEL });
    return true;
  } catch (fehler) {
    console.warn('Biometrie konnte nicht aktiviert werden:', fehler);
    // Ein halb aktivierter Zustand waere schlimmer als gar keiner.
    await biometrieVergessen();
    return false;
  }
};

/**
 * Schaltet die biometrische Anmeldung aus, OHNE abzumelden (Schalter in den
 * Einstellungen).
 *
 * Solange der Schalter an ist, liegt der Refresh-Token nur im Arbeitsspeicher
 * und im sicheren Speicher (Sicherheitsabwaegung a; auch nach jeder Rotation,
 * siehe api.ts performRefresh). Loeschte das Ausschalten nur den sicheren
 * Speicher, waere die laufende Sitzung beim naechsten Kaltstart weg. Deshalb
 * kehrt der Token hier in die normale Ablage zurueck -- genau der Zustand
 * wie vor dem Einschalten.
 */
export const biometrieAusschalten = async (): Promise<void> => {
  await biometrieVergessen();
  const laufend = getRefreshToken();
  if (laufend) await setRefreshToken(laufend);
};

/**
 * Loescht die gespeicherte Sitzung und schaltet den Schalter aus.
 * MUSS bei jedem ausdruecklichen Abmelden laufen.
 */
export const biometrieVergessen = async (): Promise<void> => {
  try {
    await Preferences.remove({ key: SCHALTER_SCHLUESSEL });
    await Preferences.remove({ key: ZEITSTEMPEL_SCHLUESSEL });
  } catch {
    // best-effort
  }
  if (!Capacitor.isNativePlatform()) return;
  try {
    await NativeBiometric.deleteData({ key: SICHERER_SCHLUESSEL });
  } catch {
    // Nichts gespeichert oder Speicher nicht erreichbar — beides in Ordnung,
    // der Schalter ist jedenfalls aus.
  }
};

export type EntsperrErgebnis =
  | { status: 'ok'; refreshToken: string; user: BaseUser; gespeichertAm: number }
  /** Biometrie abgebrochen oder nicht erkannt — normaler Login-Weg. */
  | { status: 'abgebrochen' }
  /** Nichts (mehr) gespeichert oder abgelaufen — normaler Login-Weg. */
  | { status: 'nichts-gespeichert' }
  /** Unerwarteter Fehler — normaler Login-Weg, Meldung anzeigen. */
  | { status: 'fehler' };

/**
 * Fragt Face ID / Touch ID / Fingerabdruck ab und gibt bei Erfolg den
 * gespeicherten Refresh-Token zurueck.
 *
 * Es gibt hier bewusst KEINEN Wiederholungs-Automatismus: laeuft etwas schief,
 * landet die Person auf der normalen Anmeldung. Ein automatischer zweiter
 * Versuch waere genau die Schleife, in der Nutzer:innen sonst haengen bleiben.
 */
export const mitBiometrieEntsperren = async (): Promise<EntsperrErgebnis> => {
  if (!Capacitor.isNativePlatform()) return { status: 'nichts-gespeichert' };
  if (!(await istBiometrieAktiv())) return { status: 'nichts-gespeichert' };

  let rohwert: string;
  try {
    const ergebnis = await NativeBiometric.getSecureData({
      key: SICHERER_SCHLUESSEL,
      reason: 'Melde dich bei Konfi Quest an',
      title: 'Konfi Quest entsperren',
      subtitle: 'Bestätige, dass du es bist',
      negativeButtonText: 'Mit Passwort anmelden'
    });
    rohwert = ergebnis?.value ?? '';
  } catch (fehler) {
    if (istNichtsGespeichert(fehler)) {
      // Eintrag verschwunden (Neuinstallation, Biometrie zurueckgesetzt):
      // Schalter aufraeumen, sonst fragt die App bei jedem Start ins Leere.
      await biometrieVergessen();
      return { status: 'nichts-gespeichert' };
    }
    if (istAbbruch(fehler)) return { status: 'abgebrochen' };
    console.warn('Biometrisches Entsperren fehlgeschlagen:', fehler);
    return { status: 'fehler' };
  }

  let sitzung: GespeicherteSitzung;
  try {
    sitzung = JSON.parse(rohwert);
  } catch {
    await biometrieVergessen();
    return { status: 'nichts-gespeichert' };
  }

  if (!sitzung?.refreshToken || !sitzung?.user?.id) {
    await biometrieVergessen();
    return { status: 'nichts-gespeichert' };
  }

  // Eigene Frist pruefen (Sicherheitsabwaegung b). Ein abgelaufener Eintrag
  // wird geloescht, nicht nur ignoriert.
  const alterInTagen = (Date.now() - (sitzung.gespeichertAm || 0)) / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(alterInTagen) || alterInTagen > GESPEICHERTE_SITZUNG_MAX_TAGE) {
    await biometrieVergessen();
    return { status: 'nichts-gespeichert' };
  }

  return {
    status: 'ok',
    refreshToken: sitzung.refreshToken,
    user: sitzung.user,
    gespeichertAm: sitzung.gespeichertAm
  };
};

/**
 * Schreibt den rotierten Refresh-Token zurueck in den sicheren Speicher.
 *
 * Der Server rotiert bei JEDEM Refresh und macht den alten Token nach 5 Minuten
 * endgueltig ungueltig. Ohne diese Auffrischung waere der gespeicherte Token
 * beim naechsten App-Start tot und die Biometrie nutzlos.
 *
 * Wird direkt nach dem Entsperren aufgerufen, solange auf Android das
 * 60-Sekunden-Fenster der gerade erfolgten Pruefung noch traegt — sonst saehe
 * die Person eine zweite Abfrage.
 *
 * `gespeichertAm` wird bewusst UNVERAENDERT uebernommen: sonst liefe die
 * 14-Tage-Frist nie ab, solange die App gelegentlich refresht. Massgeblich ist
 * der letzte Anmeldevorgang, nicht der letzte Netzverkehr.
 */
export const gespeichertenTokenAuffrischen = async (
  neuerRefreshToken: string,
  gespeichertAm: number
): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  if (!(await istBiometrieAktiv())) return;

  const user = getUser();
  if (!user) return;

  const sitzung: GespeicherteSitzung = {
    refreshToken: neuerRefreshToken,
    userId: user.id,
    user,
    gespeichertAm
  };

  try {
    await NativeBiometric.setData(schreibOptionen(JSON.stringify(sitzung)));
  } catch (fehler) {
    console.warn('Gespeicherte Sitzung konnte nicht aufgefrischt werden:', fehler);
  }
};

/**
 * Haelt die gespeicherte Sitzung bei der LAUFENDEN Token-Rotation aktuell.
 *
 * Warum das noetig ist: Der Server rotiert den Refresh-Token bei jedem Refresh
 * (also etwa alle 15 Minuten Nutzung) und macht den vorherigen nach 5 Minuten
 * endgueltig ungueltig. Ohne diese Auffrischung zeigte die App beim naechsten
 * Start zwar brav Face ID, bekaeme vom Server danach aber ein 401 — die
 * Biometrie waere reine Zierde.
 *
 * Wird aus dem Refresh-Pfad in api.ts aufgerufen und ist bewusst
 * "best-effort": schlaegt das Schreiben fehl, bleibt die App normal angemeldet.
 * Nur die naechste biometrische Anmeldung scheitert dann und fuehrt auf die
 * normale Anmeldung — kein Datenverlust, keine Schleife.
 *
 * Der sichere Speicher ist bei eingeschaltetem Schalter die EINZIGE dauerhafte
 * Ablage: performRefresh schreibt den rotierten Token dann nicht mehr in die
 * Preferences. Scheitert das Schreiben
 * hier, lebt der neue Token bis zum Ende des Prozesses nur im Arbeitsspeicher.
 *
 * PLATTFORM-UNTERSCHIED, bewusst in Kauf genommen:
 * Auf iOS ist das Schreiben in die Keychain immer still — dort stimmt die
 * gespeicherte Sitzung nach jeder Rotation.
 * Auf Android verlangt der Keystore fuer das Schreiben eine Authentifizierung,
 * sofern das 60-Sekunden-Fenster der letzten Pruefung abgelaufen ist. Eine
 * Abfrage mitten in der Nutzung waere unzumutbar, deshalb wird hier NICHT
 * nachgefragt: liegt die Rotation ausserhalb des Fensters, schlaegt das
 * Schreiben still fehl und die gespeicherte Sitzung bleibt auf dem Stand des
 * letzten Entsperrens. Folge auf Android: wer die App laenger als eine
 * Sitzung offen hat, muss beim uebernaechsten Start einmal das Passwort
 * eingeben. Der Alternative — eine biometrische Abfrage alle 15 Minuten —
 * waere deutlich schlimmer.
 */
export const rotationUebernehmen = async (neuerRefreshToken: string): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  if (!(await istBiometrieAktiv())) return;

  let gespeichertAm = Date.now();
  try {
    const { value } = await Preferences.get({ key: ZEITSTEMPEL_SCHLUESSEL });
    const gelesen = value ? Number(value) : NaN;
    if (Number.isFinite(gelesen) && gelesen > 0) gespeichertAm = gelesen;
  } catch {
    // Ohne Zeitstempel faellt die Frist auf "jetzt" zurueck. Das verlaengert
    // sie im Zweifel, statt jemanden faelschlich auszusperren.
  }

  await gespeichertenTokenAuffrischen(neuerRefreshToken, gespeichertAm);
};
