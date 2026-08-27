/**
 * Team-Zugehoerigkeit im Chat.
 *
 * Der Chat kennt DREI Werte für den Nutzertyp — 'admin' (Leitung/Admin),
 * 'teamer' (Teamer:in) und 'konfi' —, sowohl in `chat_participants.user_type`
 * als auch in den API-Antworten. "Team" meint die ersten beiden.
 *
 * Warum eigene Datei: Die Prüfung stand mehrfach als `=== 'admin'` im Code und
 * war dadurch an drei Stellen falsch: Der Rollenfilter "Team" im
 * Chat-Anlegen-Modal blendete Teamer:innen aus, die Liste stellte sie in
 * Konfi-Farbe ohne Funktionsbezeichnung dar, und Direktchats mit Teamer:innen
 * landeten in der Übersicht im falschen Reiter. Eine gemeinsame Funktion haelt
 * die Regel an einer Stelle und macht sie testbar.
 */

export type ChatNutzerTyp = 'admin' | 'teamer' | 'konfi';

/** Gehoert dieser Typ zum Team (Leitung, Admin oder Teamer:in)? */
export const istTeamTyp = (typ?: string | null): boolean =>
  typ === 'admin' || typ === 'teamer';

/** Ist das ein Konfi? Gegenstueck zu istTeamTyp, ohne die Luecke bei undefined. */
export const istKonfiTyp = (typ?: string | null): boolean => typ === 'konfi';
