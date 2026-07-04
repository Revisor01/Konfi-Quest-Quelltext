-- 117_fix_chat_participant_user_types.sql
-- Reparatur: chat_participants.user_type passte nicht zur echten Rolle des Users.
--
-- Ursache: POST /chat/direct kannte als target_user_type nur 'admin'|'konfi' —
-- Teamer:innen wurden vom Client als 'admin' angelegt. Da GET /chat/rooms die
-- Raeume ueber (user_id, user_type) liest, war der Direktchat fuer die
-- Teamer:in unsichtbar (Push kam trotzdem an, der laeuft nur ueber user_id).
-- Gleiche Fehlerklasse wie Migration 098, dort nur fuer Jahrgangs-Chats gefixt.
--
-- Der Code leitet den user_type jetzt serverseitig aus der Rolle ab
-- (roleToParticipantType); hier werden die Bestandsdaten geradegezogen.
--
-- Scope: nur Teilnehmer, deren PRIMAER-Org der Raum-Org entspricht — fuer via
-- user_organizations eingewechselte Mitglieder (Org-Switcher) kann die Rolle in
-- der Raum-Org abweichen, die lassen wir unangetastet (org_admin -> 'admin'
-- ist dort ohnehin korrekt).
UPDATE chat_participants cp
   SET user_type = CASE r.name
                     WHEN 'konfi'  THEN 'konfi'
                     WHEN 'teamer' THEN 'teamer'
                     ELSE 'admin'
                   END
  FROM chat_rooms cr,
       users u
  JOIN roles r ON u.role_id = r.id
 WHERE cr.id = cp.room_id
   AND cp.user_id = u.id
   AND u.organization_id = cr.organization_id
   AND cp.user_type <> CASE r.name
                         WHEN 'konfi'  THEN 'konfi'
                         WHEN 'teamer' THEN 'teamer'
                         ELSE 'admin'
                       END;
