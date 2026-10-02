-- 168_challenge_lesestand_leitung.sql
--
-- Challenge-Neuigkeiten fuer Leitung und Team: Reiter und
-- Challenge zaehlen fuer sie jetzt jeden fremden, sichtbaren Beitrag seit dem
-- letzten Oeffnen (utils/challengeNeuigkeiten.js,
-- challengeNeuigkeitenLeitungJeChallenge) -- wie der Chat.
--
-- Ohne diese Zeilen haette niemand aus der Leitung je eine Challenge
-- "geoeffnet" (challenge_read_status kannte bisher praktisch nur Konfis), und
-- am Tag des Updates stuende an jeder laufenden Challenge die Zahl ALLER
-- bisherigen Beitraege. Deshalb gilt fuer alle, die heute zur Leitung oder
-- zum Team gehoeren, jede bestehende Challenge als jetzt gesehen. Neu ist,
-- was danach kommt.
--
-- Beide Quellen der Zugehoerigkeit (Stamm-Gemeinde und user_organizations),
-- user_type wie im Token: 'teamer' fuer Teamer:innen, sonst 'admin'.
-- Rein additiv: nur Zeilen fuer Leitung und Team; bestehende Zeilen werden
-- hoechstens auf jetzt vorgezogen, nie zurueck. Konfi-Zeilen bleiben
-- unberuehrt.
INSERT INTO challenge_read_status (challenge_id, user_id, user_type, last_read_at)
SELECT c.id, m.user_id, m.user_type, NOW()
  FROM challenges c
  JOIN (
    SELECT u.id AS user_id, u.organization_id,
           CASE WHEN r.name = 'teamer' THEN 'teamer' ELSE 'admin' END AS user_type
      FROM users u
      JOIN roles r ON r.id = u.role_id
     WHERE r.name IN ('org_admin', 'admin', 'teamer')
       AND u.deleted_at IS NULL
    UNION
    SELECT uo.user_id, uo.organization_id,
           CASE WHEN r.name = 'teamer' THEN 'teamer' ELSE 'admin' END AS user_type
      FROM user_organizations uo
      JOIN roles r ON r.id = uo.role_id
     WHERE r.name IN ('org_admin', 'admin', 'teamer')
  ) m ON m.organization_id = c.organization_id
 WHERE c.is_draft = false
ON CONFLICT (challenge_id, user_id, user_type)
DO UPDATE SET last_read_at = GREATEST(challenge_read_status.last_read_at, EXCLUDED.last_read_at);
