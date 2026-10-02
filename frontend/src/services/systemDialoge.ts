import { Share } from '@capacitor/share';
import type { ShareOptions } from '@capacitor/share';
import { ohneSperre, ausflugStarten, ausflugBeenden } from './appSperre';
import { mitTypAusEndung } from '../utils/dateiTypen';
import { lesefehlerMelden } from './uploadDiagnose';

// ---------------------------------------------------------------------------
// Systemdialoge, die die App in den Hintergrund schicken.
//
// WARUM ES DIESE DATEI GIBT:
// Ein Teilen-Blatt, eine Dateiauswahl, ein geoeffneter Link oder eine Datei,
// die in einer fremden App aufgeht, legen die App in den Hintergrund, ohne dass
// die Person sie verlaesst. Fuer die App-Sperre
// (services/appSperre.ts) sieht das zunaechst aus wie "App verlassen" — und bei
// der Einstellung "sofort" saesse man nach dem Teilen vor einem Sperrbildschirm.
//
// Statt an acht Aufrufstellen einen Merker zu setzen (und beim neunten daran zu
// denken), laufen die Dialoge hier durch EINE Huelle, die den Ausflug an- und
// abmeldet. Wer kuenftig teilt, importiert von hier und bekommt das Verhalten
// geschenkt.
//
// Karten, Store, Musik- und Weblinks: Bis dahin rief jede
// Stelle window.open selbst, an linkOeffnen vorbei — bei „Sofort" stand man
// nach jedem Blick in die Karte vor dem Sperrbildschirm. Jetzt oeffnet nur
// linkOeffnen ein Fenster nach draussen; der Test linksNurUeberHuelle
// schlaegt an, sobald irgendwo sonst window.open steht.
// ---------------------------------------------------------------------------

/**
 * `Share.share` mit abgemeldeter App-Sperre.
 * Verhaelt sich sonst in jeder Hinsicht wie das Original — auch im Fehlerfall:
 * ein Abbruch wirft weiterhin, die Aufrufstellen behandeln ihn wie bisher.
 */
export const teilen = (optionen: ShareOptions) =>
  ohneSperre(() => Share.share(optionen));

/** `navigator.share` mit abgemeldeter App-Sperre (Browser-Weg). */
export const teilenImBrowser = (daten: ShareData) =>
  ohneSperre(() => navigator.share(daten));

/**
 * Oeffnet einen Link ausserhalb der App (Karten, Store, Weblinks).
 * Gibt es nur, damit auch diese Abgaenge die Sperre nicht ausloesen.
 */
export const linkOeffnen = (url: string): void => {
  ohneSperre(async () => {
    window.open(url, '_blank');
    // Kurz offen halten: window.open kehrt sofort zurueck, der Wechsel in den
    // Hintergrund passiert erst danach. Ohne diese Spanne waere der Merker
    // wieder weg, bevor er gebraucht wird.
    await new Promise((fertig) => setTimeout(fertig, 1500));
  });
};

/**
 * Wie lange der Ausflug nach dem Öffnen einer Datei noch läuft. Dieselbe
 * Spanne wie bei `linkOeffnen`, aus demselben Grund (siehe dort).
 */
export const DATEI_NACHLAUF_MS = 1500;

/**
 * Notbremse: Spätestens nach dieser Zeit endet der Ausflug, auch wenn das
 * Plugin nie antwortet.
 *
 * WARUM: Die Plugins antworten unterschiedlich. Auf Android kehren
 * beide sofort nach dem Start der fremden App zurück. Auf iOS antwortet der
 * FileOpener erst, wenn die Vorschau geschlossen ist, und der FileViewer, wenn
 * das System seinen Vorschau-Baustein freigibt — wann genau, steht in keiner
 * Dokumentation. Hinge das Ende des Ausflugs allein an dieser Antwort, wäre
 * die App-Sperre bei einem Plugin, das nie antwortet, ab da tot. Lieber sperrt
 * die App nach so langer Zeit einmal zu oft (harmlos) als nie wieder
 * (Sicherheitsleck, siehe KARENZZEIT in appSperre.ts).
 */
export const DATEI_AUSFLUG_HOECHSTENS_MS = 5 * 60 * 1000;

/**
 * Öffnet eine Datei in einer fremden App oder in der Vorschau des Systems —
 * mit abgemeldeter App-Sperre.
 *
 * WOFÜR: „Das führt bei
 * aktivierter Biometrie sofort immer zu einer Biometrie-Abfrage." Ein
 * Word-Dokument öffnet auf Android in einer anderen App; die App-Sperre hielt
 * das für „App verlassen" und fragte bei der Rückkehr nach dem Fingerabdruck.
 *
 * Das Plugin kehrt auf Android sofort zurück, der Wechsel in den Hintergrund
 * kommt erst danach. Deshalb bleibt der Ausflug nach der Antwort noch
 * `DATEI_NACHLAUF_MS` stehen — wie bei `linkOeffnen`. Anders als dort wartet
 * der Aufrufer diese Spanne NICHT ab: Die Ladeanzeige der Datei soll nicht
 * anderthalb Sekunden länger stehen, als das Öffnen dauert.
 *
 * Scheitert das Öffnen, wirft die Hülle den Fehler unverändert weiter; der
 * Ausflug endet auch dann erst nach dem Nachlauf. Ob das Plugin vor dem Fehler
 * schon etwas gestartet hat, lässt sich von hier nicht sehen — ein Nachlauf zu
 * viel schadet nicht.
 */
