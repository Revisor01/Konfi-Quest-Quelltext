-- Migration 084: Globaler Push-Master-Schalter pro User
-- Fuegt die Spalte users.push_enabled hinzu (Default true).
--   push_enabled = true   = User erhaelt Push-Benachrichtigungen (Standard).
--   push_enabled = false  = ALLE Push-Benachrichtigungen fuer diesen User aus.
-- Die Pruefung erfolgt zentral in PushService.getTokensForUser: ist push_enabled
-- false, werden keine Tokens zurueckgegeben und es wird nichts gesendet. Das deckt
-- alle Push-Typen ab, die ueber sendToUser / sendToMultipleUsers / sendChatNotification
-- laufen. Der OS-Permission-Status bleibt davon unberuehrt (zwei Ebenen:
-- Geraet erlaubt Push UND User will Push).
-- Bewusster DEFAULT true mit Backfill: bestehende User behalten ihr aktuelles
-- Verhalten (Push an), niemand wird durch die Migration stummgeschaltet.
-- Idempotent (IF NOT EXISTS), wird vom Migration-Runner (backend/database.js,
-- alphabetisch sortiert) in einem einzigen pool.query ausgefuehrt.

ALTER TABLE users ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true;
