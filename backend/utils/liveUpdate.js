// Live Update Helper
// Sendet WebSocket-Events an User für Echtzeit-Aktualisierungen

let _io = null;
let _db = null;

/**
 * OFFENE NACHLAEUFER -- nur im Test gefuehrt.
 *
 * Die send*-Funktionen sind `async` und fragen die Datenbank ab, werden aber
 * an 118 Stellen OHNE `await` gerufen: Ein Live-Update ist Beiwerk, die
 * Antwort soll nicht darauf warten. In Produktion ist das richtig.
 *
 * Im Test ist es die Ursache eines sporadischen Fehlschlags: supertest
 * schliesst die Verbindung, sobald die Antwort da ist. Laeuft die Abfrage
 * dann noch, riss der Abbruch etwa jeden 1200. Test mit --
 * "Parse Error: Expected HTTP/, RTSP/ or ICE/", wechselnd welchen.
 *
 * Statt 118 Aufrufe einzeln zu wickeln, meldet sich der Nachlauf hier
 * selbst an. `warteAufLiveUpdates()` wartet auf alle -- gerufen wird es aus
 * tests/helpers/testApp.js zusammen mit den uebrigen Nachwehen.
 */
const _offene = new Set();

function _merken(lauf) {
  if (process.env.NODE_ENV !== 'test') return lauf;
  _offene.add(lauf);
  lauf.finally(() => _offene.delete(lauf));
  return lauf;
}

/** Wartet, bis alle angefangenen Live-Updates durch sind. Nur fuer Tests. */
async function warteAufLiveUpdates() {
  // Mehrfach durchlaufen: Ein Update kann ein weiteres anstossen.
  for (let runde = 0; runde < 10 && _offene.size > 0; runde++) {
    await Promise.allSettled([..._offene]);
  }
}

/**
 * @param {object} io - Socket.IO-Instanz
 * @param {object} [db] - Datenbank-Pool. Wird er uebergeben, nutzen die
 *   Rollen-Abfragen genau diesen Pool. Ohne ihn faellt das Modul auf das
 *   Singleton aus ../database zurueck (Bestandsverhalten).
 */
function init(io, db = null) {
  _io = io;
  if (db) _db = db;
}

// Pool fuer die Rollen-Abfragen. Bevorzugt den per init() uebergebenen; nur
// wenn keiner gesetzt ist, wird das Singleton lazy nachgeladen.
function getDb() {
  if (_db) return _db;
  return require('../database');
}

// Nur fuer Tests: zurueck auf den Ausgangszustand.
function _reset() {
  _io = null;
  _db = null;
}

/**
 * Sendet ein Live-Update an einen spezifischen User
 * @param {string} userType - 'konfi' oder 'admin'
 * @param {number} userId - User ID
 * @param {string} updateType - z.B. 'dashboard', 'events', 'badges', 'requests'
 * @param {string} action - 'refresh', 'update', 'delete', 'create'
 * @param {object} data - Optionale zusätzliche Daten
 */
function sendToUser(userType, userId, updateType, action = 'refresh', data = null) {
  if (!_io) {
    return;
  }

  const userRoom = `user_${userType}_${userId}`;
  const event = {
    type: updateType,
    action: action,
    targetUserId: userId,
    targetUserType: userType,
    data: data,
    timestamp: new Date().toISOString()
  };

  _io.to(userRoom).emit('liveUpdate', event);
}

/**
 * Sendet ein Live-Update an alle Admins einer Organisation
 * @param {number} organizationId - Organisation ID
 * @param {string} updateType - z.B. 'konfis', 'events', 'requests'
 * @param {string} action - 'refresh', 'update', 'delete', 'create'
 * @param {object} data - Optionale zusätzliche Daten
 */
