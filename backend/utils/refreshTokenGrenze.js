// DIE REGEL, nach jeder Ausgabe eines Tokens (Anmeldung, Registrierung,
// Refresh, Passwortwechsel):
//   1. Traegt das neue Token eine Geraete-Kennung (Migration 171), endet jedes
//      andere offene Token desselben Kontos auf DEMSELBEN Geraet. Ein Geraet
//      haelt nur eine Sitzung je Konto; ein aelteres Token dort ist eine
//      vergessene Anmeldung.
//   2. Vom Konto bleiben die REFRESH_TOKENS_JE_KONTO juengsten offenen Tokens,
//      aeltere werden beendet.
//
// BEENDET heisst wie beim Abmelden: revoked_at UND expires_at auf jetzt. So
// faellt das Token weder in die Gnadenfrist noch unter das Diebstahl-Signal
// (routes/auth.js, /refresh) -- es gibt ein schlichtes 401, und die App geht
// zur Anmeldung (auch 2.2.0 und 2.3.0: der 401-Pfad in services/api.ts leert
// die Sitzung und zeigt "Sitzung abgelaufen"). Die Gnadenfrist selbst bleibt
// unberuehrt: das gerade rotierte Token ist bereits widerrufen und zaehlt
// nicht mit, sein Nachfolger ist das juengste.
//
// Der Aufraeumlauf (BackgroundService.cleanupRefreshTokens) loescht beendete
// Tokens beim naechsten Lauf, weil ihr expires_at dann in der Vergangenheit
// liegt.

const REFRESH_TOKENS_JE_KONTO = 10;

/**
 * Setzt die Regel fuer ein Konto durch, nachdem ein Token ausgegeben wurde.
 *
 * @param {object} db            pg-Pool oder -Client
 * @param {number} userId
 * @param {object} [optionen]
 * @param {number} [optionen.neuId]   id des gerade ausgegebenen Tokens
 * @param {string|null} [optionen.geraet]  seine Geraete-Kennung
 * @returns {Promise<{geraet: number, ueberGrenze: number}>} beendete Tokens
 */
async function refreshTokensBegrenzen(db, userId, { neuId = null, geraet = null } = {}) {
  let proGeraet = 0;
  if (geraet && neuId) {
    const { rowCount } = await db.query(
      `UPDATE refresh_tokens
          SET revoked_at = NOW(), expires_at = NOW()
        WHERE user_id = $1 AND device_id = $2 AND id <> $3
          AND revoked_at IS NULL AND expires_at > NOW()`,
      [userId, geraet, neuId]
    );
    proGeraet = rowCount || 0;
  }

  const { rowCount: ueberGrenze } = await db.query(
    `UPDATE refresh_tokens
        SET revoked_at = NOW(), expires_at = NOW()
      WHERE id IN (
        SELECT id FROM refresh_tokens
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC NULLS LAST, id DESC
        OFFSET $2
      )`,
    [userId, REFRESH_TOKENS_JE_KONTO]
  );

  return { geraet: proGeraet, ueberGrenze: ueberGrenze || 0 };
}

module.exports = { REFRESH_TOKENS_JE_KONTO, refreshTokensBegrenzen };
