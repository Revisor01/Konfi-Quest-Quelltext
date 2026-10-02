-- Refresh-Token: Gnadenfrist genau einmal, Nachfolger nachvollziehbar
--
-- ZWEI SPALTEN, beide NULL-faehig, rein additiv (Store-Apps lesen die
-- Tabelle nicht; die Antwortform von /auth/refresh bleibt unveraendert):
--
--   ersetzt_durch     id des Tokens, das bei der Rotation an die Stelle
--                     dieses Tokens getreten ist. Nutzt jemand das alte Token
--                     in der Gnadenfrist, wird dieser Nachfolger widerrufen --
--                     so bleibt je Geraet genau EIN Token offen. Bewusst kein
--                     Fremdschluessel: Der Aufraeumlauf (auth.js, alle 24 h)
--                     loescht widerrufene Tokens nach sieben Tagen; ein
--                     verwaister Verweis ist dann harmlos (das UPDATE trifft
--                     keine Zeile) und braucht weder Index noch Kaskade.
--
--   gnade_genutzt_at  wann die einmalige Gnadenfrist dieses Tokens
--                     verbraucht wurde. Steht hier ein Wert und kommt das
--                     Token noch einmal, ist das eine Wiederverwendung
--                     ausserhalb jeder Regel: Alle Refresh-Tokens des Kontos
--                     werden widerrufen (Diebstahl-Signal).
--
-- TIMESTAMPTZ wie bei Migration 159, nicht das nackte timestamp der
-- Altspalten: Der Wert wird nur auf IS NOT NULL geprueft, aber wer ihn
-- einmal in JavaScript vergleicht, soll nicht in die Falle von Migration 139
-- laufen.

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ersetzt_durch INTEGER;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS gnade_genutzt_at TIMESTAMPTZ;
