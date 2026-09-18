import React from 'react';

/**
 * Die neutrale Abdeckung fuer den App-Umschalter.
 *
 * WOFUER: Die gesperrte App war im
 * App-Umschalter MIT INHALT zu sehen — Namen, Punktestaende und Beitraege
 * lesbar, ohne die Sperre zu ueberwinden. Wer das Geraet in der Hand haelt,
 * kam so an genau die Daten, vor denen die Sperre schuetzen soll.
 *
 * WARUM NICHT EINFACH DER SPERRBILDSCHIRM: Der haengt an `gesperrt`, und das
 * wird erst beim ZURUECKKOMMEN berechnet. iOS macht die Momentaufnahme fuer
 * den Umschalter aber beim WEGWECHSELN — jede Anzeige, die erst bei der
 * Rueckkehr erscheint, kommt grundsaetzlich zu spaet. Diese Abdeckung haengt
 * deshalb an `verdeckt` und kippt im selben Ereignis, das die Aufnahme
 * ausloest (siehe hooks/useAppSperre.ts).
 *
 * WAS SIE ZEIGT UND WAS NICHT: nur Logo und Name. Kein Name der Person, keine
 * Rolle, keine Gemeinde, kein Hinweis auf den Zustand. Dieses Bild sehen auch
 * Unbefugte; es verraet nur, dass es Konfi Quest ist.
 *
 * KEINE BEDIENELEMENTE: Sie ist reiner Sichtschutz und verschwindet von selbst,
 * sobald die App zurueckkommt. Waere hier ein Knopf, muesste er auch im
 * Vorschaubild des Umschalters sinnvoll aussehen — und niemand kann ihn dort
 * antippen. Das Entsperren macht der Sperrbildschirm, der darunter schon steht.
 *
 * aria-hidden: Fuer Screenreader gibt es hier nichts zu holen. Was zu sagen
 * ist, sagt der Sperrbildschirm darunter; eine zweite, stumme Flaeche im
 * Vorlesebaum waere nur Rauschen.
 */
const AppAbdeckung: React.FC = () => (
  <div className="app-abdeckung" aria-hidden="true">
    <img
      src="/assets/icon/logo-mark.png"
      alt=""
      className="app-abdeckung__logo"
      aria-hidden="true"
    />
    <p className="app-abdeckung__name">Konfi Quest</p>
  </div>
);

export default AppAbdeckung;
