/**
 * Positivliste der Fehlertexte fuer die anonyme Fehlermessung.
 *
 * Die Messung (`setError` in AppContext -> `trackFehler`) uebertraegt den
 * Wortlaut einer Fehlermeldung NUR, wenn er hier steht — entschaerft wie
 * bisher (Ziffernfolgen zu `#`, hoechstens 80 Zeichen). Jeder andere Text wird
 * ersetzt: durch den Ersatztext der Aufrufstelle, wenn er aus
 * `fehlerText(err, 'Ersatz')` kam, sonst durch `andere-meldung`
 * (`fehlerStelle` in services/analytics.ts).
 *
 * WAS HIER STEHT:
 *   1. BEKANNTE_FEHLERTEXTE — jeder feste Text, den die App selbst an eine
 *      Fehleranzeige gibt: erstes Argument von `setError(…)`, Ersatztext von
 *      `fehlerText`/`fehlerTextOderMessage`, `onError(…)` im Chat — als
 *      Literal, als Zweig von `?:`/`||`, als lokale oder als Konstante in
 *      Grossbuchstaben. Texte mit `${…}` oder `+` gehoeren NICHT hierher: Sie
 *      setzen etwas ein, und das kann ein Name sein.
 *   2. ZUGELASSENE_SERVERTEXTE — eine kleine Auswahl von Server-Texten, die
 *      im Backend woertlich und ohne Platzhalter stehen.
 *
 * PFLEGE: Der Test bekannteFehlertexte.test.ts liest den Quelltext und
 * schlaegt fehl, wenn ein fester Fehlertext hier fehlt ODER ein Eintrag im
 * Code nicht mehr vorkommt; er nennt jeweils Text und Fundstelle. Ein neuer
 * Text wird also im selben Commit hier eingetragen — alphabetisch, damit
 * Dubletten auffallen. Fehlt er, passiert nichts Schlimmes: Er kommt als
 * `andere-meldung` an, nie im Wortlaut.
 */

