-- 160_chat_messages_fk_indizes.sql
--
-- Zwei fehlende Indizes auf Fremdschluesseln von chat_messages.
--
-- DAS PROBLEM: Migration 102 stellte chat_messages.reply_to auf ON DELETE SET
-- NULL, Migration 114 haengte fk_chat_messages_user (user_id -> users) an.
-- Beide ohne Index. Beim harten Loeschen einer Nachricht laeuft der
-- RI-Trigger `UPDATE chat_messages SET reply_to = NULL WHERE reply_to = <id>`
-- -- ohne Index ein Seq Scan ueber die GANZE Nachrichtentabelle, und zwar je
-- geloeschter Zeile. Beim Loeschen eines Kontos dasselbe fuer user_id.
--
-- Gemessen auf 490.400 Nachrichten (kq_last): 1000 Nachrichten eines Raums
-- loeschen dauerte 32,1 s (davon 32,0 s im Trigger chat_messages_reply_to_fkey)
-- und riss damit den statement_timeout von 30 s. Betroffen: Team-Chat leeren,
-- Raum-, Termin-, Jahrgangs-, Konto- und Organisationsloeschung sowie die
-- naechtliche Auto-Loeschung. Migration 064 hat diese Klasse fuer 30 Tabellen
-- abgedeckt; diese beiden Spalten fehlten.
--
-- WARUM KEIN `CREATE INDEX CONCURRENTLY`: database.js fuehrt jede
-- Migrationsdatei in EINER Transaktion aus (BEGIN ... COMMIT, Eintrag in
-- schema_migrations in derselben Transaktion). CONCURRENTLY ist in einem
-- Transaktionsblock nicht erlaubt -- die Datei wuerde scheitern, der
-- nicht-blockierende Laeufer sie ueberspringen, und der Index fehlte weiter,
-- ohne dass es jemand saehe. Der gewoehnliche CREATE INDEX haelt waehrend des
-- Aufbaus eine SHARE-Sperre: Lesen geht, Schreiben in chat_messages wartet.
-- Gemessen: 139 ms (reply_to, partiell) bzw. 180 ms (user_id) bei 490.400
-- Zeilen -- auch bei einigen Millionen Zeilen und 0,3 CPU bleibt das deutlich
-- unter dem statement_timeout von 30 s, dem auch die Migrationsverbindung
-- unterliegt. Sollte die Tabelle je so gross sein, dass das knapp wird:
-- vorher von Hand `CREATE INDEX CONCURRENTLY` mit genau diesen Namen
-- anlegen -- `IF NOT EXISTS` macht diese Migration dann zum Leerlauf.
--
-- reply_to partiell (WHERE reply_to IS NOT NULL): Die meisten Nachrichten
-- sind keine Antwort (kq_last: 10 %), der Index bleibt klein; die Bedingung
-- `reply_to = $1` des RI-Triggers faellt unter das Praedikat, der Planer
-- nutzt ihn.
--
-- Rein additiv: keine Spalte, kein Vertrag aendert sich.

CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to
  ON chat_messages(reply_to) WHERE reply_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id
  ON chat_messages(user_id);
