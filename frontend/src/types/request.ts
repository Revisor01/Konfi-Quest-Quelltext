// Zentrale Typen fuer das Melden von Aktivitaeten (Antraege).

/**
 * Rumpf von POST /konfi/requests bzw. POST /teamer/requests.
 *
 * Genau die Felder, die das Backend liest (konfi.js: activity_id,
 * description, photo_filename, requested_date, client_id). Der Rumpf geht
 * online direkt an die API und offline unveraendert in die Warteschlange —
 * beide Wege muessen dieselbe Form haben.
 */
export interface AktivitaetMelden {
  activity_id: number;
  description: string;
  requested_date: string;
  /** Dateiname des zuvor hochgeladenen Fotos; null, wenn keines dabei ist. */
  photo_filename?: string | null;
  /** Idempotenzschluessel — verhindert Doppelversand nach Wiederholung. */
  client_id: string;
}
