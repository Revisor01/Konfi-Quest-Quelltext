-- Leitgedanke: "Mitmachen ist immer besser als nur außen stehen." Pastor:innen
-- und Teamer:innen sollen eigene Beitraege einreichen koennen — gleichgewichtet
-- mit den Konfis, ohne Sonderdarstellung in der Galerie ausser der
-- Rollen-/Jahrgangs-Kennzeichnung hinter dem Namen.
--
-- audience steuert, WER teilnehmen darf (nicht zu verwechseln mit visibility,
-- die regelt, wer die Beitraege SIEHT):
--   'konfis'          — nur Konfis reichen ein (bisheriges Verhalten, Default)
--   'konfis_und_team' — Konfis UND Leitung/Teamer reichen ein
--   'nur_team'        — ausschliesslich das Team der Organisation; Konfis sehen
--                       die Challenge gar nicht. Bewusst OHNE Jahrgangsbindung
--                       (org-weit), weil das Team nicht jahrgangsgebunden denkt.
--
-- Bestandsdaten: alle vorhandenen Challenges bleiben 'konfis' — inhaltlich
-- identisch zum Verhalten vor dieser Migration.
--
-- Wie visibility/moderated ist audience nach dem Start EINGEFROREN (Route
-- erzwingt das): wer unter der Zusage "das ist eine Konfi-Challenge"
-- eingereicht hat, soll nicht nachtraeglich in einer Team-Runde landen.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'konfis';

-- Teilnahme-Kreis einer Challenge; die Route validiert zusaetzlich.
ALTER TABLE challenges
  DROP CONSTRAINT IF EXISTS challenges_audience_check;
ALTER TABLE challenges
  ADD CONSTRAINT challenges_audience_check
  CHECK (audience IN ('konfis', 'konfis_und_team', 'nur_team'));

-- Bei 'nur_team' laeuft die Sichtbarkeit org-weit ueber die Rolle, nicht ueber
-- challenge_jahrgang_assignments — dafuer braucht die Abfrage einen Index auf
-- (organization_id, audience).
CREATE INDEX IF NOT EXISTS idx_challenges_org_audience
  ON challenges(organization_id, audience);