export const dateiExternOeffnen = async <T>(oeffnen: () => Promise<T>): Promise<T> => {
  ausflugStarten();
  let laeuft = true;
  // Die Notbremse und der Nachlauf können beide feuern — der Ausflug darf aber
  // nur einmal abgemeldet werden. Ein zweites ausflugBeenden() räumte sonst
  // einen fremden, gleichzeitig laufenden Ausflug mit ab (der Merker zählt).
  const beenden = () => {
    if (!laeuft) return;
    laeuft = false;
    clearTimeout(notbremse);
    ausflugBeenden();
  };
  const notbremse = setTimeout(beenden, DATEI_AUSFLUG_HOECHSTENS_MS);
  try {
    return await oeffnen();
  } finally {
    setTimeout(beenden, DATEI_NACHLAUF_MS);
  }
};

// --- Dateiauswahl -----------------------------------------------------------

/**
 * Nach der Rückkehr in die App: So lange darf das System noch an der Auswahl
 * arbeiten (HEIC umrechnen, ein großes Video kopieren), bevor eine Auswahl
 * ohne `change` und ohne `cancel` als Abbruch gilt. `change` gewinnt jederzeit
 * vorher. Der Wert stammt aus der Challenge-Abgabe: Dort löste früher schon
 * nach 1 s ein Fokus-Rückfall mit „nichts gewählt" aus, und eine langsame
 * Auswahl ging still verloren.
 */
export const AUSWAHL_RUECKKEHR_FRIST_MS = 15000;

/**
 * Nach dieser Spanne ohne Auswahl meldet `beiRueckkehrOhneAuswahl` — für eine
 * Ladeanzeige, die bei einem Abbruch nicht 15 s stehen bleiben soll.
 */
export const AUSWAHL_RUECKKEHR_HINWEIS_MS = 1200;

/** Nachlauf nach Auswahl oder Abbruch — dieselbe Spanne wie beim Öffnen einer Datei. */
export const AUSWAHL_NACHLAUF_MS = DATEI_NACHLAUF_MS;

/**
 * Bis zu dieser Größe kommt ein Dokument gleich nach der Auswahl in den
 * Speicher (imSpeicher). Größer erlaubt die App nirgends (Material 20 MB, Chat
 * 5 MB, services/mediaCompression.ts) — dort meldet die Größenprüfung wie
 * bisher „zu groß", statt dass hier still viel Speicher belegt wird. Dieselbe
 * Grenze wie die Kopie auf Android (DateiKopie.HOECHSTENS_BYTES).
 */
export const IM_SPEICHER_HOECHSTENS_BYTES = 25 * 1024 * 1024;

/**
 * Ein Dokument gleich nach der Auswahl in den Speicher lesen.
 *
 * Fotos und Videos bleiben unberührt (Fotos verkleinert die App ohnehin,
 * Videos können groß sein), ebenso alles über der Grenze. Lässt sich ein
 * Dokument nicht lesen, geht das Original weiter — nicht schlechter als
 * vorher; der Fehler zeigt sich dann beim Senden. Gemeldet wird er schon hier
 * (services/uploadDiagnose.ts): Dann zeigt die Messung, ob es am Lesen der
 * Datei liegt oder erst am Versand.
 */
export const imSpeicher = async (datei: File): Promise<File> => {
  const typ = (datei.type || '').toLowerCase();
  if (typ.startsWith('image/') || typ.startsWith('video/')) return datei;
  if (datei.size > IM_SPEICHER_HOECHSTENS_BYTES) return datei;
  try {
    const daten = await datei.arrayBuffer();
    return new File([daten], datei.name, { type: datei.type, lastModified: datei.lastModified });
  } catch (fehler) {
    lesefehlerMelden(fehler);
    return datei;
  }
};

export interface DateiAuswahlOptionen {
  /** Wie das `accept` einer Datei-Eingabe, z. B. 'image/*'. */
  accept?: string;
  multiple?: boolean;
  /**
   * Die App ist zurück, eine Auswahl aber (noch) nicht da — gerufen
   * `AUSWAHL_RUECKKEHR_HINWEIS_MS` nach der Rückkehr. Die Auswahl kann danach
   * immer noch eintreffen.
   */
  beiRueckkehrOhneAuswahl?: () => void;
}

// Die Eingabefelder hängen in keinem Dokument. Dieser Verweis hält jedes am
// Leben, bis seine Auswahl erledigt ist — sonst dürfte der Browser ein Feld
// wegräumen, dessen `change` noch aussteht.
const offeneAuswahlen = new Set<HTMLInputElement>();

