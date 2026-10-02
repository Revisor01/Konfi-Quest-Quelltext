const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { formatUhrzeit, formatDatum } = require('../utils/zeitformat');
const jwt = require('jsonwebtoken');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { ORG_KEIN_ZUGRIFF } = require('../middleware/rbac');
const PushService = require('../services/pushService');
const { chatPushText } = require('../utils/pushText');
const { rollenAnzeigename } = require('../utils/rollenNamen');
const { encryptFileToFile, decryptFileToStream, leseKopfBytes } = require('../utils/photoCrypto');
const { syncJahrgangChat, roleToParticipantType } = require('../utils/jahrgangChat');
const { darfJahrgang, darfKonfi } = require('../utils/jahrgangsZugriff');
const { syncTeamChat } = require('../utils/teamChat');
const chatSyncCache = require('../utils/chatSyncCache');
const { nachAntwort } = require('../utils/nachAntwort');
const { darfRaumBetreten } = require('../utils/chatRoomAccess');
const { istTextTyp, pruefeTextDatei, textInhaltsTyp } = require('../utils/textDatei');

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

  // Zielraeume fuer EINEN Broadcast einer neuen Nachricht: der Chat-Raum
  // (fuer alle, die den Chat gerade offen haben -- auch die Leitung, die ohne
  // Teilnehmerschaft mitliest) PLUS die persoenlichen Raeume aller
  // Teilnehmenden (fuer Zaehler und Raumliste, wenn der Chat zu ist).
  //
  // Socket.IO stellt einen Broadcast an mehrere Raeume je Socket genau EINMAL
  // zu, auch wenn der Socket in mehreren der Raeume sitzt (socket.io-adapter,
  // `apply` fuehrt eine Menge der schon bedienten Socket-IDs); der
  // Postgres-Adapter traegt die Raumliste als Ganzes zu den anderen Replicas.
  // Ereignisname und Payload bleiben, wie die Store-Apps sie lesen.
  const zielRaeumeFuerNachricht = (roomId, teilnehmer) => [
    `room_${roomId}`,
    ...teilnehmer.map((p) => `user_${p.user_type}_${p.user_id}`),
  ];

  // Nacharbeit zu einer neuen Nachricht (oder Umfrage), NACH der Antwort:
  // Teilnehmende einmal laden, EIN Socket-Broadcast, EIN Sammel-Push.
  //
  // Ueber nachAntwort statt einer nackten async-IIFE: Fehler werden gemeldet
  // statt als unbehandelte Ablehnung zu enden, und Tests koennen den Nachlauf
  // abwarten (utils/nachAntwort.js).
  //
  // @param {object} req
  // @param {object} arg
  // @param {number|string} arg.roomId
  // @param {{id:number, type:string, name:string}} arg.sender
  // @param {number} arg.messageId
  // @param {(message:object) => object} arg.payload  Socket-Payload `message`
  // @param {(raum:{roomName:string, isDirectChat:boolean}) => {title:string, body:string}} arg.textFuer
  const nachNeuerNachricht = (req, { roomId, sender, messageId, payload, textFuer }) =>
    nachAntwort(req, async () => {
      const { rows: teilnehmer } = await db.query(
        'SELECT user_id, user_type FROM chat_participants WHERE room_id = $1',
        [roomId]
      );

      // WebSocket: EIN Broadcast an den Raum (offene Chats) und die
      // persoenlichen Raeume aller Teilnehmenden (Zaehler, Raumliste) --
      // je Client genau einmal, siehe zielRaeumeFuerNachricht.
      if (io) {
        io.to(zielRaeumeFuerNachricht(roomId, teilnehmer)).emit('newMessage', {
          roomId: parseInt(roomId),
          message: payload
        });
      }

      // Push an alle anderen Teilnehmenden -- gesammelt, nicht je Kopf.
      const empfaenger = teilnehmer
        .filter((p) => !(Number(p.user_id) === Number(sender.id) && p.user_type === sender.type))
        .map((p) => p.user_id);
      if (empfaenger.length === 0) return;

      const { rows: [room] } = await db.query(
        'SELECT name, type, organization_id FROM chat_rooms WHERE id = $1',
        [roomId]
      );
      const roomName = room?.name || 'Chat';
      const isDirectChat = room?.type === 'direct';
      const { title, body } = textFuer({ roomName, isDirectChat });

      await PushService.sendChatNotificationToMany(db, empfaenger, {
        title,
        body,
        roomId,
        messageId,
        data: {
          sender_id: sender.id,
          sender_name: sender.name,
          room_name: roomName,
          room_type: room?.type || 'unknown',
          // Content-Org des Raums (Multi-Org: der Tap wechselt in die
          // Organisation des Raums) -- mitgereicht, damit der Push-Dienst
          // sie nicht erneut nachsehen muss.
          organization_id: room?.organization_id
        }
      });
    }, 'Chat-Push');

  // Hilfsfunktion: Nach einem Vote den aktuellen Poll-Stand einsammeln und per
  // 'pollUpdated' an den Raum senden, damit alle offenen Chats die neuen Votes
  // live sehen. Die Poll-/Votes-Struktur ist
  // identisch zu GET /messages: options als Array, anonymitaets-bewusste Votes
  // (bei anonymen Umfragen ohne user_name). messageId ist die message_id der
  // Poll-Nachricht, damit der Client die richtige Nachricht im State findet.
  // Stimmen einer Umfrage für die Auslieferung aufbereiten.
  //
  // Bei anonymen Umfragen wurde bisher nur der Name weggelassen, user_id und
  // user_type aber weiterhin je Stimme mitgeliefert. Über die Teilnehmerliste
  // (GET /rooms/:id/participants) liess sich daraus aufloesen, wer was gewählt
  // hat — die zugesagte Anonymitaet war nur kosmetisch.
  //
  // Das Frontend braucht die Kennung ausschliesslich, um die EIGENE Stimme zu
  // markieren (MessageBubble: vote.user_id === user.id && vote.user_type ===
  // user.type). Deshalb wird bei anonymen Umfragen nur noch die eigene Stimme
  // mit Kennung ausgeliefert; fremde zählen anonym mit.
  const stimmenAufbereiten = (rawVotes, anonym, empfaengerId, empfaengerTyp) =>
    rawVotes.map(v => {
      const eigene = v.user_id === empfaengerId && v.user_type === empfaengerTyp;
      if (!anonym) {
        return {
          user_id: v.user_id,
          user_type: v.user_type,
          option_index: v.option_index,
          user_name: v.voter_name,
        };
      }
      return {
        user_id: eigene ? v.user_id : null,
        user_type: eigene ? v.user_type : null,
        option_index: v.option_index,
        user_name: undefined,
      };
    });

  const emitPollUpdate = async (pollDbId, roomId) => {
    if (!io) return; // io-defensiv: in Tests kein Socket -> No-op
    try {
      const { rows: [poll] } = await db.query(
        `SELECT p.id, p.message_id, p.question, p.options, p.multiple_choice,
                p.anonymous, p.exclusive_options, p.expires_at
         FROM chat_polls p WHERE p.id = $1`,
        [pollDbId]
      );
      if (!poll) return;

      const { rows: rawVotes } = await db.query(
        `SELECT v.user_id, v.user_type, v.option_index, u.display_name as voter_name
         FROM chat_poll_votes v
         LEFT JOIN users u ON v.user_id = u.id
         WHERE v.poll_id = $1`,
        [pollDbId]
      );

      let parsedOptions = [];
      try { parsedOptions = JSON.parse(poll.options); } catch (e) { parsedOptions = []; }
      const isAnonymous = Boolean(poll.anonymous);

      const pollPayload = {
        poll_id: poll.id,
        message_id: poll.message_id,
        question: poll.question,
        options: parsedOptions,
        multiple_choice: Boolean(poll.multiple_choice),
        anonymous: isAnonymous,
        exclusive_options: Boolean(poll.exclusive_options),
        expires_at: poll.expires_at,
        // Broadcast an den ganzen Raum: Es gibt keinen einzelnen Empfaenger,
        // also kann hier keine "eigene" Stimme markiert werden. Bei anonymen
        // Umfragen fallen alle Kennungen weg; der Client holt seine eigene
        // Markierung über GET /rooms/:id/messages.
        votes: stimmenAufbereiten(rawVotes, isAnonymous, null, null),
      };

      io.to(`room_${roomId}`).emit('pollUpdated', {
        roomId: parseInt(roomId),
        messageId: poll.message_id,
        poll: pollPayload,
      });
    } catch (emitErr) {
      console.error('Failed to emit pollUpdated:', emitErr);
    }
  };

  // Hilfsfunktion: 'roomsChanged' an die persoenlichen User-Räume der
  // betroffenen Nutzer senden, damit deren ChatOverview die Raumliste neu laedt
  // Nur die einfachen Fälle (Raum erstellt/
  // gelöscht, Teilnehmer hinzugefuegt/entfernt/verlassen). targets ist eine
  // Liste von { user_id, user_type }.
  const emitRoomsChanged = (targets) => {
    if (!io || !Array.isArray(targets)) return; // io-defensiv: in Tests No-op
    // Duplikate zusammenfassen (z.B. bei Direktchat kann derselbe User doppelt vorkommen).
    const seen = new Set();
    for (const t of targets) {
      if (!t || t.user_id == null || !t.user_type) continue;
      const key = `${t.user_type}_${t.user_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      io.to(`user_${t.user_type}_${t.user_id}`).emit('roomsChanged');
    }
  };

  // Team-Kontaktliste für Direktchats: alle Admins, Org-Admins und Teamer:innen
  // der eigenen Organisation.
  //
  // Warum eine eigene Route: Das Chat-Modal hat die Team-Mitglieder bisher über
  // /admin/users geladen — die Route ist aber mit requireOrgAdmin geschuetzt.
  // Teamer:innen liefen dort in einen 403, den das Frontend still verschluckt hat;
  // ihre Kontaktliste blieb dadurch leer und sie konnten niemanden aus dem Team
  // anschreiben. Diese Route gibt bewusst NUR die für einen Chat noetigen Felder
  // heraus (keine E-Mail, keine Login-Zeitpunkte) und ist für das ganze Team offen.
  router.get('/team-contacts', verifyTokenRBAC, async (req, res) => {
    try {
      if (!['admin', 'org_admin', 'teamer'].includes(req.user.role_name)) {
        return res.status(403).json({ error: 'Nur für das Team und die Leitung' });
      }

      const query = `
        SELECT u.id, u.display_name, r.name AS role_name,
               COALESCE(NULLIF(u.role_title, ''),
                 -- Woerter wie utils/rollenNamen.js.
                 CASE
                   WHEN r.name = 'teamer' THEN 'Teamer:in'
                   WHEN r.name = 'org_admin' THEN 'Gemeindeleitung'
                   ELSE 'Leitung'
                 END
               ) AS role_description
          FROM users u
          ${TEAM_MITGLIED_ROLLE}
         WHERE r.name IN ('admin', 'org_admin', 'teamer')
           AND u.is_active = true
           AND u.deleted_at IS NULL
           AND u.id != $1
         ORDER BY u.display_name
      `;
      const { rows } = await db.query(query, [req.user.id, req.user.organization_id]);
      res.json(rows);

    } catch (err) {
      console.error('Database error in GET /chat/team-contacts:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get admins for direct contact (konfis only)
  router.get('/admins', verifyTokenRBAC, async (req, res) => {
    try {
      if (req.user.type !== 'konfi') {
        return res.status(403).json({ error: 'Konfi-Zugriff erforderlich' });
      }
      
      const organizationId = req.user.organization_id;
      const query = `
        SELECT u.id, u.display_name
          FROM users u
          ${TEAM_MITGLIED_ROLLE}
         WHERE r.name IN ('admin', 'org_admin', 'teamer')
           AND u.is_active = true
           AND u.deleted_at IS NULL
           AND u.id <> $1
           AND ${KONFI_SIEHT_TEAMMITGLIED}
         ORDER BY u.display_name`;
      const { rows: admins } = await db.query(query, [req.user.id, organizationId]);
      res.json(admins);
      
    } catch (err) {
 console.error('Database error in GET /admins:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Create or get direct chat room
  // Darf der Anfragende diesen Konfi anschreiben?
  //
  // Gibt null zurueck, wenn erlaubt, sonst eine Fehlermeldung.
  const konfiAnschreibenVerboten = async (anfragender, zielUserId) => {
    const pseudoReq = { user: anfragender };

    // Vollzugriff zuerst, ueber dieselbe Quelle: darfJahrgang laesst
    // org_admin und super_admin (Rolle oder Flag) vor jeder Jahrgangs-
    // pruefung durch. So bleibt fuer die Leitung auch ein Konfi-Konto ohne
    // konfi_profiles-Datensatz erreichbar (Reparaturfall).
    if (darfJahrgang(pseudoReq, null)) return null;

    // darfKonfi ist die EINE Semantik-Quelle fuer die gebundenen Rollen
    // (admin, teamer): Zuweisung mit can_view noetig, Konfi ohne Jahrgang
    // ergibt erlaubt=false. Keine vierte Kopie der Regel hier.
    const { gefunden, erlaubt, jahrgangId } = await darfKonfi(db, pseudoReq, zielUserId);
    if (erlaubt) return null;

    // Konfi ohne Jahrgang (oder ohne Profil-Datensatz).
    if (!gefunden || !jahrgangId) {
      return 'Diese Konfirmand:in ist keinem deiner Jahrgänge zugeordnet';
    }
    return 'Du kannst nur Konfirmand:innen aus deinen Jahrgängen anschreiben';
  };

  // Darf dieser Nutzer den Raum oeffnen (lesen, schreiben, Teilnehmer sehen,
  // exportieren, Dateien laden, Umfragen, verwalten)?
  //
  // Gibt true zurück, wenn der Zugriff erlaubt ist.
  const darfRaumOeffnen = async (roomId, user) =>
    (await darfRaumBetreten(db, roomId, user)).ok;

  // Gegenrichtung: Darf dieser Konfi dieses Team-Mitglied anschreiben?
  //
  // zielRolle muss die EFFEKTIVE Rolle in der aktiven Organisation sein —
  // bei Multi-Org-Konten also die aus user_organizations, nicht die
  // Primaerrolle (TEAM_MITGLIED_ROLLE loest das auf, rbac.js macht es beim
  // Org-Wechsel genauso).
  //
  // Bestehende Raeume sperrt die Regel NICHT nachtraeglich: darfRaumOeffnen
  // prueft Teilnehmerschaft, nicht Jahrgaenge. Gebunden ist nur das ANLEGEN.
  //
  // Gibt null zurück, wenn erlaubt, sonst eine Fehlermeldung.
  const teamAnschreibenVerboten = async (konfiUserId, zielRolle, zielUserId) => {
    if (zielRolle === 'org_admin' || zielRolle === 'super_admin') return null;

    // is_super_admin-Flag zaehlt wie die Rolle (gleiche Quelle wie
    // darfJahrgang); sonst entscheidet der gemeinsame Jahrgang.
    const { rows: [ziel] } = await db.query(
      `SELECT 1
         FROM users u
        WHERE u.id = $2
          AND (u.is_super_admin OR EXISTS (
            SELECT 1
              FROM konfi_profiles kp
              JOIN user_jahrgang_assignments uja
                ON uja.jahrgang_id = kp.jahrgang_id AND uja.can_view
             WHERE kp.user_id = $1 AND uja.user_id = u.id
          ))
        LIMIT 1`,
      [konfiUserId, zielUserId]
    );

    if (!ziel) {
      // Gleiche Tonlage fuer beide Rollen: sagt WARUM es nicht geht, ohne
      // die Gemeindestruktur (Zuweisungen, andere Jahrgaenge) auszubreiten.
      return zielRolle === 'admin'
        ? 'Diese Person aus der Leitung ist nicht für deinen Jahrgang zuständig'
        : 'Diese Teamer:in ist nicht für deinen Jahrgang zuständig';
    }
    return null;
  };

  const TEAM_MITGLIED_ROLLE = `
    LEFT JOIN user_organizations uo
      ON uo.user_id = u.id AND uo.organization_id = $2
    JOIN roles r
      ON r.id = CASE WHEN u.organization_id = $2 THEN u.role_id ELSE uo.role_id END`;

  // Bewusst als geteilter Baustein fuer beide Listen (/admins,
  // /available-users); POST /direct zieht dieselbe Regel ueber
  // teamAnschreibenVerboten. Stand die Regel mehrfach im Code, blieb bisher
  // regelmäßig eine Stelle zurück.
  const KONFI_SIEHT_TEAMMITGLIED = `(
    r.name = 'org_admin'
    OR u.is_super_admin
    OR EXISTS (
      SELECT 1
        FROM konfi_profiles kp
        JOIN user_jahrgang_assignments uja
          ON uja.jahrgang_id = kp.jahrgang_id AND uja.can_view
       WHERE kp.user_id = $1 AND uja.user_id = u.id
    )
  )`;

  router.post('/direct', verifyTokenRBAC, async (req, res) => {
    try {
      const { target_user_id } = req.body;
      const organizationId = req.user.organization_id;

      if (!target_user_id) {
        return res.status(400).json({ error: 'Ziel-Benutzer erforderlich' });
      }

      // user_type des Ziels IMMER serverseitig aus der echten Rolle ableiten —
      // NIE vom Client uebernehmen. Der Client schickte für Teamer:innen
      // 'admin' (die API kannte nur admin|konfi), der Raum wurde dann mit
      // user_type='admin' gespeichert und war für den Teamer (liest als
      // 'teamer') unsichtbar. Gleiche Fehlerklasse wie Migration 098.
      const { rows: [validUser] } = await db.query(
        `SELECT u.id, u.display_name, r.name AS role_name
           FROM users u
           ${TEAM_MITGLIED_ROLLE}
          WHERE u.id = $1 AND u.deleted_at IS NULL`,
        [target_user_id, organizationId]
      );
      if (!validUser) {
        return res.status(403).json({ error: 'Benutzer nicht in deiner Gemeinde gefunden' });
      }

      // DATENSCHUTZ: Konfi-zu-Konfi-Chats gibt es nicht.
      if (req.user.type === 'konfi' && validUser.role_name === 'konfi') {
        return res.status(403).json({ error: 'Konfis können keine anderen Konfis anschreiben' });
      }

      if (req.user.type === 'konfi') {
        const verboten = await teamAnschreibenVerboten(req.user.id, validUser.role_name, target_user_id);
        if (verboten) {
          return res.status(403).json({ error: verboten });
        }
      }

      if (validUser.role_name === 'konfi') {
        const verboten = await konfiAnschreibenVerboten(req.user, target_user_id);
        if (verboten) {
          return res.status(403).json({ error: verboten });
        }
      }

      const user1_type = req.user.type;
      const user1_id = req.user.id;
      const user2_type = roleToParticipantType(validUser.role_name);
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
      
      const roomName = validUser.display_name;
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

      // Beide Teilnehmer sollen den neuen Direktchat sofort in ihrer Liste sehen.
      emitRoomsChanged([
        { user_id: user1_id, user_type: user1_type },
        { user_id: user2_id, user_type: user2_type },
      ]);

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

      // ZWEIERGESPRAECH HEISST GENAU ZWEI PERSONEN.
      // Der Typ 'direct' ist ueberall sonst das Signal "privat,
      // auch vor der Leitung" (darfRaumOeffnen, Export, Loeschen, Umfragen).
      // Bis hierher kam der Typ aber ungeprueft vom Client: Wer kein Konfi
      // war, konnte zwei Konfis in einen 'direct'-Raum setzen -- ein
      // Gruppenraum, den keine Leitung lesen kann und in dem Konfis einander
      // schreiben. Genau das schliesst "alle Chats sind moderiert,
      // Konfi-zu-Konfi-Chat gibt es nicht" aus. Der eigentliche Weg fuer
      // Zweiergespraeche ist POST /direct; 'direct' bleibt hier nur fuer
      // Clients erhalten, die diesen Weg nutzen (Antwortform ist Vertrag) --
      // mit genau einer weiteren Person. Den Bestand richtet Migration 164
      // (Raeume mit mehr als zwei Personen werden 'group' und damit fuer die
      // Leitung lesbar).
      if (type === 'direct') {
        const weitere = new Set(
          (Array.isArray(participants) ? participants : [])
            .map(p => parseInt(typeof p === 'object' && p !== null ? p.user_id : p, 10))
            .filter(uid => Number.isInteger(uid) && uid !== createdBy)
        );
        if (weitere.size !== 1) {
          return res.status(400).json({
            error: 'Ein Direktchat besteht aus genau zwei Personen. Für mehrere Personen lege eine Gruppe an.',
            error_code: 'direct_nur_zu_zweit'
          });
        }
      }

      // DATENSCHUTZ: Konfis dürfen NUR Direktnachrichten mit Admins erstellen (keine Gruppen, keine Konfi-zu-Konfi Chats)
      if (req.user.type === 'konfi') {
        if (type !== 'direct') {
          return res.status(403).json({
            error: 'Konfis können nur Direktnachrichten erstellen',
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
          return res.status(403).json({ error: 'Jahrgang nicht in deiner Gemeinde gefunden' });
        }
        const { rows: [existing] } = await db.query("SELECT id FROM chat_rooms WHERE type = 'jahrgang' AND jahrgang_id = $1 AND organization_id = $2", [jahrgang_id, organizationId]);
        if (existing) {
          // Der Raum steht schon: dann ist das hier ein Beitritt, kein Fehler.
          // Frueher kam an dieser Stelle 409 zurueck, ohne irgendwen einzutragen.
          // Konfis, die nach dem Anlegen des Jahrgangs dazukamen, landeten
          // deshalb nie in chat_participants und sahen den Chat nie.
          const { rows: konfis } = await db.query(
            `SELECT u.id FROM users u
               JOIN roles r ON u.role_id = r.id
               JOIN konfi_profiles kp ON u.id = kp.user_id
              WHERE r.name = 'konfi' AND kp.jahrgang_id = $1
                AND u.organization_id = $2 AND u.deleted_at IS NULL`,
            [jahrgang_id, organizationId]
          );
          for (const konfi of konfis) {
            await db.query(
              "INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, 'konfi') ON CONFLICT DO NOTHING",
              [existing.id, konfi.id]
            );
          }
          res.json({ room_id: existing.id, created: false });

          try {
            const { rows: currentParticipants } = await db.query(
              'SELECT user_id, user_type FROM chat_participants WHERE room_id = $1',
              [existing.id]
            );
            emitRoomsChanged(currentParticipants);
          } catch (notifyErr) {
            console.error('Failed to emit roomsChanged (join jahrgang chat):', notifyErr);
          }
          return;
        }
      }
      
      const insertRoomQuery = "INSERT INTO chat_rooms (name, type, jahrgang_id, created_by, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING id";
      const { rows: [newRoom] } = await db.query(insertRoomQuery, [name, type, jahrgang_id || null, createdBy, organizationId]);
      const roomId = newRoom.id;
      
      // Add creator as participant
      await db.query("INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, $3)", [roomId, createdBy, req.user.type]);
      
      if (participants && participants.length > 0) {
        // user_type IMMER serverseitig aus der echten Rolle ableiten — NIE vom
        // Client uebernehmen (Teamer:innen kamen sonst als 'admin' rein und
        // fanden den Raum nicht; gleiche Fehlerklasse wie Migration 098).
        const participantIds = participants
          .map(p => parseInt(typeof p === 'object' ? p.user_id : p))
          .filter(uid => Number.isInteger(uid) && uid !== createdBy);
        if (participantIds.length > 0) {
          // BEIDE Quellen der Zugehoerigkeit und die Rolle DIESER Gemeinde
          // Bis dahin stand hier
          // `u.organization_id = $2`: Wer ueber user_organizations hier
          // mitarbeitet, stand in der Kontaktliste, fiel hier aber still
          // heraus -- die Gruppe entstand ohne die Person.
          const { rows: partUsers } = await db.query(
            `SELECT u.id, r.name AS role_name
               FROM users u
               ${TEAM_MITGLIED_ROLLE}
              WHERE u.id = ANY($1::int[]) AND u.deleted_at IS NULL`,
            [participantIds, organizationId]
          );

          // Wer nicht zur Gemeinde gehoert, fiel bis hierher STILL heraus
          // Der Raum entstand ohne die
          // Person, und die Leitung hielt ihn fuer vollstaendig. Jetzt 400,
          // und der Raum wird nicht angelegt. Die Apps bieten nur Personen
          // der Gemeinde an (Kontaktliste mit denselben zwei Quellen); die
          // Meldung erreicht sie als error-Text.
          if (partUsers.length < new Set(participantIds).size) {
            await db.query('DELETE FROM chat_rooms WHERE id = $1', [roomId]);
            return res.status(400).json({
              error: 'Mindestens eine ausgewählte Person gehört nicht zu dieser Gemeinde.',
              error_code: 'teilnehmende_nicht_in_gemeinde'
            });
          }

          // Konfi-zu-Konfi bleibt verboten — auch hier. Geprueft wurde oben nur
          // der Raum-TYP ('direct'), nicht WEN eine Konfi eintraegt. Über
          // participants liess sich POST /direct (das die Kombination korrekt
          // mit 403 ablehnt) damit umgehen und ein Raum mit einer anderen Konfi
          // anlegen. Der Kommentar oben versprach das bereits.
          if (req.user.type === 'konfi' && partUsers.some(pu => pu.role_name === 'konfi')) {
            await db.query('DELETE FROM chat_rooms WHERE id = $1', [roomId]);
            return res.status(403).json({
              error: 'Konfirmand:innen können nur das Team anschreiben, nicht einander'
            });
          }

          if (req.user.type === 'konfi') {
            for (const pu of partUsers) {
              const verboten = await teamAnschreibenVerboten(req.user.id, pu.role_name, pu.id);
              if (verboten) {
                await db.query('DELETE FROM chat_rooms WHERE id = $1', [roomId]);
                return res.status(403).json({ error: verboten });
              }
            }
          }

          if (req.user.type !== 'konfi') {
            for (const pu of partUsers.filter(x => x.role_name === 'konfi')) {
              const verboten = await konfiAnschreibenVerboten(req.user, pu.id);
              if (verboten) {
                await db.query('DELETE FROM chat_rooms WHERE id = $1', [roomId]);
                return res.status(403).json({ error: verboten });
              }
            }
          }

          const participantPromises = partUsers.map(pu =>
            db.query(
              "INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
              [roomId, pu.id, roleToParticipantType(pu.role_name)]
            ).catch(err => console.error('Error adding participant :id:', pu.id, err))
          );
          await Promise.all(participantPromises);
        }
      } else if (type === 'jahrgang') {
        const konfisQuery = `SELECT u.id FROM users u
                              JOIN roles r ON u.role_id = r.id
                              JOIN konfi_profiles kp ON u.id = kp.user_id
                              WHERE r.name = 'konfi' AND kp.jahrgang_id = $1 AND u.organization_id = $2 AND u.deleted_at IS NULL`;
        const { rows: konfis } = await db.query(konfisQuery, [jahrgang_id, organizationId]);
        
        if (konfis.length > 0) {
          const konfiPromises = konfis.map(konfi => 
            db.query("INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, 'konfi')", [roomId, konfi.id])
 .catch(err => console.error('Error adding konfi :id to jahrgang chat:', konfi.id, err))
          );
          await Promise.all(konfiPromises);
        }
      }
      
      res.json({ room_id: roomId, created: true });

      // Alle finalen Teilnehmer sollen den neuen Raum sofort in ihrer Liste
      // sehen. Nach den (evtl. mehreren) Insert-Zweigen den tatsaechlichen
      // Teilnehmerstand einsammeln und benachrichtigen.
      try {
        const { rows: finalParticipants } = await db.query(
          'SELECT user_id, user_type FROM chat_participants WHERE room_id = $1',
          [roomId]
        );
        emitRoomsChanged(finalParticipants);
      } catch (notifyErr) {
        console.error('Failed to emit roomsChanged (POST /rooms):', notifyErr);
      }
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
      
      // Mitgliedschafts-Sync (Jahrgangs- + Team-Chat) NICHT mehr bei jedem Aufruf:
      // Das war Schreibarbeit auf dem meistgerufenen Lesepfad (25-35 Queries bei
      // einem Org-Admin mit 5 Jahrgängen, Hauptursache p95 ~919ms). Jetzt läuft
      // der Sync pro User höchstens 1x je TTL (10 Min) — neuer User ohne
      // Cache-Eintrag synct beim ERSTEN Aufruf sofort; Jahrgang-/Rollenwechsel
      // korrigieren die Mitgliedschaft ohnehin INLINE in ihren Handlern
      // (Details: utils/chatSyncCache.js).
      if (chatSyncCache.needsSync(organizationId, userId)) {
        let syncOk = true;

        // Jahrgangs-Chat-Mitgliedschaft synchronisieren (zentral, user_type-konsistent).
        // - konfi: genau sein Jahrgang
        // - teamer/admin: alle zugewiesenen Jahrgänge
        // - org_admin: alle Jahrgänge der Org (immer drin)
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
            // admin / teamer -> zugewiesene Jahrgänge
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
          syncOk = false;
          console.error('Jahrgangs-Chat-Sync beim Laden der Raeume fehlgeschlagen:', syncErr.message);
        }

        // Team-Chat-Mitgliedschaft synchronisieren (nur für Team-Mitglieder, nie Konfis).
        // Stellt sicher, dass der "Team"-Chat existiert und alle Admins/Teamer drin sind.
        if (userType !== 'konfi') {
          try {
            await syncTeamChat(db, organizationId, userId);
          } catch (teamSyncErr) {
            syncOk = false;
            console.error('Team-Chat-Sync beim Laden der Raeume fehlgeschlagen:', teamSyncErr.message);
          }
        }

        // Nur bei fehlerfreiem Sync merken — sonst beim nächsten Aufruf erneut versuchen.
        if (syncOk) {
          chatSyncCache.markSynced(organizationId, userId);
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
          -- Rolle des Direktchat-Partners für Chat-Farbe/Filter. Drei moegliche
          -- Werte: 'admin' (Leitung/Admin), 'teamer', 'konfi'.
          dm.partner_user_type,
          -- Reiner Team-Gruppenchat: KEIN Konfi unter den Teilnehmern. Vorher
          -- wurde auf user_type <> 'admin' geprüft — eine Gruppe mit
          -- Teamer:innen galt dadurch nie als Team-Gruppe, obwohl
          -- chat_participants.user_type 'teamer' als eigenen Wert fuehrt.
          (
              SELECT COUNT(*) FILTER (WHERE cp.user_type NOT IN ('admin', 'teamer')) = 0 AND COUNT(*) > 0
              FROM chat_participants cp
              WHERE cp.room_id = r.id
          ) as is_team_only,
          (
              SELECT COUNT(*)
              FROM chat_messages m
              WHERE m.room_id = r.id
              AND m.deleted_at IS NULL
              AND m.created_at > COALESCE(crs.last_read_at, '1970-01-01')
            AND m.created_at <= NOW()
              -- Eigene Nachrichten zaehlen nicht
              -- -- wie GET
              -- /notifications/badge-counts. Bis dahin zaehlte diese Stelle
              -- sie mit; die App faellt ohne Wert aus badge-counts auf diese
              -- Zahl zurueck (Reiter-Zahl, "Neu"-Trenner beim Oeffnen), die
              -- Store-Apps 2.2.0/2.3.0 ebenso. Feld und Werttyp bleiben.
              AND NOT (m.user_id = $1 AND m.user_type = $2)
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
              -- Die id als zweites Kriterium: Bei gleichem
              -- Zeitstempel ist die Reihenfolge nach SQL undefiniert, und
              -- die Vorschau zeigte dann mal die eine, mal die andere der
              -- beiden letzten Nachrichten.
              ORDER BY m.created_at DESC, m.id DESC
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
          -- Eindeutig sortieren, siehe oben.
          ORDER BY created_at DESC, id DESC
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
      if (!await darfRaumOeffnen(roomId, req.user)) {
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
 console.error('Database error in GET /rooms/:roomId:', req.params.roomId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Get messages for a room
  router.get('/rooms/:roomId/messages', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      /*
       * Obergrenze fuer limit.
       *
       * Bis hierhin ging `parseInt(req.query.limit) || 50` ungeprueft als
       * LIMIT $2 in die Abfrage. Ein Aufruf mit ?limit=100000 laedt
       * entsprechend viele Zeilen in den Heap eines 512-MB-Containers — und
       * darunter werden fuer JEDE geladene Nachricht noch Reaktionen und
       * Umfrage-Stimmen nachgeholt.
       *
       * Die 200 sind nicht neu erfunden: Der after-Zweig derselben Route
       * (LIMIT 200, weiter unten) hatte sie schon. Es war ein unvollstaendig
       * ausgerolltes Muster.
       *
       * Die Grenze liegt bewusst UEBER dem, was ausgelieferte Fassungen
       * anfragen: Die App schickt limit=100 (ChatRoom.tsx, zwei Stellen).
       * Keine Fassung auf einem Geraet bekommt dadurch eine kuerzere Antwort
       * als bisher — genau das waere der Fehler, den eine Deckelung machen
       * kann.
       *
       * Unsinnige Werte fallen auf die Vorgabe zurueck, nicht auf 1: LIMIT -5
       * wirft in PostgreSQL und kam vorher als 500 zurueck. Wer "-5" schickt,
       * meint keine einzelne Nachricht — er meint nichts Bestimmtes, und dann
       * ist der Normalfall die richtige Antwort.
       */
      const MAX_NACHRICHTEN = 200;
      const gewuenscht = parseInt(req.query.limit, 10);
      const limit = Number.isInteger(gewuenscht) && gewuenscht > 0
        ? Math.min(MAX_NACHRICHTEN, gewuenscht)
        : 50;
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;
      
      // Check if user has access to this room (with organization check)
      if (!await darfRaumOeffnen(roomId, req.user)) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }
      
      const after = parseInt(req.query.after) || null;

      /*
       * Aeltere Nachrichten nachladen: ?before=<message_id>.
       *
       * Die App lud einmal die juengsten 100 und danach nur noch Neues
       * (?after=) — alles davor war unerreichbar. Mit before blaettert sie
       * per Keyset nach oben: die <limit> Nachrichten DIESES Raums, die im
       * Tupel (created_at, id) vor der Anker-Nachricht liegen. Das Tupel ist
       * dieselbe Reihenfolge wie im Standardzweig; ein reiner Zeitvergleich
       * verloere Nachrichten mit gleichem Zeitstempel an der Seitengrenze.
       *
       * Additiv: Ohne before bleibt alles wie bisher (die Store-Apps rufen
       * limit=100 und after=). Ein leeres ?before= gilt als nicht gesetzt.
       *
       * - Keine positive ganze Zahl → 400. Die Obergrenze (15 Stellen, sicher
       *   als JS-Zahl und als bigint) haelt Unsinn von der Datenbank fern.
       * - Zusammen mit after → 400: zwei Richtungen zugleich ergeben nichts.
       * - Liegt die Anker-Nachricht nicht in diesem Raum (fremder Raum,
       *   unbekannte id), liefert die Unterabfrage keine Zeile, der Vergleich
       *   ergibt NULL und die Antwort ist leer. Kein Zeitstempel eines
       *   anderen Raums fliesst ein, und die Antwort verraet nicht, ob die id
       *   anderswo existiert.
       * - offset wird mit before nicht ausgewertet — Keyset ersetzt das
       *   Ueberspringen.
       */
      const beforeRoh = req.query.before;
      let before = null;
      if (beforeRoh !== undefined && beforeRoh !== '') {
        const gueltig = typeof beforeRoh === 'string' && /^[0-9]{1,15}$/.test(beforeRoh);
        before = gueltig ? Number(beforeRoh) : 0;
        if (!gueltig || before < 1) {
          return res.status(400).json({ error: 'Ungültiger Wert für before' });
        }
        if (req.query.after !== undefined && req.query.after !== '') {
          return res.status(400).json({ error: 'before und after lassen sich nicht kombinieren' });
        }
      }

      const selectColumns = `
      SELECT m.*,
              m.user_id as sender_id,
              m.user_type as sender_type,
              u.display_name as sender_name,
              u.role_title as sender_role_title,
              ro.display_name as sender_role_display_name,
              ro.name as sender_role_name,
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
      } else if (before) {
        messagesQuery = `${selectColumns}
        WHERE m.room_id = $1
          AND (m.created_at, m.id) < (
            SELECT anker.created_at, anker.id
            FROM chat_messages anker
            WHERE anker.id = $2 AND anker.room_id = $1
          )
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3`;
        queryParams = [roomId, before, limit];
      } else {
        messagesQuery = `${selectColumns}
        WHERE m.room_id = $1
        -- Eindeutig sortieren -- hier wiegt es am schwersten: Beim
        -- Blaettern mit LIMIT/OFFSET kann eine mehrdeutige Reihenfolge
        -- dieselbe Nachricht zweimal liefern oder eine ganz auslassen.
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $2 OFFSET $3`;
        queryParams = [roomId, limit, offset];
      }

      const { rows: messages } = await db.query(messagesQuery, queryParams);

      // Bulk-Query für Reactions und Poll-Votes (statt N+1 Queries)
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
            // Namen NICHT ausliefern (nur Zählung), damit niemand sehen kann, wer
            // was gewählt hat.
            const rawVotes = votesMap[msg.poll_id] || [];
            msg.votes = stimmenAufbereiten(rawVotes, msg.anonymous, userId, userType);
          }
          return msg;
        });
      }
      
      // Bei ?after ist die Query bereits ASC sortiert, kein reverse nötig
      res.json(after ? processedMessages : processedMessages.reverse());
    } catch (err) {
 console.error('Database error in GET /rooms/:roomId/messages:', req.params.roomId, err);
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

      // Check access (mit Organisations-Prüfung)
      if (!await darfRaumOeffnen(roomId, req.user)) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }
      
      // Process file
      let filePath = null, fileName = null, fileSize = null;
      let actualMessageType = message_type;
      if (req.file) {
        if (!req.file.path) {
          return res.status(400).json({ error: 'Datei konnte nicht gelesen werden' });
        }

        if (istTextTyp(req.file.mimetype)) {
          const befund = await pruefeTextDatei(req.file.path, req.file.size, req.app.locals.zwischenlager);
          if (befund) {
            return res.status(befund.status).json({ error: befund.error });
          }
        } else {
          const { fileTypeFromBuffer } = await import('file-type');
          const detected = await fileTypeFromBuffer(await leseKopfBytes(req.file.path));
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
        await encryptFileToFile(req.file.path, chatFilePath);

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

      // Socket-Broadcast und Push nach der Antwort (siehe nachNeuerNachricht).
      nachNeuerNachricht(req, {
        roomId,
        sender: { id: userId, type: userType, name: message.sender_name },
        messageId: message.id,
        payload: message,
        textFuer: ({ roomName, isDirectChat }) => ({
          title: isDirectChat ? message.sender_name : roomName,
          // Text der Mitteilung: nur Absender und Art, kein Inhalt
          // — Begruendung in utils/pushText.js, dort auch, warum
          // es KEINE echte Bildvorschau gibt.
          body: chatPushText({
            messageType: message.message_type,
            senderName: message.sender_name,
            isDirectChat,
          }),
        }),
      });

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
      console.error('Database error in POST /rooms/:roomId/messages:', req.params.roomId, err);
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

      // Zugriff prüfen (mit Organisations-Prüfung)
      if (!await darfRaumOeffnen(roomId, req.user)) {
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
 console.error('Database error in POST /rooms/:roomId/mark-read:', req.params.roomId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Bewusst NUR für admin/org_admin — nicht für Teamer:innen und Konfis.
  // Ein Export nimmt den gesamten Verlauf aus dem Kontext des Chats heraus;
  // wer ihn ziehen darf, sollte dieselbe Verantwortung tragen wie beim
  // Löschen eines Raums.
  // ============================================================
  router.get('/rooms/:roomId/export', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId, 10);
      if (!Number.isInteger(roomId) || roomId < 1) {
        return res.status(400).json({ error: 'Ungültige Raum-ID' });
      }

      const userType = req.user.type;
      const roleName = req.user.role_name;
      const organizationId = req.user.organization_id;

      // Rollenpruefung: nur Leitung. type ist für alles außer konfi/teamer
      // 'admin', deshalb zusaetzlich der Rollenname.
      const istLeitung = userType === 'admin'
        && ['admin', 'org_admin', 'super_admin'].includes(roleName);
      if (!istLeitung) {
        return res.status(403).json({ error: 'Nur die Leitung darf Chats exportieren' });
      }

      // Raum muss zur eigenen Organisation gehören — 404 statt 403, damit der
      // Export nicht verraet, ob eine fremde Raum-ID existiert.
      const { rows: [room] } = await db.query(
        `SELECT cr.id, cr.name, cr.type, cr.created_at, j.name AS jahrgang_name
         FROM chat_rooms cr
         LEFT JOIN jahrgaenge j ON cr.jahrgang_id = j.id
         WHERE cr.id = $1 AND cr.organization_id = $2`,
        [roomId, organizationId]
      );
      if (!room) {
        return res.status(404).json({ error: 'Chat nicht gefunden' });
      }

      if (!await darfRaumOeffnen(roomId, req.user)) {
        return res.status(403).json({
          error: room.type === 'direct'
            ? 'Private Zweiergespräche lassen sich nicht exportieren'
            : 'Zugriff verweigert'
        });
      }

      // Vollstaendiger Verlauf, aelteste zuerst. Geloeschte Nachrichten bleiben
      // als Platzhalter stehen, damit der Verlauf nachvollziehbar bleibt.
      const { rows: messages } = await db.query(
        `SELECT m.id, m.created_at, m.message_type, m.file_name,
                m.deleted_at IS NOT NULL AS geloescht,
                CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.content END AS content,
                u.display_name AS absender,
                ro.display_name AS rolle,
                ro.name AS rolle_name,
                p.question AS umfrage_frage,
                p.options  AS umfrage_optionen,
                reply_user.display_name AS antwort_auf_absender,
                CASE WHEN reply_msg.deleted_at IS NOT NULL THEN NULL ELSE reply_msg.content END AS antwort_auf_inhalt
         FROM chat_messages m
         LEFT JOIN users u ON m.user_id = u.id
         LEFT JOIN roles ro ON u.role_id = ro.id
         LEFT JOIN chat_polls p ON m.id = p.message_id
         LEFT JOIN chat_messages reply_msg ON m.reply_to = reply_msg.id
         LEFT JOIN users reply_user ON reply_msg.user_id = reply_user.id
         WHERE m.room_id = $1
         ORDER BY m.created_at ASC, m.id ASC`,
        [roomId]
      );

      const raumName = room.name || room.jahrgang_name || `Chat ${room.id}`;
      const format = (req.query.format || 'txt').toLowerCase();

      // Dateiname ohne Sonderzeichen — Umlaute werden transliteriert, damit der
      // Content-Disposition-Header auf allen Systemen sauber ankommt.
      const dateiBasis = raumName
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60) || 'chat';
      const heute = new Date().toISOString().slice(0, 10);

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${dateiBasis}_${heute}.json"`);
        return res.send(JSON.stringify({
          chat: raumName,
          typ: room.type,
          erstellt_am: room.created_at,
          exportiert_am: new Date().toISOString(),
          anzahl_nachrichten: messages.length,
          nachrichten: messages
        }, null, 2));
      }

      // Textformat: für Menschen zum Lesen und Weiterverarbeiten.
      // Ueber die Helfer aus utils/zeitformat, nicht ueber ein eigenes
      // toLocaleString ohne Zone: Der Container laeuft in UTC, der Kopf des
      // Exports nannte die Uhrzeit sonst zwei Stunden zu frueh -- waehrend
      // die Nachrichten darunter (formatDatum/formatUhrzeit) korrekt in
      // Berliner Zeit standen. Zwei Zeitrechnungen in einer Datei.
      const zeilen = [];
      zeilen.push(`Chat-Verlauf: ${raumName}`);
      const jetzt = new Date();
      zeilen.push(`Exportiert am ${formatDatum(jetzt)} ${formatUhrzeit(jetzt)} — ${messages.length} Nachrichten`);
      zeilen.push('='.repeat(60));
      zeilen.push('');

      let letzterTag = '';
      for (const m of messages) {
        const tag = formatDatum(m.created_at, {
          weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
        });
        if (tag !== letzterTag) {
          zeilen.push('');
          zeilen.push(`--- ${tag} ---`);
          letzterTag = tag;
        }

        const uhrzeit = formatUhrzeit(m.created_at);
        const absender = m.absender || 'Unbekannt';
        // Das feste Wort nach der Rolle (utils/rollenNamen): display_name
        // traegt in bestehenden Gemeinden noch "Hauptamt".
        const rollenWort = rollenAnzeigename(m.rolle_name, m.rolle);
        const rolle = rollenWort ? ` (${rollenWort})` : '';
        let text;

        if (m.geloescht) {
          text = '[gelöscht]';
        } else if (m.message_type === 'poll' && m.umfrage_frage) {
          const opts = Array.isArray(m.umfrage_optionen) ? m.umfrage_optionen : [];
          text = `[Umfrage] ${m.umfrage_frage}` + (opts.length ? `\n    Optionen: ${opts.join(' | ')}` : '');
        } else if (m.message_type !== 'text' && m.file_name) {
          text = `[${m.message_type === 'image' ? 'Bild' : m.message_type === 'video' ? 'Video' : 'Datei'}: ${m.file_name}]`
               + (m.content ? `\n    ${m.content}` : '');
        } else {
          text = m.content || '';
        }

        if (m.antwort_auf_absender) {
          const zitat = (m.antwort_auf_inhalt || '[gelöscht]').slice(0, 60);
          zeilen.push(`[${uhrzeit}] ${absender}${rolle} (antwortet ${m.antwort_auf_absender}: "${zitat}")`);
        } else {
          zeilen.push(`[${uhrzeit}] ${absender}${rolle}`);
        }
        zeilen.push(`    ${text.split('\n').join('\n    ')}`);
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${dateiBasis}_${heute}.txt"`);
      return res.send(zeilen.join('\n'));

    } catch (err) {
      console.error('Database error in GET /chat/rooms/:roomId/export:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  router.get('/rooms/:roomId/participants', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;

      // Check if user has access to this room (mit Organisations-Prüfung)
      if (!await darfRaumOeffnen(roomId, req.user)) {
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
        -- Jahrgang nur für echte Konfis; Team-Mitglieder (admin/teamer) haben keinen.
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
 console.error('Database error in GET /rooms/:roomId/participants:', req.params.roomId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });
  
  // Add participant to room
  router.post('/rooms/:roomId/participants', verifyTokenRBAC, async (req, res) => {
    try {
      const roomId = req.params.roomId;
      const { user_id } = req.body;
      const requesterType = req.user.type;
      const organizationId = req.user.organization_id;

      if (requesterType !== 'admin') {
        return res.status(403).json({ error: 'Nur die Leitung kann Teilnehmer hinzufügen' });
      }
      if (!user_id) {
        return res.status(400).json({ error: 'user_id ist erforderlich' });
      }

      const { rows: [room] } = await db.query("SELECT type FROM chat_rooms WHERE id = $1 AND organization_id = $2", [roomId, organizationId]);
      if (!room) {
        return res.status(404).json({ error: 'Raum nicht gefunden' });
      }
      if (room.type !== 'group') {
        return res.status(400).json({ error: 'Teilnehmer können nur zu Gruppenchats hinzugefügt werden' });
      }

      // Verwalten nur, wer den Raum auch oeffnen darf. Sonst
      // traegt sich ein Admin in eine Gruppe mit Konfis fremder Jahrgaenge
      // einfach selbst ein und liest danach als Teilnehmer mit — die Regel
      // aus darfRaumOeffnen waere mit einem Aufruf umgangen.
      if (!await darfRaumOeffnen(roomId, req.user)) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }

      // user_type IMMER serverseitig aus der echten Rolle ableiten — NIE vom
      // Client uebernehmen (siehe /direct: Teamer:innen kamen als 'admin' rein
      // und fanden den Raum nicht). Die Rolle ist die DIESER Gemeinde, die
      // Mitgliedschaft kommt aus BEIDEN Quellen.
      const { rows: [targetUser] } = await db.query(
        `SELECT u.id, r.name AS role_name
           FROM users u
           ${TEAM_MITGLIED_ROLLE}
          WHERE u.id = $1 AND u.deleted_at IS NULL`,
        [user_id, organizationId]
      );
      if (!targetUser) {
        return res.status(404).json({ error: 'Benutzer nicht in deiner Gemeinde gefunden' });
      }
      const user_type = roleToParticipantType(targetUser.role_name);

      // Jahrgangsgrenze auch beim NACHTRAEGLICHEN Hinzufuegen:
      // Sonst liesse sich die Bindung aus POST /rooms trivial umgehen —
      // Gruppe leer anlegen, fremden Konfi danach eintragen.
      // konfiAnschreibenVerboten laesst Leitung und Super-Admins durch;
      // Teamer:innen erreichen diese Route gar nicht (requesterType-Check).
      if (targetUser.role_name === 'konfi') {
        const verboten = await konfiAnschreibenVerboten(req.user, targetUser.id);
        if (verboten) {
          return res.status(403).json({ error: verboten });
        }
      }

      const { rows: [existing] } = await db.query("SELECT 1 FROM chat_participants WHERE room_id = $1 AND user_id = $2", [roomId, user_id]);
      if (existing) {
        return res.status(409).json({ error: 'Benutzer ist bereits Teilnehmer' });
      }

      await db.query("INSERT INTO chat_participants (room_id, user_id, user_type) VALUES ($1, $2, $3)", [roomId, user_id, user_type]);
      res.status(201).json({ message: 'Teilnehmer erfolgreich hinzugefügt' });

      // Alle Teilnehmer (inkl. dem neu hinzugefuegten) sollen die aktualisierte
      // Raumliste sehen.
      try {
        const { rows: currentParticipants } = await db.query(
          'SELECT user_id, user_type FROM chat_participants WHERE room_id = $1',
          [roomId]
        );
        emitRoomsChanged(currentParticipants);
      } catch (notifyErr) {
        console.error('Failed to emit roomsChanged (add participant):', notifyErr);
      }

    } catch (err) {
      // Handle unique constraint violation in case of a race condition
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Benutzer ist bereits Teilnehmer' });
      }
 console.error('Database error in POST /rooms/:roomId/participants:', req.params.roomId, err);
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
        return res.status(403).json({ error: 'Nur die Leitung kann Teilnehmer entfernen' });
      }

      const { rows: [room] } = await db.query("SELECT type FROM chat_rooms WHERE id = $1 AND organization_id = $2", [roomId, organizationId]);
      if (!room) {
        return res.status(404).json({ error: 'Raum nicht gefunden' });
      }
      if (room.type !== 'group') {
        return res.status(400).json({ error: 'Teilnehmer können nur aus Gruppenchats entfernt werden' });
      }

      // Wie beim Hinzufuegen: verwalten nur, wer den Raum oeffnen darf.
      if (!await darfRaumOeffnen(roomId, req.user)) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }

      const { rowCount } = await db.query("DELETE FROM chat_participants WHERE room_id = $1 AND user_id = $2 AND user_type = $3", [roomId, userId, userType]);
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Teilnehmer nicht gefunden' });
      }

      res.json({ message: 'Teilnehmer erfolgreich entfernt' });

      // Der entfernte Nutzer soll den Raum aus seiner Liste verlieren, die
      // verbleibenden Teilnehmer den aktualisierten Stand sehen.
      try {
        const { rows: remaining } = await db.query(
          'SELECT user_id, user_type FROM chat_participants WHERE room_id = $1',
          [roomId]
        );
        emitRoomsChanged([...remaining, { user_id: userId, user_type: userType }]);
      } catch (notifyErr) {
        console.error('Failed to emit roomsChanged (remove participant):', notifyErr);
      }
    } catch (err) {
 console.error('Database error in DELETE /rooms/:roomId/participants/...:', req.params.roomId, err);
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
        return res.status(403).json({ error: 'Die Leitung kann Chats nicht verlassen' });
      }

      // Jahrgang und Direct sind generell nicht verlassbar
      if (room.type === 'jahrgang' || room.type === 'direct') {
        return res.status(400).json({ error: 'Dieser Chat kann nicht verlassen werden' });
      }

      // Event-Chats sind an die Event-Teilnahme gekoppelt: Konfis verlassen sie
      // NICHT manuell, sondern ausschliesslich durch Abmelden vom Event. Sonst
      // wäre man am Event angemeldet, aber nicht im Chat.
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

      // Der verlassende Nutzer verliert den Raum, die verbleibenden Teilnehmer
      // sehen den aktualisierten Stand.
      try {
        const { rows: remaining } = await db.query(
          'SELECT user_id, user_type FROM chat_participants WHERE room_id = $1',
          [roomId]
        );
        emitRoomsChanged([...remaining, { user_id: userId, user_type: userType }]);
      } catch (notifyErr) {
        console.error('Failed to emit roomsChanged (leave):', notifyErr);
      }
    } catch (err) {
      console.error('Database error in DELETE /rooms/:roomId/leave:', req.params.roomId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Protected file serving route
  router.get('/files/:filename', async (req, res) => {
    // Token NUR aus dem Authorization-Header.
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Kein Token vorhanden' });
    }

    // Token von Hand prüfen statt per verifyTokenRBAC — historisch, weil die
    // Middleware den (inzwischen entfallenen) Query-Parameter nicht kannte.
    //
    // Frueher stand hier schlicht `req.user = decoded`. Zwei Folgen
    // 
    //  1. Die Angaben im Token galten ungeprueft für die volle Laufzeit —
    //     15 Minuten ohne Abgleich mit der Datenbank, auch für geloeschte
    //     oder gesperrte Konten.
    //  2. organization_id kam aus dem Token und war damit immer die
    //     PRIMAER-Organisation. Wer per Umschalter in einer Zweit-Gemeinde
    //     arbeitete, bekam seine eigenen Chat-Dateien nicht zu sehen (404).
    //     Dieselbe Klasse Fehler wurde in challenges.js am 06.08. behoben.
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ error: 'Ungültiger Token' });
    }

    try {
      const { rows: [nutzer] } = await db.query(
        `SELECT u.id, u.organization_id, u.token_invalidated_at, r.name AS role_name
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1 AND u.deleted_at IS NULL AND u.is_active = true`,
        [decoded.id]
      );
      if (!nutzer) {
        return res.status(401).json({ error: 'Nicht angemeldet' });
      }

      // Soft-Revoke wie in rbac.js: nach einem Passwortwechsel ausgestellte
      // Sperren müssen auch hier greifen.
      if (nutzer.token_invalidated_at) {
        const ausgestellt = decoded.iat;
        const gesperrtAb = Math.floor(new Date(nutzer.token_invalidated_at).getTime() / 1000);
        if (ausgestellt < gesperrtAb) {
          return res.status(401).json({ error: 'Token invalidated' });
        }
      }

      req.user = {
        id: nutzer.id,
        organization_id: nutzer.organization_id,
        role_name: nutzer.role_name,
        type: nutzer.role_name === 'konfi' ? 'konfi'
          : nutzer.role_name === 'teamer' ? 'teamer' : 'admin'
      };

      // Aktive Organisation aufloesen (Umschalter), identisch zu rbac.js.
      const headerOrg = parseInt(req.headers['x-active-organization']);
      const tokenOrg = decoded.active_organization_id ? parseInt(decoded.active_organization_id) : null;
      const gewuenschteOrg = Number.isInteger(headerOrg) ? headerOrg
        : (Number.isInteger(tokenOrg) ? tokenOrg : null);

      if (gewuenschteOrg && gewuenschteOrg !== req.user.organization_id) {
        const { rows: [mitgliedschaft] } = await db.query(
          `SELECT uo.organization_id, r.name AS role_name
           FROM user_organizations uo
           JOIN roles r ON uo.role_id = r.id
           WHERE uo.user_id = $1 AND uo.organization_id = $2`,
          [decoded.id, gewuenschteOrg]
        );
        if (!mitgliedschaft) {
          return res.status(403).json(ORG_KEIN_ZUGRIFF);
        }
        req.user.organization_id = mitgliedschaft.organization_id;
        req.user.role_name = mitgliedschaft.role_name;
        req.user.type = mitgliedschaft.role_name === 'konfi' ? 'konfi'
          : mitgliedschaft.role_name === 'teamer' ? 'teamer' : 'admin';
      }
    } catch (err) {
      console.error('Auth-Fehler in GET /chat/files/:filename:', err);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }
    try {
      // Path-Traversal-Schutz: nur den Dateinamen ohne Verzeichniskomponenten verwenden
      const filename = path.basename(req.params.filename);

      // Nur Hex-Hashes (multer SHA-256) als Dateinamen akzeptieren
      if (!/^[a-f0-9]+$/.test(filename)) {
        return res.status(400).json({ error: 'Ungültiger Dateiname' });
      }

      // Check if user has access to this file by checking chat membership.
      // Soft-geloeschte Nachrichten (deleted_at gesetzt) liefern ihren Anhang
      // NICHT mehr aus: Die Nachricht gilt als gelöscht, also darf auch die
      // Datei nicht mehr abrufbar sein. Die Datei selbst
      // bleibt bewusst liegen — die Leitung kann die Nachricht
      // wiederherstellen (Soft-Delete ist eine Designentscheidung).
      const { rows: [fileMessage] } = await db.query(
        `SELECT cm.room_id, cm.file_name
         FROM chat_messages cm
         JOIN chat_rooms cr ON cm.room_id = cr.id
         WHERE cm.file_path = $1 AND cr.organization_id = $2
           AND cm.deleted_at IS NULL`,
        [filename, req.user.organization_id]
      );

      if (!fileMessage) {
        return res.status(404).json({ error: 'Datei nicht gefunden' });
      }

      // Dieselbe Raum-Regel wie beim Lesen der Nachricht, die die Datei
      // traegt. Vorher stand hier eine eigene Kopie, die jede
      // Teilnahme ohne Blick auf user_type genuegen liess und die Leitung
      // ohne Teilnahme aussperrte: Sie las die Nachricht, das Bild darin
      // blieb leer.
      if (!await darfRaumOeffnen(fileMessage.room_id, req.user)) {
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
          // Textdateien immer als text/plain bzw. text/csv mit charset
          // -- vorher ohne Content-Type.
          const textTyp = textInhaltsTyp({ dateiname: fileMessage.file_name });
          if (textTyp) {
            res.setHeader('Content-Type', textTyp);
          } else if (contentTypes[ext]) {
            res.setHeader('Content-Type', contentTypes[ext]);
          }
        }

        // Stromweise entschluesseln und senden (frueher: ganze Datei in den
        // Arbeitsspeicher). Alte Klartext-Dateien werden unveraendert
        // durchgereicht (Abwaertskompatibilitaet bis zur Migration).
        try {
          await decryptFileToStream(filePath, res);
        } catch (decErr) {
          console.error('Error decrypting chat file:', decErr);
          if (!res.headersSent) {
            return res.status(500).json({ error: 'Datei konnte nicht entschlüsselt werden' });
          }
          res.destroy();
        }
      } else {
        res.status(404).json({ error: 'Datei nicht auf dem Server gefunden' });
      }
    } catch (error) {
 console.error('Error serving chat file:', error);
      res.status(500).json({ error: 'Serverfehler' });
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
      return res.status(403).json({ error: 'Nur die Leitung kann Umfragen erstellen' });
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
      // Zugriff wie beim Lesen (darfRaumOeffnen, utils/chatRoomAccess.js).
      // Vorher genuegte die Organisation, damit liess sich eine Umfrage in ein
      // fremdes Zweiergespraech stellen.
      const { rows: [room] } = await db.query("SELECT 1 FROM chat_rooms WHERE id = $1 AND organization_id = $2", [roomId, req.user.organization_id]);

      if (!room || !await darfRaumOeffnen(roomId, req.user)) {
        return res.status(404).json({ error: 'Raum nicht gefunden' });
      }
      
      // Calculate expires_at
      let expiresAt = null;
      if (expires_in_hours && expires_in_hours > 0) {
        expiresAt = new Date(Date.now() + expires_in_hours * 60 * 60 * 1000);
      }
      
      const client = await db.getClient();
      // Im try steht NUR die Transaktion; Antwort, Socket und Push laufen
      // hinter dem finally. Sonst faellt ein Fehler aus der Nacharbeit in den
      // Transaktions-catch und rollt eine Verbindung zurueck, die laengst ein
      // anderer Request aus dem Pool hat.
      let messageId;
      let newPoll;
      try {
        await client.query('BEGIN');

        // First create the message
        const messageQuery = `
          INSERT INTO chat_messages (room_id, user_id, user_type, message_type, content, created_at)
          VALUES ($1, $2, $3, 'poll', $4, NOW())
          RETURNING id
        `;
        const { rows: [newMessage] } = await client.query(messageQuery, [roomId, userId, userType, question]);
        messageId = newMessage.id;

        // Then create the poll
        const pollQuery = `
          INSERT INTO chat_polls (message_id, question, options, multiple_choice, expires_at, anonymous, exclusive_options, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          RETURNING id
        `;
        const { rows: [poll] } = await client.query(pollQuery, [
          messageId,
          question,
          JSON.stringify(validOptions),
          isMultipleChoice,
          expiresAt,
          Boolean(anonymous),
          Boolean(exclusive_options)
        ]);
        newPoll = poll;

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Database error in POST /rooms/:roomId/polls:', err);
        return res.status(500).json({ error: 'Datenbankfehler' });
      } finally {
        // KEIN client.release() im try — nur hier.
        client.release();
      }

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

      // WebSocket + Push: Umfrage wie eine normale Nachricht live verteilen.
      // Ohne dies sehen Teilnehmer die Umfrage erst nach Reload/Fallback-Poll
      // Wir bauen ein message-Objekt in derselben
      // Struktur, die GET /messages für Poll-Nachrichten liefert (message_type
      // 'poll', options als Array, Poll-Metadaten, leere votes), damit der
      // ChatRoom-newMessage-Handler die Umfrage sofort rendern kann.
      nachAntwort(req, async () => {
        const { rows: [sender] } = await db.query(
          'SELECT display_name, username FROM users WHERE id = $1',
          [userId]
        );
        const senderName = sender?.display_name || 'Unbekannt';
        const pollMessage = {
          id: messageId,
          room_id: parseInt(roomId),
          user_id: userId,
          user_type: userType,
          sender_id: userId,
          sender_type: userType,
          sender_name: senderName,
          sender_username: sender?.username || null,
          message_type: 'poll',
          content: question,
          created_at: new Date().toISOString(),
          // Poll-Daten wie in GET /messages
          poll_id: newPoll.id,
          question: question,
          options: validOptions,
          multiple_choice: isMultipleChoice,
          anonymous: Boolean(anonymous),
          exclusive_options: Boolean(exclusive_options),
          expires_at: expiresAt,
          votes: [],
          reactions: []
        };

        // Broadcast und Push exakt nach dem Muster des Nachrichten-Handlers.
        await nachNeuerNachricht(req, {
          roomId,
          sender: { id: userId, type: userType, name: senderName },
          messageId,
          payload: pollMessage,
          // Ohne die Frage selbst, wie bei jeder Chat-Nachricht (utils/pushText.js).
          textFuer: ({ roomName, isDirectChat }) => ({
            title: isDirectChat ? senderName : roomName,
            body: chatPushText({ messageType: 'poll', senderName, isDirectChat }),
          }),
        });
      }, 'Umfrage-Nacharbeit');

    } catch (err) {
      console.error('Database error in POST /rooms/:roomId/polls:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Vote for a poll (by poll ID)
  const votePoll = async (req, res) => {
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

      // Zugriff auf den Raum pruefen, BEVOR ueber Ablauf und Optionen geurteilt
      // wird. Vorher stand die Pruefung erst danach: Wer
      // nicht dazugehoerte, erfuhr an der Antwort trotzdem, ob es die Umfrage
      // gibt und ob sie abgelaufen ist ("Umfrage ist abgelaufen" statt 403).
      if (!await darfRaumOeffnen(poll.room_id, req.user)) {
        return res.status(403).json({ error: 'Zugriff auf diesen Raum verweigert' });
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
      
      const client = await db.getClient();
      // Use the actual poll.id from database, not the request pollId (which might be message_id)
      const actualPollId = poll.id;
      // Im try steht NUR die Transaktion. Das Live-Update und die Antwort
      // folgen hinter dem finally — sonst kann ein Fehler daraus ein ROLLBACK
      // auf einer laengst weitergereichten Verbindung ausloesen.
      let aktion = null; // 'removed' | 'added' | 'taken'
      try {
        await client.query('BEGIN');

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
          // Gilt auch für exklusive Umfragen: die eigene Wahl wieder freigeben.
          await client.query(
            "DELETE FROM chat_poll_votes WHERE poll_id = $1 AND user_id = $2 AND user_type = $3 AND option_index = $4",
            [actualPollId, userId, userType, option_index]
          );
          await client.query('COMMIT');
          aktion = 'removed';
        } else {
          // Exklusive Umfrage: ist diese Option schon von JEMAND ANDEREM belegt?
          // Dann ist sie vergeben -> 409, kein Doppel-Eintrag.
          let vergeben = false;
          if (isExclusive) {
            const { rows: [taken] } = await client.query(
              "SELECT 1 FROM chat_poll_votes WHERE poll_id = $1 AND option_index = $2 LIMIT 1",
              [actualPollId, option_index]
            );
            vergeben = Boolean(taken);
          }

          if (vergeben) {
            await client.query('ROLLBACK');
            aktion = 'taken';
          } else {
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
            aktion = 'added';
          }
        }
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        // KEIN client.release() im try — nur hier.
        client.release();
      }

      if (aktion === 'taken') {
        return res.status(409).json({ error: 'Diese Option ist bereits vergeben', action: 'taken' });
      }

      // Live-Update: aktualisierten Poll-Stand an den Raum senden.
      await emitPollUpdate(actualPollId, poll.room_id);

      return res.json({
        message: aktion === 'removed' ? 'Stimme erfolgreich entfernt' : 'Stimme erfolgreich abgegeben',
        poll_id: actualPollId,
        option_index: option_index,
        user_id: userId,
        action: aktion
      });

    } catch (err) {
      console.error('Database error in POST /polls/:pollId/vote:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  };
  router.post('/polls/:pollId/vote', verifyTokenRBAC, votePoll);

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
      
      const eigene = message.user_id == userId && message.user_type === userType;
      const istLeitung = userType === 'admin';
      const canDelete = eigene || (istLeitung && await darfRaumOeffnen(message.room_id, req.user));

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

  // Abstimmen über die Nachrichten-ID (aeltere Adressform).
  //
  // Diese Route hatte eine eigene, unvollstaendige Kopie der Abstimmlogik:
  // exclusive_options wurde komplett ignoriert, es gab weder den FOR-UPDATE-Lock
  // noch die Belegt-Prüfung. Bei einer exklusiven Umfrage ("wer macht welche
  // Tour?") konnten hierueber mehrere Personen dieselbe Option belegen, während
  // /polls/:pollId/vote das korrekt mit 409 ablehnt.
  //
  // Statt die Logik zu duplizieren, wird an den einen Handler weitergereicht:
  // /polls/:pollId/vote sucht die Umfrage ohnehin per poll_id UND per message_id.
  const voteHandler = (req, res) => {
    req.params.pollId = req.params.messageId;
    return votePoll(req, res);
  };
  router.post('/messages/:messageId/vote', verifyTokenRBAC, voteHandler);
  
  // DELETE a chat room (Admin only)
  router.delete('/rooms/:roomId', verifyTokenRBAC, async (req, res) => {
    const roomId = req.params.roomId;
    const userId = req.user.id;
    const userType = req.user.type;
    const forceDelete = req.query.force === 'true';
    
    if (userType !== 'admin') {
      return res.status(403).json({ error: 'Nur die Leitung kann Chat-Räume löschen' });
    }
    
    try {
      // Get room details
      const { rows: [room] } = await db.query("SELECT * FROM chat_rooms WHERE id = $1 AND organization_id = $2", [roomId, req.user.organization_id]);
      if (!room) {
        return res.status(404).json({ error: 'Chat-Raum nicht gefunden' });
      }

      // Loeschen nur, wer den Raum auch oeffnen darf — und das
      // VOR der Nachrichtenzahl, sonst verraet die 409-Antwort, wie viel in
      // einem fremden Raum geschrieben wurde. Fremde Zweiergespraeche,
      // Jahrgangs-Raeume anderer Jahrgaenge und Gruppen mit Konfis fremder
      // Jahrgaenge loescht ein Admin damit nicht mehr per Raum-Kennung.
      if (!await darfRaumOeffnen(roomId, req.user)) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
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
      
      // Direktchats: loeschen nur Teilnehmende (s. darfRaumOeffnen oben).

      // Teilnehmer VOR dem Löschen einsammeln, damit wir sie danach über die
      // entfernte Raumliste informieren können (nach dem Delete sind die
      // Teilnehmerzeilen weg).
      const { rows: participantsBeforeDelete } = await db.query(
        'SELECT user_id, user_type FROM chat_participants WHERE room_id = $1',
        [roomId]
      );

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
        // Der Pfad kommt aus dem injizierten uploadsDir, nicht aus __dirname:
        // sonst raeumt diese Stelle am Standardpfad auf, waehrend die Dateien
        // woanders liegen, sobald das Upload-Verzeichnis abweicht.
        const fs = require('fs').promises;
        const path = require('path');

        for (const fileRecord of filesForDeletion) {
          try {
            const fullPath = path.join(uploadsDir, 'chat', fileRecord.file_path);
            await fs.unlink(fullPath);
          } catch (fileErr) {
 console.warn(`Could not delete file ${fileRecord.file_path}:`, fileErr.message);
            // Don't fail the whole operation if file deletion fails
          }
        }
      }

      await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        // KEIN client.release() im try — nur hier. Sonst faellt der Fehler aus
        // emitRoomsChanged (synchron, ohne eigenen Schutz) in den
        // Transaktions-catch und rollt die Transaktion eines FREMDEN Requests
        // zurueck, der die Verbindung inzwischen aus dem Pool bekommen hat.
        client.release();
      }

      res.json({ message: 'Chat-Raum erfolgreich gelöscht' });

      // Alle ehemaligen Teilnehmer sollen den geloeschten Raum aus ihrer Liste
      // verlieren.
      emitRoomsChanged(participantsBeforeDelete);

    } catch (err) {
      console.error('Database error in DELETE /rooms/:roomId:', roomId, err);
      if (!res.headersSent) res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  router.delete('/rooms/:roomId/messages', verifyTokenRBAC, async (req, res) => {
    const roomId = parseInt(req.params.roomId, 10);

    if (req.user.type !== 'admin' || !['org_admin', 'admin'].includes(req.user.role_name)) {
      return res.status(403).json({ error: 'Nur die Leitung kann den Team-Chat leeren' });
    }

    try {
      const { rows: [room] } = await db.query(
        'SELECT id, is_team_chat FROM chat_rooms WHERE id = $1 AND organization_id = $2',
        [roomId, req.user.organization_id]
      );
      if (!room) {
        return res.status(404).json({ error: 'Chat-Raum nicht gefunden' });
      }
      if (!room.is_team_chat) {
        return res.status(409).json({ error: 'Nur der Team-Chat lässt sich leeren.' });
      }
      // Dieselbe Raum-Regel wie ueberall: Der Team-Chat ist ein reiner
      // Team-Raum und damit fuer jede Leitung offen — die Pruefung steht
      // trotzdem hier, damit kein Weg in einen Raum an ihr vorbeifuehrt.
      if (!await darfRaumOeffnen(roomId, req.user)) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }

      // Dateien VOR dem Löschen einsammeln (danach sind die Zeilen weg).
      const { rows: filesForDeletion } = await db.query(
        'SELECT file_path FROM chat_messages WHERE room_id = $1 AND file_path IS NOT NULL',
        [roomId]
      );

      const { rowCount: deletedCount } = await db.query(
        'DELETE FROM chat_messages WHERE room_id = $1',
        [roomId]
      );

      // Anhaenge best effort entfernen — eine fehlende Datei kippt nichts.
      for (const fileRecord of filesForDeletion) {
        try {
          await fs.promises.unlink(path.join(uploadsDir, 'chat', fileRecord.file_path));
        } catch (fileErr) {
          if (fileErr.code !== 'ENOENT') {
            console.warn(`Team-Chat leeren: Datei ${fileRecord.file_path} nicht entfernbar:`, fileErr.message);
          }
        }
      }

      res.json({ message: 'Team-Chat geleert', deleted_count: deletedCount });

      // Offene Chat-Ansichten leeren und die Raumlisten (letzte Nachricht,
      // Ungelesen-Zaehler) aktualisieren.
      if (io) {
        io.to(`room_${roomId}`).emit('chatCleared', { roomId });
      }
      const { rows: participants } = await db.query(
        'SELECT user_id, user_type FROM chat_participants WHERE room_id = $1',
        [roomId]
      );
      emitRoomsChanged(participants);
    } catch (err) {
      console.error('Database error in DELETE /rooms/:roomId/messages:', roomId, err);
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
      // Zugriff prüfen: Nachricht muss in der eigenen Organisation liegen
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

      // Dieselbe Regel wie beim Lesen der Nachrichten selbst (darfRaumOeffnen).
      if (!await darfRaumOeffnen(message.room_id, req.user)) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
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

      const adminQuery = `
        SELECT DISTINCT u.id, u.display_name as name,
          CASE WHEN r.name = 'teamer' THEN 'teamer' ELSE 'admin' END as type,
          r.name as role_name,
          COALESCE(NULLIF(u.role_title, ''),
            -- Woerter wie utils/rollenNamen.js.
            CASE
              WHEN r.name = 'teamer' THEN 'Teamer:in'
              WHEN r.name = 'org_admin' THEN 'Gemeindeleitung'
              ELSE 'Leitung'
            END
          ) as role_description,
          null as jahrgang_name
        FROM users u
        ${TEAM_MITGLIED_ROLLE}
        WHERE r.name IN ('admin', 'org_admin', 'teamer')
        AND u.id <> $1
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND ${KONFI_SIEHT_TEAMMITGLIED}
        ORDER BY u.display_name
      `;
      const { rows: admins } = await db.query(adminQuery, [userId, organizationId]);
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
        // Konfis schreiben ausschliesslich das Team an, und davon nur die
        // Leitung/Admins sowie Teamer:innen des eigenen Jahrgangs. Der Wert ist
        // fest — die Einstellung konfi_chat_permissions wird nirgends gelesen.
        permissions: 'direct_only_admin'
      });

    } catch (err) {
 console.error('Database error in GET /chat/available-users:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};