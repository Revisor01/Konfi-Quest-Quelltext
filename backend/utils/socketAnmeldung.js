// socketAnmeldung.js -- Anmeldung am Socket.io-Server.
//
// Frueher stand hier `socket.user = decoded` — die Angaben aus dem Token
// galten damit ungeprueft, und ein Socket lebt deutlich laenger als die
// 15 Minuten Token-Laufzeit. Ein geloeschtes, deaktiviertes oder per
// Passwortwechsel gesperrtes Konto behielt seine Live-Verbindung
// Die Prüfung kostet EINE Query je Verbindungsaufbau,
// nicht je Nachricht — der Socket verbindet sich einmal und bleibt dann.
const jwt = require('jsonwebtoken');
const { Sammelzeile } = require('./sammelzeile');

// Abgelehnte Tokens beim Verbindungsaufbau: gebuendelt je
// Viertelstunde statt eine Zeile je Versuch. Der haeufigste Grund ist
// "jwt expired" -- eine App, die nach der Pause mit dem alten Token
// wiederverbindet, bevor sie es erneuert hat. Routine, aber ein Muster wie
// "invalid signature" soll sichtbar bleiben: Die Zeile nennt die Anzahl je
// Grund (utils/sammelzeile.js).
const abgelehnteAnmeldungen = new Sammelzeile('Socket.io Auth fehlgeschlagen');

/**
 * @param {object} db
 * @param {string} jwtSecret
 * @returns {(socket: import('socket.io').Socket, next: (err?: Error) => void) => Promise<void>}
 */
function socketAnmeldung(db, jwtSecret) {
  return async (socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      abgelehnteAnmeldungen.zaehle(err.message);
      return next(new Error('Invalid token'));
    }

    try {
      const { rows: [nutzer] } = await db.query(
        `SELECT u.id, u.organization_id, u.display_name, u.token_invalidated_at, r.name AS role_name
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1 AND u.deleted_at IS NULL AND u.is_active = true`,
        [decoded.id]
      );
      if (!nutzer) {
        return next(new Error('Invalid token'));
      }

      // Soft-Revoke wie in rbac.js: Sperren aus einem Passwortwechsel gelten auch hier.
      if (nutzer.token_invalidated_at) {
        const ausgestellt = decoded.iat;
        const gesperrtAb = Math.floor(new Date(nutzer.token_invalidated_at).getTime() / 1000);
        if (ausgestellt < gesperrtAb) {
          return next(new Error('Token invalidated'));
        }
      }

      // Aktive Organisation aufloesen (Umschalter). Ohne das arbeitet der Socket
      // immer in der Primaer-Org — die Raum-Prüfungen (joinRoom) hätten
      // in einer Zweit-Gemeinde die falsche Organisation verglichen.
      let orgId = nutzer.organization_id;
      let rolle = nutzer.role_name;
      const tokenOrg = decoded.active_organization_id ? parseInt(decoded.active_organization_id) : null;

      if (Number.isInteger(tokenOrg) && tokenOrg !== orgId) {
        const { rows: [mitgliedschaft] } = await db.query(
          `SELECT uo.organization_id, r.name AS role_name
           FROM user_organizations uo
           JOIN roles r ON uo.role_id = r.id
           WHERE uo.user_id = $1 AND uo.organization_id = $2`,
          [decoded.id, tokenOrg]
        );
        if (!mitgliedschaft) {
          return next(new Error('Kein Zugriff auf diese Gemeinde'));
        }
        orgId = mitgliedschaft.organization_id;
        rolle = mitgliedschaft.role_name;
      }

      socket.user = {
        id: nutzer.id,
        organization_id: orgId,
        role_name: rolle,
        type: rolle === 'konfi' ? 'konfi' : rolle === 'teamer' ? 'teamer' : 'admin',
        display_name: nutzer.display_name
      };
      next();
    } catch (err) {
      console.error('Socket.io Auth: Datenbankfehler:', err.message);
      return next(new Error('Authentication failed'));
    }
  };
}

module.exports = { socketAnmeldung, abgelehnteAnmeldungen };
