// Senden -- und bei abgerissener Verbindung in die Warteschlange.
//
// Formulare mit Offline-Warteschlange verzweigten bisher allein nach
// `networkMonitor.isOnline`: offline -> einreihen, online -> senden und bei
// jedem Fehler eine Fehlermeldung. Haelt sich die App aber fuer online, obwohl
// das Netz nicht traegt (schwacher Empfang, den das Geraet noch als verbunden
// meldet; der Moment, bevor der Monitor den Verlust bemerkt), endete eine
// Abmeldung im Bus mit "Fehler bei der Abmeldung" statt mit "Wird gesendet".
// Chat-Nachrichten machten es schon richtig (components/chat/chatOutbox.ts):
// Scheitert der Versand am Netz, reihen sie sich ein. Diese Hilfsfunktion
// macht dasselbe fuer die uebrigen Formulare.
//
// WANN EINGEREIHT WIRD
// - Offline: immer (wie bisher). Die Anfrage ging nicht hinaus, ein
//   Doppelversand ist ausgeschlossen.
// - Online und die Anfrage scheitert OHNE Antwort des Servers (Netzfehler,
//   Zeitlimit): nur, wenn ein zweiter Eingang nichts doppelt tut. Denn ob die
//   erste Anfrage angekommen ist, weiss niemand -- vielleicht fehlt nur die
//   Antwort. PUT und DELETE sind dafuer gebaut (api.ts wiederholt sie aus
//   demselben Grund selbst). Ein POST nur, wenn der Aufrufer es zusichert
//   (`idempotent: true`): weil der Server ihn an einer client_id erkennt oder
//   weil der Zustand einen zweiten Eingang schluckt (Abmeldung, Zusage). Ohne
//   Zusicherung bleibt es beim Fehler -- dieselbe Regel wie in api.ts
//   (Commit "keine automatische Wiederholung schreibender Anfragen ohne
//   Idempotenzschluessel"): Bonuspunkte duerfen nicht doppelt ankommen.
// - Antwortet der Server (400, 403, 500 ...), ist das eine echte Antwort und
//   kein Fall fuer die Warteschlange: Fehler wie bisher.

/** Schreibende Methoden, wie sie die Warteschlange kennt. */
export type SchreibMethode = 'POST' | 'PUT' | 'DELETE';

/**
 * true, wenn die Anfrage ohne Antwort des Servers scheiterte: Netzfehler
 * (`ERR_NETWORK`) oder Zeitlimit (`ECONNABORTED`, `ETIMEDOUT`). Nicht:
 * eine Antwort mit Fehlerstatus, ein bewusster Abbruch, ein Fehler im
 * eigenen Code.
 */
export function istVerbindungsabbruch(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const f = err as { response?: unknown; code?: unknown };
  if (f.response) return false;
  return f.code === 'ERR_NETWORK' || f.code === 'ECONNABORTED' || f.code === 'ETIMEDOUT';
}

/** Darf eine online abgerissene Anfrage dieser Art erneut eingehen? */
export function darfNachAbbruchEinreihen(methode: SchreibMethode, idempotent = false): boolean {
  return methode === 'PUT' || methode === 'DELETE' || idempotent;
}

export type SendeWeg<T> = { weg: 'gesendet'; ergebnis: T } | { weg: 'eingereiht' };

export async function sendenOderEinreihen<T>(optionen: {
  /** Aktueller Netzstand (networkMonitor.isOnline bzw. isOnline aus useApp). */
  online: boolean;
  /** Methode der Anfrage -- bestimmt, ob ein Abbruch eingereiht werden darf. */
  methode: SchreibMethode;
  /** Nur fuer POST: Der Server erkennt einen zweiten Eingang (siehe oben). */
  idempotent?: boolean;
  senden: () => Promise<T>;
  /** Legt denselben Vorgang in die Warteschlange (writeQueue.enqueue). */
  einreihen: () => Promise<unknown>;
}): Promise<SendeWeg<T>> {
  if (!optionen.online) {
    await optionen.einreihen();
    return { weg: 'eingereiht' };
  }
  try {
    return { weg: 'gesendet', ergebnis: await optionen.senden() };
  } catch (err) {
    if (!istVerbindungsabbruch(err) || !darfNachAbbruchEinreihen(optionen.methode, optionen.idempotent)) {
      throw err;
    }
    await optionen.einreihen();
    return { weg: 'eingereiht' };
  }
}
