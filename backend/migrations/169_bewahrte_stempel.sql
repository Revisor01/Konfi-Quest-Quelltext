-- 169_bewahrte_stempel.sql
--
-- STEMPEL DES TEAMS UEBERLEBEN DAS LOESCHEN IHRER CHALLENGE.
--
-- Diese Tabelle haelt den Stempel fest, BEVOR die Challenge geht
-- (utils/challengeLoeschen.js, bewahreTeamStempel): eine Zeile je Person und
-- Challenge mit allem, was die Anzeige braucht. challenge_id wird mit dem
-- Loeschen NULL; herkunft_challenge_id behaelt die alte Kennung, damit die
-- Antwort der Stempel-Listen ihren Typ behaelt (challenge_id bleibt eine
-- Zahl -- die Apps im Store nutzen sie als Schluessel der Kachel).
--
-- ALT-APP-VERTRAG: rein additiv. Keine bestehende Tabelle aendert sich.

CREATE TABLE IF NOT EXISTS bewahrte_stempel (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  challenge_id INTEGER REFERENCES challenges(id) ON DELETE SET NULL,
  herkunft_challenge_id INTEGER NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  badge_icon VARCHAR(50) NOT NULL,
  badge_name VARCHAR(100) NOT NULL,
  earned_at TIMESTAMPTZ,
  bewahrt_am TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, herkunft_challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_bewahrte_stempel_person
  ON bewahrte_stempel(user_id, organization_id);

COMMENT ON TABLE bewahrte_stempel IS
  'Challenge-Stempel des Teams, festgehalten beim Loeschen ihrer Challenge mit dem Jahrgang. Ein lebender Stempel wird weiter aus challenge_submissions abgeleitet.';