export const BEKANNTE_FEHLERTEXTE: readonly string[] = [
  'Aktivität konnte nicht gespeichert werden',
  'Aktivität nicht gefunden',
  'Alle Felder der Gemeindeleitung sind erforderlich',
  'Alle Felder sind erforderlich',
  'Anmeldung fehlgeschlagen',
  'Anzeigename und Rolle sind erforderlich',
  'Aufnahme konnte nicht gestartet werden',
  'Benutzername darf nur Buchstaben, Zahlen, Punkt (.) und Bindestrich (-) enthalten — keine Leerzeichen oder Umlaute',
  'Benutzername ist erforderlich',
  'Benutzername muss mindestens 3 Zeichen lang sein',
  'Bitte einen Jahrgang wählen',
  'Bitte einen Titel eingeben',
  'Bitte gib dein aktuelles Passwort ein',
  'Bitte gib deine E-Mail-Adresse ein',
  'Bitte gib deinen Namen ein',
  'Bitte gib dem Event einen Namen',
  'Bitte gib eine Frage ein',
  'Bitte gib eine gültige E-Mail-Adresse ein',
  'Bitte gib einen Grund für die Ablehnung an',
  'Bitte gib einen Grund für die Abmeldung an',
  'Bitte gib einen Grund für die Abmeldung an (mind. 5 Zeichen)',
  'Bitte gib einen Gruppennamen ein',
  'Bitte gib einen Link an',
  'Bitte gib mindestens 2 Antwortmöglichkeiten ein',
  'Bitte lege Datum und Uhrzeit fest',
  'Bitte schreib etwas, bevor du einreichst',
  'Bitte wähle eine Aktivität aus',
  'Bitte wähle eine Datei aus',
  'Bitte wähle einen Jahrgang aus',
  'Bitte wähle einen Zeitslot aus',
  'Bitte wähle einen Zertifikat-Typ aus',
  'Bitte wähle mindestens eine:n Teilnehmer:in aus',
  'Bonus-Punkte konnten nicht gespeichert werden',
  'Das geht nur mit Internetverbindung. Bitte versuche es später noch einmal.',
  'Das Ende liegt vor dem Beginn',
  'Das Konfi-Limit muss eine Zahl ab 0 oder leer sein',
  'Das Material ist gespeichert, die Dateien noch nicht. Tippe noch einmal auf Speichern.',
  'Das neue Passwort erfüllt nicht alle Anforderungen',
  'Das Passwort darf keine Leerzeichen enthalten',
  'Das Passwort erfüllt nicht alle Anforderungen',
  'Das Passwort muss ein Sonderzeichen enthalten',
  'Das Passwort muss eine Zahl enthalten',
  'Das Passwort muss einen Großbuchstaben enthalten',
  'Das Passwort muss einen Kleinbuchstaben enthalten',
  'Das Passwort muss mindestens 8 Zeichen lang sein',
  'Das Team konnte nicht geladen werden',
  'Datei konnte nicht ausgewählt werden',
  'Dein Wrapped wird bald freigeschaltet',
  'Der Jahrgang enthält Chat-Nachrichten.',
  'Der Konfispruch konnte nicht gespeichert werden',
  'Der Link konnte nicht geöffnet werden',
  'Der Link muss mit http:// oder https:// beginnen',
  'Die Datei ist zu groß.',
  'Die Einladung konnte nicht beantwortet werden',
  'Die Einladung konnte nicht gesendet werden',
  'Die Einladung konnte nicht zurückgezogen werden',
  'Die Kennzahlen konnten nicht geladen werden.',
  'Die Nachricht wurde nicht angenommen.',
  'Die neuen Passwörter stimmen nicht überein',
  'Die Passwörter stimmen nicht überein',
  'Die Zeitfenster konnten nicht geladen werden — die Kopie hat keine.',
  'Diese Aktion ist offline nicht möglich',
  'Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.',
  'Diese Einladung ist nicht mehr offen. Sie wurde inzwischen beantwortet oder zurückgezogen.',
  'Diese Nachricht lässt sich nicht mehr senden. Bitte neu schreiben.',
  'Diese Option ist bereits vergeben',
  'Diese Person wurde noch nicht geladen — dafür brauchst du eine Verbindung.',
  'Dieser Dateityp kann nicht gesendet werden.',
  'Dieser Einladungscode existiert nicht. Bitte prüfe deine Eingabe.',
  'Dieser Einladungscode ist abgelaufen. Bitte frage deinen Konfi-Leiter nach einem neuen Code.',
  'Dieser Link ist abgelaufen oder ungültig. Bitte fordere einen neuen an.',
  'Dieser Zeitslot ist ausgebucht und hat keine Warteliste.',
  'Dieses Event wurde noch nicht geladen — dafür brauchst du eine Verbindung.',
  'E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.',
  'Ein Konfi mit diesem Namen existiert bereits.',
  'Eine ungesendete Chat-Nachricht konnte vor dem Wechsel nicht mehr zugestellt werden',
  'Einreichen nicht möglich — du bist offline',
  'Einstellung konnte nicht gespeichert werden',
  'Einstellungen konnten nicht geladen werden',
  'Erst die Anwesenheit setzen, dann die Notiz eintragen',
  'Es gibt noch keine Texte oder Links zum Exportieren.',
  'Export fehlgeschlagen',
  'Fehler bei der Abmeldung',
  'Fehler bei der Anmeldung',
  'Fehler bei der Code-Validierung',
  'Fehler bei der Moderation',
  'Fehler bei der Prüfung des Badges',
  'Fehler bei der Registrierung',
  'Fehler bei der Wiederanmeldung',
  'Fehler beim Absagen des Events',
  'Fehler beim Abspielen des Videos',
  'Fehler beim Abstimmen',
  'Fehler beim Aktualisieren',
  'Fehler beim Aktualisieren der Anwesenheit',
  'Fehler beim Aktualisieren der E-Mail-Adresse',
  'Fehler beim Aktualisieren der Funktionsbeschreibung',
  'Fehler beim Ändern der Bibelübersetzung',
  'Fehler beim Ändern des Passworts',
  'Fehler beim Befördern',
  'Fehler beim Bestätigen des Teilnehmers',
  'Fehler beim Einreichen',
  'Fehler beim Einreichen der Aktivität',
  'Fehler beim Entfernen',
  'Fehler beim Entfernen aus der Gemeinde',
  'Fehler beim Entfernen des Mitglieds',
  'Fehler beim Entfernen des Teilnehmers',
  'Fehler beim Erstellen der Direktnachricht',
  'Fehler beim Erstellen der Umfrage',
  'Fehler beim Erstellen des Chats',
  'Fehler beim Generieren des Codes',
  'Fehler beim Hinzufügen der Gemeindeleitung',
  'Fehler beim Hinzufügen der Mitglieder',
  'Fehler beim Hinzufügen der Teilnehmer:innen',
  'Fehler beim Hinzufügen des Konfis',
  'Fehler beim Hochladen des Fotos',
  'Fehler beim Initialisieren des Modals',
  'Fehler beim Kopieren',
  'Fehler beim Laden',
  'Fehler beim Laden der Aktivität',
  'Fehler beim Laden der Anwesenheit',
  'Fehler beim Laden der Badge-Daten',
  'Fehler beim Laden der Beiträge',
  'Fehler beim Laden der Benutzer',
  'Fehler beim Laden der Challenge',
  'Fehler beim Laden der Daten',
  'Fehler beim Laden der Event-Daten',
  'Fehler beim Laden der Gemeinde',
  'Fehler beim Laden der Konfi-Daten',
  'Fehler beim Laden der Konfisprüche',
  'Fehler beim Laden der Mitglieder',
  'Fehler beim Laden der Nachrichten',
  'Fehler beim Laden der Personen',
  'Fehler beim Laden des Badges',
  'Fehler beim Laden des Benutzers',
  'Fehler beim Laden des Bildes',
  'Fehler beim Laden des Materials',
  'Fehler beim Laden des Videos',
  'Fehler beim Leeren des Chats',
  'Fehler beim Löschen',
  'Fehler beim Löschen der Aktivität',
  'Fehler beim Löschen der Bonuspunkte',
  'Fehler beim Löschen der Challenge',
  'Fehler beim Löschen der Datei',
  'Fehler beim Löschen der Gemeinde',
  'Fehler beim Löschen der Kategorie',
  'Fehler beim Löschen der Nachricht',
  'Fehler beim Löschen des Accounts',
  'Fehler beim Löschen des Badges',
  'Fehler beim Löschen des Beitrags',
  'Fehler beim Löschen des Benutzers',
  'Fehler beim Löschen des Events',
  'Fehler beim Löschen des Fotos',
  'Fehler beim Löschen des Jahrgangs',
  'Fehler beim Löschen des Levels',
  'Fehler beim Öffnen der Datei',
  'Fehler beim Reagieren',
  'Fehler beim Senden der E-Mail',
  'Fehler beim Speichern',
  'Fehler beim Speichern der Aktivität',
  'Fehler beim Speichern der Challenge',
  'Fehler beim Speichern der Kategorie',
  'Fehler beim Speichern der Reihenfolge',
  'Fehler beim Speichern des Absagegrundes',
  'Fehler beim Speichern des Badges',
  'Fehler beim Speichern des Benutzers',
  'Fehler beim Speichern des Events',
  'Fehler beim Speichern des Jahrgangs',
  'Fehler beim Teilen',
  'Fehler beim Verbuchen der Teilnahmen',
  'Fehler beim Verlängern des Codes',
  'Fehler beim Verlassen des Chats',
  'Fehler beim Verschieben auf Warteliste',
  'Fehler beim Zurücknehmen der Absage',
  'Fehler beim Zurücksetzen der Aktivität',
  'Fehler beim Zurücksetzen des Passworts',
  'Fehler beim Zuweisen',
  'Foto konnte nicht ausgewählt werden',
  'Foto konnte nicht lokal gespeichert werden',
  'Foto konnte nicht verarbeitet werden',
  'Für diesen Jahrgang ist keine Punkteart aktiv.',
  'Gemeinde konnte nicht gewechselt werden',
  'Keine Daten verfügbar (offline)',
  'Keine verfügbaren Zertifikat-Typen mehr',
  'Löschen fehlgeschlagen',
  'Löschen nicht möglich — du bist offline',
  'Mitglied konnte nicht entfernt werden',
  'Mitglied konnte nicht hinzugefügt werden',
  'Name der Gemeinde ist erforderlich',
  'Name ist erforderlich',
  'Nur die Leitung darf Chats exportieren',
  'Nur für Super-Admins.',
  'Nur wartende Aktivitäten können gelöscht werden',
  'Passwort erfüllt nicht alle Anforderungen',
  'Passwort ist für neue Benutzer erforderlich',
  'Passwörter stimmen nicht überein',
  'Pflicht-Events brauchen mindestens einen Jahrgang',
  'Push Notifications konnten nicht aktiviert werden',
  'QR-Code konnte nicht generiert werden',
  'QR-Code konnte nicht verarbeitet werden',
  'Rückblick konnte nicht erstellt werden',
  'Rückblicke konnten nicht geladen werden',
  'Übersetzung konnte nicht gespeichert werden',
  'Unbekannter Fehler',
  'Ungültige E-Mail-Adresse',
  'Ungültiger Reset-Link',
  'Ungültiger Reset-Link. Bitte fordere einen neuen an.',
  'Verbindung fehlgeschlagen. Bitte prüfe deine Internetverbindung.',
  'Video kann nicht abgespielt werden',
  'Video konnte nicht ausgewählt werden',
  'Zugriff aufs Mikrofon wurde nicht erlaubt.',
];

