-- 151_anwesenheit_quelle.sql
--
-- WOHER KOMMT DIE ANWESENHEIT? HEUTE IST DAS NICHT MEHR ZU SEHEN.
--
-- DAS PROBLEM LIEGT IM NULL. Migration 148 haelt fest, dass
-- attendance_set_by beim QR-Check-in bewusst NULL bleibt: Dort checkt sich
-- die Konfi SELBST ein, und "Eingetragen von Emilia" laese sich wie eine
-- Leitungsentscheidung. Diese Entscheidung bleibt -- kein Personenname in
-- der Zeile. Nur: NULL heisst laut derselben Migration "unbekannt", und den
-- Altbestand von vor 148 trifft es genauso. QR-Selbstcheckin und Altbestand
-- sind dadurch heute NICHT unterscheidbar. In beiden Faellen faellt die
-- Zeile weg, obwohl im einen Fall sehr wohl etwas zu sagen waere.
--
-- ZWEI SPALTEN, im Stil von attendance_set_by/_at (Migration 148):
--
--   checkin_quelle  -- WOHER der Status kam ('qr' | 'manuell')
--   checked_in_at   -- WANN der Check-in stattfand
--
-- WARUM EINE EIGENE SPALTE STATT EINES FLAGS: 'qr' und 'manuell' sind nicht
-- die einzigen denkbaren Wege (Import, Sammelverbuchung, spaeter vielleicht
-- NFC). Ein boolesches per_qr muesste bei jedem weiteren Weg umgebaut
-- werden; ein Textfeld nimmt ihn auf, ohne dass eine alte App-Fassung
-- stolpert -- sie liest den Wert gar nicht.
--
-- WARUM checked_in_at NEBEN attendance_set_at: attendance_set_at gehoert
-- zum URHEBER-Paar und bleibt beim QR-Check-in NULL (Migration 148, siehe
-- oben). Den Zeitpunkt dort mitzuschreiben wuerde das Paar aufbrechen --
-- ein Zeitstempel ohne Namen, den die Anzeige ohnehin verwirft ("ein
-- blosses Datum beantwortet 'wer war das?' nicht", anwesenheitUrheber.ts).
-- Der Check-in-Zeitpunkt ist eine eigene Angabe und bekommt eine eigene
-- Spalte.
--
-- AUCH 'manuell' WIRD GESCHRIEBEN, nicht nur 'qr': Sonst blieben zwei
-- Faelle im selben NULL stehen -- "von Hand gesetzt, vor dieser Migration"
-- und "per QR". Erst wenn der manuelle Weg seine Quelle ebenfalls
-- hinterlaesst, sind die drei Faelle sauber getrennt:
--
--   checkin_quelle = 'qr'       -> Selbst-Check-in, Zeile "Checkin via QR-Code"
--   checkin_quelle = 'manuell'  -> von der Leitung gesetzt, Zeile "Eingetragen von ..."
--   checkin_quelle IS NULL      -> unbekannt (Altbestand), gar keine Zeile
--
-- KEIN BACKFILL: Rueckwirkend wissen wir nicht, was per QR kam. Ein
-- pauschales 'manuell' auf den Bestand waere geraten und wuerde bei genau
-- den Buchungen behaupten, die Leitung habe sie gesetzt, bei denen sich
-- jemand selbst eingecheckt hat. NULL bleibt NULL und heisst weiterhin
-- unbekannt, nicht niemand.
--
-- CHECK-CONSTRAINT statt ENUM: Wie attendance_status und status in
-- event_bookings schon gehandhabt. Ein neuer Wert ist dann ein ALTER TABLE,
-- kein Typ-Umbau mit Sperre.
--
-- ALT-APP-VERTRAG: rein additiv. Keine Spalte entfaellt, keine aendert Typ
-- oder Bedeutung, keine Bestandszeile wird umgeschrieben. Ausgelieferte
-- App-Fassungen sehen zwei Felder mehr in der Teilnehmerliste und
-- ignorieren sie.

ALTER TABLE event_bookings
  ADD COLUMN IF NOT EXISTS checkin_quelle VARCHAR(20),
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'event_bookings_checkin_quelle_check'
  ) THEN
    ALTER TABLE event_bookings
      ADD CONSTRAINT event_bookings_checkin_quelle_check
      CHECK (checkin_quelle IS NULL OR checkin_quelle IN ('qr', 'manuell'));
  END IF;
END $$;

COMMENT ON COLUMN event_bookings.checkin_quelle IS
  'Woher der Anwesenheits-Status kam: ''qr'' = Selbst-Check-in per QR-Code, ''manuell'' = von der Leitung gesetzt. NULL = unbekannt: Bestandszeilen von vor Migration 151. Kein Backfill, rueckwirkend ist der Weg nicht rekonstruierbar.';

COMMENT ON COLUMN event_bookings.checked_in_at IS
  'Wann der Check-in stattfand. Eigene Spalte neben attendance_set_at, weil dieses zum Urheber-Paar gehoert und beim QR-Check-in bewusst NULL bleibt (Migration 148). NULL = unbekannt.';
