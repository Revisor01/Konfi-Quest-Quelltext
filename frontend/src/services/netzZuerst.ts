import { offlineCache } from './offlineCache';

// Warum nicht useOfflineQuery: Das zeigt zuerst den gespeicherten Stand und
// fragt danach den Server. Bei den Challenge-Beiträgen hieße das: Ein
// inzwischen ausgeblendeter oder gelöschter Beitrag stünde nach dem Öffnen
// kurz wieder da — samt Foto aus dem Medien-Cache. Hier entscheidet bei Netz
// immer der Server; der gespeicherte Stand hilft nur, wenn keine Antwort kam.
//
// Antwortet der Server mit einem Fehler (403 kein Zugriff mehr, 404 weg, 5xx),
// gibt es bewusst KEINEN Rückgriff: Wer die Challenge nicht mehr sehen darf,
// soll sie auch nicht aus dem Speicher sehen.

export interface NetzZuerstErgebnis<T> {
  daten: T;
  /** true: kein Netz, der zuletzt geladene Stand wird gezeigt. */
  ausSpeicher: boolean;
}

/** Kam gar keine Antwort (Netz weg, Zeitlimit)? */
const ohneAntwort = (fehler: unknown): boolean =>
  (fehler as { response?: unknown })?.response === undefined;

export async function netzZuerstLaden<T>(
  schluessel: string,
  abruf: () => Promise<T>,
  ttl: number
): Promise<NetzZuerstErgebnis<T>> {
  try {
    const daten = await abruf();
    // Merken für den Fall ohne Netz — nicht abwarten, die Anzeige soll nicht
    // auf das Schreiben warten.
    void offlineCache.set(schluessel, daten, ttl).catch(() => undefined);
    return { daten, ausSpeicher: false };
  } catch (fehler) {
    if (!ohneAntwort(fehler)) throw fehler;
    const eintrag = await offlineCache.get<T>(schluessel).catch(() => null);
    if (!eintrag) throw fehler;
    return { daten: eintrag.data, ausSpeicher: true };
  }
}
