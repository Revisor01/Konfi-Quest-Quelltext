import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfOeffnen } from '../../utils/pdfDokument';

// ---------------------------------------------------------------------------
// Eine PDF im Betrachter der App: alle Seiten untereinander, mit Zoom.
//
// WOFÜR: Auf Android ging
// jede PDF in einer fremden App auf — und bei eingeschalteter App-Sperre kam
// bei der Rückkehr die Biometrie-Abfrage. Das WebView zeigt PDFs im iframe
// nicht an; deshalb zeichnet pdf.js die Seiten selbst. Im Browser gilt
// dasselbe (siehe pdfImAppBetrachter in utils/nativeFileViewer.ts), auf iOS
// bleibt die Vorschau des Systems.
//
// Der Betrachter lädt diese Datei erst beim Öffnen einer PDF per import() —
// pdf.js liegt in einem eigenen Chunk (siehe utils/pdfDokument.ts).
//
// BEDIENUNG:
//   - Ziehen mit einem Finger blättert (natives Scrollen des Rahmens).
//   - Zwei Finger zoomen, ein Doppeltipp wechselt zwischen 100 % und 200 %,
//     die Knöpfe − und + gehen in Stufen. Gezoomt lässt sich auch seitlich
//     schieben.
//   - Ungezoomt wischt ein schneller Wisch zur Seite zur nächsten Datei der
//     Ansicht, wie beim Foto.
// ---------------------------------------------------------------------------

const ZOOM_STUFEN = [1, 1.5, 2, 3, 4];
const ZOOM_MIN = ZOOM_STUFEN[0];
const ZOOM_MAX = ZOOM_STUFEN[ZOOM_STUFEN.length - 1];
const ZOOM_DOPPELTIPP = 2;

/**
 * Höchstens so viele Bildpunkte je gezeichneter Seite.
 *
 * Ein Canvas belegt vier Byte je Punkt. Eine A4-Seite auf einem Handy mit
 * 400 px Breite, dreifacher Pixeldichte und 400 % Zoom wären 4800 × 6790,
 * also 32,6 Millionen Punkte oder 130 MB — für EINE Seite, und gezeichnet
 * werden die sichtbaren samt Nachbarn. Oberhalb der Grenze (24 MB je Seite)
 * wird gröber gezeichnet und per CSS hochgezogen.
 */
const MAX_PUNKTE_JE_SEITE = 6_000_000;

/** Wie weit oberhalb und unterhalb des sichtbaren Bereichs schon gezeichnet wird. */
const VORAUS_RAND = '100% 0px';

const klemmen = (wert: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, wert));

interface SeitenMass {
  breite: number;
  hoehe: number;
}

/**
 * Der Punkt, der beim Zoomen an seiner Stelle auf dem Bildschirm bleiben soll:
 * welche Seite, wo darin (als Anteil) und wo im Rahmen er zu sehen war.
 */
interface ZoomAnker {
  seite: number;
  anteilY: number;
  anteilX: number;
  imRahmenX: number;
  imRahmenY: number;
}

interface SeiteProps {
  dok: PDFDocumentProxy;
  nummer: number;
  anzahl: number;
  breite: number;
  hoehe: number;
  zeichnen: boolean;
  anmelden: (nummer: number, element: HTMLDivElement | null) => void;
  onFehler: (fehler: unknown) => void;
}

const istAbbruch = (fehler: unknown): boolean =>
  (fehler as { name?: unknown } | null)?.name === 'RenderingCancelledException';

