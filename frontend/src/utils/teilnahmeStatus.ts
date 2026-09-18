// Wie sieht EINE Zeile der Teilnehmerliste aus?
//
// Deshalb steht die Rechnung jetzt einmal hier. Die beiden Listen
// unterscheiden sich weiterhin darin, WELCHE Zeilen sie zeigen (die
// Zeitfenster-Liste filtert auf status === 'confirmed' pro Slot), aber nicht
// mehr darin, wie eine gezeigte Zeile heisst und welche Farbe sie hat.
//
// DIE REIHENFOLGE IST DIESELBE WIE IN utils/anwesenheitsMatrix.ts
// (getZellStatus) und war vorher schon in EventDetailView.tsx begruendet:
// Sobald ein Anwesenheits-Status gesetzt ist, zaehlt dieser und nicht mehr
// die Selbstabmeldung. Wer sich abgemeldet hatte und dann doch kam, steht als
// anwesend da -- sonst bliebe die Zeile rot und "Abgemeldet", obwohl die
// Leitung genau das gerade korrigiert hat.

export interface TeilnahmeAngabe {
  status?: string;
  attendance_status?: string | null;
}

export type TeilnahmeStatusText =
  | 'Abgemeldet'
  | 'Abgemeldet (nachgetragen)'
  | 'Anwesend'
  | 'Abwesend'
  | 'Warteliste'
  | 'Gebucht';

export interface TeilnahmeDarstellung {
  /** Der Text, der im Badge und als title steht. */
  statusText: TeilnahmeStatusText;
  /** Suffix fuer app-list-item--, app-icon-circle-- und app-corner-badge--. */
  farbe: 'danger' | 'neutral' | 'success' | 'warning' | 'info';
  /** Selbstabmeldung, noch nicht von der Leitung verbucht. */
  istAbgemeldet: boolean;
  /** Von der Leitung nachgetragene Abmeldung. */
  istNachgetragen: boolean;
}

/**
 * Selbstabmeldung, die noch nicht verbucht wurde.
 *
 * ZWEI WELTEN, BEIDE ABGEDECKT: Bis hierher hiess eine
 * Selbstabmeldung ausschliesslich status = 'opted_out'. Seit die Abmeldung
 * zusaetzlich status = 'excused' setzen kann, muessen beide Schreibweisen
 * dasselbe bedeuten -- sonst zeigt dieselbe Abmeldung je nach Entstehungszeit
 * einen anderen Zustand, und die Kachel "Abgemeldet" zaehlt die Haelfte.
 */
export const istSelbstAbgemeldet = (p: TeilnahmeAngabe): boolean =>
  (p.status === 'opted_out' || p.status === 'excused') && !p.attendance_status;

/**
 * Zaehlt eine Person als abgemeldet? Die Frage der Kachel "Abgemeldet"
 * (admin/views/EventDetailView.tsx).
 *
 * Drei Wege fuehren jetzt zu derselben Antwort:
 *   - attendance_status === 'excused'  (nachgetragen ODER nach Terminabsage)
 *   - status === 'excused'             (die neue Schreibweise der Abmeldung)
 *   - status === 'opted_out'           (die Selbstabmeldung wie bisher)
 * Anwesend oder abwesend Verbuchte fallen heraus: Wer da war, ist nicht
 * abgemeldet, auch wenn er sich vorher abgemeldet hatte.
 */
export const zaehltAlsAbgemeldet = (p: TeilnahmeAngabe): boolean => {
  if (p.attendance_status === 'present' || p.attendance_status === 'absent') return false;
  return p.attendance_status === 'excused'
    || p.status === 'excused'
    || p.status === 'opted_out';
};

/**
 * Text und Farbe einer Zeile. EINE Quelle fuer beide Teilnehmerlisten.
 */
export const teilnahmeDarstellung = (p: TeilnahmeAngabe): TeilnahmeDarstellung => {
  const istAbgemeldet = istSelbstAbgemeldet(p);
  // Nachgetragene Abmeldung: grau, nicht rot. Rot hiesse "hat
  // gefehlt" -- hier war die Abmeldung gemeldet, das ist keine Verfehlung,
  // sondern eine geklaerte Lage.
  const istNachgetragen = !istAbgemeldet && p.attendance_status === 'excused';

  if (istAbgemeldet) {
    return { statusText: 'Abgemeldet', farbe: 'danger', istAbgemeldet: true, istNachgetragen: false };
  }
  if (istNachgetragen) {
    return { statusText: 'Abgemeldet (nachgetragen)', farbe: 'neutral', istAbgemeldet: false, istNachgetragen: true };
  }
  if (p.attendance_status === 'present') {
    return { statusText: 'Anwesend', farbe: 'success', istAbgemeldet: false, istNachgetragen: false };
  }
  if (p.attendance_status === 'absent') {
    return { statusText: 'Abwesend', farbe: 'danger', istAbgemeldet: false, istNachgetragen: false };
  }
  if (p.status === 'waitlist') {
    return { statusText: 'Warteliste', farbe: 'warning', istAbgemeldet: false, istNachgetragen: false };
  }
  // 'info' und nicht 'booked': Die Zeitfenster-Liste nahm bisher
  // app-list-item--booked, die Hauptliste app-list-item--info. Beide zeigen
  // laut variables.css dieselbe Farbe (--app-color-info), aber nur --info
  // hat die Regel fuer den ausgewaehlten Zustand. Eine Klasse weniger, kein
  // sichtbarer Unterschied.
  return { statusText: 'Gebucht', farbe: 'info', istAbgemeldet: false, istNachgetragen: false };
};

// Die drei Klassennamen. Alle drei aus derselben Farbe, damit Rand, Kreis
// und Eck-Badge einer Zeile nie auseinanderlaufen koennen.
export const listItemKlasse = (d: TeilnahmeDarstellung): string =>
  `app-list-item--${d.farbe}`;

export const iconKreisKlasse = (d: TeilnahmeDarstellung): string =>
  `app-icon-circle--${d.farbe}`;

export const eckBadgeKlasse = (d: TeilnahmeDarstellung): string =>
  `app-corner-badge--${d.farbe}`;
