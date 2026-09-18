-- 153_abmeldung_im_buchungsstatus.sql
--
-- EINE ABMELDUNG STAND BISHER NUR IM ANWESENHEITS-STATUS -- UND DIE HALBE
-- ANWENDUNG HAT SIE DESHALB NICHT GESEHEN.
--
--   * Erinnerungen ("Morgen: Konfistunde!") gehen an status = 'confirmed'
--     -- die abgemeldete Person bekam sie weiter.
--   * Die Kapazitaet zaehlt status = 'confirmed' als belegten Platz
--     -- ein frei gewordener Platz blieb besetzt.
--   * Die Warteliste rueckt nach, wenn ein bestaetigter Platz frei wird
--     -- er wurde nie frei, also rueckte niemand nach.
--   * Die Teilnehmerliste sortiert nach status ('confirmed' zuerst)
--     -- die abgemeldete Person stand ganz oben zwischen den Anwesenden.
--
-- Drei Symptome, eine Ursache. Die Abmeldung war eine Aussage ueber die
-- ANWESENHEIT, obwohl sie in Wahrheit die BUCHUNG betrifft: Wer abgemeldet
-- ist, nimmt nicht teil. Genau das sagt 'opted_out' schon fuer die
-- Selbstabmeldung -- es fehlte das Gegenstueck fuer die Abmeldung DURCH die
-- Leitung.
--
-- ===================================================================
-- A) DER CONSTRAINT BEKOMMT 'excused'
-- ===================================================================
--
-- Bisher (Prod-Stand):
--   CHECK (status = ANY (ARRAY['confirmed','waitlist','cancelled','opted_out','pending']))
-- Ein Schreibversuch mit 'excused' scheitert daran.
--
-- DIE TOTEN WERTE 'pending' UND 'cancelled' BLEIBEN DRIN -- entgegen dem
-- ersten Impuls, beim Anfassen gleich aufzuraeumen. Nachgemessen auf
-- Produktion: beide haben NULL Datensaetze, ueber alle fuenf
-- Organisationen und 938 Buchungen. Sie zu entfernen waere also gefahrlos
-- fuer die DATEN -- aber nicht fuer den CODE:
--
--   routes/wrapped.js liest `eb.status = 'cancelled'` und zaehlt daraus
--   "so viele Termine wurden dir abgesagt" fuer den Jahresrueckblick. Die
--   Abfrage steht da, die Tests stellen den Stand her und pruefen ihn
--   (tests/routes/wrapped.test.js). Ein enger Constraint wuerde genau diese
--   Tests beim Herstellen des Standes abweisen -- und im Betrieb einen
--   Schreibweg verbieten, den zwar heute niemand geht, der aber gelesen wird.
--
-- Einen Wert aus einem CHECK zu streichen ist ausserdem nicht additiv: Es ist
-- eine VERSCHAERFUNG gegen ausgelieferte App-Fassungen. Sie schreiben den
-- Status zwar nicht direkt, aber die Regel gilt trotzdem -- eine Verschaerfung
-- braucht einen Grund, und "sieht sauberer aus" ist keiner. Der Gewinn waere
-- null Zeilen weniger Unordnung, der Einsatz ein Schreibweg, den eine Route
-- noch kennt. Aufraeumen kann, wer wrapped.js mit aufraeumt; hier gehoert es
-- nicht dazu.
--
-- ===================================================================
-- B) abgemeldet_durch_absage: WOHER DIE ABMELDUNG KAM
-- ===================================================================
--
-- Eine Abmeldung kann aus zwei ganz verschiedenen Vorgaengen stammen:
--
--   (1) EINZELENTSCHEIDUNG -- die Leitung meldet EINE Person ab, weil die
--       Mutter angerufen hat. Betrifft nur diese Person.
--   (2) TERMINABSAGE -- der Termin faellt aus, und deshalb sind ALLE
--       abgemeldet. Betrifft niemanden persoenlich.
--
-- Im Feld sieht beides identisch aus: status = 'excused'. Solange eine Absage
-- endgueltig ist, faellt das nicht auf. Sobald eine Absage aber
-- ZURUECKGENOMMEN werden kann -- der Termin findet doch statt --, wird die
-- Unterscheidung zwingend.
--
-- Ohne diese Spalte gaebe es beim Zuruecknehmen nur zwei gleich falsche Wege:
-- entweder ALLE zurueck auf 'confirmed' -- dann steht die krank gemeldete
-- Konfi ploetzlich wieder angemeldet da, ihre Abmeldung ist verschwunden --,
-- oder NIEMAND zurueck -- dann hat das Zuruecknehmen keine Wirkung. Das
-- Kennzeichen trennt die beiden Gruppen, und nur die Absage-Gruppe wird
-- aufgehoben.
--
-- BOOLEAN NOT NULL DEFAULT FALSE, nicht nullable: Hier gibt es kein
-- "unbekannt" (anders als bei attendance_set_by, Migration 148). Eine
-- Buchung stammt aus einer Terminabsage oder nicht; der Bestand, den die
-- Datenmigration unten nicht als Absage erkennt, ist eine Einzelentscheidung.
-- FALSE ist damit eine Aussage und keine Vermutung.
--
-- WARUM NICHT AN EINEM VERGLEICH DES GRUNDES ERKENNEN: Die Absage traegt den
-- Absagegrund als excuse_reason ein (bookingUtils.meldeAlleAbBeiAbsage), ohne
-- Grund den festen Text 'Termin abgesagt'. Daraus zurueckzuschliessen hiesse,
-- eine Abmeldung an ihrem Freitext zu erkennen -- eine Leitung, die von Hand
-- "Termin abgesagt" eintippt, waere nicht mehr zu unterscheiden, und ein
-- geaenderter Grund loeschte die Herkunft. Herkunft ist eine eigene Angabe.
--
-- WARUM NICHT events.cancelled BEFRAGEN: Ein Termin kann abgesagt, wieder
-- aufgenommen und erneut abgesagt werden. Die Frage lautet nicht "ist dieser
-- Termin abgesagt", sondern "wurde DIESE Buchung durch eine Absage
-- abgemeldet". Das ist eine Eigenschaft der Buchung.
--
-- ===================================================================
-- C) DER BESTAND WIRD MITGEZOGEN
-- ===================================================================
--
-- Nachgemessen auf Produktion: 6 Buchungen mit
-- attendance_status = 'excused', 4 abgesagte Termine, 938 Buchungen gesamt.
-- Der Bestand ist winzig und darf deshalb mitwandern -- er soll sich
-- verhalten wie alles, was ab jetzt entsteht. Bliebe er zurueck, gaebe es
-- dauerhaft zwei Sorten Abmeldung: sechs, bei denen die Erinnerung weiter
-- rausgeht und der Platz belegt bleibt, und alle uebrigen.
--
-- IDEMPOTENT, und zwar an der Auswahl statt an einem Merker: Beide UPDATEs
-- treffen beim zweiten Lauf null Zeilen, weil sie nur greifen, wo der Stand
-- noch NICHT hergestellt ist (status <> 'excused' bzw.
-- abgemeldet_durch_absage = FALSE bei bereits gesetztem status). Ein
-- Wiederholungslauf ist damit nicht nur unschaedlich, er tut buchstaeblich
-- nichts.
--
-- NUR WO attendance_status = 'excused' STEHT: Der Bestand wird nicht
-- interpretiert, sondern uebersetzt. Eine Buchung ohne Abmeldevermerk bleibt
-- unberuehrt -- auch an einem abgesagten Termin, wo sie vielleicht auf
-- 'present' steht, weil jemand doch da war und geholfen hat.
--
-- WARUM DER STATUS UND NICHT NUR DER ANWESENHEITS-STATUS FUEHRT: Die beiden
-- bleiben bewusst nebeneinander stehen. attendance_status = 'excused'
-- dokumentiert weiterhin, wie der Termin fuer diese Person ausgegangen ist
-- (samt Grund, Urheber, Vermerk); status = 'excused' sagt, dass die Buchung
-- nicht mehr zaehlt. Zwei Fragen, zwei Felder -- und die Anzeige der
-- ausgelieferten App-Fassungen haengt am alten Feld.
--
-- Die Antwortform aendert sich NICHT: kein Feld faellt weg, keines wird
-- umbenannt, keines wechselt den Typ. Es kommt ein WERT hinzu, den
-- ausgelieferte Fassungen (2.1.1) noch nicht kennen.
--
-- Nachgemessen: 2.1.1 stuerzt an einem unbekannten status-Wert NICHT ab --
-- alle Fundstellen haben einen Fallback. Die Person erscheint dort als
-- "Gebucht" und faellt aus sieben Zaehlungen heraus. Bei sechs Bestands-
-- datensaetzen ist das hinnehmbar; die neue Fassung zeigt es richtig.
--
-- Die Alternative waere eine zweite, versionierte Route gewesen. Sie haette
-- den Fehler aber nicht behoben, sondern verdoppelt: Erinnerungen, Kapazitaet
-- und Warteliste lesen den Status SERVERSEITIG -- dort gaebe es weiterhin nur
-- eine Wahrheit, und die waere die falsche.

