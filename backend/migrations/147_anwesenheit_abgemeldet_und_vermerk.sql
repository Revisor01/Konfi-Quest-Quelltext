-- 147_anwesenheit_abgemeldet_und_vermerk.sql
--
-- ANWESENHEIT KENNT NUR ANWESEND ODER ABWESEND -- DAS TRIFFT DIE WIRKLICHKEIT
-- NICHT.
--
-- Zweiter Fall: Eine Konfirmandin bittet darum, schon um 14 Uhr zu gehen.
-- Sie war da, bekommt ihre Punkte, ist also ANWESEND -- aber der Vermerk
-- soll trotzdem festgehalten werden koennen.
--
-- Drei Felder, alle NULLABLE, alle additiv:
--
--   attendance_status bekommt zusaetzlich 'excused' (abgemeldet)
--   excuse_reason     -- warum abgemeldet wurde ("krank, Mutter hat angerufen")
--   attendance_note   -- Vermerk unabhaengig vom Status ("ging um 14 Uhr")
--
-- WARUM NICHT opt_out_reason MITBENUTZEN, das es schon gibt:
-- opt_out_reason gehoert zu status='opted_out' -- der SELBSTabmeldung einer
-- Konfi von einem Pflichttermin (routes/konfi.js:1729, nur vor dem Termin
-- moeglich). Das ist ein anderer Vorgang, von einer anderen Person, zu einer
-- anderen Zeit: Hier traegt die LEITUNG nach, was ausserhalb der App gemeldet
-- wurde, oft erst beim Verbuchen NACH dem Termin. Beides in ein Feld zu legen
-- hiesse, zwei Vorgaenge nicht mehr auseinanderhalten zu koennen -- und die
-- Matrix unterscheidet sie bereits (getZellStatus: 'opted_out' vor
-- attendance_status).
--
-- KEIN CHECK-CONSTRAINT auf attendance_status: Die Spalte hat heute keinen,
-- und einer waere eine Verschaerfung gegen ausgelieferte App-Fassungen --
-- die schreiben weiterhin nur 'present'/'absent', das bleibt gueltig. Die
-- erlaubten Werte prueft die Route (events/anwesenheit.js).

ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS excuse_reason text;
ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS attendance_note text;

COMMENT ON COLUMN event_bookings.excuse_reason IS
  'Grund einer von der Leitung nachgetragenen Abmeldung (attendance_status = ''excused''). NICHT zu verwechseln mit opt_out_reason -- das ist die Selbstabmeldung der Konfi vor dem Termin.';

COMMENT ON COLUMN event_bookings.attendance_note IS
  'Freier Vermerk zur Anwesenheit, unabhaengig vom Status. Beispiel: "ging um 14 Uhr". Sichtbar fuer Leitung und Team.';
