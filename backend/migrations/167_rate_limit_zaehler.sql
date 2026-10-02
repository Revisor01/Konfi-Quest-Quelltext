-- 167_rate_limit_zaehler.sql
--
-- Gemeinsamer Zaehler-Speicher fuer die Rate-Limiter aller Backend-Replicas
-- 
--
-- DAS PROBLEM: express-rate-limit zaehlte je Prozess im Speicher. Hinter
-- Traefik mit zwei Replicas galt damit jedes Limit doppelt (40 statt 20
-- Doku-Passwort-Versuche, 600 statt 300 Login-Fehlversuche), und 429 kam
-- scheinbar zufaellig, je nachdem, welche Replica gerade "voll" war.
-- Es gibt kein Redis im Stack; die vorhandene Datenbank uebernimmt den
-- Zaehler (utils/rateLimitStore.js).
--
-- UNLOGGED: kein WAL, dafuer schneller -- und nach einem Absturz der
-- Datenbank ist die Tabelle leer. Fuer Fenster von einer Minute bis zu einer
-- Stunde ist das genau richtig; nichts darin ist aufbewahrungswuerdig.
--
-- schluessel = "<limiter>:<nutzer-oder-ip>", ablauf = Ende des laufenden
-- Fensters. Der Index auf ablauf traegt das periodische Aufraeumen.
--
-- Rein additiv: keine bestehende Tabelle, kein Vertrag aendert sich.

CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_zaehler (
  schluessel TEXT PRIMARY KEY,
  treffer    INTEGER NOT NULL DEFAULT 0,
  ablauf     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_zaehler_ablauf
  ON rate_limit_zaehler (ablauf);
