-- Migration 085: Level-Icons von Unicode-Emojis auf Ionicon-Namen umstellen
-- Die alten Standard-Levels (init-scripts/007_levels.sql) wurden mit Emojis als
-- icon geseedet. Emojis verstossen gegen die Projektregel (keine Unicode-Emojis)
-- und landeten frueher sogar in Push-Titeln. Das UI (LevelManagementModal) rendert
-- icon ohnehin als Ionicon-Name-Lookup mit Fallback auf 'trophy' — ein Emoji wurde
-- dort nie korrekt angezeigt. Diese Migration bringt die BESTEHENDEN Datensaetze
-- auf dieselben Ionicon-Namen, die das init-script jetzt verwendet.
--
-- Mapping (identisch zu 007_levels.sql):
--   Novize   leaf,  Lehrling book,   Gehilfe people,
--   Experte  star,  Meister  trophy, Legende medal
--
-- Es werden NUR die unveraenderten Emoji-Defaultwerte ersetzt — im Modal bereits
-- bearbeitete Levels haben schon einen Ionicon-Namen und werden nicht angefasst.
-- Spalte ggf. von VARCHAR(10) auf VARCHAR(50) erweitern (Ionicon-Namen koennen
-- laenger als 10 Zeichen sein, z.B. 'colorPalette').
-- Idempotent: ein zweiter Lauf findet keine Emojis mehr und aendert nichts.

ALTER TABLE levels ALTER COLUMN icon TYPE VARCHAR(50);

UPDATE levels SET icon = 'leaf'   WHERE icon = '🌱';
UPDATE levels SET icon = 'book'   WHERE icon = '📚';
UPDATE levels SET icon = 'people' WHERE icon = '🤝';
UPDATE levels SET icon = 'star'   WHERE icon = '🎯';
UPDATE levels SET icon = 'trophy' WHERE icon = '🏆';
UPDATE levels SET icon = 'medal'  WHERE icon = '👑';

-- Spalten-Default ebenfalls von Emoji auf Ionicon-Namen umstellen
ALTER TABLE levels ALTER COLUMN icon SET DEFAULT 'trophy';
