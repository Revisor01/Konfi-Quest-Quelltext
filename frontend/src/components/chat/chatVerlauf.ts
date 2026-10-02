import { Message } from '../../types/chat';
import { mergeMitLokalen } from './chatOutbox';

/**
 * Der Raum laedt beim Oeffnen den juengsten Block (ERSTER_BLOCK Nachrichten)
 * und danach nur Neues (?after=). Wer an den Anfang der geladenen Nachrichten
 * scrollt, bekommt die naechsten AELTERE_SEITE aelteren
 * (?before=<aelteste geladene id>) oben eingefuegt. Liefert der Server weniger
 * als angefordert, ist der Anfang des Chats erreicht.
 *
 * Hier liegt nur die reine Zusammenfuehrung — ohne React, ohne Netz, damit
 * sie sich ohne Rendern pruefen laesst.
 */

/** So viele Nachrichten laedt der Raum beim Oeffnen (auch alte Apps: limit=100). */
export const ERSTER_BLOCK = 100;

/** So viele aeltere Nachrichten kommen je Nachladen dazu. */
export const AELTERE_SEITE = 50;

/**
 * Id der aeltesten SERVER-Nachricht der Liste (Anker fuer ?before=), oder
 * null, wenn keine da ist. Die Liste ist chronologisch; lokale Nachrichten
 * (optimistisch oder aus der Warteschlange) tragen negative ids und zaehlen
 * nicht — der Server kennt sie nicht.
 */
export function aeltesteServerId(nachrichten: Message[]): number | null {
  for (const m of nachrichten) {
    if (m.id > 0) return m.id;
  }
  return null;
}

/**
 * Aeltere Seite oben einfuegen. Doppelte (gleiche id) kommen nicht zweimal
 * in die Liste — etwa wenn zwei Nachlade-Anfragen sich ueberholen oder ein
 * Socket-Ereignis dieselbe Nachricht schon gebracht hat. Die vorhandene
 * Fassung gewinnt: Sie kann neuer sein (Reaktion, Loeschung per Socket).
 */
export function aeltereVoranstellen(vorhanden: Message[], aeltere: Message[]): Message[] {
  if (aeltere.length === 0) return vorhanden;
  const bekannt = new Set(vorhanden.filter(m => m.id > 0).map(m => m.id));
  const neu: Message[] = [];
  for (const m of aeltere) {
    if (bekannt.has(m.id)) continue;
    bekannt.add(m.id);
    neu.push(m);
  }
  if (neu.length === 0) return vorhanden;
  return [...neu, ...vorhanden];
}

/**
 * Den juengsten Block (GET ?limit=ERSTER_BLOCK — Oeffnen, Cache-Auffrischung,
 * Nachziehen nach Loeschen/Umfrage/Pull-to-Refresh) in die Liste einpflegen.
 *
 * Bisher ersetzte der Block die Liste (bis auf lokale Nachrichten, siehe
 * mergeMitLokalen). Mit dem Blaettern wuerde das jede nachgeladene aeltere
 * Seite wieder wegwerfen — und die Leserin, die gerade weiter oben liest,
 * springen lassen. Darum bleiben die bereits geladenen aelteren Nachrichten
 * stehen, WENN der Block an sie anschliesst: Die aelteste Nachricht des
 * Blocks steht schon in der Liste. Dann ist alles davor lueckenlos.
 *
 * Schliesst der Block nicht an (lange weg, mehr als ERSTER_BLOCK neue
 * Nachrichten dazwischen), wuerde das Behalten eine unsichtbare Luecke in den
 * Verlauf reissen. Dann gilt der Block allein; wer hochscrollt, laedt die
 * aelteren Nachrichten neu nach.
 *
 * Ist der Block kuerzer als angefordert, IST er der ganze Chat — dann gibt
 * es nichts Aelteres, das zu behalten waere.
 */
export function juengstenBlockEinpflegen(
  block: Message[],
  vorher: Message[],
  angefordert: number = ERSTER_BLOCK
): Message[] {
  const mitLokalen = mergeMitLokalen(block, vorher);
  if (block.length === 0 || block.length < angefordert) return mitLokalen;

  const anschluss = vorher.findIndex(m => m.id === block[0].id);
  if (anschluss <= 0) return mitLokalen;

  const imBlock = new Set(block.map(m => m.id));
  // Nur Server-Nachrichten: lokale (negative id) bringt mergeMitLokalen
  // bereits wieder ans Ende — hier davor stuenden sie doppelt.
  const aeltere = vorher.slice(0, anschluss).filter(m => m.id > 0 && !imBlock.has(m.id));
  if (aeltere.length === 0) return mitLokalen;
  return [...aeltere, ...mitLokalen];
}

/** Der Platzhalter, den der Server fuer eine geloeschte Nachricht ausliefert. */
export const GELOESCHT_TEXT = 'Diese Nachricht wurde gelöscht';

/**
 * Eine Nachricht so markieren, wie der Server sie nach dem Loeschen liefert
 * (GET messages: is_deleted, Platzhalter statt Inhalt). Noetig, seit die
 * Liste nachgeladene aeltere Nachrichten haelt: Der juengste Block, der nach
 * dem Loeschen nachgeladen wird, enthaelt sie nicht — ohne diese Markierung
 * stuende eine geloeschte aeltere Nachricht bis zum naechsten Oeffnen mit
 * Inhalt da. Dasselbe gilt fuer das Socket-Ereignis, wenn anderswo geloescht
 * wird: Es setzte bisher nur deleted_at, das die Blase nicht auswertet.
 */
export function alsGeloescht(m: Message): Message {
  return { ...m, is_deleted: 1, content: GELOESCHT_TEXT };
}

/**
 * Ist der Anfang des Chats erreicht? `anfangBei` ist die id der aeltesten
 * Nachricht in dem Moment, als der Server weniger lieferte als angefordert.
 * Solange genau sie die aelteste der Liste ist, gibt es nichts Aelteres.
 * Faellt sie weg (Block ohne Anschluss, Chat geleert), gilt der Merker
 * automatisch nicht mehr — ohne dass jemand ihn zuruecksetzen muss.
 */
export function anfangErreicht(nachrichten: Message[], anfangBei: number | null): boolean {
  if (anfangBei === null) return false;
  return aeltesteServerId(nachrichten) === anfangBei;
}