async function sendToOrgAdmins(organizationId, updateType, action = 'refresh', data = null) {
  if (!_io) {
    return;
  }

  try {
    const db = getDb();
    // Hole alle Admins, Org-Admins und Teamer:innen dieser Organisation.
    // Rollenname wird mitgeholt, weil Teamer-Sockets in einem EIGENEN Raum
    // (user_teamer_<id>) sitzen, während admin/org_admin im Raum
    // user_admin_<id> sitzen (Socket-Join-Typ aus dem JWT, server.js:75f).
    // Nur nicht-geloeschte User (deleted_at IS NULL) sollen Updates bekommen.
    //
    // Mehrfach-Zugehoerigkeit: users.organization_id haelt nur die PRIMAER-Org.
    // Wer per Umschalter in einer Zweit-Organisation arbeitet, steht dort
    // ausschliesslich in user_organizations — und bekam deshalb in dieser Org
    // gar keine Live-Updates. Deshalb beide Quellen vereinen.
    // Die Rolle wird je Quelle getrennt gezogen: user_organizations trägt ein
    // eigenes role_id, die Rolle kann sich also je Gemeinde unterscheiden.
    const adminsResult = await db.query(`
      SELECT u.id, r.name AS role_name FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.organization_id = $1
      AND r.name IN ('admin', 'org_admin', 'teamer')
      AND u.deleted_at IS NULL
      UNION
      SELECT u.id, r.name AS role_name FROM users u
      JOIN user_organizations uo ON uo.user_id = u.id
      JOIN roles r ON r.id = uo.role_id
      WHERE uo.organization_id = $1
      AND r.name IN ('admin', 'org_admin', 'teamer')
      AND u.deleted_at IS NULL
    `, [organizationId]);

    const event = {
      type: updateType,
      action: action,
      data: data,
      timestamp: new Date().toISOString()
    };

    adminsResult.rows.forEach(admin => {
      // Teamer:innen sitzen im Raum user_teamer_<id>, alle uebrigen im
      // Admin-Raum user_admin_<id>. Vorher gingen ALLE an user_admin_<id> ->
      // Teamer-Sockets erhielten NIE ein Org-Broadcast.
      const roomType = admin.role_name === 'teamer' ? 'teamer' : 'admin';
      const userRoom = `user_${roomType}_${admin.id}`;
      _io.to(userRoom).emit('liveUpdate', event);
    });

  } catch (error) {
 console.error('LiveUpdate: Error sending to org admins:', error);
  }
}

/**
 * Sendet ein Live-Update an alle Konfis einer Organisation
 * @param {number} organizationId - Organisation ID
 * @param {string} updateType - z.B. 'events', 'badges'
 * @param {string} action - 'refresh', 'update', 'delete', 'create'
 * @param {object} data - Optionale zusätzliche Daten
 */
async function sendToOrgKonfis(organizationId, updateType, action = 'refresh', data = null) {
  if (!_io) {
    return;
  }

  try {
    const db = getDb();
    // Hole alle Konfis dieser Organisation. Wie bei sendToOrgAdmins beide
    // Quellen vereinen: users.organization_id (Primaer-Org) und
    // user_organizations (Zweit-Organisationen über den Umschalter).
    const konfisResult = await db.query(`
      SELECT u.id FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.organization_id = $1
      AND r.name = 'konfi'
      AND u.deleted_at IS NULL
      UNION
      SELECT u.id FROM users u
      JOIN user_organizations uo ON uo.user_id = u.id
      JOIN roles r ON r.id = uo.role_id
      WHERE uo.organization_id = $1
      AND r.name = 'konfi'
      AND u.deleted_at IS NULL
    `, [organizationId]);

    const event = {
      type: updateType,
      action: action,
      data: data,
      timestamp: new Date().toISOString()
    };

    konfisResult.rows.forEach(konfi => {
      const userRoom = `user_konfi_${konfi.id}`;
      _io.to(userRoom).emit('liveUpdate', event);
    });

  } catch (error) {
 console.error('LiveUpdate: Error sending to org konfis:', error);
  }
}

/**
 * Sendet ein Live-Update an alle User einer Organisation (Admins + Konfis)
 */
async function sendToOrg(organizationId, updateType, action = 'refresh', data = null) {
  await sendToOrgAdmins(organizationId, updateType, action, data);
  await sendToOrgKonfis(organizationId, updateType, action, data);
}

/**
 * Sendet ein Live-Update an alle Konfis eines bestimmten Jahrgangs
 */
async function sendToJahrgang(jahrgangId, updateType, action = 'refresh', data = null) {
  if (!_io) {
    return;
  }

  try {
    const db = getDb();
    const konfisResult = await db.query(`
      SELECT u.id FROM users u
      JOIN konfi_profiles kp ON u.id = kp.user_id
      WHERE kp.jahrgang_id = $1
      AND u.deleted_at IS NULL
    `, [jahrgangId]);

    const event = {
      type: updateType,
      action: action,
      data: data,
      timestamp: new Date().toISOString()
    };

    konfisResult.rows.forEach(konfi => {
      const userRoom = `user_konfi_${konfi.id}`;
      _io.to(userRoom).emit('liveUpdate', event);
    });

  } catch (error) {
 console.error('LiveUpdate: Error sending to jahrgang:', error);
  }
}

/**
 * Convenience-Funktion: Sendet ein Live-Update an einen spezifischen Konfi
 * @param {number} konfiId - Konfi User ID
 * @param {string} updateType - z.B. 'dashboard', 'events', 'badges', 'requests', 'points'
 * @param {string} action - 'refresh', 'update', 'delete', 'create'
 * @param {object} data - Optionale zusätzliche Daten
 */
