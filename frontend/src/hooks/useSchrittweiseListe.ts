import { useCallback, useState } from 'react';

/**
 * Lange Listen schrittweise zeigen.
 *
 * DER WEG: Nur die ersten `schritt` Zeilen rendern; weitere kommen dazu, wenn
 * man nach unten scrollt (IonInfiniteScroll, shared/WeitereEintraege.tsx)
 * oder den Knopf darunter antippt. Suche, Filter und Sortierung laufen weiter
 * ueber die GANZE Liste -- nur das Rendern ist begrenzt, Zaehler und Treffer
 * bleiben vollstaendig.
 *
 * BEWUSST KEINE echte Virtualisierung (Zeilen ausserhalb des Bildes
 * entfernen): IonItemSliding, die Wisch-Aktionen, Pull-to-refresh und die
 * Kopfzeilen haengen am normalen Dokumentfluss im IonContent. Schrittweises
 * Anhaengen aendert daran nichts; einmal gerenderte Zeilen bleiben stehen.
 *
 * `zuruecksetzenBei`: ein Schluessel aus Suche/Filter/Reiter. Aendert er sich,
 * beginnt die Liste wieder mit dem ersten Schritt -- im SELBEN Render, damit
 * ein Tastendruck nie erst die alte, lange Liste neu zeichnet.
 */
export const LISTE_SCHRITT = 30;

export function useSchrittweiseListe<T>(
  eintraege: T[],
  zuruecksetzenBei: string,
  schritt: number = LISTE_SCHRITT,
): { sichtbar: T[]; weitere: number; mehrZeigen: () => void } {
  const [stand, setStand] = useState({ schluessel: zuruecksetzenBei, anzahl: schritt });

  let anzahl = stand.anzahl;
  if (stand.schluessel !== zuruecksetzenBei) {
    // Abgeleiteter Zustand nach React-Muster: waehrend des Renderns
    // zuruecksetzen, React verwirft diesen Durchlauf und rendert sofort neu.
    setStand({ schluessel: zuruecksetzenBei, anzahl: schritt });
    anzahl = schritt;
  }

  const sichtbar = eintraege.length > anzahl ? eintraege.slice(0, anzahl) : eintraege;
  const weitere = eintraege.length - sichtbar.length;
  const mehrZeigen = useCallback(() => {
    setStand((s) => ({ ...s, anzahl: s.anzahl + schritt }));
  }, [schritt]);

  return { sichtbar, weitere, mehrZeigen };
}
