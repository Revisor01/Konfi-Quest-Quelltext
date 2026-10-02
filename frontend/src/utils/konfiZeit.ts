// Die Events der Konfi-Zeit lesbar machen.
//
// Die Kopie haelt Buchungsstatus und Anwesenheit so fest, wie sie am Tag der
// Befoerderung standen. Daraus wird EIN Wort, das sagt, wie es war -- die
// Anwesenheit geht vor dem Buchungsstatus, denn sie ist das, was verbucht
// wurde. Werte, die es nicht gibt, fallen auf das Neutrale zurueck, statt die
// Liste zu kippen.
import type { KonfiZeit, KonfiZeitTermin } from '../types/konfiZeit';

export function konfiZeitTerminStatus(termin: Pick<KonfiZeitTermin, 'status' | 'anwesenheit' | 'abgesagt'>): string {
  if (termin.anwesenheit === 'present') return 'Dabei';
  if (termin.anwesenheit === 'absent') return 'Nicht da';
  if (termin.anwesenheit === 'excused' || termin.status === 'excused' || termin.status === 'opted_out') return 'Abgemeldet';
  if (termin.abgesagt) return 'Abgesagt';
  if (termin.status === 'waitlist') return 'Warteliste';
  if (termin.status === 'confirmed') return 'Angemeldet';
  if (!termin.status) return 'Punkte erhalten';
  return 'Angemeldet';
}

/** Ist das eine brauchbare Kopie? Schuetzt die Ansicht vor halben Antworten. */
export function alsKonfiZeit(wert: unknown): KonfiZeit | null {
  if (!wert || typeof wert !== 'object') return null;
  const kopie = (wert as { konfi_zeit?: unknown }).konfi_zeit;
  if (!kopie || typeof kopie !== 'object') return null;
  const termine = (kopie as { termine?: unknown }).termine;
  if (!Array.isArray(termine)) return null;
  return kopie as KonfiZeit;
}
