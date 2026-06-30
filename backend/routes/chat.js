const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const PushService = require('../services/pushService');
const { encryptBuffer, decryptBuffer } = require('../utils/photoCrypto');
const { syncJahrgangChat } = require('../utils/jahrgangChat');
const { syncTeamChat } = require('../utils/teamChat');

module.exports = (db, rbacMiddleware, uploadsDir, chatUpload, io) => {
  const { verifyTokenRBAC } = rbacMiddleware;
  // Using passed-in encrypted chatUpload from server.js

  // Validierungsregeln
  const validateCreateRoom = [
    body('name').optional().trim(),
    body('type').isIn(['group', 'direct', 'jahrgang']).withMessage('Ungültiger Chat-Typ'),
    handleValidationErrors
  ];

  const validateSendMessage = [
    param('roomId').isInt({ min: 1 }).withMessage('Ungültige Raum-ID'),
    body('content').optional().trim().isLength({ max: 4000 }).withMessage('Nachricht darf maximal 4000 Zeichen lang sein'),
    body('client_id').optional().isUUID().withMessage('client_id muss eine UUID sein'),
    handleValidationErrors
  ];

  const validateCreatePoll = [
    param('roomId').isInt({ min: 1 }).withMessage('Ungültige Raum-ID'),
    body('question').trim().notEmpty().withMessage('Frage ist erforderlich'),
    body('options').isArray({ min: 2 }).withMessage('Mindestens 2 Antwortoptionen erforderlich'),
    handleValidationErrors
  ];
  
  // === UTILITY FUNCTIONS ===
  
  
  
  // === CHAT API ENDPOINTS ===
  
  // Get admins for direct contact (konfis only)
  router.get('/admins', verifyTokenRBAC, async (req, res) => {
    try {
      if (req.user.type !== 'konfi') {
        return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
      }
      
      const organizationId = req.user.organization_id;
      const query = "SELECT u.id, u.display_name, u.username FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name IN ('admin', 'org_admin', 'teamer') AND u.organization_id = $1 ORDER BY u.display_name";
      const { rows: admins } = await db.query(query, [organizationId]);
      res.json(admins);
      
    } catch (err) {
 console.error('Database error in GET /admins:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Create or get direct chat room
  router.post('/direct', verifyTokenRBAC, async (req, res) => {
    try {
      const { target_user_id, target_user_type } = req.body;
      const organizationId = req.user.organization_id;
      
      if (!target_user_id || !target_user_type) {
        return res.status(400).json({ error: 'Ziel-Benutzer erforderlich' });
      }
      if (!['admin', 'konfi'].includes(target_user_type)) {
        return res.status(400).json({ error: 'Ungültiger Benutzertyp' });
      }

      // DATENSCHUTZ: Konfis dürfen NUR Admins anschreiben
      if (req.user.type === 'konfi' && target_user_type !== 'admin') {
        return res.status(403).json({ error: 'Konfirmanden dürfen nur Admins anschreiben' });
      }

      const { rows: [validUser] } = await db.query("SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL", [target_user_id, organizationId]);
      if (!validUser) {
        return res.status(403).json({ error: 'Benutzer nicht in deiner Organisation gefunden' });
      }
      
      const user1_type = req.user.type;
      const user1_id = req.user.id;
      const user2_type = target_user_type;
      const user2_id = target_user_id;
      
      const existingRoomQuery = `
        SELECT r.id FROM chat_rooms r
        WHERE r.type = 'direct' AND r.organization_id = $1
        AND EXISTS (SELECT 1 FROM chat_participants p1 WHERE p1.room_id = r.id AND p1.user_id = $2 AND p1.user_type = $3)
        AND EXISTS (SELECT 1 FROM chat_participants p2 WHERE p2.room_id = r.id AND p2.user_id = $4 AND p2.user_type = $5)
      `;
      const { rows: [existingRoom] } = await db.query(existingRoomQuery, [organizationId, user1_id, user1_type, user2_id, user2_type]);
      if (existingRoom) {
        return res.json({ room_id: existingRoom.id, created: false });
      }
      
      const targetQuery = target_user_type === 'admin' ?
      "SELECT u.display_name as name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1 AND r.name IN ('admin', 'org_admin', 'teamer')" :
      "SELECT u.display_name as name FROM users u JOIN roles r ON u.role_id = r.id JOIN konfi_profiles kp ON u.id = kp.user_id WHERE u.id = $1 AND r.name = 'konfi'";
      const { rows: [targetUser] } = await db.query(targetQuery, [target_user_id]);
      if (!targetUser) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }
      
      const roomName = targetUser.name;
      const insertRoomQuery = "INSERT INTO chat_rooms (name, type, created_by, organization_id) VALUES ($1, 'direct', $2, $3) RETURNING id";
      const { rows: [newRoom] } = await db.query(insertRoomQuery, [roomName, req.user.id, organizationId]);
      const roomId = newRoom.id;
      
      const insertParticipant1Query = "INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, $3)";
      const insertParticipant2Query = "INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, $3)";
      await Promise.all([
        db.query(insertParticipant1Query, [roomId, user1_id, user1_type]),
        db.query(insertParticipant2Query, [roomId, user2_id, user2_type])
      ]);
      
      res.json({ room_id: roomId, created: true });
      
    } catch (err) {
 console.error('Database error in POST /direct:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Create new chat room
  router.post('/rooms', verifyTokenRBAC, validateCreateRoom, async (req, res) => {
    try {
      const { type, name, participants, jahrgang_id } = req.body;
      const createdBy = req.user.id;
      const organizationId = req.user.organization_id;
      
      if (!type || !name) {
        return res.status(400).json({ error: 'Typ und Name sind erforderlich' });
      }
      if (!['direct', 'group', 'jahrgang', 'admin_team'].includes(type)) {
        return res.status(400).json({ error: 'Ungültiger Chat-Typ' });
      }
      
      // DATENSCHUTZ: Konfis dürfen NUR Direktnachrichten mit Admins erstellen (keine Gruppen, keine Konfi-zu-Konfi Chats)
      if (req.user.type === 'konfi') {
        if (type !== 'direct') {
          return res.status(403).json({
            error: 'Konfirmanden können nur Direktnachrichten mit Admins erstellen',
            allowed_types: ['direct'],
            user_type: req.user.type
          });
        }
      }
      
      if (type === 'jahrgang') {
        if (!jahrgang_id) {
          return res.status(400).json({ error: 'Jahrgangs-ID für Jahrgangs-Chats erforderlich' });
        }
        const { rows: [validJahrgang] } = await db.query("SELECT id FROM jahrgaenge WHERE id = $1 AND organization_id = $2", [jahrgang_id, organizationId]);
        if (!validJahrgang) {
          return res.status(403).json({ error: 'Jahrgang nicht in deiner Organisation gefunden' });
        }
        const { rows: [existing] } = await db.query("SELECT id FROM chat_rooms WHERE type = 'jahrgang' AND jahrgang_id = $1 AND organization_id = $2", [jahrgang_id, organizationId]);
        if (existing) {
          return res.status(409).json({ error: 'Jahrgangs-Chat existiert bereits' });
        }
      }
      
      const insertRoomQuery = "INSERT INTO chat_rooms (name, type, jahrgang_id, created_by, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING id";
      const { rows: [newRoom] } = await db.query(insertRoomQuery, [name, type, jahrgang_id || null, createdBy, organizationId]);
      const roomId = newRoom.id;
      
      // Add creator as participant
      await db.query("INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, $3)", [roomId, createdBy, req.user.type]);
      
      if (participants && participants.length > 0) {
        const participantPromises = participants.map(participant => {
          const userId = typeof participant === 'object' ? participant.user_id : participant;
          const userType = typeof participant === 'object' ? participant.user_type : 'konfi';
          if (userId === createdBy && userType === req.user.type) return null;
 return db.query("INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, $3)", [roomId, userId, userType]).catch(err => console.error(`Error adding participant ${userId}:`, err));
        }).filter(p => p !== null);
        await Promise.all(participantPromises);
      } else if (type === 'jahrgang') {
        const konfisQuery = `SELECT u.id FROM users u
                              JOIN roles r ON u.role_id = r.id
                              JOIN konfi_profiles kp ON u.id = kp.user_id
                              WHERE r.name = 'konfi' AND kp.jahrgang_id = $1 AND u.organization_id = $2 AND u.deleted_at IS NULL`;
        const { rows: konfis } = await db.query(konfisQuery, [jahrgang_id, organizationId]);
        
        if (konfis.length > 0) {
          const konfiPromises = konfis.map(konfi => 
            db.query("INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, 'konfi')", [roomId, konfi.id])
 .catch(err => console.error(`Error adding konfi ${konfi.id} to jahrgang chat:`, err))
          );
          await Promise.all(konfiPromises);
        }
      }
      
      res.json({ room_id: roomId, created: true });
    } catch (err) {
 console.error('Database error in POST /rooms:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get chat rooms for user
  router.get('/rooms', verifyTokenRBAC, async (req, res) => {
    try {
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;
      
      // Jahrgangs-Chat-Mitgliedschaft synchronisieren (zentral, user_type-konsistent).
      // - konfi: genau sein Jahrgang
      // - teamer/admin: alle zugewiesenen Jahrgaenge
      // - org_admin: alle Jahrgaenge der Org (immer drin)
      try {
        let jahrgangIds = [];
        if (userType === 'konfi') {
          const { rows } = await db.query(
            'SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1 AND jahrgang_id IS NOT NULL',
            [userId]
          );
          jahrgangIds = rows.map(r => r.jahrgang_id);
        } else if (req.user.role_name === 'org_admin') {
          const { rows } = await db.query(
            'SELECT id FROM jahrgaenge WHERE organization_id = $1',
            [organizationId]
          );
          jahrgangIds = rows.map(r => r.id);
        } else {
          // admin / teamer -> zugewiesene Jahrgaenge
          const { rows } = await db.query(
            'SELECT jahrgang_id FROM user_jahrgang_assignments WHERE user_id = $1 AND can_view = true',
            [userId]
          );
          jahrgangIds = rows.map(r => r.jahrgang_id);
        }
        for (const jid of jahrgangIds) {
          await syncJahrgangChat(db, jid, organizationId, userId);
        }
      } catch (syncErr) {
        console.error('Jahrgangs-Chat-Sync beim Laden der Raeume fehlgeschlagen:', syncErr.message);
      }

      // Team-Chat-Mitgliedschaft synchronisieren (nur fuer Team-Mitglieder, nie Konfis).
      // Stellt sicher, dass der "Team"-Chat existiert und alle Admins/Teamer drin sind.
      if (userType !== 'konfi') {
        try {
          await syncTeamChat(db, organizationId, userId);
        } catch (teamSyncErr) {
          console.error('Team-Chat-Sync beim Laden der Raeume fehlgeschlagen:', teamSyncErr.message);
        }
      }
      
      // Admins and Konfis use the same optimized query now.
      // Uses LATERAL joins to avoid N+1 queries for direct-chat names
      // and correlated subquery in ORDER BY.
      const query = `
      SELECT
          r.id, r.type, r.organization_id, r.jahrgang_id, r.created_by, r.created_at, r.event_id,
          COALESCE(CASE WHEN r.type = 'direct' THEN dm.direct_name ELSE r.name END, r.name) as name,
          j.name as jahrgang_name,
          (
              SELECT COUNT(*)
              FROM chat_participants cp
              WHERE cp.room_id = r.id
          ) as participant_count,
          -- Rolle des Direktchat-Partners (admin=Team, konfi=Konfi) fuer Chat-Farbe/Filter.
          dm.partner_user_type,
          -- Reiner Team-Gruppenchat: alle Teilnehmer sind admin (= Teamer:innen). Nur fuer Gruppen relevant.
          (
              SELECT COUNT(*) FILTER (WHERE cp.user_type <> 'admin') = 0 AND COUNT(*) > 0
              FROM chat_participants cp
              WHERE cp.room_id = r.id
          ) as is_team_only,
          (
              SELECT COUNT(*)
              FROM chat_messages m
              WHERE m.room_id = r.id
              AND m.deleted_at IS NULL
              AND m.created_at > COALESCE(crs.last_read_at, '1970-01-01')
          ) as unread_count,
          (
              SELECT json_build_object(
                  'content', m.content,
                  'sender_name', u.display_name,
                  'created_at', m.created_at,
                  'file_name', m.file_name,
                  'message_type', m.message_type
              )
              FROM chat_messages m
              JOIN users u ON m.user_id = u.id
              WHERE m.room_id = r.id AND m.deleted_at IS NULL
              ORDER BY m.created_at DESC
              LIMIT 1
          ) as last_message,
          lm.last_message_at
      FROM chat_rooms r
      INNER JOIN chat_participants p ON r.id = p.room_id AND p.user_id = $1 AND p.user_type = $2
      LEFT JOIN jahrgaenge j ON r.jahrgang_id = j.id
      LEFT JOIN chat_read_status crs ON r.id = crs.room_id AND crs.user_id = $1 AND crs.user_type = $2
      LEFT JOIN LATERAL (
          SELECT u.display_name as direct_name, dp.user_type as partner_user_type
          FROM chat_participants dp
          JOIN users u ON dp.user_id = u.id
          WHERE dp.room_id = r.id
            AND NOT (dp.user_id = $1 AND dp.user_type = $2)
          LIMIT 1
      ) dm ON r.type = 'direct'
      LEFT JOIN LATERAL (
          SELECT created_at as last_message_at
          FROM chat_messages
          WHERE room_id = r.id AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
      ) lm ON true
      WHERE r.organization_id = $3
      GROUP BY r.id, r.type, r.organization_id, r.jahrgang_id, r.created_by, r.created_at, r.event_id, r.name,
               j.name, crs.last_read_at, dm.direct_name, dm.partner_user_type, lm.last_message_at
      ORDER BY lm.last_message_at DESC NULLS LAST
    `;
      const params = [userId, userType, organizationId];

      const { rows: rooms } = await db.query(query, params);

      res.json(rooms);
      
    } catch (err) {
 console.error('Database error in GET /rooms:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // === NEUER ENDPOINT: Get details for a single chat room ===
  router.get('/rooms/:roomId', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;
      
      // 1. Security Check: Does the user have access to this room?
      let hasAccess = false;
      const accessQuery = `
      SELECT 1 FROM chat_participants cp
      JOIN chat_rooms cr ON cp.room_id = cr.id 
      WHERE cp.room_id = $1 AND cp.user_id = $2 AND cp.user_type = $3 AND cr.organization_id = $4
    `;
      const { rows: [access] } = await db.query(accessQuery, [roomId, userId, userType, organizationId]);
      
      if (access) {
        hasAccess = true;
      } else if (userType === 'admin') {
        const adminAccessQuery = "SELECT 1 FROM chat_rooms WHERE id = $1 AND organization_id = $2";
        const { rows: [adminAccess] } = await db.query(adminAccessQuery, [roomId, organizationId]);
        if (adminAccess) {
          hasAccess = true;
        }
      }
      
      if (!hasAccess) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }
      
      // 2. Fetch room data
      const roomQuery = `
      SELECT 
        cr.*,
        j.name as jahrgang_name
      FROM chat_rooms cr
      LEFT JOIN jahrgaenge j ON cr.jahrgang_id = j.id
      WHERE cr.id = $1 AND cr.organization_id = $2
    `;
      const { rows: [room] } = await db.query(roomQuery, [roomId, organizationId]);
      
      if (!room) {
        return res.status(404).json({ error: 'Raum nicht gefunden' });
      }
      
      // 3. Fetch participant list
      const participantsQuery = `
      SELECT u.id as user_id, u.display_name, cp.user_type
      FROM chat_participants cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.room_id = $1 AND u.deleted_at IS NULL
    `;
      const { rows: participants } = await db.query(participantsQuery, [roomId]);
      room.participants = participants;
      
      // 4. Adjust name for direct chats
      if (room.type === 'direct') {
        const otherParticipant = participants.find(p =>
          !(p.user_id === userId && p.user_type === userType)
        );
        if (otherParticipant) {
          room.name = otherParticipant.display_name || room.name;
        }
      }
      
      res.json(room);
      
    } catch (err) {
 console.error(`Database error in GET /rooms/${req.params.roomId}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Get messages for a room
  router.get('/rooms/:roomId/messages', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;
      
      // Check if user has access to this room (with organization check)
      const accessQuery = userType === 'admin'
      ? "SELECT 1 FROM chat_rooms WHERE id = $1 AND organization_id = $2"
      : `SELECT 1 FROM chat_participants cp 
          JOIN chat_rooms cr ON cp.room_id = cr.id 
          WHERE cp.room_id = $1 AND cp.user_id = $2 AND cp.user_type = $3 AND cr.organization_id = $4`;
      const accessParams = userType === 'admin' ? [roomId, organizationId] : [roomId, userId, userType, organizationId];
      const { rows: [access] } = await db.query(accessQuery, accessParams);
      
      if (!access) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }
      
      const after = parseInt(req.query.after) || null;

      const selectColumns = `
      SELECT m.*,
              m.user_id as sender_id,
              m.user_type as sender_type,
              u.display_name as sender_name,
              u.role_title as sender_role_title,
              ro.display_name as sender_role_display_name,
              u.username as sender_username,
              p.question, p.options, p.expires_at, p.multiple_choice,
              p.anonymous, p.exclusive_options,
              p.id as poll_id,
              CASE
                WHEN m.deleted_at IS NOT NULL THEN 'Diese Nachricht wurde gelöscht'
                ELSE m.content
              END as content,
              CASE
                WHEN m.deleted_at IS NOT NULL THEN true
                ELSE false
              END as is_deleted,
              -- Reply data
              reply_msg.id as reply_to_id,
              reply_msg.content as reply_to_content,
              reply_msg.file_name as reply_to_file_name,
              reply_msg.message_type as reply_to_message_type,
              reply_user.display_name as reply_to_sender_name
      FROM chat_messages m
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN roles ro ON u.role_id = ro.id
      LEFT JOIN chat_polls p ON m.id = p.message_id
      LEFT JOIN chat_messages reply_msg ON m.reply_to = reply_msg.id
      LEFT JOIN users reply_user ON reply_msg.user_id = reply_user.id`;

      let messagesQuery, queryParams;
      if (after) {
        messagesQuery = `${selectColumns}
        WHERE m.room_id = $1 AND m.id > $2
        ORDER BY m.created_at ASC
        LIMIT 200`;
        queryParams = [roomId, after];
      } else {
        messagesQuery = `${selectColumns}
        WHERE m.room_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2 OFFSET $3`;
        queryParams = [roomId, limit, offset];
      }

      const { rows: messages } = await db.query(messagesQuery, queryParams);

      // Bulk-Query fuer Reactions und Poll-Votes (statt N+1 Queries)
      const messageIds = messages.map(m => m.id);

      let processedMessages = [];
      if (messageIds.length === 0) {
        processedMessages = [];
      } else {
        // Reactions in einer einzigen Bulk-Query laden
        const { rows: allReactions } = await db.query(
          `SELECT r.id, r.emoji, r.user_id, r.user_type, u.display_name as user_name, r.message_id
           FROM chat_message_reactions r
           JOIN users u ON r.user_id = u.id
           WHERE r.message_id = ANY($1::int[])
           ORDER BY r.created_at ASC`,
          [messageIds]
        );

        // Reactions-Map aufbauen (message_id -> reactions[])
        const reactionsMap = {};
        for (const r of allReactions) {
          if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = [];
          reactionsMap[r.message_id].push(r);
        }

        // Poll-IDs aus poll-Nachrichten ermitteln
        const pollMessages = messages.filter(m => m.message_type === 'poll' && m.options && m.poll_id);
        const pollIds = pollMessages.map(m => m.poll_id);

        // Votes in einer einzigen Bulk-Query laden (nur wenn pollIds vorhanden)
        let votesMap = {};
        if (pollIds.length > 0) {
          const { rows: allVotes } = await db.query(
            `SELECT v.*, u.display_name as voter_name
             FROM chat_poll_votes v
             LEFT JOIN users u ON v.user_id = u.id
             WHERE v.poll_id = ANY($1::int[])`,
            [pollIds]
          );
          for (const v of allVotes) {
            if (!votesMap[v.poll_id]) votesMap[v.poll_id] = [];
            votesMap[v.poll_id].push(v);
          }
        }

        // Nachrichten mit Daten anreichern (synchron, kein await)
        processedMessages = messages.map(msg => {
          msg.reactions = reactionsMap[msg.id] || [];

          if (msg.message_type === 'poll' && msg.options) {
            try {
              msg.options = JSON.parse(msg.options);
            } catch (e) {
              console.error('Failed to parse poll options:', msg.options, e);
              msg.options = [];
            }
            msg.multiple_choice = Boolean(msg.multiple_choice);
            msg.anonymous = Boolean(msg.anonymous);
            msg.exclusive_options = Boolean(msg.exclusive_options);
            // Votes anreichern: voter_name -> user_name. Bei anonymen Umfragen die
            // Namen NICHT ausliefern (nur Zaehlung), damit niemand sehen kann, wer
            // was gewaehlt hat.
            const rawVotes = votesMap[msg.poll_id] || [];
            msg.votes = rawVotes.map(v => ({
              user_id: v.user_id,
              user_type: v.user_type,
              option_index: v.option_index,
              user_name: msg.anonymous ? undefined : v.voter_name,
            }));
          }
          return msg;
        });
      }
      
      // Bei ?after ist die Query bereits ASC sortiert, kein reverse noetig
      res.json(after ? processedMessages : processedMessages.reverse());
    } catch (err) {
 console.error(`Database error in GET /rooms/${req.params.roomId}/messages:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Send message
  router.post('/rooms/:roomId/messages', verifyTokenRBAC, chatUpload.single('file'), validateSendMessage, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const { content, message_type = 'text', reply_to, client_id } = req.body;
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;

      if (!content && !req.file) {
        return res.status(400).json({ error: 'Inhalt oder Datei erforderlich' });
      }

      // Idempotency: Prüfen ob Nachricht mit dieser client_id bereits existiert (org-gescopt)
      if (client_id) {
        const existingQuery = `
          SELECT m.*, m.user_id as sender_id, m.user_type as sender_type,
                 u.display_name as sender_name, u.username as sender_username
          FROM chat_messages m
          JOIN users u ON m.user_id = u.id
          JOIN chat_rooms cr ON m.room_id = cr.id
          WHERE m.client_id = $1 AND cr.organization_id = $2
        `;
        const { rows: [existing] } = await db.query(existingQuery, [client_id, organizationId]);
        if (existing) {
          return res.status(200).json(existing);
        }
      }

      // Check access (mit Organisations-Pruefung)
      const accessQuery = userType === 'admin'
      ? "SELECT 1 FROM chat_rooms WHERE id = $1 AND organization_id = $2"
      : `SELECT 1 FROM chat_participants cp
          JOIN chat_rooms cr ON cp.room_id = cr.id
          WHERE cp.room_id = $1 AND cp.user_id = $2 AND cp.user_type = $3 AND cr.organization_id = $4`;
      const accessParams = userType === 'admin' ? [roomId, organizationId] : [roomId, userId, userType, organizationId];
      const { rows: [access] } = await db.query(accessQuery, accessParams);
      if (!access) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }
      
      // Process file
      let filePath = null, fileName = null, fileSize = null;
      let actualMessageType = message_type;
      if (req.file) {
        if (!req.file.buffer) {
          return res.status(400).json({ error: 'Datei konnte nicht gelesen werden' });
        }

        // Magic-Bytes-Pruefung direkt auf dem Buffer (echte Dateitypen erzwingen).
        // Text-Formate (txt/csv) haben keine Magic Bytes -> Header vertrauen.
        const textMimes = ['text/plain', 'text/csv'];
        if (!textMimes.includes(req.file.mimetype)) {
          const { fileTypeFromBuffer } = await import('file-type');
          const detected = await fileTypeFromBuffer(req.file.buffer);
          const allowedPrefixes = [
            'image/', 'video/', 'audio/', 'application/pdf',
            'application/vnd.openxmlformats', 'application/msword',
            'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
            'application/zip', 'application/x-cfb'
          ];
          if (!detected || !allowedPrefixes.some(p => detected.mime.startsWith(p))) {
            return res.status(415).json({ error: 'Dateityp konnte nicht verifiziert werden' });
          }
        }

        const crypto = require('crypto');
        // Zufaelliger Hex-Dateiname (die Abruf-Route akzeptiert nur [a-f0-9]+)
        const filename = crypto.randomBytes(32).toString('hex');
        const chatDir = path.join(uploadsDir, 'chat');
        const chatFilePath = path.join(chatDir, filename);
        await fs.promises.mkdir(chatDir, { recursive: true });
        const encrypted = encryptBuffer(req.file.buffer);
        await fs.promises.writeFile(chatFilePath, encrypted);

        filePath = filename;
        fileName = req.file.originalname;
        fileSize = req.file.size;
        const ext = path.extname(fileName).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.heic', '.webp'].includes(ext)) {
          actualMessageType = 'image';
        } else if (['.mp4', '.mov', '.avi'].includes(ext)) {
          actualMessageType = 'video';
        } else {
          actualMessageType = 'file';
        }
      }
      
      // reply_to validieren: Verweist die Antwort auf eine existierende Nachricht
      // IM SELBEN Raum? Wenn nicht (geloeschte Nachricht oder lokale optimistische
      // ID, die nie persistiert wurde), reply_to auf null -> Nachricht geht trotzdem
      // raus, statt mit FK-Constraint-Verletzung (chat_messages_reply_to_fkey) 500 zu werfen.
      let safeReplyTo = null;
      if (reply_to) {
        const { rows: [replyRow] } = await db.query(
          'SELECT id FROM chat_messages WHERE id = $1 AND room_id = $2',
          [reply_to, roomId]
        );
        if (replyRow) safeReplyTo = reply_to;
      }

      // Insert message and get its ID back
      const insertQuery = `
      INSERT INTO chat_messages (room_id, user_id, user_type, message_type, content, file_path, file_name, file_size, reply_to, client_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `;
      const { rows: [newMessage] } = await db.query(insertQuery, [roomId, userId, userType, actualMessageType, content, filePath, fileName, fileSize, safeReplyTo, client_id || null]);
      const messageId = newMessage.id;
      
      // Fetch the complete message object to send back and for push notifications
      const messageQuery = `
      SELECT m.*,
              m.user_id as sender_id,
              m.user_type as sender_type,
              u.display_name as sender_name,
              u.username as sender_username,
              -- Reply data
              reply_msg.id as reply_to_id,
              reply_msg.content as reply_to_content,
              reply_msg.file_name as reply_to_file_name,
              reply_msg.message_type as reply_to_message_type,
              reply_user.display_name as reply_to_sender_name
      FROM chat_messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN chat_messages reply_msg ON m.reply_to = reply_msg.id
      LEFT JOIN users reply_user ON reply_msg.user_id = reply_user.id
      WHERE m.id = $1
    `;
      const { rows: [message] } = await db.query(messageQuery, [messageId]);
      
      res.json(message); // Respond immediately

      // WebSocket: Broadcast new message to room (für User die den Chat offen haben)
      if (io) {
        io.to(`room_${roomId}`).emit('newMessage', {
          roomId: parseInt(roomId),
          message: message
        });

        // ZUSÄTZLICH: Benachrichtige alle Teilnehmer über ihren persönlichen Room
        // (für Badge-Updates in ChatOverview und TabBar, auch wenn sie nicht im Chat sind)
        const participantsQuery = `
          SELECT user_id, user_type FROM chat_participants
          WHERE room_id = $1
        `;
        const { rows: allParticipants } = await db.query(participantsQuery, [roomId]);
        for (const p of allParticipants) {
          const userRoom = `user_${p.user_type}_${p.user_id}`;
          io.to(userRoom).emit('newMessage', {
            roomId: parseInt(roomId),
            message: message
          });
        }
      }

      // Asynchronously send push notifications
      (async () => {
        try {
          const getParticipantsQuery = `
          SELECT user_id, user_type FROM chat_participants
          WHERE room_id = $1 AND NOT (user_id = $2 AND user_type = $3)
        `;
          const { rows: participants } = await db.query(getParticipantsQuery, [roomId, userId, userType]);
          if (!participants) return;
          
          const { rows: [room] } = await db.query('SELECT name, type FROM chat_rooms WHERE id = $1', [roomId]);
          const roomName = room?.name || 'Chat';
          const isDirectChat = room?.type === 'direct';
          const pushTitle = isDirectChat ? message.sender_name : roomName;
          const pushBody = isDirectChat
          ? (content || '[Anhang]')
          : `${message.sender_name}: ${content || '[Anhang]'}`;
          
          for (const p of participants) {
            const badgeQuery = `
            SELECT COUNT(DISTINCT cm.id) as total_unread
            FROM chat_messages cm
            JOIN chat_participants cp ON cm.room_id = cp.room_id
            LEFT JOIN chat_read_status crs ON cm.room_id = crs.room_id AND crs.user_id = $1 AND crs.user_type = $2
            WHERE cp.user_id = $1
            AND cp.user_type = $2
            AND cm.created_at > COALESCE(crs.last_read_at, '1970-01-01')
            AND cm.deleted_at IS NULL
            AND NOT (cm.user_id = $1 AND cm.user_type = $2)
          `;
            const { rows: [badgeResult] } = await db.query(badgeQuery, [p.user_id, p.user_type]);
            const badgeCount = parseInt(badgeResult?.total_unread || '0', 10);
            
            await PushService.sendChatNotification(db, p.user_id, {
              title: pushTitle,
              body: pushBody,
              badge: badgeCount,
              roomId: roomId,
              messageId: message.id,
              data: {
                sender_id: userId,
                sender_name: message.sender_name,
                room_name: roomName,
                room_type: room?.type || 'unknown'
              }
            });
          }
        } catch (pushError) {
 console.error('Failed to send chat push notification:', pushError);
        }
      })();
      
    } catch (err) {
      // Race Condition: Nachricht wurde zwischen Check und Insert eingefügt
      if (err.code === '23505' && err.detail?.includes('client_id')) {
        try {
          const { rows: [existing] } = await db.query(
            `SELECT m.*, m.user_id as sender_id, m.user_type as sender_type,
                    u.display_name as sender_name, u.username as sender_username
             FROM chat_messages m JOIN users u ON m.user_id = u.id
             JOIN chat_rooms cr ON m.room_id = cr.id
             WHERE m.client_id = $1 AND cr.organization_id = $2`, [req.body.client_id, req.user.organization_id]
          );
          if (existing) return res.status(200).json(existing);
        } catch (lookupErr) {
          console.error('Error looking up duplicate message:', lookupErr);
        }
      }
      console.error(`Database error in POST /rooms/${req.params.roomId}/messages:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Mark room as read
  // NOTE: The on-demand table creation logic from the original sqlite3 code has been removed.
  // In a production environment, database schema should be managed by dedicated migration scripts,
  // not created at runtime by API endpoints.
  router.post('/rooms/:roomId/mark-read', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;

      // Zugriff pruefen (mit Organisations-Pruefung)
      const accessQuery = userType === 'admin'
      ? "SELECT 1 FROM chat_rooms WHERE id = $1 AND organization_id = $2"
      : `SELECT 1 FROM chat_participants cp
          JOIN chat_rooms cr ON cp.room_id = cr.id
          WHERE cp.room_id = $1 AND cp.user_id = $2 AND cp.user_type = $3 AND cr.organization_id = $4`;
      const accessParams = userType === 'admin' ? [roomId, organizationId] : [roomId, userId, userType, organizationId];
      const { rows: [access] } = await db.query(accessQuery, accessParams);
      if (!access) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }

      // Use PostgreSQL's "UPSERT" functionality (INSERT ON CONFLICT)
      const query = `
      INSERT INTO chat_read_status (room_id, user_id, user_type, last_read_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (room_id, user_id, user_type)
      DO UPDATE SET last_read_at = NOW();
    `;
      
      const { rowCount } = await db.query(query, [roomId, userId, userType]);
      
      res.json({ message: 'Raum als gelesen markiert', affected: rowCount });
      
    } catch (err) {
 console.error(`Database error in POST /rooms/${req.params.roomId}/mark-read:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Get room participants
  router.get('/rooms/:roomId/participants', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;

      // Check if user has access to this room (mit Organisations-Pruefung)
      const accessQuery = userType === 'admin'
      ? "SELECT 1 FROM chat_rooms WHERE id = $1 AND organization_id = $2"
      : `SELECT 1 FROM chat_participants cp
          JOIN chat_rooms cr ON cp.room_id = cr.id
          WHERE cp.room_id = $1 AND cp.user_id = $2 AND cp.user_type = $3 AND cr.organization_id = $4`;
      const accessParams = userType === 'admin' ? [roomId, organizationId] : [roomId, userId, userType, organizationId];

      const { rows: [access] } = await db.query(accessQuery, accessParams);
      if (!access) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }

      // Get participants with their details
      const query = `
      SELECT
        cp.user_id,
        cp.user_type,
        cp.joined_at,
        u.display_name as name,
        u.role_title,
        r.name as role_name,
        r.display_name as role_display_name,
        -- Jahrgang nur fuer echte Konfis; Team-Mitglieder (admin/teamer) haben keinen.
        CASE
          WHEN cp.user_type = 'konfi' THEN kp.jahrgang_id
          ELSE NULL
        END as jahrgang_id,
        CASE
          WHEN cp.user_type = 'konfi' THEN j.name
          ELSE NULL
        END as jahrgang_name
      FROM chat_participants cp
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN konfi_profiles kp ON cp.user_type = 'konfi' AND cp.user_id = kp.user_id
      LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
      WHERE cp.room_id = $1
      ORDER BY cp.joined_at ASC
    `;
      
      const { rows: participants } = await db.query(query, [roomId]);
      res.json(participants);
      
    } catch (err) {
 console.error(`Database error in GET /rooms/${req.params.roomId}/participants:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Add participant to room
  router.post('/rooms/:roomId/participants', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const { user_id, user_type } = req.body;
      const requesterType = req.user.type;
      const organizationId = req.user.organization_id;

      if (requesterType !== 'admin') {
        return res.status(403).json({ error: 'Nur Admins können Teilnehmer hinzufügen' });
      }
      if (!user_id || !user_type) {
        return res.status(400).json({ error: 'user_id und user_type sind erforderlich' });
      }
      if (!['admin', 'konfi'].includes(user_type)) {
        return res.status(400).json({ error: 'Ungültiger Benutzertyp' });
      }

      const { rows: [room] } = await db.query("SELECT type FROM chat_rooms WHERE id = $1 AND organization_id = $2", [roomId, organizationId]);
      if (!room) {
        return res.status(404).json({ error: 'Raum nicht gefunden' });
      }
      if (room.type !== 'group') {
        return res.status(400).json({ error: 'Teilnehmer können nur zu Gruppenchats hinzugefügt werden' });
      }
      
      const { rows: [existing] } = await db.query("SELECT 1 FROM chat_participants WHERE room_id = $1 AND user_id = $2 AND user_type = $3", [roomId, user_id, user_type]);
      if (existing) {
        return res.status(409).json({ error: 'Benutzer ist bereits Teilnehmer' });
      }
      
      await db.query("INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, $3)", [roomId, user_id, user_type]);
      res.status(201).json({ message: 'Teilnehmer erfolgreich hinzugefügt' });
      
    } catch (err) {
      // Handle unique constraint violation in case of a race condition
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Benutzer ist bereits Teilnehmer' });
      }
 console.error(`Database error in POST /rooms/${req.params.roomId}/participants:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Remove participant from room
  router.delete('/rooms/:roomId/participants/:userId/:userType', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const userId = parseInt(req.params.userId);
      const userType = req.params.userType;
      const requesterType = req.user.type;
      const organizationId = req.user.organization_id;

      if (requesterType !== 'admin') {
        return res.status(403).json({ error: 'Nur Admins können Teilnehmer entfernen' });
      }

      const { rows: [room] } = await db.query("SELECT type FROM chat_rooms WHERE id = $1 AND organization_id = $2", [roomId, organizationId]);
      if (!room) {
        return res.status(404).json({ error: 'Raum nicht gefunden' });
      }
      if (room.type !== 'group') {
        return res.status(400).json({ error: 'Teilnehmer können nur aus Gruppenchats entfernt werden' });
      }
      
      const { rowCount } = await db.query("DELETE FROM chat_participants WHERE room_id = $1 AND user_id = $2 AND user_type = $3", [roomId, userId, userType]);
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Teilnehmer nicht gefunden' });
      }
      
      res.json({ message: 'Teilnehmer erfolgreich entfernt' });
    } catch (err) {
 console.error(`Database error in DELETE /rooms/${req.params.roomId}/participants/...:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Self-leave: Authenticated user leaves a chat room
  router.delete('/rooms/:roomId/leave', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;

      const { rows: [room] } = await db.query("SELECT type, event_id FROM chat_rooms WHERE id = $1 AND organization_id = $2", [roomId, organizationId]);
      if (!room) {
        return res.status(404).json({ error: 'Raum nicht gefunden' });
      }

      // Admins duerfen NIEMALS irgendeinen Chat verlassen
      if (userType === 'admin') {
        return res.status(403).json({ error: 'Admins können Chats nicht verlassen' });
      }

      // Jahrgang und Direct sind generell nicht verlassbar
      if (room.type === 'jahrgang' || room.type === 'direct') {
        return res.status(400).json({ error: 'Dieser Chat kann nicht verlassen werden' });
      }

      // Event-Chats sind an die Event-Teilnahme gekoppelt: Konfis verlassen sie
      // NICHT manuell, sondern ausschliesslich durch Abmelden vom Event. Sonst
      // waere man am Event angemeldet, aber nicht im Chat.
      if (userType === 'konfi' && room.event_id) {
        return res.status(400).json({ error: 'Event-Chats werden über die Event-Abmeldung verlassen, nicht direkt.' });
      }

      const { rowCount } = await db.query(
        "DELETE FROM chat_participants WHERE room_id = $1 AND user_id = $2 AND user_type = $3",
        [roomId, userId, userType]
      );

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Du bist kein Teilnehmer dieses Chats' });
      }

      res.json({ message: 'Chat erfolgreich verlassen' });
    } catch (err) {
      console.error(`Database error in DELETE /rooms/${req.params.roomId}/leave:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Protected file serving route
  router.get('/files/:filename', async (req, res) => {
    // Support token from header OR query parameter (for video elements)
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    
    if (!token) {
      return res.status(401).json({ error: 'Kein Token vorhanden' });
    }
    
    // Verify token manually since we can't use middleware for query params
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      return res.status(401).json({ error: 'Ungültiger Token' });
    }
    try {
      // Path-Traversal-Schutz: nur den Dateinamen ohne Verzeichniskomponenten verwenden
      const filename = path.basename(req.params.filename);

      // Nur Hex-Hashes (multer SHA-256) als Dateinamen akzeptieren
      if (!/^[a-f0-9]+$/.test(filename)) {
        return res.status(400).json({ error: 'Ungültiger Dateiname' });
      }

      // Check if user has access to this file by checking chat membership
      const { rows: [fileMessage] } = await db.query(
        `SELECT cm.room_id, cm.file_name
         FROM chat_messages cm
         JOIN chat_rooms cr ON cm.room_id = cr.id
         WHERE cm.file_path = $1 AND cr.organization_id = $2`,
        [filename, req.user.organization_id]
      );

      if (!fileMessage) {
        return res.status(404).json({ error: 'Datei nicht gefunden' });
      }

      // Check if user is member of the chat room
      const { rows: [membership] } = await db.query(
        `SELECT 1 FROM chat_participants cp
         WHERE cp.room_id = $1 AND cp.user_id = $2`,
        [fileMessage.room_id, req.user.id]
      );

      if (!membership) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }

      const filePath = path.join(uploadsDir, 'chat', filename);

      if (fs.existsSync(filePath)) {
        // Content-Type aus dem originalen Dateinamen (DB) ableiten
        const contentTypes = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.pdf': 'application/pdf',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        };

        if (fileMessage.file_name) {
          const ext = path.extname(fileMessage.file_name).toLowerCase();
          if (contentTypes[ext]) {
            res.setHeader('Content-Type', contentTypes[ext]);
          }
        }

        // Datei lesen und (falls verschluesselt) entschluesseln, dann senden.
        // Alte Klartext-Dateien werden vom decryptBuffer unveraendert
        // durchgereicht (Abwaertskompatibilitaet bis zur Migration).
        const fileBuffer = await fs.promises.readFile(filePath);
        let mediaBuffer;
        try {
          mediaBuffer = decryptBuffer(fileBuffer);
        } catch (decErr) {
          console.error('Error decrypting chat file:', decErr);
          return res.status(500).json({ error: 'Datei konnte nicht entschlüsselt werden' });
        }
        res.send(mediaBuffer);
      } else {
        res.status(404).json({ error: 'Datei nicht auf dem Server gefunden' });
      }
    } catch (error) {
 console.error('Error serving chat file:', error);
      res.status(500).json({ error: 'Serverfehler' });
    }
  });

  // Badge update endpoint for Background Refresh
  router.post('/badge-update', verifyTokenRBAC, async (req, res) => {
    try {
      const userId = req.user.id;
      const userType = req.user.type;
      
      // Use the consistent query for unread counts, referencing chat_read_status
      const badgeQuery = `
      SELECT COUNT(DISTINCT m.id) as total_unread
      FROM chat_messages m
      JOIN chat_participants p ON m.room_id = p.room_id
      LEFT JOIN chat_read_status crs ON m.room_id = crs.room_id AND p.user_id = crs.user_id AND p.user_type = crs.user_type
      WHERE p.user_id = $1
        AND p.user_type = $2
        AND m.created_at > COALESCE(crs.last_read_at, '1970-01-01')
        AND m.deleted_at IS NULL
        AND m.user_id != $1
    `;
      const { rows: [result] } = await db.query(badgeQuery, [userId, userType]);
      const badgeCount = parseInt(result?.total_unread || '0', 10);
      
      // Send badge update via Push Notification
      await PushService.sendBadgeUpdate(db, userId, badgeCount);
      
      res.json({
        success: true,
        badgeCount: badgeCount,
        message: `Badge updated to ${badgeCount}`
      });
      
    } catch (error) {
      // The push service might throw an error, which should be caught but not treated as a 500
      if (error.isPushServiceError) {
 console.error('Push badge update failed:', error);
        res.status(502).json({ 
          success: false, 
          error: 'Push-Benachrichtigung fehlgeschlagen'
        });
      } else {
 console.error('Badge update endpoint error:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
      }
    }
  });

  // Create poll for a room
  router.post('/rooms/:roomId/polls', verifyTokenRBAC, validateCreatePoll, async (req, res) => {
    const roomId = req.params.roomId;
    const { question, options, multiple_choice = false, expires_in_hours, anonymous = true, exclusive_options = false } = req.body;
    const userId = req.user.id;
    const userType = req.user.type;
    // Exklusive Optionen (jede Option max 1 Person) sind immer Einzelauswahl —
    // Mehrfachauswahl ergibt dabei keinen Sinn.
    const isMultipleChoice = exclusive_options ? false : Boolean(multiple_choice);


    // Only admins can create polls
    if (userType !== 'admin') {
      return res.status(403).json({ error: 'Nur Admins können Umfragen erstellen' });
    }
    
    // Validate input
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Frage ist erforderlich' });
    }
    
    if (!options || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'Mindestens 2 Optionen sind erforderlich' });
    }
    
    const validOptions = options.filter(opt => opt && opt.trim());
    if (validOptions.length < 2) {
      return res.status(400).json({ error: 'Mindestens 2 gültige Optionen sind erforderlich' });
    }
    
    try {
      // Check if user has access to this room
      const { rows: [room] } = await db.query("SELECT 1 FROM chat_rooms WHERE id = $1 AND organization_id = $2", [roomId, req.user.organization_id]);
      
      if (!room) {
        return res.status(404).json({ error: 'Raum nicht gefunden' });
      }
      
      // Calculate expires_at
      let expiresAt = null;
      if (expires_in_hours && expires_in_hours > 0) {
        expiresAt = new Date(Date.now() + expires_in_hours * 60 * 60 * 1000);
      }
      
      const client = await db.getClient();
      try {
      await client.query('BEGIN');

      // First create the message
      const messageQuery = `
        INSERT INTO chat_messages (room_id, user_id, user_type, message_type, content, created_at)
        VALUES ($1, $2, $3, 'poll', $4, NOW())
        RETURNING id
      `;
      const { rows: [newMessage] } = await client.query(messageQuery, [roomId, userId, userType, question]);
      const messageId = newMessage.id;

      // Then create the poll
      const pollQuery = `
        INSERT INTO chat_polls (message_id, question, options, multiple_choice, expires_at, anonymous, exclusive_options, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING id
      `;
      const { rows: [newPoll] } = await client.query(pollQuery, [
        messageId,
        question,
        JSON.stringify(validOptions),
        isMultipleChoice,
        expiresAt,
        Boolean(anonymous),
        Boolean(exclusive_options)
      ]);

      await client.query('COMMIT');
      client.release();

      // Return the created poll
      res.status(201).json({
        id: newPoll.id,
        message_id: messageId,
        question: question,
        options: validOptions,
        multiple_choice: isMultipleChoice,
        anonymous: Boolean(anonymous),
        exclusive_options: Boolean(exclusive_options),
        expires_at: expiresAt,
        votes: []
      });

      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
        client.release();
        console.error('Database error in POST /rooms/:roomId/polls:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    } catch (err) {
      console.error('Database error in POST /rooms/:roomId/polls:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Vote for a poll (by poll ID)
  router.post('/polls/:pollId/vote', verifyTokenRBAC, async (req, res) => {
    const pollId = req.params.pollId;
    const { option_index } = req.body;
    const userId = req.user.id;
    const userType = req.user.type;
    
    
    if (option_index === undefined || option_index === null) {
      return res.status(400).json({ error: 'Option-Index ist erforderlich' });
    }
    
    try {
      // Get the poll - try by poll_id first, then by message_id (frontend compatibility)
      let getPollQuery = `
        SELECT p.*, m.room_id FROM chat_polls p
        JOIN chat_messages m ON p.message_id = m.id
        WHERE p.id = $1
      `;
      let { rows: [poll] } = await db.query(getPollQuery, [pollId]);
      
      // If not found by poll_id, try by message_id (frontend might be sending message_id)
      if (!poll) {
        getPollQuery = `
          SELECT p.*, m.room_id FROM chat_polls p
          JOIN chat_messages m ON p.message_id = m.id
          WHERE p.message_id = $1
        `;
        const result = await db.query(getPollQuery, [pollId]);
        poll = result.rows[0];
      }
      
      if (!poll) {
        return res.status(404).json({ error: 'Umfrage nicht gefunden' });
      }
      
      // Check if poll has expired
      if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Umfrage ist abgelaufen' });
      }
      
      // Parse options and validate option_index
      let parsedOptions;
      try {
        parsedOptions = JSON.parse(poll.options);
      } catch (e) {
 console.error('Failed to parse poll options:', poll.options);
        return res.status(500).json({ error: 'Ungültige Umfragedaten' });
      }
      
      if (option_index < 0 || option_index >= parsedOptions.length) {
        return res.status(400).json({ error: 'Ungültiger Option-Index' });
      }
      
      // Check if user has access to the room
      const accessQuery = `
        SELECT 1 FROM chat_participants cp 
        JOIN chat_rooms cr ON cp.room_id = cr.id 
        WHERE cp.room_id = $1 AND cp.user_id = $2 AND cp.user_type = $3 AND cr.organization_id = $4
      `;
      const { rows: [access] } = await db.query(accessQuery, [poll.room_id, userId, userType, req.user.organization_id]);
      
      if (!access) {
        return res.status(403).json({ error: 'Zugriff auf diesen Raum verweigert' });
      }
      
      const client = await db.getClient();
      try {
      await client.query('BEGIN');

      // Use the actual poll.id from database, not the request pollId (which might be message_id)
      const actualPollId = poll.id;

      // Bei exklusiven Umfragen die Poll-Zeile sperren (FOR UPDATE), damit zwei
      // gleichzeitige Votes auf dieselbe Option serialisiert werden -> kein Race,
      // bei dem beide dieselbe Option ergattern.
      const isExclusive = Boolean(poll.exclusive_options);
      if (isExclusive) {
        await client.query("SELECT 1 FROM chat_polls WHERE id = $1 FOR UPDATE", [actualPollId]);
      }

      // Check if user already voted for this specific option
      const { rows: [existingVote] } = await client.query(
        "SELECT 1 FROM chat_poll_votes WHERE poll_id = $1 AND user_id = $2 AND user_type = $3 AND option_index = $4",
        [actualPollId, userId, userType, option_index]
      );

      if (existingVote) {
        // If already voted for this option, remove the vote (toggle off).
        // Gilt auch fuer exklusive Umfragen: die eigene Wahl wieder freigeben.
        await client.query(
          "DELETE FROM chat_poll_votes WHERE poll_id = $1 AND user_id = $2 AND user_type = $3 AND option_index = $4",
          [actualPollId, userId, userType, option_index]
        );
        await client.query('COMMIT');
        client.release();
        return res.json({
          message: 'Stimme erfolgreich entfernt',
          poll_id: actualPollId,
          option_index: option_index,
          user_id: userId,
          action: 'removed'
        });
      }

      // Exklusive Umfrage: ist diese Option schon von JEMAND ANDEREM belegt?
      // Dann ist sie vergeben -> 409, kein Doppel-Eintrag.
      if (isExclusive) {
        const { rows: [taken] } = await client.query(
          "SELECT 1 FROM chat_poll_votes WHERE poll_id = $1 AND option_index = $2 LIMIT 1",
          [actualPollId, option_index]
        );
        if (taken) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(409).json({ error: 'Diese Option ist bereits vergeben', action: 'taken' });
        }
      }

      // Einzelauswahl (auch exklusiv): vorhandene Stimme(n) des Nutzers entfernen,
      // bevor die neue gesetzt wird. So wechselt man bei exklusiven Umfragen die
      // Option und gibt die alte automatisch wieder frei.
      if (!poll.multiple_choice) {
        await client.query(
          "DELETE FROM chat_poll_votes WHERE poll_id = $1 AND user_id = $2 AND user_type = $3",
          [actualPollId, userId, userType]
        );
      }

      // Add the new vote
      await client.query(
        "INSERT INTO chat_poll_votes (poll_id, user_id, user_type, option_index, created_at) VALUES ($1, $2, $3, $4, NOW())",
        [actualPollId, userId, userType, option_index]
      );

      await client.query('COMMIT');
      client.release();

      res.json({
        message: 'Stimme erfolgreich abgegeben',
        poll_id: actualPollId,
        option_index: option_index,
        user_id: userId,
        action: 'added'
      });

      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
        client.release();
        throw err;
      }

    } catch (err) {
      console.error('Database error in POST /polls/:pollId/vote:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Delete message (soft delete)
  router.delete('/messages/:messageId', verifyTokenRBAC, async (req, res) => {
    const messageId = req.params.messageId;
    const userId = req.user.id;
    const userType = req.user.type;
    
    try {
      // Get message details and check ownership
      const messageQuery = `
        SELECT m.*, cr.organization_id 
        FROM chat_messages m 
        JOIN chat_rooms cr ON m.room_id = cr.id 
        WHERE m.id = $1
      `;
      const { rows: [message] } = await db.query(messageQuery, [messageId]);
      
      if (!message) {
        return res.status(404).json({ error: 'Nachricht nicht gefunden' });
      }
      
      // Check if user can delete this message (own message or admin in same org)
      const canDelete = (message.user_id == userId && message.user_type === userType) || 
                       (userType === 'admin' && message.organization_id == req.user.organization_id);
      
      if (!canDelete) {
        return res.status(403).json({ error: 'Du kannst nur eigene Nachrichten löschen' });
      }
      
      // Soft delete the message
      await db.query("UPDATE chat_messages SET deleted_at = NOW() WHERE id = $1", [messageId]);

      // WebSocket: Broadcast message deletion to room
      if (io) {
        io.to(`room_${message.room_id}`).emit('messageDeleted', {
          roomId: message.room_id,
          messageId: parseInt(messageId)
        });
      }

      res.json({ message: 'Nachricht erfolgreich gelöscht' });
      
    } catch (err) {
 console.error('Database error in DELETE /messages/:messageId:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Vote for a poll (by message ID - for frontend compatibility)
  router.post('/messages/:messageId/vote', verifyTokenRBAC, async (req, res) => {
    const messageId = req.params.messageId;
    const { option_index } = req.body;
    const userId = req.user.id;
    const userType = req.user.type;
    
    
    if (option_index === undefined || option_index === null) {
      return res.status(400).json({ error: 'Option-Index ist erforderlich' });
    }
    
    try {
      // Get the poll by message_id
      const getPollQuery = `
        SELECT p.*, m.room_id FROM chat_polls p
        JOIN chat_messages m ON p.message_id = m.id
        WHERE p.message_id = $1
      `;
      
      const { rows: [poll] } = await db.query(getPollQuery, [messageId]);
      
      if (!poll) {
        return res.status(404).json({ error: 'Umfrage für diese Nachricht nicht gefunden' });
      }
      
      // Check if poll has expired
      if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Umfrage ist abgelaufen' });
      }
      
      // Parse options and validate option_index
      let parsedOptions;
      try {
        parsedOptions = JSON.parse(poll.options);
      } catch (e) {
 console.error('Failed to parse poll options:', poll.options);
        return res.status(500).json({ error: 'Ungültige Umfragedaten' });
      }
      
      if (option_index < 0 || option_index >= parsedOptions.length) {
        return res.status(400).json({ error: 'Ungültiger Option-Index' });
      }
      
      // Check if user has access to the room
      const accessQuery = `
        SELECT 1 FROM chat_participants cp 
        JOIN chat_rooms cr ON cp.room_id = cr.id 
        WHERE cp.room_id = $1 AND cp.user_id = $2 AND cp.user_type = $3 AND cr.organization_id = $4
      `;
      const { rows: [access] } = await db.query(accessQuery, [poll.room_id, userId, userType, req.user.organization_id]);
      
      if (!access) {
        return res.status(403).json({ error: 'Zugriff auf diesen Raum verweigert' });
      }
      
      const client = await db.getClient();
      try {
      await client.query('BEGIN');

      // For single choice polls, remove existing vote
      if (!poll.multiple_choice) {
        await client.query(
          "DELETE FROM chat_poll_votes WHERE poll_id = $1 AND user_id = $2 AND user_type = $3",
          [poll.id, userId, userType]
        );
      } else {
        // For multiple choice, check if user already voted for this option
        const { rows: [existingVote] } = await client.query(
          "SELECT 1 FROM chat_poll_votes WHERE poll_id = $1 AND user_id = $2 AND user_type = $3 AND option_index = $4",
          [poll.id, userId, userType, option_index]
        );

        if (existingVote) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: 'Du hast bereits für diese Option abgestimmt' });
        }
      }

      // Add the new vote
      await client.query(
        "INSERT INTO chat_poll_votes (poll_id, user_id, user_type, option_index, created_at) VALUES ($1, $2, $3, $4, NOW())",
        [poll.id, userId, userType, option_index]
      );

      await client.query('COMMIT');
      client.release();

      res.json({
        message: 'Stimme erfolgreich abgegeben',
        poll_id: poll.id,
        message_id: parseInt(messageId),
        option_index: option_index,
        user_id: userId
      });

      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
        client.release();
        throw err;
      }

    } catch (err) {
      console.error('Database error in POST /messages/:messageId/vote:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // DELETE a chat room (Admin only)
  router.delete('/rooms/:roomId', verifyTokenRBAC, async (req, res) => {
    const roomId = req.params.roomId;
    const userId = req.user.id;
    const userType = req.user.type;
    const forceDelete = req.query.force === 'true';
    
    if (userType !== 'admin') {
      return res.status(403).json({ error: 'Nur Admins können Chat-Räume löschen' });
    }
    
    try {
      // Get room details
      const { rows: [room] } = await db.query("SELECT * FROM chat_rooms WHERE id = $1 AND organization_id = $2", [roomId, req.user.organization_id]);
      if (!room) {
        return res.status(404).json({ error: 'Chat-Raum nicht gefunden' });
      }
      
      // Check if room has messages
      const { rows: [messageCount] } = await db.query("SELECT COUNT(*)::int as count FROM chat_messages WHERE room_id = $1 AND deleted_at IS NULL", [roomId]);
      
      if (messageCount.count > 0 && !forceDelete) {
        // All admins can force delete chat rooms
        return res.status(409).json({ 
          error: `Chat-Raum kann nicht gelöscht werden: ${messageCount.count} Nachricht(en) vorhanden.`,
          canForceDelete: true
        });
      }
      
      // Prevent deletion of system rooms (jahrgang chats can only be deleted via jahrgang)
      if (room.type === 'jahrgang') {
        return res.status(409).json({ 
          error: 'Jahrgangs-Chat-Räume können nicht direkt gelöscht werden. Bitte den Jahrgang löschen.'
        });
      }
      
      // Direct chats can be deleted by admins (no restrictions)
      
      const client = await db.getClient();
      try {
      await client.query('BEGIN');

      // If force delete or no messages, proceed with deletion
      if (forceDelete || messageCount.count === 0) {
        // Get all files before deleting messages (for file cleanup)
        const { rows: filesForDeletion } = await client.query("SELECT file_path FROM chat_messages WHERE room_id = $1 AND file_path IS NOT NULL", [roomId]);

        // Delete in correct order due to foreign keys
        // 1. Delete poll votes first (polls are linked via message_id, not room_id)
        await client.query(`
          DELETE FROM chat_poll_votes WHERE poll_id IN (
            SELECT cp.id FROM chat_polls cp
            JOIN chat_messages cm ON cp.message_id = cm.id
            WHERE cm.room_id = $1
          )
        `, [roomId]);

        // 2. Delete polls (via message_id)
        await client.query(`
          DELETE FROM chat_polls WHERE message_id IN (
            SELECT id FROM chat_messages WHERE room_id = $1
          )
        `, [roomId]);

        // 3. Delete read status
        await client.query("DELETE FROM chat_read_status WHERE room_id = $1", [roomId]);

        // 4. Delete messages
        await client.query("DELETE FROM chat_messages WHERE room_id = $1", [roomId]);

        // 5. Delete participants
        await client.query("DELETE FROM chat_participants WHERE room_id = $1", [roomId]);

        // 6. Delete room itself
        await client.query("DELETE FROM chat_rooms WHERE id = $1", [roomId]);

        // 7. Clean up files from filesystem (best effort, don't fail if files don't exist)
        const fs = require('fs').promises;
        const path = require('path');

        for (const fileRecord of filesForDeletion) {
          try {
            const fullPath = path.join(__dirname, '..', 'uploads', 'chat', fileRecord.file_path);
            await fs.unlink(fullPath);
          } catch (fileErr) {
 console.warn(`Could not delete file ${fileRecord.file_path}:`, fileErr.message);
            // Don't fail the whole operation if file deletion fails
          }
        }
      }

      await client.query('COMMIT');
      client.release();

      res.json({ message: 'Chat-Raum erfolgreich gelöscht' });

      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
        client.release();
        throw err;
      }

    } catch (err) {
      console.error(`Database error in DELETE /rooms/${roomId}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // === REACTIONS API ===

  // Add reaction to a message
  router.post('/messages/:messageId/reactions', verifyTokenRBAC, async (req, res) => {
    const messageId = req.params.messageId;
    const { emoji } = req.body;
    const userId = req.user.id;
    const userType = req.user.type;

    if (!emoji) {
      return res.status(400).json({ error: 'Emoji ist erforderlich' });
    }

    // Nur bestimmte Emojis erlauben (Sicherheit)
    const allowedEmojis = ['like', 'heart', 'laugh', 'wow', 'sad', 'pray'];
    if (!allowedEmojis.includes(emoji)) {
      return res.status(400).json({ error: 'Ungültiger Emoji-Typ' });
    }

    try {
      // Get message and check access
      const messageQuery = `
        SELECT m.room_id, cr.organization_id
        FROM chat_messages m
        JOIN chat_rooms cr ON m.room_id = cr.id
        WHERE m.id = $1
      `;
      const { rows: [message] } = await db.query(messageQuery, [messageId]);

      if (!message) {
        return res.status(404).json({ error: 'Nachricht nicht gefunden' });
      }

      if (message.organization_id !== req.user.organization_id) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }

      // Check if user is participant in the room
      const participantQuery = `
        SELECT 1 FROM chat_participants
        WHERE room_id = $1 AND user_id = $2 AND user_type = $3
      `;
      const { rows: [isParticipant] } = await db.query(participantQuery, [message.room_id, userId, userType]);

      if (!isParticipant) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }

      // Check if user already has this reaction (toggle off)
      const existingQuery = `
        SELECT id FROM chat_message_reactions
        WHERE message_id = $1 AND user_id = $2 AND user_type = $3 AND emoji = $4
      `;
      const { rows: [existing] } = await db.query(existingQuery, [messageId, userId, userType, emoji]);

      if (existing) {
        // Remove reaction
        await db.query('DELETE FROM chat_message_reactions WHERE id = $1', [existing.id]);

        // Broadcast via WebSocket
        if (io) {
          io.to(`room_${message.room_id}`).emit('reactionRemoved', {
            roomId: message.room_id,
            messageId: parseInt(messageId),
            userId,
            userType,
            emoji
          });
        }

        return res.json({ action: 'removed', emoji });
      }

      // Add reaction
      const insertQuery = `
        INSERT INTO chat_message_reactions (message_id, user_id, user_type, emoji)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;
      const { rows: [newReaction] } = await db.query(insertQuery, [messageId, userId, userType, emoji]);

      // Broadcast via WebSocket
      if (io) {
        io.to(`room_${message.room_id}`).emit('reactionAdded', {
          roomId: message.room_id,
          messageId: parseInt(messageId),
          reaction: {
            id: newReaction.id,
            user_id: userId,
            user_type: userType,
            emoji,
            user_name: req.user.display_name
          }
        });
      }

      res.json({ action: 'added', emoji, id: newReaction.id });

    } catch (err) {
 console.error('Database error in POST /messages/:messageId/reactions:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get reactions for a message
  router.get('/messages/:messageId/reactions', verifyTokenRBAC, async (req, res) => {
    const messageId = req.params.messageId;
    const userId = req.user.id;
    const userType = req.user.type;
    const organizationId = req.user.organization_id;

    try {
      // Zugriff pruefen: Nachricht muss in der eigenen Organisation liegen
      const messageQuery = `
        SELECT m.room_id, cr.organization_id
        FROM chat_messages m
        JOIN chat_rooms cr ON m.room_id = cr.id
        WHERE m.id = $1
      `;
      const { rows: [message] } = await db.query(messageQuery, [messageId]);
      if (!message) {
        return res.status(404).json({ error: 'Nachricht nicht gefunden' });
      }
      if (message.organization_id !== organizationId) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }

      // Admins duerfen alle Raeume ihrer Org lesen, andere muessen Teilnehmer sein
      if (userType !== 'admin') {
        const { rows: [isParticipant] } = await db.query(
          "SELECT 1 FROM chat_participants WHERE room_id = $1 AND user_id = $2 AND user_type = $3",
          [message.room_id, userId, userType]
        );
        if (!isParticipant) {
          return res.status(403).json({ error: 'Zugriff verweigert' });
        }
      }

      const query = `
        SELECT r.*, u.display_name as user_name
        FROM chat_message_reactions r
        JOIN users u ON r.user_id = u.id
        WHERE r.message_id = $1
        ORDER BY r.created_at ASC
      `;
      const { rows: reactions } = await db.query(query, [messageId]);

      res.json(reactions);

    } catch (err) {
 console.error('Database error in GET /messages/:messageId/reactions:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get available chat partners for Konfis
  router.get('/available-users', verifyTokenRBAC, async (req, res) => {
    try {
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;

      // Nur für Konfis verfügbar
      if (userType !== 'konfi') {
        return res.status(403).json({ error: 'Nur Konfis können diesen Endpunkt nutzen' });
      }

      // 1. Get Konfi's jahrgang
      const konfiQuery = `
        SELECT kp.jahrgang_id, j.name as jahrgang_name
        FROM konfi_profiles kp
        JOIN jahrgaenge j ON kp.jahrgang_id = j.id
        WHERE kp.user_id = $1
      `;
      const { rows: [konfiProfile] } = await db.query(konfiQuery, [userId]);
      
      if (!konfiProfile || !konfiProfile.jahrgang_id) {
        return res.status(400).json({ error: 'Konfi ist keinem Jahrgang zugewiesen' });
      }

      // DATENSCHUTZ: Konfis dürfen NUR Admins anschreiben (keine Konfi-zu-Konfi Chats)
      // Alle Admins, Org-Admins und Teamer der Organisation
      // role_title ist die selbst gewählte Rollenbezeichnung (z.B. "Pastorin", "Teamerin")
      const adminQuery = `
        SELECT DISTINCT u.id, u.display_name as name, 'admin' as type,
          r.name as role_name,
          COALESCE(NULLIF(u.role_title, ''),
            CASE
              WHEN r.name = 'teamer' THEN 'Teamer:in'
              WHEN r.name = 'org_admin' THEN 'Admin'
              WHEN r.name = 'admin' THEN 'Admin'
              ELSE 'Admin'
            END
          ) as role_description,
          null as jahrgang_name
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE r.name IN ('admin', 'org_admin', 'teamer')
        AND u.organization_id = $1
        AND u.id != $2
        ORDER BY u.display_name
      `;
      const { rows: admins } = await db.query(adminQuery, [organizationId, userId]);
      const availableUsers = admins;

      // 5. Get existing direct chats to filter out duplicates
      const existingChatsQuery = `
        SELECT DISTINCT 
          CASE 
            WHEN cp1.user_id = $1 THEN cp2.user_id
            ELSE cp1.user_id
          END as partner_id,
          CASE 
            WHEN cp1.user_id = $1 THEN cp2.user_type
            ELSE cp1.user_type
          END as partner_type
        FROM chat_participants cp1
        JOIN chat_participants cp2 ON cp1.room_id = cp2.room_id
        JOIN chat_rooms cr ON cp1.room_id = cr.id
        WHERE cr.type = 'direct'
        AND cr.organization_id = $2
        AND ((cp1.user_id = $1 AND cp1.user_type = $3) OR (cp2.user_id = $1 AND cp2.user_type = $3))
        AND cp1.user_id != cp2.user_id
      `;
      const { rows: existingChats } = await db.query(existingChatsQuery, [userId, organizationId, userType]);
      const existingPartnerKeys = new Set(existingChats.map(chat => `${chat.partner_id}_${chat.partner_type}`));

      // 6. Filter out users with existing direct chats
      const filteredUsers = availableUsers.filter(user => {
        const key = `${user.id}_${user.type}`;
        return !existingPartnerKeys.has(key);
      });

      res.json({
        users: filteredUsers,
        jahrgang: konfiProfile.jahrgang_name,
        permissions: 'direct_only_admin' // DATENSCHUTZ: Konfis dürfen nur Admins anschreiben
      });

    } catch (err) {
 console.error('Database error in GET /chat/available-users:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};