function sendToKonfi(konfiId, updateType, action = 'refresh', data = null) {
  sendToUser('konfi', konfiId, updateType, action, data);
}

/**
 * Convenience-Funktion: Sendet ein Live-Update an einen spezifischen Admin
 * @param {number} adminId - Admin User ID
 * @param {string} updateType - z.B. 'konfis', 'events', 'requests'
 * @param {string} action - 'refresh', 'update', 'delete', 'create'
 * @param {object} data - Optionale zusätzliche Daten
 */
function sendToAdmin(adminId, updateType, action = 'refresh', data = null) {
  sendToUser('admin', adminId, updateType, action, data);
}

/**
 * Sendet ein Live-Update an einen User anhand seiner DB-Rolle in den KORREKTEN
 * Socket-Raum. Notwendig, weil ein Empfaenger sowohl Konfi als auch Teamer:in
 * oder Admin sein kann und die Sockets je nach Typ in verschiedenen Räumen
 * sitzen (user_konfi_/user_teamer_/user_admin_, server.js:75f). Ein blindes
 * sendToKonfi() an z.B. einen Teamer landet sonst im leeren Konfi-Raum.
 *
 * Mapping: role 'teamer' -> Raum-Typ 'teamer'; role 'konfi' -> 'konfi';
 * alles andere (admin/org_admin/...) -> 'admin'.
 * Unbekannter User: still return (kein Throw).
 *
 * @param {number} userId - User ID
 * @param {string} updateType - z.B. 'badges', 'points', 'requests'
 * @param {string} action - 'refresh', 'update', 'delete', 'create', 'earned'
 * @param {object} data - Optionale zusaetzliche Daten
 */
async function sendToUserByRole(userId, updateType, action = 'refresh', data = null) {
  if (!_io) {
    return;
  }

  try {
    const db = getDb();
    const { rows } = await db.query(`
      SELECT r.name AS role_name FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1
      AND u.deleted_at IS NULL
    `, [userId]);

    if (rows.length === 0) {
      // Unbekannter/geloeschter User -> still nichts senden.
      return;
    }

    const roleName = rows[0].role_name;
    let userType;
    if (roleName === 'teamer') {
      userType = 'teamer';
    } else if (roleName === 'konfi') {
      userType = 'konfi';
    } else {
      userType = 'admin';
    }

    sendToUser(userType, userId, updateType, action, data);
  } catch (error) {
    console.error('LiveUpdate: Error sending to user by role:', error);
  }
}

/**
 * Trennt ALLE aktiven Socket.io-Verbindungen eines Users sofort. Notwendig bei
 * User-Löschung, Passwort-Reset und Deaktivierung: Ohne aktives Trennen bleibt
 * ein bereits verbundener Socket bestehen und empfaengt weiter Live-Updates, bis
 * der Client von selbst neu verbindet (oder nie). Der User kann so mit einer
 * toten/entzogenen Session weiter mitlesen.
 *
 * Trennt die drei moeglichen Räume (user_konfi_/user_teamer_/user_admin_<id>),
 * weil der Raum-Typ vom Login-Typ im JWT abhaengt und hier nicht sicher bekannt
 * ist. disconnectSockets(true) schließt auch den zugrundeliegenden Transport
 * (close=true). Über den @socket.io/postgres-adapter wirkt das replika-
 * uebergreifend (auch Sockets an der anderen Backend-Instanz werden getrennt).
 * Still bei fehlendem _io; Fehler werden gefangen (darf einen Request nie kippen).
 *
 * @param {number} userId - User ID
 */
function disconnectUserSockets(userId) {
  if (!_io) {
    return;
  }
  try {
    const rooms = [
      `user_konfi_${userId}`,
      `user_teamer_${userId}`,
      `user_admin_${userId}`,
    ];
    for (const room of rooms) {
      _io.in(room).disconnectSockets(true);
    }
  } catch (error) {
    console.error('LiveUpdate: Error disconnecting user sockets:', error);
  }
}

module.exports = {
  init,
  _reset,
  sendToUser,
  disconnectUserSockets,
  sendToKonfi,
  sendToAdmin,
  sendToUserByRole,
  // Die send*-Funktionen laufen durch _merken: Im Test wird ihr Nachlauf
  // mitgeschrieben, in Produktion ist es ein durchgereichter Aufruf.
  sendToOrgAdmins: (...a) => _merken(sendToOrgAdmins(...a)),
  sendToOrgKonfis: (...a) => _merken(sendToOrgKonfis(...a)),
  sendToOrg: (...a) => _merken(sendToOrg(...a)),
  sendToJahrgang: (...a) => _merken(sendToJahrgang(...a)),
  warteAufLiveUpdates
};
