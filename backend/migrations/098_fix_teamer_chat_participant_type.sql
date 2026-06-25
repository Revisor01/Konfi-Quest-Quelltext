-- 098_fix_teamer_chat_participant_type.sql
-- Inkonsistenz: Teamer haben req.user.type='teamer', wurden aber an einigen
-- Stellen (Event-Chat-Erstellung, Jahrgang-Zuweisung) faelschlich als
-- user_type='admin' in chat_participants gespeichert. Folge: Beim Laden der
-- Raeume (Filter p.user_type = req.user.type = 'teamer') fanden diese Teamer
-- ihre eigenen Chats NICHT. Bestand korrigieren: chat_participants-Eintraege,
-- deren User die Rolle 'teamer' hat, aber als 'admin' eingetragen sind, auf
-- 'teamer' setzen. (org_admin/admin -> req.user.type='admin' bleibt korrekt.)
UPDATE chat_participants cp
SET user_type = 'teamer'
FROM users u
JOIN roles r ON u.role_id = r.id
WHERE cp.user_id = u.id
  AND r.name = 'teamer'
  AND cp.user_type = 'admin';
