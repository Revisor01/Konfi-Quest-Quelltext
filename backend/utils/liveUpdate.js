// Live Update Helper
// Sendet WebSocket-Events an User für Echtzeit-Aktualisierungen

let _io = null;

function init(io) {
  _io = io;
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
    const db = require('../database');
    // Hole alle Admins dieser Organisation
    const adminsResult = await db.query(`
      SELECT u.id FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.organization_id = $1
      AND r.name IN ('admin', 'org_admin', 'teamer')
    `, [organizationId]);

    const event = {
      type: updateType,
      action: action,
      data: data,
      timestamp: new Date().toISOString()
    };

    adminsResult.rows.forEach(admin => {
      const userRoom = `user_admin_${admin.id}`;
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
    const db = require('../database');
    // Hole alle Konfis dieser Organisation
    const konfisResult = await db.query(`
      SELECT u.id FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.organization_id = $1
      AND r.name = 'konfi'
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
    const db = require('../database');
    const konfisResult = await db.query(`
      SELECT u.id FROM users u
      JOIN konfi_profiles kp ON u.id = kp.user_id
      WHERE kp.jahrgang_id = $1
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

module.exports = {
  init,
  sendToUser,
  sendToKonfi,
  sendToAdmin,
  sendToOrgAdmins,
  sendToOrgKonfis,
  sendToOrg,
  sendToJahrgang
};
