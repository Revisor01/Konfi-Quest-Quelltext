-- 132_bibeluebersetzung_eine_spalte.sql
--
-- Diese Migration fuehrt beide auf users.bible_translation zusammen. Nur
-- diese Richtung kann funktionieren: users hat JEDE Rolle, konfi_profiles
-- nur Konfis (und ehemalige Konfis).
--
-- Spaltenformen vor der Zusammenlegung (aus tests/schema/prod-schema.sql):
--   konfi_profiles.bible_translation  varchar(10) DEFAULT 'LUT'   (NULL erlaubt)
--   users.bible_translation           varchar(10) DEFAULT 'LUT'   NOT NULL
--
-- Schritt 1: Werte uebernehmen, aber NUR wo an users noch nichts Eigenes
-- steht. users.bible_translation ist NOT NULL mit Default 'LUT' -- "leer"
-- heisst hier also 'LUT', nicht NULL. Steht dort bereits etwas anderes als
-- 'LUT', ist das die neuere, bewusste Wahl (z.B. von einem befoerderten
-- Teamer, der danach umgestellt hat) und darf nicht ueberschrieben werden.
-- Umgekehrt wird auch nichts uebernommen, was selbst nur der Default ist:
-- kp.bible_translation muss gesetzt und von 'LUT' verschieden sein, sonst
-- aendert die Zeile ohnehin nichts.
--
-- IDEMPOTENZ: Schritt 1 laeuft nur,
-- solange es die Spalte noch gibt. Vorher las ein zweiter Lauf
-- kp.bible_translation nach dem DROP aus Schritt 2 und scheiterte. Vermerkte
-- Staende betrifft das nicht (der Migrationslauf vergleicht nur den Namen).
-- Waechter: tests/schema/migrationenIdempotent.test.js.
DO $migration$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'konfi_profiles'
               AND column_name = 'bible_translation') THEN
    EXECUTE $sql$
      UPDATE users u
         SET bible_translation = kp.bible_translation
        FROM konfi_profiles kp
       WHERE kp.user_id = u.id
         AND kp.bible_translation IS NOT NULL
         AND kp.bible_translation <> 'LUT'
         AND u.bible_translation = 'LUT'
    $sql$;
  END IF;
END $migration$;

-- Schritt 2: Die Doppelspalte entfernen. Ab hier ist
-- users.bible_translation die einzige Quelle fuer alle Rollen.
ALTER TABLE konfi_profiles DROP COLUMN IF EXISTS bible_translation;
