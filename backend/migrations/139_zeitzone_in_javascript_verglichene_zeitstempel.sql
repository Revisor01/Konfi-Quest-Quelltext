-- 139_zeitzone_in_javascript_verglichene_zeitstempel.sql
--
-- Nachtrag zu 138. Dort wurden die Spalten migriert, die Nutzer:innen
-- ANGEZEIGT werden. Die Einordnung der uebrigen als "folgenlos, weil mit
-- NOW() geschrieben und in SQL gegen NOW() geprueft" hatte eine Luecke:
-- Sie fragte, WIE geschrieben wird -- nicht, wer den Wert LIEST.
--
-- Drei Spalten werden nicht in SQL, sondern in JavaScript ausgewertet:
--
--   users.token_invalidated_at   middleware/rbac.js:106 und :139,
--                                routes/chat.js:1634 -- verglichen gegen den
--                                Unix-Zeitstempel `iat` aus dem JWT.
--   invite_codes.expires_at      routes/auth.js:771 und :776 -- verglichen
--                                gegen new Date() und um 7 Tage verlaengert.
--
-- Bei einem `timestamp without time zone` deutet der pg-Treiber den naiven
-- Wert in der PROZESS-Zeitzone. Stimmt die nicht mit der Sitzungszone der
-- Datenbank ueberein, liegt das Ergebnis um den Zonenversatz daneben.
--
--   Prozess Europe/Berlin  ->  Versatz    0 s   (richtig)
--   Prozess UTC            ->  Versatz 7200 s   (zwei Stunden in der ZUKUNFT)
--
-- Die Richtung ist wichtig, weil sie oft falsch herum vermutet wird: Der
-- Widerruf lag ZU WEIT VORNE, nicht zu weit hinten. Ein bereits ausgestelltes
-- Token wurde korrekt gesperrt -- aber ein NEU ausgestelltes ebenfalls, denn
-- auch dessen iat lag vor der um zwei Stunden vorgeschobenen Sperre. Wer sein
-- Passwort aenderte, kam danach zwei Stunden lang nicht wieder herein. Eine
-- Luecke, durch die ein widerrufenes Token durchgekommen waere, gab es nicht.
--
-- Seit die Container in Europe/Berlin laufen, stimmt der Vergleich. Aber er
-- stimmt dann, weil zwei Einstellungen zufaellig zusammenpassen -- genau die
-- Bauart, die den urspruenglichen Fehler ueberhaupt erst verdeckt hat. Mit
-- timestamptz traegt der Wert seine Zone selbst und der Vergleich ist
-- unabhaengig von der Prozess-Zeitzone richtig.
--
-- Bestand wird wie in 138 als Berliner Zeit interpretiert.

ALTER TABLE users
  ALTER COLUMN token_invalidated_at TYPE timestamptz
  USING token_invalidated_at AT TIME ZONE 'Europe/Berlin';

ALTER TABLE invite_codes
  ALTER COLUMN expires_at TYPE timestamptz
  USING expires_at AT TIME ZONE 'Europe/Berlin';

ALTER TABLE invite_codes
  ALTER COLUMN used_at TYPE timestamptz
  USING used_at AT TIME ZONE 'Europe/Berlin';
