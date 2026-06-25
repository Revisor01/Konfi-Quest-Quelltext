-- 106_poll_anonymous_exclusive.sql
-- Umfragen erweitern um zwei Optionen:
--   1) anonymous: ist die Umfrage anonym? (default true = bisheriges Verhalten).
--      Bei false sieht man pro Option die Namen der Waehlenden.
--   2) exclusive_options: jede Option darf nur von EINER Person gewaehlt werden
--      (first-come-first-served, z.B. Tour-Verteilung A/B/C/D). Sobald jemand eine
--      Option waehlt, ist sie fuer alle anderen gesperrt.
ALTER TABLE chat_polls ADD COLUMN IF NOT EXISTS anonymous BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE chat_polls ADD COLUMN IF NOT EXISTS exclusive_options BOOLEAN NOT NULL DEFAULT false;

-- Race-Sicherheit fuer exclusive_options: pro (poll, option) darf es nur EINE
-- Stimme geben. Der Partial-Unique-Index greift nur fuer exklusive Umfragen,
-- damit normale (Mehrfach-)Umfragen unberuehrt bleiben. Bei gleichzeitigen
-- Votes auf dieselbe Option scheitert der zweite INSERT am Constraint -> sauber
-- als "schon vergeben" behandelbar.
-- Hinweis: Der Index braucht eine Bedingung auf chat_polls.exclusive_options,
-- die in einem Index auf chat_poll_votes nicht direkt referenzierbar ist. Daher
-- wird die Exklusivitaet zusaetzlich in der Vote-Route per FOR UPDATE + Pruefung
-- abgesichert; dieser Index ist die zweite Verteidigungslinie fuer den Fall,
-- dass exklusive Polls spaeter eine eigene Markierung an den Votes bekommen.
-- Fuer JETZT genuegt die transaktionale Pruefung in der Route (kein Index noetig).
