const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations } = require('../middleware/validation');
const liveUpdate = require('../utils/liveUpdate');
const emailService = require('../services/emailService');
const { syncJahrgangChat } = require('../utils/jahrgangChat');

// Jahrgänge: Teamer darf ansehen, Admin darf bearbeiten
module.exports = (db, rbacVerifier, { requireAdmin, requireTeamer }) => {

  // Schema-Migrationen: siehe backend/migrations/064_consolidate_inline_schemas.sql

  // Validierungsregeln
  const validateCreateJahrgang = [
    commonValidations.name,
    body('gottesdienst_enabled').optional().isBoolean().withMessage('gottesdienst_enabled muss Boolean sein'),
    body('gemeinde_enabled').optional().isBoolean().withMessage('gemeinde_enabled muss Boolean sein'),
    body('konfspruch_enabled').optional().isBoolean().withMessage('konfspruch_enabled muss Boolean sein'),
    body('target_gottesdienst').optional().isInt({ min: 0 }).withMessage('target_gottesdienst muss >= 0 sein'),
    body('target_gemeinde').optional().isInt({ min: 0 }).withMessage('target_gemeinde muss >= 0 sein'),
    handleValidationErrors
  ];

  const validateUpdateJahrgang = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    commonValidations.name,
    body('gottesdienst_enabled').optional().isBoolean().withMessage('gottesdienst_enabled muss Boolean sein'),
    body('gemeinde_enabled').optional().isBoolean().withMessage('gemeinde_enabled muss Boolean sein'),
    body('konfspruch_enabled').optional().isBoolean().withMessage('konfspruch_enabled muss Boolean sein'),
    body('target_gottesdienst').optional().isInt({ min: 0 }).withMessage('target_gottesdienst muss >= 0 sein'),
    body('target_gemeinde').optional().isInt({ min: 0 }).withMessage('target_gemeinde muss >= 0 sein'),
    handleValidationErrors
  ];

  const validateJahrgangId = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors
  ];

  // GET all jahrgaenge for the admin's organization
  router.get('/', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const query = `SELECT j.*,
        (SELECT COUNT(*) FROM konfi_profiles kp JOIN users u ON kp.user_id = u.id WHERE kp.jahrgang_id = j.id AND u.organization_id = j.organization_id)::int as konfi_count,
        (SELECT COALESCE(SUM(kp.gottesdienst_points), 0) FROM konfi_profiles kp WHERE kp.jahrgang_id = j.id AND kp.gottesdienst_points > 0)::int as gottesdienst_points_total,
        (SELECT COALESCE(SUM(kp.gemeinde_points), 0) FROM konfi_profiles kp WHERE kp.jahrgang_id = j.id AND kp.gemeinde_points > 0)::int as gemeinde_points_total
      FROM jahrgaenge j WHERE j.organization_id = $1 ORDER BY j.name DESC`;
      const { rows: jahrgaenge } = await db.query(query, [req.user.organization_id]);
      res.json(jahrgaenge);
    } catch (err) {
 console.error('Database error in GET /api/jahrgaenge:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // POST a new jahrgang
  router.post('/', rbacVerifier, requireAdmin, validateCreateJahrgang, async (req, res) => {
    const { name, gottesdienst_enabled, gemeinde_enabled, konfspruch_enabled, target_gottesdienst, target_gemeinde } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    try {
      // Das Konfirmationsdatum ist ab Phase 119 kein Pflichtfeld mehr und
      // wird bei der Anlage nicht mehr beschrieben (Spalte seit Migration 094
      // nullable). konfspruch_enabled defaultet auf true.
      const query = `INSERT INTO jahrgaenge (name, organization_id, gottesdienst_enabled, gemeinde_enabled, konfspruch_enabled, target_gottesdienst, target_gemeinde)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`;
      const params = [
        name,
        req.user.organization_id,
        gottesdienst_enabled !== undefined ? gottesdienst_enabled : true,
        gemeinde_enabled !== undefined ? gemeinde_enabled : true,
        konfspruch_enabled !== undefined ? konfspruch_enabled : true,
        target_gottesdienst !== undefined ? target_gottesdienst : 10,
        target_gemeinde !== undefined ? target_gemeinde : 10
      ];
      const { rows: [newJahrgang] } = await db.query(query, params);

      // Jahrgangs-Chat sofort anlegen + Mitglieder synchronisieren (Org-Admins,
      // zugewiesene Admins/Teamer, Konfis). Frueher entstand der Chat erst lazy
      // beim ersten Chat-Tab-Aufruf eines Konfis — neue Orgs/Jahrgaenge hatten
      // dadurch gar keinen Chat. Fehler hier darf die Anlage nicht scheitern lassen.
      try {
        await syncJahrgangChat(db, newJahrgang.id, req.user.organization_id, req.user.id);
      } catch (chatErr) {
        console.error('Jahrgangs-Chat konnte nicht angelegt werden:', chatErr.message);
      }

      res.status(201).json(newJahrgang);

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'jahrgaenge', 'create');
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Jahrgang-Name existiert bereits in dieser Organisation' });
      }
 console.error('Database error in POST /api/jahrgaenge:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // PUT (update) a jahrgang
  router.put('/:id', rbacVerifier, requireAdmin, validateUpdateJahrgang, async (req, res) => {
    const { name, gottesdienst_enabled, gemeinde_enabled, konfspruch_enabled, target_gottesdienst, target_gemeinde } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    try {
      // Bestehende Werte laden für Warnungen bei Deaktivierung
      const { rows: [currentJahrgang] } = await db.query(
        'SELECT gottesdienst_enabled, gemeinde_enabled FROM jahrgaenge WHERE id = $1 AND organization_id = $2',
        [req.params.id, req.user.organization_id]
      );

      if (!currentJahrgang) {
        return res.status(404).json({ error: 'Jahrgang nicht gefunden' });
      }

      // Warnungen sammeln bei Deaktivierung mit bestehenden Punkten
      const warnings = [];

      if (currentJahrgang.gottesdienst_enabled && gottesdienst_enabled === false) {
        const { rows: [{ count }] } = await db.query(
          'SELECT COUNT(*)::int as count FROM konfi_profiles WHERE jahrgang_id = $1 AND gottesdienst_points > 0',
          [req.params.id]
        );
        if (count > 0) {
          warnings.push({ type: 'gottesdienst', affected_count: count, message: `${count} Konfi(s) haben bereits Gottesdienst-Punkte` });
        }
      }

      if (currentJahrgang.gemeinde_enabled && gemeinde_enabled === false) {
        const { rows: [{ count }] } = await db.query(
          'SELECT COUNT(*)::int as count FROM konfi_profiles WHERE jahrgang_id = $1 AND gemeinde_points > 0',
          [req.params.id]
        );
        if (count > 0) {
          warnings.push({ type: 'gemeinde', affected_count: count, message: `${count} Konfi(s) haben bereits Gemeinde-Punkte` });
        }
      }

      // Das Konfirmationsdatum wird ab Phase 119 nicht mehr beschrieben/erzwungen.
      // konfspruch_enabled via COALESCE: ein nicht uebergebenes Feld laesst den
      // bestehenden Wert unveraendert.
      const query = `UPDATE jahrgaenge SET name = $1,
        gottesdienst_enabled = COALESCE($4, gottesdienst_enabled),
        gemeinde_enabled = COALESCE($5, gemeinde_enabled),
        konfspruch_enabled = COALESCE($6, konfspruch_enabled),
        target_gottesdienst = COALESCE($7, target_gottesdienst),
        target_gemeinde = COALESCE($8, target_gemeinde)
        WHERE id = $2 AND organization_id = $3`;
      const params = [
        name, req.params.id, req.user.organization_id,
        gottesdienst_enabled !== undefined ? gottesdienst_enabled : null,
        gemeinde_enabled !== undefined ? gemeinde_enabled : null,
        konfspruch_enabled !== undefined ? konfspruch_enabled : null,
        target_gottesdienst !== undefined ? target_gottesdienst : null,
        target_gemeinde !== undefined ? target_gemeinde : null
      ];
      const { rowCount } = await db.query(query, params);

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Jahrgang nicht gefunden' });
      }

      const response = { message: 'Jahrgang erfolgreich aktualisiert' };
      if (warnings.length > 0) response.warnings = warnings;
      res.json(response);

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'jahrgaenge', 'update');
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Jahrgang-Name existiert bereits' });
      }
 console.error(`Database error in PUT /api/jahrgaenge/${req.params.id}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // DELETE a jahrgang
  router.delete('/:id', rbacVerifier, requireAdmin, validateJahrgangId, async (req, res) => {
    const jahrgangId = req.params.id;
    const forceDelete = req.query.force === 'true';

    try {
      // Blockieren NUR AKTIVE Konfis (Rolle = konfi). Beförderte Ex-Konfis
      // (jetzt teamer/admin) behalten beim Befördern bewusst ihr konfi_profiles
      // (Punkte-Historie), sind aber keine aktiven Konfis mehr und duerfen die
      // Loeschung NICHT blockieren. Ihre (verwaisten) Profile werden unten vor
      // dem Jahrgang-Delete entfernt (User + Badges + Historie bleiben).
      const checkKonfisQuery = `
        SELECT COUNT(*)::int as count
        FROM konfi_profiles kp
        JOIN users u ON kp.user_id = u.id
        JOIN roles r ON u.role_id = r.id
        WHERE kp.jahrgang_id = $1 AND r.name = 'konfi'
      `;
      const { rows: [konfiUsage] } = await db.query(checkKonfisQuery, [jahrgangId]);

      if (konfiUsage.count > 0) {
        return res.status(409).json({ error: `Jahrgang kann nicht gelöscht werden: ${konfiUsage.count} Konfi(s) zugeordnet.` });
      }

      // Check if there are chat rooms with messages
      const checkChatQuery = `
        SELECT cr.id,
               (SELECT COUNT(*) FROM chat_messages WHERE room_id = cr.id)::int as message_count
        FROM chat_rooms cr
        WHERE cr.type = 'jahrgang' AND cr.jahrgang_id = $1
      `;
      const { rows: chatRooms } = await db.query(checkChatQuery, [jahrgangId]);

      if (chatRooms.length > 0) {
        const roomsWithMessages = chatRooms.filter(room => room.message_count > 0);
        if (roomsWithMessages.length > 0 && !forceDelete) {
          return res.status(409).json({
            error: `Jahrgang kann nicht gelöscht werden: Chat-Raum enthält ${roomsWithMessages[0].message_count} Nachricht(en).`,
            canForceDelete: true
          });
        }

        // Delete chat rooms (with or without messages if force)
        if (forceDelete || roomsWithMessages.length === 0) {
          const allFiles = [];
          for (const room of chatRooms) {
            const { rows: roomFiles } = await db.query("SELECT file_path FROM chat_messages WHERE room_id = $1 AND file_path IS NOT NULL", [room.id]);
            allFiles.push(...roomFiles);
          }

          for (const room of chatRooms) {
            await db.query(`
              DELETE FROM chat_poll_votes WHERE poll_id IN (
                SELECT cp.id FROM chat_polls cp
                JOIN chat_messages cm ON cp.message_id = cm.id
                WHERE cm.room_id = $1
              )
            `, [room.id]);

            await db.query(`
              DELETE FROM chat_polls WHERE message_id IN (
                SELECT id FROM chat_messages WHERE room_id = $1
              )
            `, [room.id]);

            await db.query("DELETE FROM chat_read_status WHERE room_id = $1", [room.id]);
            await db.query("DELETE FROM chat_messages WHERE room_id = $1", [room.id]);
            await db.query("DELETE FROM chat_participants WHERE room_id = $1", [room.id]);
          }

          await db.query("DELETE FROM chat_rooms WHERE type = 'jahrgang' AND jahrgang_id = $1", [jahrgangId]);

          const fs = require('fs').promises;
          const path = require('path');

          for (const fileRecord of allFiles) {
            try {
              const fullPath = path.join(__dirname, '..', 'uploads', 'chat', fileRecord.file_path);
              await fs.unlink(fullPath);
            } catch (fileErr) {
 console.warn(`Could not delete file ${fileRecord.file_path}:`, fileErr.message);
            }
          }
        }
      }

      // konfi_profiles beförderter Ex-Konfis (Rolle != konfi) werden vom Jahrgang
      // GELOEST (jahrgang_id = NULL), NICHT geloescht. Sonst blockiert der
      // NO-ACTION-FK konfi_profiles.jahrgang_id den Jahrgang-Delete. WICHTIG:
      // Die WERTE des beförderten Konfis (gottesdienst_points/gemeinde_points,
      // current_level_id, konfspruch_*) stehen IN konfi_profiles -> das Profil
      // MUSS erhalten bleiben, damit er seine Werte spaeter noch einsehen kann.
      // Nur die Bindung an den geloeschten Jahrgang faellt weg.
      await db.query(`
        UPDATE konfi_profiles kp
        SET jahrgang_id = NULL
        FROM users u, roles r
        WHERE kp.user_id = u.id AND u.role_id = r.id
          AND kp.jahrgang_id = $1 AND r.name != 'konfi'
      `, [jahrgangId]);

      const deleteJahrgangQuery = "DELETE FROM jahrgaenge WHERE id = $1 AND organization_id = $2";
      const { rowCount } = await db.query(deleteJahrgangQuery, [jahrgangId, req.user.organization_id]);

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Jahrgang nicht gefunden' });
      }

      res.json({ message: 'Jahrgang erfolgreich gelöscht' });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'jahrgaenge', 'delete');
    } catch (err) {
 console.error(`Database error in DELETE /api/jahrgaenge/${jahrgangId}:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // GET attendance matrix for a jahrgang: all mandatory events x all konfis with attendance status
  router.get('/:id/attendance-matrix', rbacVerifier, requireAdmin, validateJahrgangId, async (req, res) => {
    const jahrgangId = parseInt(req.params.id, 10);
    try {
      const { rows: [jahrgang] } = await db.query(
        'SELECT id, name FROM jahrgaenge WHERE id = $1 AND organization_id = $2',
        [jahrgangId, req.user.organization_id]
      );
      if (!jahrgang) return res.status(404).json({ error: 'Jahrgang nicht gefunden' });

      const { rows: konfis } = await db.query(`
        SELECT u.id AS user_id, u.display_name, u.username
        FROM users u
        JOIN konfi_profiles kp ON kp.user_id = u.id
        JOIN roles r ON u.role_id = r.id
        WHERE kp.jahrgang_id = $1
          AND u.organization_id = $2
          AND r.name = 'konfi'
        ORDER BY u.display_name ASC
      `, [jahrgangId, req.user.organization_id]);

      const { rows: events } = await db.query(`
        SELECT DISTINCT e.id, e.name, e.event_date
        FROM events e
        JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
        WHERE eja.jahrgang_id = $1
          AND e.mandatory = true
          AND e.organization_id = $2
          AND (e.cancelled IS NULL OR e.cancelled = false)
        ORDER BY e.event_date ASC
      `, [jahrgangId, req.user.organization_id]);

      const { rows: bookings } = await db.query(`
        SELECT eb.event_id, eb.user_id, eb.status, eb.attendance_status
        FROM event_bookings eb
        WHERE eb.event_id = ANY($1::int[])
          AND eb.user_id = ANY($2::int[])
      `, [events.map(e => e.id), konfis.map(k => k.user_id)]);

      res.json({
        jahrgang: { id: jahrgang.id, name: jahrgang.name },
        konfis,
        events,
        bookings
      });
    } catch (err) {
      console.error(`Database error in GET /api/admin/jahrgaenge/${jahrgangId}/attendance-matrix:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ------------------------------------------------------------------
  // Hilfsfunktionen fuer die Konfispruch-Liste + den Konfirmationstermin
  // ------------------------------------------------------------------

  // Loest fuer jeden Konfi eines Jahrgangs den gewaehlten Konfispruch auf
  // (Listen-Wahl ODER Freitext, genau wie der Builder in konfi.js:486-522).
  // WICHTIG (W1): Die Uebersetzung kommt aus der DEDIZIERTEN Spalte
  // kp.konfspruch_translation (NICHT kp.bible_translation -- das ist die
  // separate Tageslosungs-Praeferenz).
  // Rueckgabe: Array { user_id, display_name, konfspruch } (konfspruch ggf. null).
  const buildSpruecheList = async (jahrgangId, organizationId) => {
    const { rows: konfis } = await db.query(`
      SELECT u.id AS user_id, u.display_name,
             kp.konfspruch_id, kp.konfspruch_freitext, kp.konfspruch_freitext_referenz,
             kp.konfspruch_translation,
             ce.event_date AS konfirmation_date
      FROM users u
      JOIN konfi_profiles kp ON kp.user_id = u.id
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN (
        -- Konfirmationstermin PRO KONFI aus dem confirmed-gebuchten is_konfirmation-Event.
        SELECT eb.user_id, e.event_date
        FROM event_bookings eb
        JOIN events e ON e.id = eb.event_id
        WHERE eb.status = 'confirmed'
          AND e.is_konfirmation = true
          AND e.organization_id = $2
          AND (e.cancelled IS NULL OR e.cancelled = false)
      ) ce ON ce.user_id = u.id
      WHERE kp.jahrgang_id = $1
        AND u.organization_id = $2
        AND r.name = 'konfi'
        AND u.deleted_at IS NULL
      ORDER BY u.display_name ASC
    `, [jahrgangId, organizationId]);

    const result = [];
    for (const konfi of konfis) {
      let konfspruch = null;
      if (konfi.konfspruch_id) {
        // Listen-Wahl: gewaehlte Konfispruch-Uebersetzung nachladen (org-gescopt, is_active).
        const spruchTranslation = konfi.konfspruch_translation || 'luther2017';
        const { rows: [spruch] } = await db.query(`
          SELECT ks.id, ks.reference, ku.text
          FROM konfsprueche ks
          LEFT JOIN konfspruch_uebersetzungen ku
            ON ku.spruch_id = ks.id AND ku.translation = $2
          WHERE ks.id = $1
            AND ks.is_active = true
            AND (ks.organization_id IS NULL OR ks.organization_id = $3)
        `, [konfi.konfspruch_id, spruchTranslation, organizationId]);
        if (spruch) {
          konfspruch = {
            source: 'liste',
            id: spruch.id,
            reference: spruch.reference,
            text: spruch.text || '',
            translation: konfi.konfspruch_translation || null
          };
        }
      } else if (konfi.konfspruch_freitext) {
        // Freitext-Spruch mit Pflicht-Referenz
        konfspruch = {
          source: 'freitext',
          text: konfi.konfspruch_freitext,
          reference: konfi.konfspruch_freitext_referenz
        };
      }
      result.push({
        user_id: konfi.user_id,
        display_name: konfi.display_name,
        konfspruch,
        // Termin PRO KONFI (sein gebuchter is_konfirmation-Event), nicht Jahrgang-weit.
        konfirmation_date: konfi.konfirmation_date || null
      });
    }
    return result;
  };

  // GET sprueche-Liste je Jahrgang: Array { user_id, display_name, konfspruch, konfirmation_date }
  router.get('/:id/sprueche', rbacVerifier, requireAdmin, validateJahrgangId, async (req, res) => {
    const jahrgangId = parseInt(req.params.id, 10);
    try {
      const { rows: [jahrgang] } = await db.query(
        'SELECT id, name FROM jahrgaenge WHERE id = $1 AND organization_id = $2',
        [jahrgangId, req.user.organization_id]
      );
      if (!jahrgang) return res.status(404).json({ error: 'Jahrgang nicht gefunden' });

      const sprueche = await buildSpruecheList(jahrgangId, req.user.organization_id);
      res.json(sprueche);
    } catch (err) {
      console.error(`Database error in GET /api/admin/jahrgaenge/${jahrgangId}/sprueche:`, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // POST matrix-email: schickt die Anwesenheitsmatrix ODER die Sprueche-Liste
  // per E-Mail an die eigene Adresse der Admin:in. Body { type }.
  const validateMatrixEmail = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('type').isIn(['anwesenheit', 'sprueche']).withMessage("type muss 'anwesenheit' oder 'sprueche' sein"),
    handleValidationErrors
  ];

  router.post('/:id/matrix-email', rbacVerifier, requireAdmin, validateMatrixEmail, async (req, res) => {
    const jahrgangId = parseInt(req.params.id, 10);
    const { type } = req.body;
    try {
      const { rows: [jahrgang] } = await db.query(
        'SELECT id, name FROM jahrgaenge WHERE id = $1 AND organization_id = $2',
        [jahrgangId, req.user.organization_id]
      );
      if (!jahrgang) return res.status(404).json({ error: 'Jahrgang nicht gefunden' });

      // E-Mail-Adresse der Admin:in laden (req.user enthaelt KEINE email -> aus users-Tabelle).
      const { rows: [adminRow] } = await db.query(
        'SELECT display_name, email FROM users WHERE id = $1',
        [req.user.id]
      );
      if (!adminRow || !adminRow.email) {
        return res.status(400).json({ error: 'Keine E-Mail-Adresse hinterlegt' });
      }

      let rows;
      if (type === 'sprueche') {
        const sprueche = await buildSpruecheList(jahrgangId, req.user.organization_id);
        rows = sprueche.map(s => ({
          display_name: s.display_name,
          konfirmation_date: s.konfirmation_date, // pro Konfi (gebuchter Termin)
          konfspruch: s.konfspruch
        }));
      } else {
        // type === 'anwesenheit': Pflicht-Events + Anwesenheits-Zusammenfassung je Konfi
        const { rows: konfis } = await db.query(`
          SELECT u.id AS user_id, u.display_name
          FROM users u
          JOIN konfi_profiles kp ON kp.user_id = u.id
          JOIN roles r ON u.role_id = r.id
          WHERE kp.jahrgang_id = $1
            AND u.organization_id = $2
            AND r.name = 'konfi'
            AND u.deleted_at IS NULL
          ORDER BY u.display_name ASC
        `, [jahrgangId, req.user.organization_id]);

        const { rows: events } = await db.query(`
          SELECT DISTINCT e.id
          FROM events e
          JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
          WHERE eja.jahrgang_id = $1
            AND e.mandatory = true
            AND e.organization_id = $2
            AND (e.cancelled IS NULL OR e.cancelled = false)
        `, [jahrgangId, req.user.organization_id]);
        const eventIds = events.map(e => e.id);

        const { rows: bookings } = eventIds.length > 0 ? await db.query(`
          SELECT eb.user_id, eb.attendance_status
          FROM event_bookings eb
          WHERE eb.event_id = ANY($1::int[])
            AND eb.user_id = ANY($2::int[])
        `, [eventIds, konfis.map(k => k.user_id)]) : { rows: [] };

        const totalEvents = eventIds.length;
        rows = konfis.map(k => {
          const own = bookings.filter(b => b.user_id === k.user_id);
          const present = own.filter(b => b.attendance_status === 'present').length;
          return {
            display_name: k.display_name,
            present_count: present,
            total_count: totalEvents
          };
        });
      }

      console.log(`[matrix-email] Versand angefordert: Jahrgang ${jahrgangId} "${jahrgang.name}", type=${type}, an=${adminRow.email}, rows=${rows.length}`);
      const mailResult = await emailService.sendKonfiMatrixEmail(
        adminRow.email,
        adminRow.display_name,
        jahrgang.name,
        type,
        rows
      );
      console.log(`[matrix-email] Versand-Ergebnis:`, JSON.stringify(mailResult));

      if (mailResult && mailResult.success === false) {
        return res.status(502).json({ error: 'E-Mail konnte nicht versendet werden (SMTP-Fehler)' });
      }
      res.json({ success: true });
    } catch (err) {
      console.error(`Database error in POST /api/admin/jahrgaenge/${jahrgangId}/matrix-email:`, err);
      res.status(500).json({ error: 'Fehler beim Senden der E-Mail' });
    }
  });

  return router;
};
