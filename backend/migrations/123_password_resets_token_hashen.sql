-- Reset-Tokens gehasht ablegen
--
-- password_resets.token enthielt den Token im KLARTEXT. Wer die Datenbank
-- lesen kann (Backup, Dump), konnte damit fremde Passwoerter zuruecksetzen.
-- Refresh-Tokens werden hier laengst als SHA-256-Hash abgelegt.
--
-- Diese Migration zieht die noch offenen Alt-Eintraege nach, damit bereits
-- verschickte Reset-Mails weiter funktionieren. Ohne sie liefen sie ins Leere:
-- die Route vergleicht ab jetzt ausschliesslich gegen den Hash.
--
-- Ein Klartext-Vergleich als Uebergangsloesung waere naheliegend, hebt den
-- Schutz aber auf — der gespeicherte Hash ist selbst ein gueltiger
-- Klartext-Wert und wuerde dann als Token funktionieren.
--
-- Erkennungsmerkmal: generateResetToken liefert 32 Byte als 64 Hex-Zeichen,
-- SHA-256 ebenfalls 64 Hex. Die Laenge unterscheidet sie also NICHT. Deshalb
-- werden nur noch offene, unverbrauchte Eintraege umgeschrieben — verbrauchte
-- und abgelaufene bleiben unangetastet (sie werden nie wieder eingeloest, und
-- ein doppeltes Hashen waere nicht erkennbar).

UPDATE password_resets
SET token = encode(sha256(token::bytea), 'hex')
WHERE used_at IS NULL
  AND expires_at > NOW();
