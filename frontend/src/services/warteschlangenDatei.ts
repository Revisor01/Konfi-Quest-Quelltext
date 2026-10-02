import { Filesystem, Directory } from '@capacitor/filesystem';

// Dateien fuer die Schreib-Warteschlange (Chat-Anhang, Foto zu einem Antrag)
// sichern -- EINE Stelle fuer alle, die offline oder nach einem Netzabbruch
// einreihen.
//
// Tester-Rueckmeldung Build 130: Eine PDF ging im Chat vom Android-Handy nicht
// raus. Scheitert der Versand ohne Antwort des Servers, sichert die App die
// Datei nach queue-uploads/ und versucht es spaeter. Diesen Ordner legte nie
// jemand an, und writeFile ohne `recursive` bricht dann ab ("Missing parent
// directory -- possibly recursive=false was passed", @capacitor/filesystem 8
// auf Android und iOS). Jede Datei, die nicht sofort durchging -- im Chat, im
// Antrag von Konfi und Teamer:in --, stand deshalb als Fehler da.
//
// Directory.Data: bleibt ueber einen Neustart der App erhalten (anders als der
// Cache), und auf iOS liegt es nicht offen in der Dateien-App
// (config/iosNativ.test.ts).

export const WARTESCHLANGE_ORDNER = 'queue-uploads';

/**
 * Legt eine Datei (als data-URL oder Base64) fuer die Warteschlange ab und
 * gibt den Pfad zurueck, unter dem writeQueue sie beim Nachsenden liest.
 */
export async function warteschlangenDateiSichern(dateiname: string, daten: string): Promise<string> {
  const pfad = `${WARTESCHLANGE_ORDNER}/${dateiname}`;
  await Filesystem.writeFile({
    path: pfad,
    data: daten,
    directory: Directory.Data,
    recursive: true,
  });
  return pfad;
}
