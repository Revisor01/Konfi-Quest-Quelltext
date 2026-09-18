import { useLayoutEffect, useRef, useState } from 'react';
import { kachelNameKuerzen } from '../../utils/kachelName';

// Misst die tatsaechlich verfuegbare Breite einer Kachel-Beschriftung und
// kuerzt den Namen darauf — wortweise, nie mitten im Wort.
//
// WARUM GEMESSEN UND NICHT IN CSS:
// Die Begruendung steht ausfuehrlich in utils/kachelName.ts. Kurz: Im
// Dreierraster bleiben bei 320 px Fensterbreite 79 px fuer den Namen, das
// laengste Produktionswort ist 124 px breit, und es gibt keine Schriftgroesse
// im lesbaren Bereich, bei der es passt. `text-overflow: ellipsis` greift im
// `-webkit-box`-Container bei einem waagerecht ueberlaufenden Einzelwort
// nicht, und `overflow-wrap: break-word` bricht per Definition mitten im Wort.
//
// WARUM useLayoutEffect:
// Gemessen und gekuerzt wird VOR dem Zeichnen. Mit useEffect stuende fuer
// einen Bildaufbau der ungekuerzte Name da und spraenge dann um — auf dem
// Geraet als Flackern sichtbar.
//
// Ein eigener Messknoten statt des echten Elements: Das echte Element traegt
// line-clamp und Umbruch; seine Breite zu messen beantwortet nicht, wie breit
// der Text OHNE Umbruch waere. Der Messknoten uebernimmt die Schriftmerkmale
// und misst in einer Zeile.

/** Baut einen Messknoten mit den Schriftmerkmalen des Ziels. */
const messknotenFuer = (ziel: HTMLElement): HTMLSpanElement => {
  const stil = window.getComputedStyle(ziel);
  const knoten = document.createElement('span');
  knoten.style.position = 'absolute';
  knoten.style.visibility = 'hidden';
  knoten.style.whiteSpace = 'nowrap';
  knoten.style.pointerEvents = 'none';
  knoten.style.left = '-9999px';
  knoten.style.top = '0';
  knoten.style.fontSize = stil.fontSize;
  knoten.style.fontWeight = stil.fontWeight;
  knoten.style.fontFamily = stil.fontFamily;
  knoten.style.letterSpacing = stil.letterSpacing;
  knoten.style.textTransform = stil.textTransform;
  return knoten;
};

/**
 * Liefert [ref, anzeigeName]. Den ref an das Namenselement haengen; der
 * anzeigeName ist der gekuerzte Text.
 *
 * Solange noch nicht gemessen wurde (erster Durchgang, oder kein DOM),
 * kommt der VOLLE Name zurueck. Lieber einmal zu lang als leer: Ein leeres
 * Feld saehe aus wie ein Fehler, ein zu langer Name wird im naechsten
 * Layout-Schritt gekuerzt.
 */
export function useKachelName(name: string): [React.RefObject<HTMLDivElement | null>, string] {
  const ref = useRef<HTMLDivElement>(null);
  const [anzeige, setAnzeige] = useState(name);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) { setAnzeige(name); return; }

    const messen = () => {
      const breite = el.clientWidth;
      // Ohne brauchbare Breite (Element noch nicht im Layout, Kachel
      // ausgeblendet) NICHT kuerzen — sonst entstuende aus 0 px ein "…".
      if (!breite || breite <= 0) { setAnzeige(name); return; }

      const knoten = messknotenFuer(el);
      document.body.appendChild(knoten);
      try {
        const miss = (text: string): number => {
          knoten.textContent = text;
          return knoten.getBoundingClientRect().width;
        };
        setAnzeige(kachelNameKuerzen(name, breite, miss));
      } finally {
        knoten.remove();
      }
    };

    messen();

    // Die Kachelbreite haengt am Fenster (Drehen, Splitscreen, Browser).
    // ResizeObserver statt window.resize: Er feuert auch, wenn sich nur die
    // Spaltenbreite aendert, ohne dass sich das Fenster aendert.
    if (typeof ResizeObserver === 'undefined') return;
    const beobachter = new ResizeObserver(() => messen());
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [name]);

  return [ref, anzeige];
}

export default useKachelName;
