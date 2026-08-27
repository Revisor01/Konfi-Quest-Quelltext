-- Konsequenz hier:
--   1. Neuer Spalten-Default 'konfis_und_team' (statt 'konfis').
--   2. Bestandsdaten werden mitgezogen: 'konfis' -> 'konfis_und_team'.
--      Das erweitert nur den Kreis der EINREICHENDEN (das Team kommt hinzu);
--      an der Sichtbarkeit fuer die Konfis aendert sich nichts, und niemandem
--      wird etwas weggenommen.
--
-- 'konfis' bleibt im CHECK-Constraint erlaubt: die Route akzeptiert den Wert
-- weiterhin (Alt-Clients, API-Kompatibilitaet), die UI bietet ihn nur nicht an.

ALTER TABLE challenges
  ALTER COLUMN audience SET DEFAULT 'konfis_und_team';

UPDATE challenges
  SET audience = 'konfis_und_team'
  WHERE audience = 'konfis';
