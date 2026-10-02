import React from 'react';

/**
 * Rote Zaehler-Kugel oben rechts an einem Listen-Symbol -- fuer Eintraege,
 * die Neues tragen: ein Chat-Raum mit ungelesenen Nachrichten, eine
 * Challenge mit Neuigkeiten. Sie steht als Geschwister des Symbolkreises
 * in einem `.app-zaehler-anker` (position: relative, so breit wie der
 * Kreis); alles Weitere -- Lage, Groesse, Rand -- regelt das Stylesheet
 * (variables.css, Abschnitt "Rote Zaehler-Kugel am Listen-Symbol").
 *
 * Ab 10 steht "9+", genau wie an den Reitern in MainTabs. Bei 0 wird nichts
 * gerendert.
 */
interface ZaehlerKugelProps {
  anzahl: number;
  /** Was gezaehlt wird, fuer Vorleseprogramme: "ungelesene Nachrichten". */
  label: string;
}

const ZaehlerKugel: React.FC<ZaehlerKugelProps> = ({ anzahl, label }) => {
  if (!(anzahl > 0)) return null;
  return (
    <span className="app-zaehler-kugel" aria-label={`${anzahl} ${label}`}>
      {anzahl > 9 ? '9+' : anzahl}
    </span>
  );
};

export default ZaehlerKugel;
