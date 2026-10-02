// ---------------------------------------------------------------------------
// pdf.js für den Betrachter der App.
//
// WARUM: Auf Android zeigte keine Stelle der App eine PDF selbst an — beide
// Plugins starten dort nur eine fremde App, und das WebView zeigt PDFs im
// iframe nicht an.
// pdf.js zeichnet die Seiten in <canvas>.
//
// DIE LEGACY-FASSUNG, NICHT DIE MODERNE: Die moderne setzt Map.getOrInsertComputed,
// Math.sumPrecise und Promise.try voraus — das haben erst die neuesten Browser.
// Ein Android-WebView, das ein paar Monate hinter Chrome liegt, oder Safari auf
// einem älteren iPhone (Web-Fassung) schlügen fehl. Die Legacy-Fassung bringt
// dafür die Ersatzfunktionen mit (core-js): bei pdfjs-dist 6.3.289 59.850 B
// mehr im Hauptteil und 51.621 B mehr im Worker.
// ---------------------------------------------------------------------------

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
// Der Worker über Vites ?worker&url, NICHT über ?url:
// ?url legte die Datei unverändert als .mjs ab. nginx kennt die Endung .mjs
// nicht (mime.types führt nur .js) und liefert sie als application/octet-stream
// — ein Modul-Worker mit falschem Typ wird vom Browser verweigert, die PDF
// bliebe in der Web-Fassung leer. ?worker&url bündelt ihn als eigenen Chunk
// mit der Endung .js (Format ES, siehe worker.format in vite.config.ts).
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url';
// Decoder für JPEG-2000- und JBIG2-Bilder. Ohne sie fehlen solche Bilder auf
// der Seite; JBIG2 nutzen manche Kopierer für Schwarz-Weiß-Scans.
import openjpegWasmUrl from 'pdfjs-dist/wasm/openjpeg.wasm?url';
import jbig2WasmUrl from 'pdfjs-dist/wasm/jbig2.wasm?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Die Wasm-Dateien, die pdf.js nachladen darf. Vite hängt an jeden Namen eine
 * Prüfsumme — pdf.js erwartet aber ein Verzeichnis mit festen Namen
 * (`wasmUrl`). Deshalb liefert eine eigene Datenquelle die Dateien aus.
 */
const WASM_DATEIEN: Record<string, string> = {
  'openjpeg.wasm': openjpegWasmUrl,
  'jbig2.wasm': jbig2WasmUrl,
};

/**
 * Datenquelle für pdf.js (Option `BinaryDataFactory`). pdf.js fragt sie im
 * Hauptfaden, wenn `useWorkerFetch` aus ist, und reicht die Bytes an den
 * Worker weiter.
 *
 * Schriften (`standardFontDataUrl`) und Zeichentabellen (`cMapUrl`) liefert
 * sie bewusst nicht: pdf.js nimmt dann Systemschriften, und die Dateien
 * brächten der App 774 KB (Schriften) und 1,2 MB (Zeichentabellen) für
 * seltene Fälle — PDFs ohne eingebettete Schriften oder mit asiatischen
 * Schriftzeichen. Eingebettete Farbprofile (ICC) übergeht pdf.js ohne
 * Worker-Abruf (useWorkerFetch: false) und nimmt den Ersatz-Farbraum der PDF.
 */
export class AppDatenQuelle {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = kind === 'wasmUrl' ? WASM_DATEIEN[filename] : undefined;
    if (!url) throw new Error(`pdf.js: ${kind} ${filename} ist nicht eingebunden`);
    const antwort = await fetch(url);
    if (!antwort.ok) throw new Error(`pdf.js: ${filename} nicht ladbar (${antwort.status})`);
    return new Uint8Array(await antwort.arrayBuffer());
  }
}

/** Öffnet eine PDF aus ihren Bytes. Der Aufrufer räumt mit `destroy()` auf. */
export const pdfOeffnen = (daten: Uint8Array): PDFDocumentLoadingTask =>
  getDocument({
    data: daten,
    BinaryDataFactory: AppDatenQuelle,
    useWorkerFetch: false,
  });
