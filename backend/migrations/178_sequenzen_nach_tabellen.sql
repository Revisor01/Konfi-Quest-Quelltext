-- Sequenzen von user_badges und user_activities nach ihren Tabellen benennen
-- 
--
-- WIRKUNG: nur der Name. Der Default nextval('...'::regclass) verweist per
-- OID auf die Sequenz und zeigt danach den neuen Namen; Besitz (OWNED BY) und
-- Zaehlerstand bleiben. Keine Code-Stelle nennt die alten Namen (geprueft:
-- Routen, Dienste, Hilfen, Test-Helfer, E2E). Auch eine alte Server-Fassung
-- im Deploy merkt nichts.
--
-- Die Typmischung integer/bigint an 55 Fremdschluesseln bleibt;
-- neue Migrationen legen Fremdschluessel als BIGINT an
-- (tests/schema/migrationenKonventionen.test.js).
--
-- SPERRE: ALTER SEQUENCE RENAME, ein Katalogeintrag; Lastbestand 18-40 ms
-- (drei Laeufe, samt Verbindungsaufbau).
--
-- IDEMPOTENT: nur, solange der alte Name da ist und der neue frei.

DO $$
BEGIN
  IF to_regclass('public.konfi_badges_id_seq') IS NOT NULL
     AND to_regclass('public.user_badges_id_seq') IS NULL THEN
    ALTER SEQUENCE konfi_badges_id_seq RENAME TO user_badges_id_seq;
  END IF;
  IF to_regclass('public.konfi_activities_id_seq') IS NOT NULL
     AND to_regclass('public.user_activities_id_seq') IS NULL THEN
    ALTER SEQUENCE konfi_activities_id_seq RENAME TO user_activities_id_seq;
  END IF;
END $$;
