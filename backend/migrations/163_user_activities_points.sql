-- 163: Punktwert am Zuordnungsdatensatz speichern
--
-- ADDITIV: eine neue, nullbare Spalte. Keine bestehende Spalte ändert Form
-- oder Typ, keine Antwortform ändert sich (die Lesestellen liefern weiter das
-- Feld `points`, nur aus COALESCE(ua.points, a.points)). Name und Typ wie bei
-- den Nachbarn bonus_points.points und event_points.points (bigint).
--
-- KEIN DB-Default: Der Wert kommt aus der Aktivität zum Zeitpunkt der Vergabe
-- bzw. aus dem genehmigten Antrag (routes/activities.js,
-- routes/konfi-management.js) — das Schema kennt ihn nicht.
--
-- Zeilen, die danach noch NULL tragen (Aktivität ohne Punktwert, etwa alte
-- Teamer-Aktivitäten), verhalten sich über COALESCE weiter wie heute.

ALTER TABLE user_activities ADD COLUMN IF NOT EXISTS points bigint;

UPDATE user_activities ua
   SET points = a.points
  FROM activities a
 WHERE a.id = ua.activity_id
   AND ua.points IS NULL;

COMMENT ON COLUMN user_activities.points IS
  'Bei der Vergabe gutgeschriebener Punktwert (Wert der Aktivität zu diesem Zeitpunkt, Migration 163). NULL nur bei Bestand ohne Aktivitätswert; Lesestellen fallen dann auf activities.points zurück. Eine spätere Änderung der Aktivität ändert diesen Wert nicht.';
