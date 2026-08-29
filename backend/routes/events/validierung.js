
/**
 * Validiert die Felder des Teamer-Kontingents.
 * 0 = unbegrenzt (Konvention wie max_participants), negativ ist ungueltig.
 * @returns {string|null} Fehlermeldung oder null wenn alles in Ordnung ist
 */
function validateTeamerQuota(teamerMaxParticipants, teamerMaxWaitlistSize) {
  if (teamerMaxParticipants !== undefined && teamerMaxParticipants !== null) {
    const value = parseInt(teamerMaxParticipants, 10);
    if (Number.isNaN(value) || value < 0) {
      return 'teamer_max_participants muss eine Zahl >= 0 sein (0 = unbegrenzt)';
    }
  }
  if (teamerMaxWaitlistSize !== undefined && teamerMaxWaitlistSize !== null) {
    const value = parseInt(teamerMaxWaitlistSize, 10);
    if (Number.isNaN(value) || value < 0) {
      return 'teamer_max_waitlist_size muss eine Zahl >= 0 sein';
    }
  }
  return null;
}

module.exports = { validateTeamerQuota };
