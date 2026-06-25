-- 096_konfi_role_for_all_orgs.sql
-- Die Org-Anlage (POST /organizations) legte historisch nur org_admin/admin/teamer
-- an — KEINE konfi-Rolle. konfi-management sucht die Rolle aber org-gescopt:
-- neue Organisationen konnten deshalb keine Konfis anlegen (500 "Konfi-Rolle
-- nicht gefunden"). Verifiziert auf Prod: Org 2 und Org 3 ohne konfi-Rolle.
-- Diese Migration zieht die Rolle für alle Organisationen nach, denen sie fehlt.
INSERT INTO roles (organization_id, name, display_name, description, is_system_role)
SELECT o.id, 'konfi', 'Konfirmand:in',
       'Konfirmand:innen haben Zugriff auf eigene Daten und können Aktivitäten beantragen',
       true
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.organization_id = o.id AND r.name = 'konfi'
);
