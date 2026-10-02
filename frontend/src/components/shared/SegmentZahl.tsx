import React from 'react';

/**
 * ORANGE wie das Eck-Badge "n Uhr" an der Challenge, nicht rot: Rot bleibt
 * die Summe an Reiter und App-Symbol und die Kugel am Listeneintrag. Die
 * Farbe steht in EINEM Token (--app-segment-zahl-farbe, variables.css) --
 * ein Wechsel auf Rot ist eine Zeile.
 *
 * Im Textfluss statt absolut ueber dem Rand: Ionic-Segmente schneiden
 * ueberstehende Kinder ab, im iOS-Glas-Look wie in Android-MD3.
 *
 * Ab 10 steht "9+", wie an den Reitern. Bei 0 nichts. Vorleseprogramme
 * hoeren den ganzen Satz (role="img" + aria-label).
 */
interface SegmentZahlProps {
  anzahl: number;
  /** Was wartet, ohne Zahl: "warten auf dich". */
  label?: string;
}

const SegmentZahl: React.FC<SegmentZahlProps> = ({ anzahl, label = 'warten auf dich' }) => {
  if (!(anzahl > 0)) return null;
  return (
    <span className="app-segment-zahl" role="img" aria-label={`${anzahl} ${label}`}>
      {anzahl > 9 ? '9+' : anzahl}
    </span>
  );
};

export default SegmentZahl;
