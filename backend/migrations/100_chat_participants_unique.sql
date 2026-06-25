-- 100_chat_participants_unique.sql
-- KRITISCH: Auf Prod fehlte der Unique-Constraint (room_id, user_id) — er war
-- nur im init-script, aber nie auf die migrierte Prod-DB angewandt. Dadurch
-- griff "INSERT ... ON CONFLICT DO NOTHING" NICHT, und syncJahrgangChat fuegte
-- bei jedem /rooms-Load alle Soll-Mitglieder ERNEUT hinzu (Room 94 wuchs auf
-- 2520 Zeilen -> App crashte beim Rendern). Erst Bestand deduplizieren (pro
-- (room_id, user_id) nur die kleinste id behalten), dann Constraint setzen.
DELETE FROM chat_participants cp
USING chat_participants keep
WHERE cp.room_id = keep.room_id
  AND cp.user_id = keep.user_id
  AND cp.id > keep.id;

ALTER TABLE chat_participants DROP CONSTRAINT IF EXISTS chat_participants_unique;
ALTER TABLE chat_participants ADD CONSTRAINT chat_participants_unique UNIQUE (room_id, user_id);
