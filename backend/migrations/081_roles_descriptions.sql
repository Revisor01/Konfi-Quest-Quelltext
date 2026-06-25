-- Korrigiert die Rollen-Beschreibungen entsprechend der tatsaechlichen Backend-Logik

UPDATE roles SET description = 'Vollzugriff auf die Organisation inkl. Benutzerverwaltung'
WHERE name = 'org_admin';

UPDATE roles SET description = 'Verwaltung von Konfis, Antraegen, Badges und Events (ohne Benutzerverwaltung)'
WHERE name = 'admin';

UPDATE roles SET description = 'Kann Antraege bearbeiten und Punkte vergeben'
WHERE name = 'teamer';

UPDATE roles SET description = 'Konfirmand:innen haben Zugriff auf eigene Daten und koennen Aktivitaeten beantragen'
WHERE name = 'konfi';
