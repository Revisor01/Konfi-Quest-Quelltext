-- 145_warteliste_historie.sql
--
-- WER NACHGERUECKT IST, VERLIERT HEUTE SEINE VORGESCHICHTE.
--
-- promoteFromWaitlist (utils/bookingUtils.js) macht aus 'waitlist' ein
-- 'confirmed' -- mit einem UPDATE, das den alten Status ueberschreibt.
-- Hinterher ist nicht mehr erkennbar, ob jemand von Anfang an einen Platz
-- hatte oder geduldig auf der Warteliste stand, bis einer frei wurde.
--
-- Fuer den Jahresrueckblick ist genau das eine Geschichte: "Du hast
-- gewartet -- und bist reingekommen." Ohne diese Spalte laesst sie sich
-- nicht erzaehlen, weil die Information im Moment des Nachrueckens
-- verloren geht.
--
-- Dieselbe Fehlerklasse und dieselbe Loesung wie bei
-- 141_teamer_absage_nach_zusage.sql: Der Uebergang selbst haelt fest, was
-- er ueberschreibt.
--
-- WARUM NULLABLE UND NICHT 'NOT NULL DEFAULT false':
--
-- Migration 141 konnte den Default false setzen, weil dort gemessen
-- feststand, dass KEINE Bestandszeile das Flag tragen durfte. Hier ist es
-- anders: Unter den bestehenden Buchungen sind mit Sicherheit welche, die
-- ueber die Warteliste kamen -- wir wissen nur nicht mehr, welche. Ein
-- pauschales false wuerde behaupten "niemand hat je gewartet" und damit
-- eine Aussage erfinden, die wir nicht belegen koennen.
--
-- NULL heisst deshalb ausdruecklich UNBEKANNT, nicht "nein". Die Auswertung
-- im Rueckblick behandelt es auch so: Die Seite erscheint nur bei einem
-- echten true. Wer NULL traegt, bekommt sie nicht -- aber es steht auch
-- nirgends, er habe nicht gewartet.
--
-- ALT-APP-VERTRAG: rein additiv. Keine Spalte entfaellt, keine aendert
-- Typ oder Bedeutung, keine Bestandszeile wird umgeschrieben. Ausgelieferte
-- App-Versionen lesen die Spalte nicht und merken von ihr nichts.
ALTER TABLE event_bookings
  ADD COLUMN IF NOT EXISTS war_auf_warteliste BOOLEAN;

COMMENT ON COLUMN event_bookings.war_auf_warteliste IS
  'true = diese Buchung ist von der Warteliste nachgerueckt. NULL = unbekannt (Bestandszeilen vor Migration 145).';
