// Die dauerhafte Kopie der Konfi-Zeit einer befoerderten Person.
//
// Liefert GET /teamer/konfi-zeit (eigene) bzw. GET /teamer/:userId/konfi-zeit
// (Detailansicht der Leitung) als { konfi_zeit: KonfiZeit | null }. Aufbau
// siehe backend/utils/konfiHistorie.js. Alles ausser den Termine ist optional
// typisiert gelesen: Die Kopie traegt eine Version, spaetere Fassungen
// duerfen Felder dazubekommen.

export interface KonfiZeitTermin {
  event_id: number;
  name: string;
  datum: string;
  ort?: string | null;
  abgesagt?: boolean;
  /** Buchungsstatus zur Zeit der Kopie; null = keine Buchung, nur Punkte. */
  status?: string | null;
  /** 'present' | 'absent' | 'excused' | null */
  anwesenheit?: string | null;
  punkte?: number;
  punktart?: string | null;
}

export interface KonfiZeit {
  version?: number;
  jahrgang_name: string | null;
  anlass: 'befoerderung' | 'jahrgang_geloescht' | 'abzeichen_geloescht' | 'abzeichen_geaendert';
  erstellt_am: string | null;
  punkte?: { gottesdienst: number; gemeinde: number; gesamt: number };
  termine: KonfiZeitTermin[];
}

export interface KonfiZeitAntwort {
  konfi_zeit: KonfiZeit | null;
}
