//   "teamer erstellen keine veranstaltungen fertig. das machen admins und org
//    admins. das ist einfach nicht der weg. ich halte das fuer zu komplex.
//    lass es uns rausnehmen. also auch nicht loeschen und absagen"
//
// Die verbindliche Pruefung macht der Server (routes/events/index.js:
// requireAdmin auf Anlegen, Aendern, Loeschen, Absagen, Serien, Teilnehmer,
// Anwesenheit) -- diese Funktion spiegelt sie fuer die Oberflaeche.
//
// WARUM ES DIESE DATEI GIBT: Der Kopfkommentar der Serien-Route verlangt
// ausdruecklich "Gesperrt wird in BEIDEN Ebenen: Oberflaeche und Backend".
// Die Oberflaeche zaehlte aber weiter 'teamer' mit -- Teamer:innen sahen also
// Anlegen, Absagen und Loeschen und kassierten beim Antippen einen 403.
// Ein Knopf, der nur fehlschlagen kann, ist schlimmer als kein Knopf.
//
// Lesen, die eigene Zu- und Absage sowie QR-Check-in bleiben davon unberuehrt
// -- die haengen an requireTeamer bzw. stehen allen Angemeldeten offen.

export interface TerminRechteUser {
  role_name?: string;
}

/** Rollen, die das Backend fuer Terminverwaltung durchlaesst (requireAdmin). */
const LEITUNGSROLLEN = ['org_admin', 'admin'];

export const darfTermineVerwalten = (
  user: TerminRechteUser | null | undefined
): boolean => LEITUNGSROLLEN.includes(user?.role_name || '');
