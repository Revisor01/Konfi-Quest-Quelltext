// Zellstatus-Logik der Anwesenheitsmatrix (AttendanceMatrixModal).
//
// 'excused' ist der zweite Weg zur Abmeldung: Nicht die Konfi
// selbst hat sich in der App abgemeldet, sondern die Leitung trägt nach, was
// ausserhalb gemeldet wurde ("krank, die Mutter hat angerufen"). Fachlich ist
// das dieselbe Aussage — keine Punkte, kein Fehlen im Sinne von
// unentschuldigt — und die Matrix behandelt es deshalb wie 'opted_out': eigener
// Zellstatus, grauer Punkt, nicht im Pflicht-Nenner.

export type MatrixZellStatus = 'present' | 'absent' | 'excused' | 'opted_out' | 'open';

export interface MatrixBookingLike {
  status: string | null;
  attendance_status: 'present' | 'absent' | 'excused' | null;
}

// Status einer einzelnen Zelle (Konfi x Pflichttermin).
//
// Reihenfolge UMGEDREHT: Der ausdrücklich gesetzte
// Anwesenheits-Status schlägt jetzt die Selbstabmeldung, nicht umgekehrt.
//
// Vorher stand 'opted_out' zuerst, weil es keinen Weg gab, eine
// Selbstabmeldung zu verbuchen — ein attendance_status daneben konnte nur
// versehentlich entstanden sein. Seit die Leitung genau das darf ("hatte sich
// abgemeldet, kam dann doch"), ist es das Gegenteil: Ein gesetzter Status ist
// eine getroffene Entscheidung, die Abmeldung nur die Vorgeschichte. Bliebe
// 'opted_out' vorn, wäre die nachträglich verbuchte Anwesenheit in der Matrix
// unsichtbar — und die Konfi zählte trotz Teilnahme nicht in den
// Pflicht-Nenner.
//
// Die Teilnehmerliste (EventDetailView, renderParticipant) färbt nach
// derselben Reihenfolge. Die beiden müssen zusammenpassen, sonst zeigen
// Liste und Matrix Verschiedenes über dieselbe Person.
//
// Ohne gesetzten Status bleibt alles wie gehabt: Eine Abmeldung ist keine
// offene Verbuchung, sondern eine abgeschlossene Rückmeldung.
export const getZellStatus = (b: MatrixBookingLike | undefined): MatrixZellStatus => {
  if (!b) return 'open';
  if (b.attendance_status === 'present') return 'present';
  if (b.attendance_status === 'absent') return 'absent';
  if (b.attendance_status === 'excused') return 'excused';
  if (b.status === 'opted_out') return 'opted_out';
  return 'open';
};

export interface MatrixZeilenStats {
  present: number;
  absent: number;
  excused: number;
  opted_out: number;
  open: number;
  // Nenner der Summenspalte: Pflichttermine OHNE die abgemeldeten
  // (beide Wege: Selbstabmeldung und von der Leitung nachgetragene)
  nenner: number;
}

// Zusammenfassung einer Konfi-Zeile über alle Pflichttermine.
export const berechneZeilenStats = (zellen: MatrixZellStatus[]): MatrixZeilenStats => {
  const stats: MatrixZeilenStats = { present: 0, absent: 0, excused: 0, opted_out: 0, open: 0, nenner: 0 };
  zellen.forEach(z => { stats[z]++; });
  stats.nenner = zellen.length - stats.opted_out - stats.excused;
  return stats;
};
