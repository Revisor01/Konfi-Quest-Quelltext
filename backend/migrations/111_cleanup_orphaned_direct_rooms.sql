
DELETE FROM chat_rooms r
WHERE r.type = 'direct'
  AND NOT EXISTS (SELECT 1 FROM chat_participants p WHERE p.room_id = r.id);
