import { useEffect, useRef, useState } from 'react';

// setTimeout wartet höchstens 2^31-1 ms (rund 24,8 Tage); längere Strecken
// werden in Etappen geplant.
const LAENGSTE_WARTEZEIT = 2 ** 31 - 1;

/**
 * Die aktuelle Zeit in Millisekunden — neu gerendert genau dann, wenn eine der
 * übergebenen Grenzen erreicht ist, etwa Beginn oder Ende einer Challenge.
 *
 * Warum nicht einfach Date.now() im Render (oder in einem useMemo auf die
 * Daten): Dann rechnet die Ansicht nur, wenn sich zufällig etwas anderes
 * ändert. Endete eine Challenge bei offenem Detail, stand sie weiter als
 * laufend da.
 *
 * Eine Grenze gilt als erreicht, sobald die Zeit >= Grenze ist. Wer „bis
 * einschließlich Ende" meint (`jetzt <= ende`), übergibt `ende + 1`.
 * Ungültige Werte (NaN, etwa aus einem fehlenden Datum) werden übergangen.
 */
export function useJetztMitGrenzen(grenzen: readonly number[]): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  const stand = useRef(jetzt);
  // Als Zeichenkette, damit ein neues Array mit denselben Werten den Wecker
  // nicht bei jedem Rendern neu stellt.
  const schluessel = grenzen.filter(Number.isFinite).join(',');

  useEffect(() => {
    const liste = schluessel ? schluessel.split(',').map(Number) : [];
    let wecker: ReturnType<typeof setTimeout> | undefined;

    const planen = () => {
      const nun = Date.now();
      // Liegt eine Grenze zwischen dem letzten Stand und jetzt — etwa weil
      // sich die Grenzen geändert haben —, sofort nachziehen.
      const verpasst = liste.some((g) => g > stand.current && g <= nun);
      const naechste = liste.filter((g) => g > nun).sort((a, b) => a - b)[0];
      if (!verpasst && naechste === undefined) return;
      const warten = verpasst ? 0 : Math.min(naechste - nun, LAENGSTE_WARTEZEIT);
      wecker = setTimeout(() => {
        stand.current = Date.now();
        setJetzt(stand.current);
        planen();
      }, warten);
    };

    planen();
    return () => clearTimeout(wecker);
  }, [schluessel]);

  return jetzt;
}