/**
 * Server-Texte, die im Wortlaut gemessen werden duerfen.
 *
 * WARUM UEBERHAUPT: Wo der Server einen Text schickt, meldet die Messung
 * sonst den Ersatztext der Aufrufstelle („Fehler bei der Anmeldung") und die
 * Art (`http-400`). Das beantwortet das WO. Bei der Anmeldung zu einem Event
 * und der Abmeldung davon reicht es fuer das WARUM nicht: Hinter `http-400`
 * stehen dort ein Dutzend Gruende — noch nicht geoeffnet, geschlossen,
 * ausgebucht, abgesagt, Zeitslot fehlt, Frist vorbei … Genau das ist die
 * Frage, die eine Gemeinde stellt, wenn Konfis sich nicht anmelden koennen.
 *
 * WARUM NUR DIESE: Alle stehen WOERTLICH als eigenes Literal in
 * backend/utils/bookingUtils.js (der Test prueft das), ohne `${…}` und ohne
 * Verkettung — der Buchungskern fuer Konfis und Team (`bucheTermin`,
 * `setzeTeamerZusage`, `validateRegistrationWindow`,
 * `determineBookingStatus`, `pruefeKonfiStorno`). Der Vergleich ist exakt:
 * Der Text mit dem Namen des Konfirmationstermins („Du bist bereits zu einem
 * Konfirmationstermin angemeldet ("…")") steht NICHT hier und kann nicht
 * durchrutschen, auch nicht als Anfang eines laengeren Textes.
 *
 * Aendert das Backend einen dieser Texte, schlaegt der Test fehl; die App im
 * Store meldet den neuen Text bis zu ihrem naechsten Update als Ersatztext —
 * nie im Wortlaut.
 */
