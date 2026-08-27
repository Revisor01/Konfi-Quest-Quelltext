-- Album zu Musik-Links (Challenge-Beitraege).
--
-- Bisher wurden nur Titel und Interpret gespeichert und in EINER Zeile mit
-- Mittelpunkten angezeigt ("Titel · Interpret · Dienst"). Das Album lag bei
-- Apple Music bereits vor (collectionName), wurde aber nur als Ersatz fuer
-- einen fehlenden Titel genutzt und sonst verworfen.
--
-- Altbestand bleibt unberuehrt: NULL bedeutet "kein Album bekannt", die
-- Anzeige laesst die Zeile dann weg. Es wird NICHT nacherhoben — dafuer
-- muesste der Server fremde Musikdienste zu alten Beitraegen anfragen.
ALTER TABLE challenge_submissions
  ADD COLUMN IF NOT EXISTS link_album VARCHAR(200);