const PdfSeite: React.FC<SeiteProps> = ({ dok, nummer, anzahl, breite, hoehe, zeichnen, anmelden, onFehler }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Fester Rückruf je Seite: Ein neuer bei jedem Rendern hieße, React meldet
  // die Seite ab und wieder an — der Beobachter meldete sie dann jedes Mal neu,
  // das setzte Zustand, das renderte neu … eine Schleife ohne Ende.
  const anmeldenHier = useCallback((element: HTMLDivElement | null) => anmelden(nummer, element), [anmelden, nummer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!zeichnen || breite <= 0) {
      // Weit weg vom sichtbaren Bereich: Speicher freigeben. Ein langes PDF
      // hielte sonst jede einmal gesehene Seite als Bild im Speicher.
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

    let abgebrochen = false;
    let aufgabe: RenderTask | null = null;
    (async () => {
      const zwischen = document.createElement('canvas');
      try {
        const seite = await dok.getPage(nummer);
        if (abgebrochen) return;
        const basis = seite.getViewport({ scale: 1 });
        const dichte = window.devicePixelRatio || 1;
        let massstab = (breite / basis.width) * dichte;
        const punkte = basis.width * basis.height * massstab * massstab;
        if (punkte > MAX_PUNKTE_JE_SEITE) massstab *= Math.sqrt(MAX_PUNKTE_JE_SEITE / punkte);
        const viewport = seite.getViewport({ scale: massstab });

        // Erst in ein Zwischenbild zeichnen, dann umkopieren: Beim Zoomen
        // bliebe die Seite sonst leer, bis sie neu gezeichnet ist. So steht
        // bis dahin das alte Bild, per CSS auf die neue Größe gezogen.
        zwischen.width = Math.max(1, Math.floor(viewport.width));
        zwischen.height = Math.max(1, Math.floor(viewport.height));
        aufgabe = seite.render({ canvas: zwischen, viewport });
        await aufgabe.promise;
        if (abgebrochen) return;
        canvas.width = zwischen.width;
        canvas.height = zwischen.height;
        canvas.getContext('2d')?.drawImage(zwischen, 0, 0);
      } catch (fehler) {
        // Wegscrollen oder Zoomen bricht das Zeichnen ab — das ist kein Fehler.
        if (abgebrochen || istAbbruch(fehler)) return;
        onFehler(fehler);
      } finally {
        zwischen.width = 0;
        zwischen.height = 0;
      }
    })();

    return () => {
      abgebrochen = true;
      aufgabe?.cancel();
    };
  }, [dok, nummer, breite, zeichnen, onFehler]);

  return (
    <div
      className="pdf-seite"
      ref={anmeldenHier}
      data-seite={nummer}
      style={{ width: breite, height: hoehe }}
    >
      <canvas ref={canvasRef} className="pdf-seite-bild" role="img" aria-label={`Seite ${nummer} von ${anzahl}`} />
    </div>
  );
};

export interface PdfSeitenProps {
  /** Adresse der PDF, in der Regel eine blob:-URL aus dem Medien-Cache. */
  url: string;
  /** Dateiname, für Vorlesehilfen. */
  titel: string;
  /**
   * pdf.js konnte die Datei nicht öffnen oder eine Seite nicht zeichnen. Der
   * Betrachter weicht dann aus (Android: fremde App, Browser: iframe).
   */
  onFehler: (fehler: unknown) => void;
  /** Ungezoomt zur Seite gewischt: nächste oder vorige Datei der Ansicht. */
  onWischen?: (richtung: 'weiter' | 'zurueck') => void;
}