export const ZUGELASSENE_SERVERTEXTE: readonly string[] = [
  // Anmelden (bucheTermin, validateRegistrationWindow, determineBookingStatus)
  'Dieses Event ist abgesagt',
  'Du bist bereits für dieses Event angemeldet',
  'Dieses Event ist nicht für das Team buchbar',
  'Dieses Event gehört zu einem Jahrgang, dem du nicht zugewiesen bist',
  'Dieses Event gehört zu einem anderen Jahrgang',
  'Dieses Event ist nur für das Team',
  'Anmeldung noch nicht geöffnet',
  'Anmeldung bereits geschlossen',
  'Bitte einen Zeitslot auswählen',
  'Ungültiger Zeitslot',
  'Dieses Event hat keine Zeitslots',
  'Das Event ist leider bereits ausgebucht',
  'Event ist voll und Warteliste ist auch voll',
  // Zusage des Teams (setzeTeamerZusage)
  'Für dieses Event wird kein Team gesucht',
  'Das Event liegt bereits in der Vergangenheit',
  'Du hattest zugesagt — bitte gib einen Grund für deine Absage an, damit die Leitung umplanen kann',
  // Abmelden (pruefeKonfiStorno)
  'Die Anwesenheit ist bereits verbucht — Änderungen macht die Leitung',
  'Pflicht-Events können nur über Opt-out abgemeldet werden',
  'Abmeldung ist nur bis 2 Tage vor dem Event möglich',
];
