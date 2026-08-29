import { useCallback, useEffect, useState } from 'react';
import { writeQueue, onQueueChanged, QueueItem, FailedAction } from '../services/writeQueue';

export interface WartendeVorgaenge {
  /** Was noch in der Warteschlange liegt. */
  wartend: QueueItem[];
  /** Was endgueltig gescheitert ist und noch niemand weggewischt hat. */
  gescheitert: FailedAction[];
  /** Einen gescheiterten Vorgang wegwischen. */
  vergessen: (id: string) => Promise<void>;
  /** Alle gescheiterten Vorgaenge wegwischen. */
  alleVergessen: () => Promise<void>;
}

/**
 * Liest den Zustand der Offline-Warteschlange fuer die Anzeige.
 *
 * Vorher lag diese Logik zweimal wortgleich in KonfiEventsPage und
 * TeamerEventsPage, jeweils nur fuer Antraege — die uebrigen rund vierzig
 * Einreih-Stellen (Abmeldungen, Buchungen, alle Leitungs-Aktionen) zeigten gar
 * nicht an, dass noch etwas aussteht. Man tippte womoeglich ein zweites Mal.
 *
 * Zwei Unterschiede zur alten Fassung:
 *
 * Erstens haengt die Aktualisierung nicht mehr daran, dass die zugehoerige
 * Liste neu laedt. Leerte sich die Queue im Hintergrund (Reconnect, App-Start),
 * blieb "Wird gesendet..." stehen, bis jemand zog. Jetzt meldet die
 * Warteschlange jede Aenderung selbst.
 *
 * @param typen Auf welche Vorgangsarten eingeschraenkt werden soll. Ohne
 *   Angabe alles ausser den stillen Hintergrund-Aufraeumern
 *   ('fire-and-forget'), die niemanden interessieren.
 */
export function useWartendeVorgaenge(
  typen?: Array<QueueItem['metadata']['type']>
): WartendeVorgaenge {
  const [wartend, setWartend] = useState<QueueItem[]>([]);
  const [gescheitert, setGescheitert] = useState<FailedAction[]>([]);

  // Als String vergleichen: Ein frisch gebautes Array-Literal an der
  // Aufrufstelle ist bei jedem Rendern eine neue Referenz und wuerde den
  // Effekt sonst endlos neu aufsetzen.
  const typenSchluessel = typen ? typen.join(',') : '';

  const laden = useCallback(async () => {
    const gefiltert = typenSchluessel ? typenSchluessel.split(',') : null;
    const alle = await writeQueue.getAll();
    setWartend(alle.filter(item => (
      gefiltert
        ? gefiltert.includes(item.metadata.type)
        : item.metadata.type !== 'fire-and-forget'
    )));

    const fehl = await writeQueue.getFailedActions();
    setGescheitert(gefiltert ? fehl.filter(f => gefiltert.includes(f.type)) : fehl);
  }, [typenSchluessel]);

  useEffect(() => {
    laden();
    return onQueueChanged(() => { laden(); });
  }, [laden]);

  const vergessen = useCallback(async (id: string) => {
    await writeQueue.forgetFailedAction(id);
  }, []);

  const alleVergessen = useCallback(async () => {
    await writeQueue.forgetAllFailedActions();
  }, []);

  return { wartend, gescheitert, vergessen, alleVergessen };
}

export default useWartendeVorgaenge;
