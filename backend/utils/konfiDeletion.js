// backend/utils/konfiDeletion.js
// Gemeinsame kaskadierende Loesch-Funktion für Konfis.
// Single Source of Truth: wird von Admin-Delete, Self-Delete (Plan 02)
// und Auto-Delete (Plan 05) genutzt, damit die Loesch-Pfade nicht
// auseinanderlaufen.

const { deletePhotoFile, deleteChallengeFile, deleteChatFile } = require('./photoStorage');

/**
 * Loescht einen Konfi und alle 16 abhaengigen Tabellen in der korrekten
 * FK-Reihenfolge (Kind-Tabellen zuerst, users zuletzt).
 *
 * WICHTIG: Diese Funktion fuehrt KEIN BEGIN/COMMIT/ROLLBACK aus. Der Aufrufer
 * steuert die Transaktion und uebergibt einen client (aus db.getClient()).
 * So können Admin/Self/Auto-Delete die Löschung in ihre eigene Transaktion
 * einbetten.
 *
 * organization_id wird nur bei Tabellen mitgegeben, die die Spalte besitzen
 * (user_activities, bonus_points, event_points, event_bookings, activity_requests).
 *
 * @param {import('pg').PoolClient} client - DB-Client (Transaktion vom Aufrufer gesteuert)
 * @param {number} userId - ID des zu loeschenden Konfis
 * @param {number} organizationId - Organisation des Konfis (Scope-Schutz)
 */
async function deleteKonfiCascade(client, userId, organizationId) {
  // Reihenfolge MUSS erhalten bleiben (FK-Constraints).
  await client.query("DELETE FROM user_activities WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]);
  await client.query("DELETE FROM bonus_points WHERE konfi_id = $1 AND organization_id = $2", [userId, organizationId]);
  await client.query("DELETE FROM event_points WHERE konfi_id = $1 AND organization_id = $2", [userId, organizationId]);
  await client.query("DELETE FROM event_bookings WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]);
  await client.query("DELETE FROM user_badges WHERE user_id = $1", [userId]);
  // Nachweisfotos der Anträge dieses Konfis vor dem DB-Delete einsammeln,
  // damit die Dateien anschliessend vom Dateisystem entfernt werden können.
  const { rows: photoRows } = await client.query(
    "SELECT photo_filename FROM activity_requests WHERE user_id = $1 AND organization_id = $2 AND photo_filename IS NOT NULL",
    [userId, organizationId]
  );
  await client.query("DELETE FROM activity_requests WHERE user_id = $1 AND organization_id = $2", [userId, organizationId]);
  let challengeFileRows = [];
  const { rows: [chTbl] } = await client.query("SELECT to_regclass('public.challenge_submissions') as t");
  if (chTbl?.t) {
    ({ rows: challengeFileRows } = await client.query(
      "SELECT file_path FROM challenge_submissions WHERE user_id = $1 AND organization_id = $2 AND file_path IS NOT NULL",
      [userId, organizationId]
    ));
  }
  await client.query("DELETE FROM chat_participants WHERE user_id = $1 AND user_type = 'konfi'", [userId]);
  await client.query("DELETE FROM chat_read_status WHERE user_id = $1", [userId]);
  // chat_message_reactions: Reaktionen des Konfis entfernen (kein CASCADE garantiert).
  // to_regclass ist transaktions-neutral (funktioniert mit und ohne umschliessende TX,
  // da diese Funktion in beiden Modi aufgerufen wird).
  const { rows: [reactTbl] } = await client.query("SELECT to_regclass('public.chat_message_reactions') as t");
  if (reactTbl?.t) {
    await client.query("DELETE FROM chat_message_reactions WHERE user_id = $1 AND user_type = 'konfi'", [userId]);
  }
  // Chat-Anhaenge: Dateipfade VOR dem Löschen der Nachrichten einsammeln —
  // dieselbe Fehlerklasse wie bei den Challenge-Dateien direkt darüber: Die
  // DB-Zeilen verschwinden, die verschluesselten Dateien auf der Platte sonst
  // nicht.
  const { rows: chatFileRows } = await client.query(
    "SELECT file_path FROM chat_messages WHERE user_id = $1 AND file_path IS NOT NULL",
    [userId]
  );
  await client.query("DELETE FROM chat_messages WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM notifications WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM password_resets WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM user_jahrgang_assignments WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM chat_poll_votes WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM push_tokens WHERE user_id = $1", [userId]);
  await client.query("DELETE FROM konfi_profiles WHERE user_id = $1", [userId]);
  // Verliehene Urkunden. Der Fremdschlüssel auf users(id) hat KEIN ON DELETE
  // und blockierte damit jede Löschung einer Person, die je eine Urkunde
  // bekommen hat — gegen Produktion nachgewiesen. Weiter
  // unten wird nur user_certificates.admin_id genullt, also die verleihende
  // Seite; die empfangende fehlte.
  await client.query("DELETE FROM user_certificates WHERE user_id = $1", [userId]);
  // URHEBERSCHAFT anonymisieren statt löschen.
  //
  // Siebzehn Fremdschlüssel zeigen auf users(id) — die meisten OHNE
  // ON DELETE. Bleibt auch nur einer stehen, scheitert das DELETE auf users
  // mit einem 500er. Betroffen ist nicht nur der geloeschte Konfi selbst:
  // Diese Funktion löscht auch Teamer- und Admin-Konten (Selbstloeschung
  // über /auth/delete-account, alle Rollen). Wer je Punkte vergeben, ein
  // Event angelegt oder ein Abzeichen erstellt hat, konnte seinen Account
  // deshalb GAR NICHT löschen.
  //
  // Die Eintraege selbst bleiben erhalten: Vergebene Punkte, angelegte Events
  // und Materialien gehören der Gemeinde, nicht der Person. Nur der Bezug auf
  // das geloeschte Konto fällt weg — dieselbe Logik wie bei chat_rooms.
  const urheberFelder = [
    ['bonus_points', 'admin_id'],
    ['event_points', 'admin_id'],
    ['user_activities', 'admin_id'],
    ['user_certificates', 'admin_id'],
    ['activity_requests', 'approved_by'],
    ['chat_rooms', 'created_by'],
    ['custom_badges', 'created_by'],
    ['events', 'created_by'],
    ['levels', 'created_by'],
    ['materials', 'created_by'],
    ['user_jahrgang_assignments', 'assigned_by'],
  ];
  for (const [tabelle, spalte] of urheberFelder) {
    await client.query(`UPDATE ${tabelle} SET ${spalte} = NULL WHERE ${spalte} = $1`, [userId]);
  }

  // invite_codes.created_by ist NOT NULL — hier geht kein Anonymisieren.
  // Einladungscodes sind kurzlebig und an die einladende Person gebunden;
  // ohne sie ergeben sie keinen Sinn mehr, also löschen.
  await client.query("DELETE FROM invite_codes WHERE created_by = $1", [userId]);

  await client.query("DELETE FROM users WHERE id = $1", [userId]);

  // Nachweisfotos vom Dateisystem entfernen (nach dem DB-Delete, nicht
  // blockierend — ein fehlendes File darf die Löschung nicht scheitern lassen).
  for (const row of photoRows) {
    await deletePhotoFile(row.photo_filename);
  }
  for (const row of challengeFileRows) {
    await deleteChallengeFile(row.file_path);
  }
  for (const row of chatFileRows) {
    await deleteChatFile(row.file_path);
  }
}

module.exports = { deleteKonfiCascade };
