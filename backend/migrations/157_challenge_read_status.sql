-- 157_challenge_read_status.sql
--
-- WANN HAT JEMAND EINE CHALLENGE ZULETZT GEOEFFNET?
--
-- Der Chat kennt diese Frage laengst: chat_read_status haelt je Raum und
-- Person den Zeitpunkt des letzten Oeffnens, und alles, was danach
-- hereinkam, zaehlt als ungelesen -- am Raum, am Reiter, am App-Icon.
-- Fuer Challenges gab es das nicht. Eine neue Challenge, ein neuer Beitrag
-- in der Galerie oder die Freigabe des eigenen Beitrags kamen als Push,
-- aber in der App stand nirgends eine Zahl. Wer den Push wegwischte, hatte
-- keinen zweiten Hinweis.
--
-- Diese Tabelle spiegelt chat_read_status: eine Zeile je (Challenge,
-- Person), gesetzt beim Oeffnen der Detailansicht (POST
-- /challenges/konfi/:id/mark-read). Der Zaehler (utils/challengeNeuigkeiten)
-- rechnet daraus, was seit dem letzten Oeffnen dazugekommen ist. Keine
-- Zeile = nie geoeffnet.
--
-- user_type steht mit drin wie im Chat: dieselbe id kann es in mehreren
-- Typen geben, die id allein reicht nicht als Schluessel.
--
-- ALT-APP-VERTRAG: rein additiv. Keine bestehende Tabelle aendert sich.

CREATE TABLE IF NOT EXISTS challenge_read_status (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_type TEXT NOT NULL CHECK (user_type IN ('admin', 'teamer', 'konfi')),
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (challenge_id, user_id, user_type)
);

COMMENT ON TABLE challenge_read_status IS
  'Letztes Oeffnen einer Challenge je Person -- Grundlage des Neuigkeiten-Zaehlers (wie chat_read_status fuer den Chat).';
