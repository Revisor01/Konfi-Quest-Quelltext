/**
 * Guard-Funktion: Prüft ob ein Punkte-Typ für den Jahrgang eines Konfis aktiviert ist.
 * Verhindert Punktevergabe an deaktivierte Typen.
 */

async function checkPointTypeEnabled(db, konfiId, pointType) {
  const enabledField = pointType === 'gottesdienst' ? 'gottesdienst_enabled' : 'gemeinde_enabled';
  const typeName = pointType === 'gottesdienst' ? 'Gottesdienst' : 'Gemeinde';

  const { rows } = await db.query(
    `SELECT j.${enabledField} as enabled
     FROM konfi_profiles kp
     JOIN jahrgaenge j ON kp.jahrgang_id = j.id
     WHERE kp.user_id = $1`,
    [konfiId]
  );

  if (rows.length === 0) {
    return { enabled: false, error: 'Konfi-Profil oder Jahrgang nicht gefunden' };
  }

  if (!rows[0].enabled) {
    return { enabled: false, error: `${typeName}-Punkte sind für diesen Jahrgang deaktiviert` };
  }

  return { enabled: true };
}

module.exports = { checkPointTypeEnabled };