/**
 * Öffnet die Dateiauswahl des Systems — mit abgemeldeter App-Sperre. Die
 * EINZIGE Stelle der App, an der eine Datei-Eingabe entsteht (Leitplanke:
 * dateiAuswahlNurUeberHuelle.test.ts).
 *
 * Das Versprechen löst mit den gewählten Dateien auf, oder mit `null`, wenn
 * nichts gewählt wurde (Abbruch). Es wirft nie. Jede Datei trägt einen Typ:
 * Fehlt er oder ist er allgemein, kommt er aus der Endung (mitTypAusEndung).
 * Dokumente kommen als Kopie im Speicher (imSpeicher), Fotos und Videos so,
 * wie das System sie liefert.
 *
 * DER AUSFLUG beginnt, bevor die Auswahl aufgeht, und endet genau einmal:
 *   - nach der Auswahl (`change`) oder dem Abbruch (`cancel`, wo das WebView
 *     es kennt), jeweils nach `AUSWAHL_NACHLAUF_MS` — der Rückweg in die App
 *     (appStateChange) darf nicht nach dem Ende des Ausflugs ankommen;
 *   - sonst über die Rückkehr des Fokus: `AUSWAHL_RUECKKEHR_FRIST_MS` danach
 *     gilt die Auswahl als erledigt, mit dem, was dann im Feld steht;
 *   - spätestens nach `DATEI_AUSFLUG_HOECHSTENS_MS` (Notbremse), falls gar
 *     kein Ereignis kommt. Die Auswahl bleibt dann offen, nur die Sperre ist
 *     wieder scharf — lieber einmal zu oft gesperrt als nie wieder.
 *
 * Jeder Aufruf legt ein frisches Feld an und leert es nach dem Auslesen.
 * Dieselbe Datei lässt sich deshalb gleich noch einmal wählen — bei einem
 * wiederverwendeten Feld feuerte `change` ohne Wertwechsel nicht.
 */
export const dateiAuswaehlen = ({
  accept,
  multiple = false,
  beiRueckkehrOhneAuswahl,
}: DateiAuswahlOptionen = {}): Promise<File[] | null> =>
  new Promise((aufloesen) => {
    const feld = document.createElement('input');
    feld.type = 'file';
    if (accept) feld.accept = accept;
    feld.multiple = multiple;
    offeneAuswahlen.add(feld);

    ausflugStarten();
    let ausflugLaeuft = true;
    // Notbremse und Nachlauf können beide feuern — abgemeldet wird trotzdem
    // nur einmal, sonst räumte das einen fremden, gleichzeitig laufenden
    // Ausflug mit ab (der Merker zählt; wie in dateiExternOeffnen).
    const ausflugEnde = () => {
      if (!ausflugLaeuft) return;
      ausflugLaeuft = false;
      clearTimeout(notbremse);
      ausflugBeenden();
    };
    const notbremse = setTimeout(ausflugEnde, DATEI_AUSFLUG_HOECHSTENS_MS);

    let erledigt = false;
    let frist: ReturnType<typeof setTimeout> | undefined;
    let hinweis: ReturnType<typeof setTimeout> | undefined;

    // Nennt das Gerät keinen Typ (Android bei manchen Word-Dateien), kommt er
    // aus der Endung — siehe utils/dateiTypen.ts. Sonst ginge die Datei als
    // application/octet-stream hinaus.
    const gewaehlt = (): File[] => Array.from(feld.files ?? []).map(mitTypAusEndung);

    const fertig = (dateien: File[]) => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(frist);
      clearTimeout(hinweis);
      window.removeEventListener('focus', beiRueckkehr);
      // Erst ausgelesen (dateien), dann geleert.
      try {
        feld.value = '';
      } catch {
        // Manche Umgebungen lassen das nicht zu — das Feld wird ohnehin verworfen.
      }
      offeneAuswahlen.delete(feld);
      setTimeout(ausflugEnde, AUSWAHL_NACHLAUF_MS);
      // Dokumente gleich in den Speicher (imSpeicher). imSpeicher wirft nie,
      // das Versprechen also auch nicht.
      aufloesen(dateien.length > 0 ? Promise.all(dateien.map(imSpeicher)) : null);
    };

    const beiRueckkehr = () => {
      hinweis = setTimeout(() => {
        if (!erledigt) beiRueckkehrOhneAuswahl?.();
      }, AUSWAHL_RUECKKEHR_HINWEIS_MS);
      // Zum Ende der Frist noch einmal ins Feld sehen: Eine Auswahl, deren
      // `change` verloren ging, zählt trotzdem.
      frist = setTimeout(() => fertig(gewaehlt()), AUSWAHL_RUECKKEHR_FRIST_MS);
    };

    feld.onchange = () => fertig(gewaehlt());
    // Natives Abbruch-Ereignis (neuere WebViews) — sofort und verlässlich.
    feld.oncancel = () => fertig([]);
    window.addEventListener('focus', beiRueckkehr, { once: true });

    try {
      feld.click();
    } catch {
      // Ließ sich die Auswahl gar nicht öffnen, ist auch nichts zu schützen.
      fertig([]);
    }
  });