-- ---------------------------------------------------------------
-- A) Constraint: 'excused' dazu, alles andere bleibt
-- ---------------------------------------------------------------
ALTER TABLE event_bookings DROP CONSTRAINT IF EXISTS event_bookings_status_check;

ALTER TABLE event_bookings
  ADD CONSTRAINT event_bookings_status_check
  CHECK (status = ANY (ARRAY['confirmed', 'waitlist', 'cancelled', 'opted_out', 'pending', 'excused']));

-- ---------------------------------------------------------------
-- B) Herkunft der Abmeldung
-- ---------------------------------------------------------------
ALTER TABLE event_bookings
  ADD COLUMN IF NOT EXISTS abgemeldet_durch_absage BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN event_bookings.abgemeldet_durch_absage IS
  'TRUE = diese Buchung wurde durch die ABSAGE DES TERMINS abgemeldet, nicht einzeln. Nur diese Abmeldungen werden aufgehoben, wenn die Absage zurueckgenommen wird; von Hand oder selbst Abgemeldete bleiben abgemeldet. FALSE ist eine Aussage, kein "unbekannt".';

COMMENT ON COLUMN event_bookings.status IS
  'Buchungsstatus. ''confirmed'' = angemeldet, ''waitlist'' = Warteliste, ''opted_out'' = SELBST abgemeldet (Konfi-Opt-out von Pflichtterminen, Teamer-Absage), ''excused'' = von der LEITUNG abgemeldet oder durch eine Terminabsage (seit Migration 153). ''cancelled'' und ''pending'' sind historisch und werden nicht mehr geschrieben. Weder ''opted_out'' noch ''excused'' belegen einen Platz.';

