-- Direktchats mit mehr als zwei Personen werden Gruppen
--
-- NUR RAEUME MIT MEHR ALS ZWEI PERSONEN. Ein 'direct'-Raum mit nur noch
-- einer Person (die andere hat ihr Konto geloescht) bleibt ein privates
-- Zweiergespraech und wird NICHT fuer die Leitung geoeffnet.
--
-- ADDITIV: nur ein Typwechsel. Keine Nachricht, keine Teilnehmerin, keine
-- Datei geht verloren; die Store-Apps kennen 'group' seit jeher.
UPDATE chat_rooms r
   SET type = 'group'
 WHERE r.type = 'direct'
   AND (SELECT COUNT(*) FROM chat_participants p WHERE p.room_id = r.id) > 2;