const PdfSeiten: React.FC<PdfSeitenProps> = ({ url, titel, onFehler, onWischen }) => {
  const [dok, setDok] = useState<PDFDocumentProxy | null>(null);
  const [masse, setMasse] = useState<SeitenMass[]>([]);
  const [zoom, setZoom] = useState(1);
  const [rahmenBreite, setRahmenBreite] = useState(0);
  // Welche Seiten nahe genug am Bild sind, um gezeichnet zu werden. Zu Beginn
  // die erste; den Rest meldet der IntersectionObserver. null = es gibt keinen
  // (ältere Umgebung, Tests) — dann alle zeichnen.
  const [sichtbar, setSichtbar] = useState<ReadonlySet<number> | null>(
    () => (typeof IntersectionObserver === 'undefined' ? null : new Set([1]))
  );

  const rahmenRef = useRef<HTMLDivElement>(null);
  const blattRef = useRef<HTMLDivElement>(null);
  const seitenRef = useRef(new Map<number, HTMLDivElement>());
  const beobachterRef = useRef<IntersectionObserver | null>(null);
  const ankerRef = useRef<ZoomAnker | null>(null);

  // Rückrufe über Refs: Ein neuer onFehler bei jedem Rendern des Betrachters
  // darf das Dokument nicht neu laden.
  const onFehlerRef = useRef(onFehler);
  const onWischenRef = useRef(onWischen);
  useEffect(() => {
    onFehlerRef.current = onFehler;
    onWischenRef.current = onWischen;
  });
  const fehlerMelden = useCallback((fehler: unknown) => onFehlerRef.current(fehler), []);

  // --- Dokument laden ---------------------------------------------------------
  useEffect(() => {
    let aus = false;
    let aufgabe: ReturnType<typeof pdfOeffnen> | null = null;
    (async () => {
      try {
        const antwort = await fetch(url);
        const daten = new Uint8Array(await antwort.arrayBuffer());
        if (aus) return;
        aufgabe = pdfOeffnen(daten);
        const geladen = await aufgabe.promise;
        // Die Maße aller Seiten vorab: Die Platzhalter haben so von Anfang an
        // die richtige Höhe, und die Bildlaufleiste springt beim Zeichnen nicht.
        const liste: SeitenMass[] = [];
        for (let nummer = 1; nummer <= geladen.numPages; nummer += 1) {
          if (aus) return;
          const seite = await geladen.getPage(nummer);
          const { width, height } = seite.getViewport({ scale: 1 });
          liste.push({ breite: width, hoehe: height });
        }
        if (aus) return;
        setMasse(liste);
        setDok(geladen);
      } catch (fehler) {
        if (!aus) fehlerMelden(fehler);
      }
    })();
    return () => {
      aus = true;
      // destroy() beendet auch den Worker. Scheitern darf es still — die
      // Ansicht ist ohnehin weg.
      aufgabe?.destroy().catch(() => undefined);
    };
  }, [url, fehlerMelden]);

  // --- Breite des Rahmens ----------------------------------------------------
  useLayoutEffect(() => {
    const rahmen = rahmenRef.current;
    if (!rahmen) return;
    const messen = () => setRahmenBreite(rahmen.clientWidth || window.innerWidth);
    messen();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', messen);
      return () => window.removeEventListener('resize', messen);
    }
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(rahmen);
    return () => beobachter.disconnect();
  }, []);

  // --- Nur zeichnen, was (fast) zu sehen ist ------------------------------------
  useEffect(() => {
    const rahmen = rahmenRef.current;
    if (!rahmen || !dok || typeof IntersectionObserver === 'undefined') return;
    const beobachter = new IntersectionObserver((eintraege) => {
      setSichtbar((vorher) => {
        const neu = new Set(vorher ?? []);
        for (const eintrag of eintraege) {
          const nummer = Number((eintrag.target as HTMLElement).dataset.seite);
          if (eintrag.isIntersecting) neu.add(nummer);
          else neu.delete(nummer);
        }
        // Unverändert: denselben Stand behalten, sonst rendert alles neu.
        const gleich = vorher !== null && neu.size === vorher.size && [...neu].every((n) => vorher.has(n));
        return gleich ? vorher : neu;
      });
    }, { root: rahmen, rootMargin: VORAUS_RAND });
    beobachterRef.current = beobachter;
    seitenRef.current.forEach((element) => beobachter.observe(element));
    return () => {
      beobachter.disconnect();
      beobachterRef.current = null;
    };
  }, [dok]);

  const seiteAnmelden = useCallback((nummer: number, element: HTMLDivElement | null) => {
    const vorher = seitenRef.current.get(nummer);
    if (vorher === element) return;
    if (vorher) beobachterRef.current?.unobserve(vorher);
    if (element) {
      seitenRef.current.set(nummer, element);
      beobachterRef.current?.observe(element);
    } else {
      seitenRef.current.delete(nummer);
    }
  }, []);

  // --- Zoom --------------------------------------------------------------------

  /** Merkt sich den Punkt unter (imRahmenX, imRahmenY), bevor der Zoom wechselt. */
  const ankerSetzen = useCallback((imRahmenX: number, imRahmenY: number) => {
    const rahmen = rahmenRef.current;
    const blatt = blattRef.current;
    if (!rahmen || !blatt) return;
    const x = rahmen.scrollLeft + imRahmenX;
    const y = rahmen.scrollTop + imRahmenY;
    let seite = 1;
    let anteilY = 0;
    seitenRef.current.forEach((element, nummer) => {
      if (y >= element.offsetTop && y < element.offsetTop + element.offsetHeight) {
        seite = nummer;
        anteilY = (y - element.offsetTop) / Math.max(1, element.offsetHeight);
      }
    });
    ankerRef.current = {
      seite,
      anteilY,
      anteilX: x / Math.max(1, blatt.offsetWidth),
      imRahmenX,
      imRahmenY,
    };
  }, []);

  const zoomSetzen = useCallback((neu: number, imRahmenX?: number, imRahmenY?: number) => {
    const rahmen = rahmenRef.current;
    const ziel = klemmen(neu);
    if (rahmen) {
      ankerSetzen(imRahmenX ?? rahmen.clientWidth / 2, imRahmenY ?? rahmen.clientHeight / 2);
    }
    setZoom(ziel);
  }, [ankerSetzen]);

  // Nach dem Zoomen den gemerkten Punkt wieder unter Finger oder Mitte holen.
  useLayoutEffect(() => {
    const anker = ankerRef.current;
    const rahmen = rahmenRef.current;
    const blatt = blattRef.current;
    ankerRef.current = null;
    if (!anker || !rahmen || !blatt) return;
    const element = seitenRef.current.get(anker.seite);
    if (element) {
      rahmen.scrollTop = element.offsetTop + anker.anteilY * element.offsetHeight - anker.imRahmenY;
    }
    rahmen.scrollLeft = anker.anteilX * blatt.offsetWidth - anker.imRahmenX;
  }, [zoom]);

  const zoomStufe = (richtung: 1 | -1) => {
    const naechste = richtung > 0
      ? ZOOM_STUFEN.find((stufe) => stufe > zoom + 0.01)
      : [...ZOOM_STUFEN].reverse().find((stufe) => stufe < zoom - 0.01);
    zoomSetzen(naechste ?? zoom);
  };

  // --- Gesten ------------------------------------------------------------------
  const gesteRef = useRef<{
    art: 'wisch' | 'zwei';
    startX: number;
    startY: number;
    startZeit: number;
    startAbstand: number;
    mitteX: number;
    mitteY: number;
    faktor: number;
  } | null>(null);
  const letzterTippRef = useRef<{ zeit: number; x: number; y: number } | null>(null);

  const imRahmen = (clientX: number, clientY: number) => {
    const box = rahmenRef.current?.getBoundingClientRect();
    return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const mitte = imRahmen((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      gesteRef.current = {
        art: 'zwei',
        startX: 0,
        startY: 0,
        startZeit: Date.now(),
        startAbstand: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        mitteX: mitte.x,
        mitteY: mitte.y,
        faktor: 1,
      };
      letzterTippRef.current = null;
      return;
    }
    if (e.touches.length === 1 && gesteRef.current?.art !== 'zwei') {
      const t = e.touches[0];
      gesteRef.current = {
        art: 'wisch',
        startX: t.clientX,
        startY: t.clientY,
        startZeit: Date.now(),
        startAbstand: 0,
        mitteX: 0,
        mitteY: 0,
        faktor: 1,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const geste = gesteRef.current;
    const rahmen = rahmenRef.current;
    const blatt = blattRef.current;
    if (!geste || geste.art !== 'zwei' || e.touches.length !== 2 || !rahmen || !blatt) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const abstand = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    // Nur als Vorschau per CSS — neu gezeichnet wird erst beim Loslassen.
    geste.faktor = klemmen(zoom * (abstand / geste.startAbstand)) / zoom;
    blatt.style.transformOrigin = `${rahmen.scrollLeft + geste.mitteX}px ${rahmen.scrollTop + geste.mitteY}px`;
    blatt.style.transform = `scale(${geste.faktor})`;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const geste = gesteRef.current;
    if (!geste) return;

    if (geste.art === 'zwei') {
      // Erst wenn beide Finger weg sind, ist die Geste vorbei.
      if (e.touches.length > 0) return;
      gesteRef.current = null;
      const blatt = blattRef.current;
      if (blatt) {
        blatt.style.transform = '';
        blatt.style.transformOrigin = '';
      }
      if (Math.abs(geste.faktor - 1) > 0.01) zoomSetzen(zoom * geste.faktor, geste.mitteX, geste.mitteY);
      return;
    }

    gesteRef.current = null;
    const ende = e.changedTouches[0];
    if (!ende) return;
    const dx = ende.clientX - geste.startX;
    const dy = ende.clientY - geste.startY;
    const dauer = Date.now() - geste.startZeit;

    // Doppeltipp: zwei kurze Tipps kurz nacheinander an fast derselben Stelle.
    if (Math.hypot(dx, dy) < 10 && dauer < 300) {
      const vorher = letzterTippRef.current;
      const jetzt = Date.now();
      if (vorher && jetzt - vorher.zeit < 300 && Math.hypot(ende.clientX - vorher.x, ende.clientY - vorher.y) < 30) {
        letzterTippRef.current = null;
        const punkt = imRahmen(ende.clientX, ende.clientY);
        zoomSetzen(zoom > ZOOM_MIN ? ZOOM_MIN : ZOOM_DOPPELTIPP, punkt.x, punkt.y);
      } else {
        letzterTippRef.current = { zeit: jetzt, x: ende.clientX, y: ende.clientY };
      }
      return;
    }

    // Wischen zur nächsten Datei — nur ungezoomt, sonst schiebt man die Seite.
    if (zoom <= ZOOM_MIN && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dauer < 500) {
      onWischenRef.current?.(dx < 0 ? 'weiter' : 'zurueck');
    }
  };

  // --- Darstellung ---------------------------------------------------------------
  const seitenBreite = rahmenBreite * zoom;
  const laden = !dok;

  return (
    <div className="pdf-ansicht">
      <div
        ref={rahmenRef}
        className="pdf-rahmen"
        role="document"
        aria-label={titel}
        aria-busy={laden}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {laden ? (
          <div className="file-viewer-fallback pdf-laden">
            <p className="file-viewer-fallback-name">PDF wird geladen…</p>
          </div>
        ) : (
          <div ref={blattRef} className="pdf-blatt" style={{ width: seitenBreite }}>
            {masse.map((mass, index) => {
              const nummer = index + 1;
              return (
                <PdfSeite
                  key={nummer}
                  dok={dok}
                  nummer={nummer}
                  anzahl={masse.length}
                  breite={seitenBreite}
                  hoehe={(seitenBreite * mass.hoehe) / mass.breite}
                  zeichnen={sichtbar === null || sichtbar.has(nummer)}
                  anmelden={seiteAnmelden}
                  onFehler={fehlerMelden}
                />
              );
            })}
          </div>
        )}
      </div>

      {!laden && (
        <div className="pdf-zoom-leiste">
          <button
            type="button"
            className="file-viewer-btn pdf-zoom-btn"
            onClick={() => zoomStufe(-1)}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Verkleinern"
          >
            −
          </button>
          <span className="pdf-zoom-wert" aria-live="polite">{Math.round(zoom * 100)} %</span>
          <button
            type="button"
            className="file-viewer-btn pdf-zoom-btn"
            onClick={() => zoomStufe(1)}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Vergrößern"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
};

export default PdfSeiten;