-- ---------------------------------------------------------------
-- C) Bestand mitziehen -- idempotent, siehe Begruendung oben
-- ---------------------------------------------------------------

-- C1: Jede vorhandene Abmeldung bekommt den Buchungsstatus 'excused'.
--     `status IN ('confirmed','waitlist')` macht den zweiten Lauf zum
--     Leerlauf: Was einmal auf 'excused' steht, faellt aus der Auswahl.
--     Dieselbe Bedingung grenzt zugleich fachlich ein -- eine
--     Selbstabmeldung ('opted_out') bleibt eine Selbstabmeldung, auch wenn
--     die Leitung sie spaeter als abgemeldet verbucht hat -- dieser Fall ist
--     in tests/routes/anwesenheitSelbstabmeldungUndUrheber.test.js
--     ausdruecklich festgehalten ("der BUCHUNGSSTATUS bleibt opted_out").
UPDATE event_bookings
   SET status = 'excused'
 WHERE attendance_status = 'excused'
   AND status IN ('confirmed', 'waitlist');

-- C2: Herkunft nachtragen. Nur fuer die eben (oder frueher) auf 'excused'
--     gesetzten Buchungen, und nur dort, wo der Termin abgesagt ist.
--     `abgemeldet_durch_absage = FALSE` macht auch das beim zweiten Lauf zum
--     Leerlauf.
UPDATE event_bookings eb
   SET abgemeldet_durch_absage = TRUE
  FROM events e
 WHERE e.id = eb.event_id
   AND e.cancelled = TRUE
   AND eb.status = 'excused'
   AND eb.attendance_status = 'excused'
   AND eb.abgemeldet_durch_absage = FALSE;
