// In-Memory-TTL-Cache fuer den Chat-Mitgliedschafts-Sync.
//
// Hintergrund: GET /chat/rooms fuehrte bei JEDEM Aufruf syncJahrgangChat (pro
// Jahrgang des Users) + syncTeamChat aus — 25-35 Queries Schreibarbeit auf dem
// meistgerufenen Lesepfad der App (Hauptursache p95 ~919ms). Der Sync stellt
// nur sicher, dass die Raum-Mitgliedschaften zum aktuellen Rollen-/Jahrgangs-
// Stand passen — das aendert sich selten und muss nicht pro Request geprueft
// werden.
//
// Warum der TTL sicher ist: Ein NEUER User hat keinen Cache-Eintrag — sein
// erster /rooms-Aufruf synct ihn sofort in seine Raeume. Bestehende Mitglieder
// brauchen den Sync nicht, um andere zu sehen. Und ALLE Mutations-Handler
// korrigieren die Mitgliedschaften bereits INLINE, unabhaengig vom /rooms-Sync:
// users.js POST /:id/jahrgaenge (syncJahrgangChat direkt), konfi-management.js
// POST / + PUT /:id (synct alten UND neuen Jahrgang), promote-teamer (patcht
// chat_participants.user_type direkt). Der /rooms-Sync ist damit nur ein
// Selbstheilungs-Netz — TTL-gesteuert voellig ausreichend.
//
// Replika-Hinweis: Der Cache ist PRO Backend-Replika — auf der jeweils anderen
// greift der Sync spaetestens nach Ablauf des TTL. Bewusst akzeptiert.
// invalidate() ist fuer kuenftige Mutations-Pfade ohne Inline-Sync exportiert.

const TTL_MS = 10 * 60 * 1000; // 10 Minuten
const MAX_ENTRIES = 5000; // Speicher-Guard: aelteste Eintraege verdraengen

// Map<'orgId:userId', lastSyncMs> — Insertion-Order genuegt als grobe LRU.
const lastSync = new Map();

function key(orgId, userId) {
  return `${orgId}:${userId}`;
}

// Muss der Sync fuer diesen User (wieder) laufen?
function needsSync(orgId, userId) {
  const t = lastSync.get(key(orgId, userId));
  return !t || (Date.now() - t) > TTL_MS;
}

// Nach erfolgreichem Sync aufrufen.
function markSynced(orgId, userId) {
  if (lastSync.size >= MAX_ENTRIES) {
    // Aeltesten (zuerst eingefuegten) Eintrag verdraengen.
    const oldest = lastSync.keys().next().value;
    lastSync.delete(oldest);
  }
  // Re-Insert ans Ende (frischester Eintrag).
  lastSync.delete(key(orgId, userId));
  lastSync.set(key(orgId, userId), Date.now());
}

// Bei Jahrgang-/Rollenwechsel eines Users aufrufen: Der naechste /rooms-Aufruf
// synct dann sofort neu (statt bis zu TTL zu warten).
function invalidate(orgId, userId) {
  lastSync.delete(key(orgId, userId));
}

// Nur fuer Tests: kompletten Cache leeren (DB wird zwischen Tests getruncated,
// der Modul-Cache wuerde sonst Sync-Laeufe faelschlich ueberspringen).
function clear() {
  lastSync.clear();
}

module.exports = { needsSync, markSynced, invalidate, clear };
