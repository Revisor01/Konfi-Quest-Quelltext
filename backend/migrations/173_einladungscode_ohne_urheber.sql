-- 173_einladungscode_ohne_urheber.sql
--
-- EINLADUNGSCODES BLEIBEN DER GEMEINDE, WENN DAS KONTO GEHT.
--
-- Ein Einladungscode ist so etwas: Die Org-Leitung legt ihn fuer einen
-- Jahrgang an, alle Org-Leitungen der Gemeinde sehen, verlaengern und
-- loeschen ihn (routes/auth.js, /invite-codes). created_by war NOT NULL --
-- deshalb loeschten die Kontoloeschwege bis hierher jeden Code der Person
-- mit. Ein Code, der auf dem Elternbrief steht, hoerte damit auf zu
-- funktionieren, sobald die Person ihr Konto loeschte.
--
-- Nur die NOT-NULL-Bedingung faellt. Der Fremdschluessel bleibt, wie er ist
-- (ohne ON DELETE); das Nullen uebernimmt die Loeschfunktion, wie bei
-- events.created_by und den anderen Urheber-Spalten.
--
-- ALT-APP-VERTRAG: Keine Route gibt created_by aus (GET /auth/invite-codes,
-- GET /auth/validate-invite/:code nennen es nicht); das Anlegen schreibt es
-- weiter. Rein lockernd, bestehende Zeilen bleiben unveraendert.

ALTER TABLE invite_codes ALTER COLUMN created_by DROP NOT NULL;
