// jahrgangsPassung.ts — Passt eine Person zum Jahrgang eines Termins?
//
// Dieselbe Regel wie im Backend (utils/jahrgangsZugriff.js, gehoertZumTermin),
// das den Eintrag sonst mit 403 abweist. Hier, damit die Person in der
// Teilnehmerauswahl (ParticipantManagementModal) gar nicht erst zur Auswahl
// steht:
//   - 'Nur Team'-Termin: alle
//   - Termin ohne Jahrgang: alle
//   - org_admin / super_admin (Rolle oder Flag): immer
//   - Konfi: ihr EINER Jahrgang (jahrgang_id) muss einer des Termins sein
//   - Team und Leitung (admin): EIN gemeinsamer Jahrgang aus jahrgang_ids genuegt

export interface PersonMitJahrgang {
  role_name?: string;
  jahrgang_id?: number;
  jahrgang_ids?: number[];
  is_super_admin?: boolean;
}

export interface TerminMitJahrgang {
  teamer_only?: boolean;
}

export function passtZumTermin(
  person: PersonMitJahrgang,
  termin: TerminMitJahrgang | null,
  terminJahrgangIds: number[]
): boolean {
  if (termin?.teamer_only) return true;
  if (terminJahrgangIds.length === 0) return true;
  if (person.role_name === 'org_admin' || person.role_name === 'super_admin' || person.is_super_admin) return true;
  const terminIds = new Set(terminJahrgangIds.map(Number));
  if (person.role_name === 'konfi') {
    return person.jahrgang_id != null && terminIds.has(Number(person.jahrgang_id));
  }
  return (person.jahrgang_ids || []).some(id => terminIds.has(Number(id)));
}
