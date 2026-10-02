-- 158_push_gruppen_stumm.sql
--
-- WELCHE PUSH-GRUPPEN EINE PERSON STUMMGESCHALTET HAT
--
-- Bis hierher gab es genau einen Schalter: users.push_enabled (Migration 084),
-- alles oder nichts. Android laesst in den Systemeinstellungen jeden Kanal
-- einzeln stummschalten, iOS nicht. Damit die Auswahl auf beiden Plattformen
-- geht, trifft die App sie selbst -- und der Server speichert sie hier.
--
-- GESPEICHERT WIRD DIE ABWAHL, nicht die Auswahl. Ein leeres Feld heisst
-- "alles an" -- fuer alle bestehenden Konten und fuer jedes neue, ohne dass
-- jemand etwas eintragen muss. Kommt spaeter eine fuenfte Gruppe dazu, ist sie
-- fuer alle automatisch an, statt still zu fehlen. Die Kennungen sind die
-- Android-Kanaele (konfi_chat, konfi_termine, konfi_fortschritt,
-- konfi_verwaltung; utils/pushGruppen.js) -- dieselben vier Toepfe, die das
-- Geraet kennt.
--
-- TEXT[] statt einer Tabelle: vier feste Werte je Person, gelesen in JEDER
-- Token-Abfrage des Versands (PushService.getTokensForUser, getTokensForUsers,
-- sendChatNotification). Die Pruefung ist ein Vergleich in derselben Zeile,
-- in der schon push_enabled steht -- kein zweiter Join bei 15.000 Empfaengern.
-- JSONB haette dieselbe Zeile gekostet, aber einen unhandlicheren Vergleich;
-- eine eigene Tabelle einen Join, den niemand braucht.
--
-- push_enabled BLEIBT der Hauptschalter und gilt weiter fuer alles. Die
-- Abwahl greift nur darunter, nur fuer den Versand -- der Postfach-Eintrag
-- entsteht unabhaengig davon (utils/postfachArten.js).
--
-- ALT-APP-VERTRAG: rein additiv. GET/PUT /notifications/preferences liefern
-- push_enabled unveraendert; die Gruppen kommen als neue Felder dazu.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_gruppen_stumm TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN users.push_gruppen_stumm IS
  'Stummgeschaltete Push-Gruppen (Kennungen der Android-Kanaele, utils/pushGruppen.js). Leer = alles an. Greift nur unter push_enabled und nur fuer den Versand, nicht fuers Postfach.';
