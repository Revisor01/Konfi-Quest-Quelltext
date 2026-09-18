-- 155_status_vor_absage.sql
--
-- EINE ABSAGE LAESST SICH ZURUECKNEHMEN -- ABER WOHIN GENAU?
--
-- Migration 153 hat die eine Haelfte davon schon gebaut: WER durch die Absage
-- abgemeldet wurde, steht in abgemeldet_durch_absage. Nur diese Gruppe wird
-- beim Zuruecknehmen aufgehoben; wer vorher selbst ('opted_out') oder von der
-- Leitung ('excused' mit abgemeldet_durch_absage = FALSE) abgemeldet war,
-- bleibt abgemeldet.
--
-- Es fehlt die andere Haelfte: WOHIN diese Gruppe zurueckkehrt.
--
-- ===================================================================
-- DER ALTE WERT IST SONST NICHT MEHR DA
-- ===================================================================
--
-- meldeAlleAbBeiAbsage setzt status = 'excused' -- fuer Angemeldete
-- ('confirmed') UND fuer Wartende ('waitlist') gleichermassen. Danach sehen
-- beide Gruppen identisch aus. Ohne eine eigene Angabe bliebe beim
-- Zuruecknehmen nur zu raten, und beide moeglichen Vermutungen sind falsch:
--
--   ALLE AUF 'confirmed': Die Warteliste verschwindet. Wer vor der Absage auf
--   Platz drei gewartet hat, stuende danach fest angemeldet in der Liste --
--   ueber der Kapazitaet, an der Reihenfolge vorbei, und vor denen, die vorher
--   einen echten Platz hatten. Bei einem vollen Termin mit zehn Plaetzen und
--   fuenf Wartenden waeren aus zehn Bestaetigten fuenfzehn geworden.
--
--   ALLE AUF 'waitlist': Genau umgekehrt. Alle, die einen sicheren Platz
--   hatten, muessten sich neu anstellen.
--
-- ===================================================================
-- WARUM KEINE DER VORHANDENEN SPALTEN REICHT
-- ===================================================================
--
-- war_auf_warteliste (Migration 145) beantwortet eine ANDERE Frage: "ist diese
-- Buchung irgendwann einmal von der Warteliste nachgerueckt?" -- nicht "worauf
-- stand sie unmittelbar vor DIESER Absage". Wer nachgerueckt IST, traegt dort
-- true und war zum Zeitpunkt der Absage 'confirmed'; die Spalte wuerde ihn
-- also ausgerechnet falsch herum einsortieren. Und sie ist nullable mit der
-- ausdruecklichen Bedeutung "unbekannt" (Bestandszeilen), taugt also auch
-- nicht als Rueckfallwert.
--
-- attendance_status sagt, wie der Termin fuer diese Person ausgegangen ist,
-- nicht, ob sie einen Platz hatte. excuse_reason ist Freitext -- daraus etwas
-- zurueckzuschliessen waere derselbe Fehler, den Migration 153 fuer die
-- Herkunft schon ausgeschlossen hat ("Herkunft ist eine eigene Angabe").
--
-- Bliebe, die Kapazitaet neu zu rechnen: "die ersten zehn nach created_at auf
-- confirmed, der Rest auf die Warteliste". Das waere keine Wiederherstellung,
-- sondern eine Neuverteilung -- sie ordnete die Liste nach Buchungszeitpunkt,
-- obwohl sie durch Nachruecken, manuelles Eintragen und Kapazitaets-
-- aenderungen laengst anders aussehen kann. Und sie stuerzte genau dann ab,
-- wenn die Kapazitaet zwischen Absage und Zuruecknahme verkleinert wurde.
-- Der alte Wert ist bekannt; ihn aufzuschreiben ist billiger und ehrlicher,
-- als ihn spaeter zu rekonstruieren.
--
-- ===================================================================
-- DIE SPALTE
-- ===================================================================
--
-- TEXT, nullable. NULL heisst "diese Buchung wurde nicht durch eine
-- Terminabsage abgemeldet" -- und ist damit der Normalfall, nicht "unbekannt":
-- Die Spalte wird ausschliesslich zusammen mit abgemeldet_durch_absage = TRUE
-- geschrieben und beim Zuruecknehmen wieder auf NULL gesetzt. Die beiden
-- gehoeren zusammen; die eine sagt, DASS aus einer Absage abgemeldet wurde,
-- die andere, WOHIN es zurueckgeht.
--
-- EIN CHECK STATT FREITEXT: Erlaubt sind nur 'confirmed' und 'waitlist' --
-- die einzigen zwei Werte, die meldeAlleAbBeiAbsage ueberhaupt vorfindet
-- (ihre Auswahl lautet status IN ('confirmed','waitlist')). Ein anderer Wert
-- waere ein Programmierfehler und soll beim ersten Testlauf auffallen, nicht
-- im Betrieb als stiller Datensatz ueberleben.
--
-- ALT-APP-VERTRAG: rein additiv. Keine Spalte entfaellt, keine aendert Typ
-- oder Bedeutung, keine Bestandszeile wird umgeschrieben. Ausgelieferte
-- App-Fassungen lesen die Spalte nicht und merken von ihr nichts.

ALTER TABLE event_bookings
  ADD COLUMN IF NOT EXISTS status_vor_absage TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'event_bookings_status_vor_absage_check'
  ) THEN
    ALTER TABLE event_bookings
      ADD CONSTRAINT event_bookings_status_vor_absage_check
      CHECK (status_vor_absage IS NULL OR status_vor_absage IN ('confirmed', 'waitlist'));
  END IF;
END $$;

COMMENT ON COLUMN event_bookings.status_vor_absage IS
  'Der Buchungsstatus unmittelbar VOR einer Terminabsage (''confirmed'' oder ''waitlist''). Wird nur zusammen mit abgemeldet_durch_absage = TRUE gesetzt und beim Zuruecknehmen der Absage wieder auf NULL. NULL = diese Buchung wurde nicht durch eine Terminabsage abgemeldet (Normalfall) oder stammt aus der Zeit vor Migration 155. NICHT zu verwechseln mit war_auf_warteliste (Migration 145): das sagt, ob eine Buchung je NACHGERUECKT ist, nicht worauf sie vor der Absage stand.';
