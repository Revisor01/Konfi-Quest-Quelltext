-- Postfach: Mitteilungen ueber eine Person ohne Kennung der Person loeschen
-- 
--
-- WAS GEHT: genau die Arten aus ARTEN_UEBER_PERSON (Test haelt die Liste
-- gleich: tests/utils/migration188PostfachAltbestand.test.js), wenn weder
-- konfi_id noch user_id einen Wert hat. data NULL oder ein blosser
-- JSON-String ergeben bei ->> NULL und zaehlen als "ohne Kennung".
-- WAS BLEIBT: alles mit Kennung (geht spaeter mit dem Konto) und alle
-- anderen Arten -- eigene Mitteilungen, Entscheidungen, Punkte.
--
-- Eine Mitteilung, die danach im Postfach fehlt, zeigte auf einen Vorgang,
-- der in der jeweiligen Liste weiter steht (Abmeldungen am Event,
-- Beitraege an der Challenge). Die Zahl am Glockensymbol sinkt um die
-- ungelesenen davon.
--
-- SPERRE: DELETE mit Zeilensperren, kein Tabellen-Lock. Die Tabelle ist
-- klein (Postfach mit 365-Tage-Frist).

DELETE FROM notifications
 WHERE type IN (
         'new_activity_request',
         'new_konfi_registration',
         'event_unregistration',
         'event_opt_out',
         'event_opt_in',
         'challenge_submission',
         'teamer_event_booking',
         'teamer_event_cancellation',
         'gemeinde_einladung_beantwortet'
       )
   AND COALESCE(data->>'konfi_id', '') = ''
   AND COALESCE(data->>'user_id', '') = '';
