const express = require('express');
const bcrypt = require('bcrypt');
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations, getPointField } = require('../middleware/validation');
const { checkPointTypeEnabled } = require('../utils/pointTypeGuard');
const { generateBiblicalPassword } = require('../utils/passwordUtils');
const { generateUniqueUsername } = require('../utils/usernameGenerator');
const { deleteKonfiCascade } = require('../utils/konfiDeletion');
const { deletePhotoFile } = require('../utils/photoStorage');
const { checkKonfiLimit, nextTier } = require('../utils/konfiLimit');
const { syncJahrgangChat } = require('../utils/jahrgangChat');
const { removeFromEventChat, addToEventChat } = require('../utils/eventChat');
const { getKonfiBadgeProgress } = require('../utils/konfiBadgeProgress');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');
const router = express.Router();

// Konfis: Teamer darf ansehen, Admin darf bearbeiten
module.exports = (db, rbacVerifier, { requireAdmin, requireTeamer }, filterByJahrgangAccess, checkAndAwardBadges) => {

    // Validierungsregeln
    const validateCreateKonfi = [
        body('name').trim().notEmpty().withMessage('Name ist erforderlich'),
        body('jahrgang_id').isInt({ min: 1 }).withMessage('Ungültige Jahrgangs-ID'),
        handleValidationErrors
    ];

    const validateUpdateKonfi = [
        param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
        body('name').trim().notEmpty().withMessage('Name ist erforderlich'),
        body('jahrgang_id').isInt({ min: 1 }).withMessage('Ungültige Jahrgangs-ID'),
        handleValidationErrors
    ];

    const validateBonusPoints = [
        param('id').isInt({ min: 1 }).withMessage('Ungültige Konfi-ID'),
        commonValidations.points,
        commonValidations.type,
        body('description').trim().notEmpty().withMessage('Beschreibung ist erforderlich'),
        handleValidationErrors
    ];

    const validateAddActivity = [
        param('id').isInt({ min: 1 }).withMessage('Ungültige Konfi-ID'),
        body('activity_id').isInt({ min: 1 }).withMessage('Ungültige Aktivitäts-ID'),
        body('completed_date').notEmpty().isISO8601().withMessage('Gültiges Datum erforderlich'),
        handleValidationErrors
    ];

    const validateParamId = [
        param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
        handleValidationErrors
    ];

    // GET all konfis for the admin's organization (with jahrgang filtering)
    router.get('/', rbacVerifier, requireTeamer, async (req, res) => {
        try {
            let jahrgangFilter = '';
            let params = [req.user.organization_id];
            let placeholderIndex = 2; // Start after $1 for organization_id

            if (!req.user.is_super_admin && req.user.role_name !== 'org_admin') {
                const viewableJahrgaenge = req.user.assigned_jahrgaenge
                    .filter(j => j.can_view)
                    .map(j => j.id);

                if (viewableJahrgaenge.length === 0) {
                    res.set('X-Kein-Jahrgang-Zugewiesen', 'true');
                    return res.json([]);
                }

                const placeholders = viewableJahrgaenge.map(() => `$${placeholderIndex++}`).join(',');
                jahrgangFilter = `AND j.id IN (${placeholders})`;
                params.push(...viewableJahrgaenge);
            }

            const query = `
                SELECT u.id, u.display_name as name, u.username,
                       kp.gottesdienst_points, kp.gemeinde_points,
                       j.name as jahrgang_name, j.id as jahrgang_id,
                       j.gottesdienst_enabled, j.gemeinde_enabled,
                       j.target_gottesdienst, j.target_gemeinde,
                       (SELECT COUNT(*) FROM user_badges WHERE user_id = u.id) as "badgeCount"
                FROM users u
                JOIN roles r ON u.role_id = r.id
                LEFT JOIN konfi_profiles kp ON u.id = kp.user_id
                LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
                WHERE r.name = 'konfi' AND u.organization_id = $1 AND u.deleted_at IS NULL ${jahrgangFilter}
                ORDER BY j.name DESC, u.display_name
            `;

            const { rows } = await db.query(query, params);
            res.json(rows);
        } catch (err) {
 console.error('Database error in GET /konfis:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        }
    });

    // GET all teamers for the admin's organization
    router.get('/teamer', rbacVerifier, requireTeamer, async (req, res) => {
        try {
            const query = `
                SELECT u.id, u.display_name as name, u.username, u.teamer_since,
                       STRING_AGG(DISTINCT j.name, ', ' ORDER BY j.name) as jahrgang_name,
                       COALESCE(badge_counts.badge_count, 0)::int as badge_count,
                       COALESCE(cert_counts.cert_count, 0)::int as cert_count
                FROM users u
                JOIN roles r ON u.role_id = r.id
                LEFT JOIN user_jahrgang_assignments uja ON u.id = uja.user_id
                LEFT JOIN jahrgaenge j ON uja.jahrgang_id = j.id
                LEFT JOIN (
                    SELECT ub.user_id, COUNT(*) as badge_count
                    FROM user_badges ub
                    JOIN custom_badges cb ON ub.badge_id = cb.id
                    WHERE cb.target_role = 'teamer'
                    GROUP BY ub.user_id
                ) badge_counts ON u.id = badge_counts.user_id
                LEFT JOIN (
                    SELECT user_id, COUNT(*) as cert_count
                    FROM user_certificates
                    WHERE organization_id = $1
                    GROUP BY user_id
                ) cert_counts ON u.id = cert_counts.user_id
                WHERE r.name = 'teamer' AND u.organization_id = $1
                GROUP BY u.id, u.display_name, u.username, u.teamer_since,
                         badge_counts.badge_count, cert_counts.cert_count
                ORDER BY u.display_name
            `;
            const { rows } = await db.query(query, [req.user.organization_id]);
            res.json(rows);
        } catch (err) {
            console.error('Database error in GET /konfis/teamer:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        }
    });

    // GET a single konfi/teamer by ID - weiterleiten an zweiten Handler

    // POST (create) a new konfi
    router.post('/', rbacVerifier, requireAdmin, validateCreateKonfi, async (req, res) => {
        const { name, jahrgang_id } = req.body;
        const confirm = req.body.confirm === true;
        if (!name || !jahrgang_id) {
            return res.status(400).json({ error: 'Name und Jahrgang sind erforderlich' });
        }

        const password = generateBiblicalPassword();
        const hashedPassword = await bcrypt.hash(password, 10);

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // Global freien Username generieren (Kollision -> anna.musterfrau2 usw.),
            // sonst knallt der UNIQUE-Index (organization_id, username) mit 500.
            const username = await generateUniqueUsername(client, name);

            // First verify that the jahrgang exists
            const jahrgangCheckQuery = "SELECT id FROM jahrgaenge WHERE id = $1 AND organization_id = $2";
            const { rows: [jahrgangExists] } = await client.query(jahrgangCheckQuery, [jahrgang_id, req.user.organization_id]);

            if (!jahrgangExists) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Jahrgang nicht gefunden oder gehört nicht zu Ihrer Organisation' });
            }

            const roleQuery = "SELECT id FROM roles WHERE name = 'konfi' AND organization_id = $1";
            const { rows: [role] } = await client.query(roleQuery, [req.user.organization_id]);

            if (!role) {
                await client.query('ROLLBACK');
                return res.status(500).json({ error: 'Konfi-Rolle nicht gefunden' });
            }

            const { count, limit, stufe } = await checkKonfiLimit(client, req.user.organization_id);

            if (stufe === 'hard_block') {
                // Harte Grenze (count >= limit + 5): kein Override, auch nicht mit confirm.
                await client.query('ROLLBACK');
                return res.status(403).json({
                    error: `Tarif-Grenze erreicht (${count} von ${limit} Konfis). Ein Tarif-Upgrade ist nötig, um weitere Konfis anzulegen.`,
                    error_code: 'limit_exceeded',
                    count,
                    limit,
                    next_tier: nextTier(limit)
                });
            }

            if (stufe === 'grace' && !confirm) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    error: `Tarif ausgeschöpft (${count} von ${limit} Konfis). Du kannst bis zu 5 weitere anlegen — danach ist ein Upgrade nötig.`,
                    error_code: 'limit_grace',
                    count,
                    limit,
                    next_tier: nextTier(limit)
                });
            }
            // under_limit ODER (grace mit confirm:true) -> normal anlegen.

            const userQuery = `
                INSERT INTO users (username, display_name, password_hash, role_id, organization_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id`;
            const { rows: [newUser] } = await client.query(userQuery, [username, name, hashedPassword, role.id, req.user.organization_id]);
            const userId = newUser.id;

            const profileQuery = `
                INSERT INTO konfi_profiles (user_id, jahrgang_id, organization_id, gottesdienst_points, gemeinde_points)
                VALUES ($1, $2, $3, 0, 0)`;
            await client.query(profileQuery, [userId, jahrgang_id, req.user.organization_id]);

            // Jahrgangs-Chat synchronisieren: legt den Chat bei Bedarf an und
            // fuegt den neuen Konfi (sowie weiterhin alle Soll-Mitglieder) hinzu.
            await syncJahrgangChat(client, jahrgang_id, req.user.organization_id, req.user.id);

            await client.query('COMMIT');

            // Auto-Enrollment für zukünftige Pflicht-Events
            try {
              const enrollFutureEventsQuery = `
                INSERT INTO event_bookings (event_id, user_id, status, booking_date, organization_id)
                SELECT e.id, $1, 'confirmed', NOW(), $2
                FROM events e
                JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
                WHERE eja.jahrgang_id = $3
                  AND e.mandatory = true
                  AND e.event_date > NOW()
                  AND e.organization_id = $2
                  AND e.cancelled IS NOT TRUE
                ON CONFLICT (user_id, event_id) DO NOTHING
                RETURNING event_id
              `;
              const { rows: gebucht } = await db.query(enrollFutureEventsQuery, [userId, req.user.organization_id, jahrgang_id]);
              // Auch in die Chats der Pflichttermine eintreten (falls die
              // Leitung dort einen angelegt hat) — sonst fehlt der neue Konfi
              // in Chats, in denen sein ganzer Jahrgang sitzt.
              for (const row of gebucht) {
                await addToEventChat(db, row.event_id, userId, req.user.organization_id);
              }
            } catch (enrollErr) {
              console.error('Auto-enrollment für Pflicht-Events fehlgeschlagen:', enrollErr);
            }

            res.status(201).json({ id: userId, username, temporaryPassword: password, message: 'Konfi erfolgreich erstellt' });

            // Live-Update NACH der Response: neuer Konfi taucht in der Admin-Liste auf.
            // Ausserhalb des try/catch wäre ideal, hier aber unkritisch, da der Send
            // selbst gefangen ist (No-op ohne io) und die Response bereits raus ist.
            liveUpdate.sendToOrgAdmins(req.user.organization_id, 'konfis', 'create');

        } catch (err) {
            await client.query('ROLLBACK').catch(rbErr => console.error('Rollback failed:', rbErr));

            if (err.code === '23505') { // unique_violation
                return res.status(409).json({ error: 'Benutzername existiert bereits' });
            }
 console.error('Database error in POST /konfis:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } finally {
            client.release();
        }
    });

    // PUT (update) a konfi
    router.put('/:id', rbacVerifier, requireAdmin, validateUpdateKonfi, async (req, res) => {
        const { name, jahrgang_id } = req.body;
        if (!name || !jahrgang_id) {
            return res.status(400).json({ error: 'Name und Jahrgang sind erforderlich' });
        }
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // Get current jahrgang_id before update
            const currentProfileQuery = `SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1`;
            const { rows: [currentProfile] } = await client.query(currentProfileQuery, [req.params.id]);

            // Username wird beim Update BEWUSST NICHT mehr neu generiert: das
            // ueberschrieb still selbstgewaehlte Usernamen aus der Registrierung
            // (z.B. "anna.musterfrau" -> "anna", sobald ein Admin den Datensatz
            // bearbeitete) — die Login-Kennung blieb dann unauffindbar.
            const userQuery = `
                UPDATE users SET display_name = $1
                WHERE id = $2 AND organization_id = $3`;
            const { rowCount: userUpdateCount } = await client.query(userQuery, [name, req.params.id, req.user.organization_id]);

            if (userUpdateCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Konfi nicht gefunden' });
            }

            const zielJahrgangQuery = "SELECT id FROM jahrgaenge WHERE id = $1 AND organization_id = $2";
            const { rows: [zielJahrgang] } = await client.query(
                zielJahrgangQuery, [jahrgang_id, req.user.organization_id]
            );
            if (!zielJahrgang) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Jahrgang nicht gefunden oder gehört nicht zu Ihrer Organisation' });
            }

            const profileQuery = `UPDATE konfi_profiles SET jahrgang_id = $1 WHERE user_id = $2`;
            await client.query(profileQuery, [jahrgang_id, req.params.id]);

            // Jahrgang-Wechsel: alten + neuen Jahrgangs-Chat synchronisieren.
            // syncJahrgangChat entfernt den Konfi aus dem alten (nicht mehr Soll)
            // und fuegt ihn dem neuen hinzu — user_type-konsistent.
            if (currentProfile && currentProfile.jahrgang_id !== parseInt(jahrgang_id)) {
                if (currentProfile.jahrgang_id) {
                    await syncJahrgangChat(client, currentProfile.jahrgang_id, req.user.organization_id, req.user.id);
                }
                await syncJahrgangChat(client, jahrgang_id, req.user.organization_id, req.user.id);
            }

            if (currentProfile && currentProfile.jahrgang_id !== parseInt(jahrgang_id)) {
              // Zuerst die Pflichttermine des ALTEN Jahrgangs abraeumen. Ohne das
              // blieb der Konfi dort gebucht und stand anschliessend in den
              // Pflichtterminen beider Jahrgänge.
              // Bewusst eng gefasst: nur kuenftige Termine, nur solange keine
              // Anwesenheit erfasst ist und der Termin nicht auch zum neuen
              // Jahrgang gehört — Historie bleibt damit unberuehrt.
              if (currentProfile.jahrgang_id) {
                  const { rows: abgemeldet } = await client.query(
                    `DELETE FROM event_bookings eb
                     USING events e
                     WHERE eb.event_id = e.id
                       AND eb.user_id = $1
                       AND eb.attendance_status IS NULL
                       AND e.event_date > NOW()
                       AND e.organization_id = $2
                       AND EXISTS (
                         SELECT 1 FROM event_jahrgang_assignments eja
                         WHERE eja.event_id = e.id AND eja.jahrgang_id = $3
                       )
                       AND NOT EXISTS (
                         SELECT 1 FROM event_jahrgang_assignments eja
                         WHERE eja.event_id = e.id AND eja.jahrgang_id = $4
                       )
                     RETURNING eb.event_id`,
                    [req.params.id, req.user.organization_id, currentProfile.jahrgang_id, jahrgang_id]
                  );
                  // Wer nicht mehr gebucht ist, gehört auch nicht mehr in den
                  // Event-Chat — dieselbe Regel wie bei der Abmeldung
                  // (eventChat.js). Ohne das las der Konfi im Chat eines
                  // Termins mit, den er gar nicht mehr sieht
                  // 
                  for (const row of abgemeldet) {
                    await removeFromEventChat(client, row.event_id, parseInt(req.params.id, 10), req.user.organization_id);
                  }
              }
                const enrollFutureEventsQuery = `
                  INSERT INTO event_bookings (event_id, user_id, status, booking_date, organization_id)
                  SELECT e.id, $1, 'confirmed', NOW(), $2
                  FROM events e
                  JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
                  WHERE eja.jahrgang_id = $3
                    AND e.mandatory = true
                    AND e.event_date > NOW()
                    AND e.organization_id = $2
                    AND e.cancelled IS NOT TRUE
                  ON CONFLICT (user_id, event_id) DO NOTHING
                  RETURNING event_id
                `;
                const { rows: gebucht } = await client.query(enrollFutureEventsQuery, [req.params.id, req.user.organization_id, jahrgang_id]);
                // In die Chats der neu gebuchten Pflichttermine eintreten —
                // dieselbe Regel wie beim Nachbuchen eines Jahrgangs am Event
                // (events.js: syncEventChat). Existiert kein Chat, passiert
                // nichts (Anlage bleibt Sache der Leitung).
                for (const row of gebucht) {
                  await addToEventChat(client, row.event_id, parseInt(req.params.id, 10), req.user.organization_id);
                }
            }

            await client.query('COMMIT');

            res.json({ message: 'Konfi erfolgreich aktualisiert' });

            // Live-Update NACH der Response: geaenderter Konfi in der Admin-Liste.
            liveUpdate.sendToOrgAdmins(req.user.organization_id, 'konfis', 'update', { konfiId: req.params.id });

        } catch (err) {
            await client.query('ROLLBACK').catch(rbErr => console.error('Rollback failed:', rbErr));
 console.error('Database error in PUT /konfis/:id:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } finally {
            client.release();
        }
    });

    // DELETE a konfi
    router.delete('/:id', rbacVerifier, requireAdmin, validateParamId, async (req, res) => {
        const userId = req.params.id;
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const checkUserQuery = `
                SELECT u.id FROM users u
                JOIN roles r ON u.role_id = r.id
                WHERE u.id = $1 AND u.organization_id = $2 AND r.name = 'konfi' AND u.deleted_at IS NULL`;
            const { rows: [user] } = await client.query(checkUserQuery, [userId, req.user.organization_id]);

            if (!user) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Konfi nicht gefunden' });
            }

            await deleteKonfiCascade(client, userId, req.user.organization_id);

            await client.query('COMMIT');
            res.json({ message: 'Konfi erfolgreich gelöscht' });

            // Live-Update NACH der Response: geloeschter Konfi aus der Admin-Liste entfernen.
            liveUpdate.sendToOrgAdmins(req.user.organization_id, 'konfis', 'delete', { konfiId: userId });
            // Socket trennen: sonst empfaengt das geloeschte Konto weiter
            // Org-Updates, bis die App neu gestartet wird.
            liveUpdate.disconnectUserSockets(userId);

        } catch (err) {
            await client.query('ROLLBACK').catch(rbErr => console.error('Rollback failed:', rbErr));
 console.error('Database error in DELETE /konfis/:id:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } finally {
            client.release();
        }
    });

    // Regenerate password for a konfi
    router.post('/:id/regenerate-password', rbacVerifier, requireAdmin, validateParamId, async (req, res) => {
        const newPassword = generateBiblicalPassword();
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const updateUserQuery = `
                UPDATE users SET password_hash = $1
                WHERE id = $2 AND organization_id = $3`;
            const { rowCount } = await client.query(updateUserQuery, [hashedPassword, req.params.id, req.user.organization_id]);

            if (rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Konfi nicht gefunden' });
            }

            const updateProfileQuery = "UPDATE konfi_profiles SET password_plain = NULL WHERE user_id = $1";
            await client.query(updateProfileQuery, [req.params.id]);

            await client.query('COMMIT');
            res.json({ message: 'Passwort erfolgreich neu generiert', temporaryPassword: newPassword });

        } catch (err) {
            await client.query('ROLLBACK').catch(rbErr => console.error('Rollback failed:', rbErr));
 console.error('Database error in POST /konfis/:id/regenerate-password:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } finally {
            client.release();
        }
    });

    // GET single konfi details with activities, bonusPoints, eventPoints
    router.get('/:id', rbacVerifier, requireTeamer, async (req, res) => {
        const konfiId = req.params.id;
        
        try {
            const konfiQuery = `
                SELECT u.*, u.teamer_since, kp.gottesdienst_points, kp.gemeinde_points,
                       kp.konfspruch_id, kp.konfspruch_freitext, kp.konfspruch_freitext_referenz,
                       kp.konfspruch_translation,
                       j.name as jahrgang_name, j.id as jahrgang_id,
                       j.gottesdienst_enabled, j.gemeinde_enabled,
                       j.target_gottesdienst, j.target_gemeinde,
                       ce.event_date as confirmation_date, ce.location as confirmation_location,
                       r.name as role_name
                FROM users u
                JOIN roles r ON u.role_id = r.id
                LEFT JOIN konfi_profiles kp ON u.id = kp.user_id
                LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
                LEFT JOIN (
                  -- Konfirmationstermin/-ort PRO KONFI: das is_konfirmation-Event, zu dem
                  -- der Konfi mit status='confirmed' gebucht ist (mehrere Termine je Jahrgang
                  -- möglich, jeder Konfi bucht genau einen). Keine Buchung -> kein Termin.
                  SELECT eb.user_id, e.location, e.event_date
                  FROM event_bookings eb
                  JOIN events e ON e.id = eb.event_id
                  WHERE eb.status = 'confirmed'
                    AND e.is_konfirmation = true
                    AND e.organization_id = $2
                    AND (e.cancelled IS NULL OR e.cancelled = false)
                ) ce ON ce.user_id = u.id
                WHERE u.id = $1 AND r.name IN ('konfi', 'teamer') AND u.organization_id = $2 AND u.deleted_at IS NULL
            `;
            const { rows: [konfi] } = await db.query(konfiQuery, [konfiId, req.user.organization_id]);

            if (!konfi) {
                return res.status(404).json({ error: 'Benutzer nicht gefunden' });
            }

            const activitiesQuery = `
                SELECT ka.*, a.name, a.points, a.type, a.target_role, u.display_name as admin_name
                FROM user_activities ka
                JOIN activities a ON ka.activity_id = a.id
                LEFT JOIN users u ON ka.admin_id = u.id
                WHERE ka.user_id = $1 AND ka.organization_id = $2
                ORDER BY ka.completed_date DESC, ka.created_at DESC
            `;
            const { rows: activities } = await db.query(activitiesQuery, [konfiId, req.user.organization_id]);

            const bonusQuery = `
                SELECT bp.*, u.display_name as admin_name
                FROM bonus_points bp
                LEFT JOIN users u ON bp.admin_id = u.id
                WHERE bp.konfi_id = $1 AND bp.organization_id = $2
                ORDER BY bp.created_at DESC
            `;
            const { rows: bonusPoints } = await db.query(bonusQuery, [konfiId, req.user.organization_id]);

            const badgeQuery = `
                SELECT COUNT(*) as "badgeCount" FROM user_badges ub
                JOIN custom_badges cb ON ub.badge_id = cb.id
                WHERE ub.user_id = $1 AND cb.target_role = $2
            `;
            const { rows: [badgeResult] } = await db.query(badgeQuery, [konfiId, konfi.role_name]);

            // Zertifikate für Teamer mitladen
            let certificates = [];
            let teamerEvents = [];
            if (konfi.role_name === 'teamer') {
                const certQuery = `
                    SELECT uc.id, uc.issued_date, uc.expiry_date, ct.name, ct.icon
                    FROM user_certificates uc
                    JOIN certificate_types ct ON uc.certificate_type_id = ct.id
                    WHERE uc.user_id = $1 AND uc.organization_id = $2
                    ORDER BY uc.issued_date DESC
                `;
                const { rows: certRows } = await db.query(certQuery, [konfiId, req.user.organization_id]);
                certificates = certRows;

                // Events für Teamer: gebuchte Events mit Status
                const eventsQuery = `
                    SELECT e.id, e.name, e.event_date, e.location, e.teamer_only, e.teamer_needed,
                           eb.status as booking_status, eb.booking_date
                    FROM event_bookings eb
                    JOIN events e ON eb.event_id = e.id
                    WHERE eb.user_id = $1 AND e.organization_id = $2
                    ORDER BY e.event_date DESC
                `;
                const { rows: eventRows } = await db.query(eventsQuery, [konfiId, req.user.organization_id]);
                teamerEvents = eventRows;
            }

            // Konfi-Historie: Punkte-History für promoted Teamer
            let konfiHistory = null;
            if (konfi.role_name === 'teamer' && konfi.gottesdienst_points !== null) {
                // Activities aus der Konfi-Zeit
                const histActivities = `
                    SELECT ka.id, a.name as title, a.points, a.type as category,
                           ka.completed_date as date, 'activity' as source_type
                    FROM user_activities ka
                    JOIN activities a ON ka.activity_id = a.id
                    WHERE ka.user_id = $1 AND ka.organization_id = $2
                    ORDER BY ka.completed_date DESC
                `;
                const { rows: histAct } = await db.query(histActivities, [konfiId, req.user.organization_id]);

                const histBonus = `
                    SELECT id, description as title, points, type as category,
                           completed_date as date, 'bonus' as source_type
                    FROM bonus_points
                    WHERE konfi_id = $1 AND organization_id = $2
                    ORDER BY completed_date DESC
                `;
                const { rows: histBon } = await db.query(histBonus, [konfiId, req.user.organization_id]);

                const histEvents = `
                    SELECT ep.id, e.name as title, ep.points, ep.point_type as category,
                           ep.awarded_date as date, 'event' as source_type
                    FROM event_points ep
                    JOIN events e ON ep.event_id = e.id
                    WHERE ep.konfi_id = $1 AND ep.organization_id = $2
                    ORDER BY ep.awarded_date DESC
                `;
                const { rows: histEvt } = await db.query(histEvents, [konfiId, req.user.organization_id]);

                const allHistory = [...histAct, ...histBon, ...histEvt].sort((a, b) =>
                    new Date(b.date || 0) - new Date(a.date || 0)
                );

                konfiHistory = {
                    history: allHistory,
                    totals: {
                        gottesdienst: konfi.gottesdienst_points || 0,
                        gemeinde: konfi.gemeinde_points || 0,
                        total: (konfi.gottesdienst_points || 0) + (konfi.gemeinde_points || 0)
                    }
                };
            }

            // Gewaehlten Konfispruch aufloesen (read-only Admin-Einsicht, SPRUCH-08)
            // Builder uebernommen aus konfi.js:486-518. Genau EINE Quelle aktiv:
            // Listen-Wahl ODER Freitext. Translation-Quelle ist die DEDIZIERTE Spalte
            // kp.konfspruch_translation (NICHT die Tageslosungs-Praeferenz bible_translation).
            let konfspruch = null;
            if (konfi.role_name === 'konfi') {
                if (konfi.konfspruch_id) {
                    const spruchTranslation = konfi.konfspruch_translation || 'luther2017';
                    const spruchQuery = `
                        SELECT ks.id, ks.reference, ks.book, ks.chapter, ks.verse, ku.text
                        FROM konfsprueche ks
                        LEFT JOIN konfspruch_uebersetzungen ku
                          ON ku.spruch_id = ks.id AND ku.translation = $2
                        WHERE ks.id = $1
                          AND ks.is_active = true
                          AND (ks.organization_id IS NULL OR ks.organization_id = $3)
                    `;
                    const { rows: [spruch] } = await db.query(spruchQuery, [konfi.konfspruch_id, spruchTranslation, req.user.organization_id]);
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
                    konfspruch = {
                        source: 'freitext',
                        text: konfi.konfspruch_freitext,
                        reference: konfi.konfspruch_freitext_referenz
                    };
                }
            }

            res.json({
                ...konfi,
                konfspruch,
                activities: activities || [],
                bonusPoints: bonusPoints || [],
                badgeCount: badgeResult ? badgeResult.badgeCount : 0,
                ...(konfi.role_name === 'teamer' ? { certificates, teamerEvents, konfiHistory } : {})
            });

        } catch (err) {
 console.error('Database error in GET /konfis/:id (second route):', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        }
    });

    // GET event points for konfi
    router.get('/:id/event-points', rbacVerifier, requireTeamer, async (req, res) => {
        const konfiId = req.params.id;
        
        try {
            const eventPointsQuery = `
                SELECT ep.*, e.name as event_name, e.event_date, u.display_name as admin_name
                FROM event_points ep
                JOIN events e ON ep.event_id = e.id
                LEFT JOIN users u ON ep.admin_id = u.id
                WHERE ep.konfi_id = $1 AND ep.organization_id = $2
                ORDER BY ep.awarded_date DESC, ep.created_at DESC
            `;
            const { rows: eventPoints } = await db.query(eventPointsQuery, [konfiId, req.user.organization_id]);
            res.json(eventPoints || []);
        } catch (err) {
 console.error('Database error in GET /konfis/:id/event-points:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        }
    });

    // GET Badges eines Konfis (Admin-Einsicht) — identische Wertung/Progress wie
    // die Konfi-eigene Ansicht (GET /konfi/badges), gemeinsame Quelle
    // utils/konfiBadgeProgress.js. Teamer:innen duerfen ansehen.
    router.get('/:id/badges', rbacVerifier, requireTeamer, async (req, res) => {
        const konfiId = req.params.id;

        try {
            // Org-Zugehoerigkeit + Konfi-Rolle prüfen (Badge-Progress ist
            // konfi-spezifisch; Teamer haben eigene Badges über teamer.js).
            const { rows: [konfi] } = await db.query(
                `SELECT u.id FROM users u
                 JOIN roles r ON u.role_id = r.id
                 WHERE u.id = $1 AND r.name = 'konfi' AND u.organization_id = $2 AND u.deleted_at IS NULL`,
                [konfiId, req.user.organization_id]
            );

            if (!konfi) {
                return res.status(404).json({ error: 'Konfi nicht gefunden' });
            }

            const result = await getKonfiBadgeProgress(db, parseInt(konfiId, 10), req.user.organization_id);
            res.json(result);
        } catch (err) {
 console.error('Database error in GET /konfis/:id/badges:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        }
    });

    // GET attendance stats for konfi (mandatory events)
    router.get('/:id/attendance-stats', rbacVerifier, requireAdmin, async (req, res) => {
        const konfiId = req.params.id;

        try {
            // Jahrgang des Konfis ermitteln
            const jahrgangResult = await db.query(
                'SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1',
                [konfiId]
            );

            if (jahrgangResult.rows.length === 0) {
                return res.status(404).json({ error: 'Konfi nicht gefunden' });
            }

            const jahrgangId = jahrgangResult.rows[0].jahrgang_id;

            if (!jahrgangId) {
                return res.json({ total_mandatory: 0, attended: 0, percentage: 100, missed_events: [] });
            }

            // Alle vergangenen Pflicht-Events des Jahrgangs mit Booking-Status
            const { rows } = await db.query(`
                SELECT
                    e.id as event_id,
                    e.name as event_name,
                    e.event_date,
                    e.location,
                    eb.status as booking_status,
                    eb.attendance_status,
                    eb.opt_out_reason
                FROM events e
                JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
                LEFT JOIN event_bookings eb ON e.id = eb.event_id AND eb.user_id = $1
                WHERE eja.jahrgang_id = $2
                    AND e.mandatory = true
                    AND e.event_date < NOW()
                    AND (e.cancelled IS NOT TRUE)
                    AND e.organization_id = $3
                ORDER BY e.event_date DESC
            `, [konfiId, jahrgangId, req.user.organization_id]);

            const total_mandatory = rows.length;
            const attended = rows.filter(r => r.attendance_status === 'present').length;
            const percentage = total_mandatory > 0 ? Math.round((attended / total_mandatory) * 100) : 100;

            const missed_events = rows
                .filter(r => r.attendance_status !== 'present')
                .map(r => ({
                    event_id: r.event_id,
                    event_name: r.event_name,
                    event_date: r.event_date,
                    location: r.location,
                    status: r.booking_status === 'opted_out' ? 'opted_out' : 'absent',
                    opt_out_reason: r.booking_status === 'opted_out' ? r.opt_out_reason : null
                }));

            res.json({ total_mandatory, attended, percentage, missed_events });
        } catch (err) {
            console.error('Database error in GET /konfis/:id/attendance-stats:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        }
    });

    // POST bonus points for a konfi
    router.post('/:id/bonus-points', rbacVerifier, requireTeamer, validateBonusPoints, async (req, res) => {
        const { points, type, description } = req.body;
        if (!points || !type || !description) {
            return res.status(400).json({ error: 'Punkte, Typ und Beschreibung sind erforderlich' });
        }

        try {
            if (req.user.role_name === 'teamer') {
                const { rows: [konfiProfile] } = await db.query(
                    'SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1', [req.params.id]
                );
                if (!konfiProfile) {
                    return res.status(404).json({ error: 'Konfi nicht gefunden' });
                }
                const hasAccess = req.user.assigned_jahrgaenge.some(
                    j => j.id === konfiProfile.jahrgang_id && j.can_view
                );
                if (!hasAccess) {
                    return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
                }
            }

            // Guard: Punkte-Typ muss für den Jahrgang aktiviert sein
            const { enabled, error } = await checkPointTypeEnabled(db, req.params.id, type);
            if (!enabled) return res.status(400).json({ error });

            const updateField = getPointField(type);

            const client = await db.getClient();
            try {
                await client.query('BEGIN');

                const query = `
                    INSERT INTO bonus_points (konfi_id, points, type, description, admin_id, organization_id, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, NOW())`;
                await client.query(query, [req.params.id, points, type, description, req.user.id, req.user.organization_id]);

                const updateQuery = `
                    UPDATE konfi_profiles kp
                    SET ${updateField} = ${updateField} + $1
                    FROM users u
                    WHERE kp.user_id = $2 AND u.id = kp.user_id AND u.organization_id = $3`;
                const { rowCount: profileUpdated } = await client.query(updateQuery, [points, req.params.id, req.user.organization_id]);
                if (profileUpdated === 0) {
                    throw new Error('Konfi nicht in eigener Organisation gefunden');
                }

                await client.query('COMMIT');
            } catch (txErr) {
                await client.query('ROLLBACK');
                throw txErr;
            } finally {
                client.release();
            }

            // Badge-Check NACH COMMIT (verwendet db Pool)
            try {
                const newBadges = await checkAndAwardBadges(db, req.params.id);
                if (newBadges > 0) {
                }
            } catch (badgeErr) {
 console.error('Error checking badges after bonus points:', badgeErr);
                // Don't fail the request if badge checking fails
            }

            // Level-Check NACH Badge-Check
            try {
                await PushService.checkAndSendLevelUp(db, parseInt(req.params.id), req.user.organization_id);
            } catch (levelErr) {
                console.error('Level-up check failed:', levelErr);
            }

            // Push-Notification an Konfi senden
            try {
                await PushService.sendBonusPointsToKonfi(db, req.params.id, points, description, type);
            } catch (pushErr) {
 console.error('Error sending bonus points push:', pushErr);
            }

            res.status(201).json({ message: 'Bonuspunkte erfolgreich hinzugefügt' });

            // Live Update: Notify konfi about dashboard (points) and admins about konfi change
            liveUpdate.sendToUser('konfi', parseInt(req.params.id), 'dashboard', 'update', { points });
            liveUpdate.sendToOrgAdmins(req.user.organization_id, 'konfis', 'update', { konfiId: req.params.id });

        } catch (err) {
            if (err.message === 'Ungültiger Punktetyp') {
                return res.status(400).json({ error: 'Ungültiger Punktetyp. Erlaubt: gottesdienst, gemeinde' });
            }
 console.error('Database error in POST /konfis/:id/bonus-points:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        }
    });

    // DELETE bonus points
    router.delete('/:id/bonus-points/:bonusId', rbacVerifier, requireAdmin, async (req, res) => {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const { rows: [bonus] } = await client.query(
                'SELECT bp.* FROM bonus_points bp JOIN users u ON bp.konfi_id = u.id WHERE bp.id = $1 AND bp.konfi_id = $2 AND u.organization_id = $3',
                [req.params.bonusId, req.params.id, req.user.organization_id]
            );

            if (!bonus) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Bonuspunkte nicht gefunden' });
            }

            await client.query('DELETE FROM bonus_points WHERE id = $1', [req.params.bonusId]);

            const updateField = getPointField(bonus.type);
            const updateQuery = `
                UPDATE konfi_profiles
                SET ${updateField} = GREATEST(0, ${updateField} - $1)
                WHERE user_id = $2`;
            await client.query(updateQuery, [bonus.points, req.params.id]);

            await client.query('COMMIT');

            // Badge-Check NACH COMMIT (verwendet db Pool)
            try {
                await checkAndAwardBadges(db, req.params.id);
            } catch (badgeErr) {
 console.error('Error checking badges after bonus points removal:', badgeErr);
                // Don't fail the request if badge checking fails
            }

            res.json({ message: 'Bonuspunkte erfolgreich gelöscht' });

            // Live Update: Notify konfi about dashboard (points) and admins about konfi change
            liveUpdate.sendToUser('konfi', parseInt(req.params.id), 'dashboard', 'update', { points: -bonus.points });
            liveUpdate.sendToOrgAdmins(req.user.organization_id, 'konfis', 'update', { konfiId: req.params.id });

        } catch (err) {
 console.error('Database error in DELETE /konfis/:id/bonus-points/:bonusId:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } finally {
            client.release();
        }
    });

    // POST activity for a konfi
    router.post('/:id/activities', rbacVerifier, requireAdmin, validateAddActivity, async (req, res) => {
        const { activity_id, completed_date, comment } = req.body;
        if (!activity_id || !completed_date) {
            return res.status(400).json({ error: 'Aktivitäts-ID und Datum sind erforderlich' });
        }

        try {
            const { rows: [activity] } = await db.query('SELECT * FROM activities WHERE id = $1 AND organization_id = $2', [activity_id, req.user.organization_id]);

            if (!activity) {
                return res.status(404).json({ error: 'Aktivität nicht gefunden' });
            }

            const isTeamerActivity = activity.target_role === 'teamer';

            if (!isTeamerActivity) {
                // Guard: Punkte-Typ muss für den Jahrgang aktiviert sein
                const { enabled: ptEnabled, error: ptError } = await checkPointTypeEnabled(db, req.params.id, activity.type);
                if (!ptEnabled) return res.status(400).json({ error: ptError });
            }

            const client = await db.getClient();
            try {
                await client.query('BEGIN');

                const query = `
                    INSERT INTO user_activities (user_id, activity_id, completed_date, comment, admin_id, organization_id, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, NOW())`;
                await client.query(query, [req.params.id, activity_id, completed_date, comment || '', req.user.id, req.user.organization_id]);

                if (!isTeamerActivity && activity.points && activity.type) {
                    const updateField = getPointField(activity.type);
                    const updateQuery = `
                        UPDATE konfi_profiles kp
                        SET ${updateField} = ${updateField} + $1
                        FROM users u
                        WHERE kp.user_id = $2 AND u.id = kp.user_id AND u.organization_id = $3`;
                    const { rowCount: profileUpdated } = await client.query(updateQuery, [activity.points, req.params.id, req.user.organization_id]);
                    if (profileUpdated === 0) {
                        throw new Error('Konfi nicht in eigener Organisation gefunden');
                    }
                }

                await client.query('COMMIT');
            } catch (txErr) {
                await client.query('ROLLBACK');
                throw txErr;
            } finally {
                client.release();
            }

            // Badge-Check NACH COMMIT (verwendet db Pool)
            try {
                const newBadges = await checkAndAwardBadges(db, req.params.id);
                if (newBadges > 0) {
                }
            } catch (badgeErr) {
 console.error('Error checking badges after activity:', badgeErr);
                // Don't fail the request if badge checking fails
            }

            res.status(201).json({ message: 'Aktivität erfolgreich hinzugefügt' });

            // Live Update: Notify konfi about dashboard (points) and admins about konfi change
            liveUpdate.sendToUser('konfi', parseInt(req.params.id), 'dashboard', 'update', { points: activity.points });
            liveUpdate.sendToOrgAdmins(req.user.organization_id, 'konfis', 'update', { konfiId: req.params.id });

        } catch (err) {
 console.error('Database error in POST /konfis/:id/activities:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        }
    });

    // DELETE activity for a konfi
    router.delete('/:id/activities/:activityId', rbacVerifier, requireAdmin, async (req, res) => {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // organization_id MUSS mitgeprueft werden: ohne sie fand der SELECT
            // auch Eintraege fremder Organisationen. Der DELETE darunter ist zwar
            // org-gescopt und traf dann 0 Zeilen — das UPDATE auf konfi_profiles
            // lief aber trotzdem und zog dem fremden Konfi Punkte ab
            // 
            const getActivityQuery = `
                SELECT ka.*, a.points, a.type
                FROM user_activities ka
                JOIN activities a ON ka.activity_id = a.id
                JOIN users u ON ka.user_id = u.id
                WHERE ka.id = $1 AND ka.user_id = $2
                  AND ka.organization_id = $3 AND u.organization_id = $3`;
            const { rows: [activity] } = await client.query(getActivityQuery, [req.params.activityId, req.params.id, req.user.organization_id]);

            if (!activity) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Aktivität nicht gefunden' });
            }

            const { rowCount: geloescht } = await client.query(
                'DELETE FROM user_activities WHERE id = $1 AND organization_id = $2',
                [req.params.activityId, req.user.organization_id]
            );
            // Nur dekrementieren, wenn wirklich etwas gelöscht wurde.
            if (geloescht === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Aktivität nicht gefunden' });
            }

            const updateField = getPointField(activity.type);
            const updateQuery = `
                UPDATE konfi_profiles
                SET ${updateField} = GREATEST(0, ${updateField} - $1)
                WHERE user_id = $2`;
            await client.query(updateQuery, [activity.points, req.params.id]);

            await client.query('COMMIT');

            // Badge-Check NACH COMMIT (verwendet db Pool)
            try {
                await checkAndAwardBadges(db, req.params.id);
            } catch (badgeErr) {
 console.error('Error checking badges after activity removal:', badgeErr);
                // Don't fail the request if badge checking fails
            }

            res.json({ message: 'Aktivität erfolgreich gelöscht' });

            // Live Update: Notify konfi about dashboard (points) and admins about konfi change
            liveUpdate.sendToUser('konfi', parseInt(req.params.id), 'dashboard', 'update', { points: -activity.points });
            liveUpdate.sendToOrgAdmins(req.user.organization_id, 'konfis', 'update', { konfiId: req.params.id });

        } catch (err) {
 console.error('Database error in DELETE /konfis/:id/activities/:activityId:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } finally {
            client.release();
        }
    });

    // PUT teamer_since - Aktiv-seit-Datum ändern
    router.put('/:id/teamer-since', rbacVerifier, requireAdmin, validateParamId, async (req, res) => {
        try {
            const { teamer_since } = req.body;
            if (!teamer_since) {
                return res.status(400).json({ error: 'teamer_since ist erforderlich' });
            }
            const result = await db.query(
                'UPDATE users SET teamer_since = $1 WHERE id = $2 AND organization_id = $3 RETURNING teamer_since',
                [teamer_since, req.params.id, req.user.organization_id]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User nicht gefunden' });
            }
            res.json({ teamer_since: result.rows[0].teamer_since });
        } catch (err) {
            console.error('Database error in PUT /konfis/:id/teamer-since:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        }
    });

    // POST promote konfi to teamer
    router.post('/:id/promote-teamer', rbacVerifier, requireAdmin, validateParamId, async (req, res) => {
        const konfiId = parseInt(req.params.id);

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // 1. User existiert in gleicher Organisation und ist Konfi
            const checkUserQuery = `
                SELECT u.id, u.display_name, r.name as role_name
                FROM users u
                JOIN roles r ON u.role_id = r.id
                WHERE u.id = $1 AND u.organization_id = $2
            `;
            const { rows: [user] } = await client.query(checkUserQuery, [konfiId, req.user.organization_id]);

            if (!user) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'User nicht gefunden' });
            }

            if (user.role_name !== 'konfi') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'User ist kein Konfi und kann nicht befördert werden' });
            }

            // 2. Teamer-Role-ID laden (org-spezifisch oder global)
            let teamerRoleQuery = `SELECT id FROM roles WHERE name = 'teamer' AND organization_id = $1`;
            let { rows: [teamerRole] } = await client.query(teamerRoleQuery, [req.user.organization_id]);

            if (!teamerRole) {
                // Fallback: globale Teamer-Rolle
                const globalQuery = `SELECT id FROM roles WHERE name = 'teamer' AND organization_id IS NULL`;
                const { rows: [globalRole] } = await client.query(globalQuery);
                teamerRole = globalRole;
            }

            if (!teamerRole) {
                await client.query('ROLLBACK');
                return res.status(500).json({ error: 'Teamer-Rolle nicht gefunden' });
            }

            // 3. Rolle ändern + teamer_since setzen
            await client.query('UPDATE users SET role_id = $1, teamer_since = CURRENT_DATE WHERE id = $2', [teamerRole.id, konfiId]);

            // 4. Event-Buchungen löschen
            await client.query('DELETE FROM event_bookings WHERE user_id = $1', [konfiId]);

            const { rows: pendingFotos } = await client.query(
                "SELECT photo_filename FROM activity_requests WHERE user_id = $1 AND status = 'pending' AND photo_filename IS NOT NULL",
                [konfiId]
            );
            await client.query("DELETE FROM activity_requests WHERE user_id = $1 AND status = 'pending'", [konfiId]);

            // 6. Jahrgang aus konfi_profiles in user_jahrgang_assignments übertragen
            const { rows: [konfiProfile] } = await client.query(
                'SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1', [konfiId]
            );
            if (konfiProfile && konfiProfile.jahrgang_id) {
                const { rows: [existing] } = await client.query(
                    'SELECT id FROM user_jahrgang_assignments WHERE user_id = $1 AND jahrgang_id = $2',
                    [konfiId, konfiProfile.jahrgang_id]
                );
                if (!existing) {
                    await client.query(
                        'INSERT INTO user_jahrgang_assignments (user_id, jahrgang_id, can_view, can_edit) VALUES ($1, $2, true, true)',
                        [konfiId, konfiProfile.jahrgang_id]
                    );
                }
            }

            // 7. konfi_profiles BLEIBT bestehen
            // 8. user_badges BLEIBEN bestehen
            // 9. Chat-Teilnahmen: user_type aktualisieren damit Räume sichtbar bleiben
            await client.query("UPDATE chat_participants SET user_type = 'teamer' WHERE user_id = $1 AND user_type = 'konfi'", [konfiId]);
            await client.query("UPDATE chat_read_status SET user_type = 'teamer' WHERE user_id = $1 AND user_type = 'konfi'", [konfiId]);


            await client.query('COMMIT');

            // Nachweisfotos der geloeschten Anträge vom Dateisystem entfernen
            // (nach dem COMMIT, fehlertolerant — eine fehlende Datei darf die
            // Beförderung nicht scheitern lassen).
            for (const row of pendingFotos) {
                await deletePhotoFile(row.photo_filename);
            }

            res.json({
                success: true,
                message: 'Konfi wurde zum Teamer befördert',
                user: {
                    id: konfiId,
                    display_name: user.display_name,
                    role_name: 'teamer'
                }
            });

            // Live-Update NACH der Response: Konfi verschwindet aus der Konfi-Liste
            // und taucht als Teamer:in in der Benutzer-Liste auf.
            liveUpdate.sendToOrgAdmins(req.user.organization_id, 'konfis', 'update', { konfiId });
            liveUpdate.sendToOrgAdmins(req.user.organization_id, 'users', 'update', { userId: konfiId });
            // Rollenwechsel: Socket ZULETZT trennen, sonst bleibt die/der
            // Befoerderte im Konfi-Raum hängen und bekommt als Teamer:in gar
            // keine Updates mehr, bis sie/er sich neu anmeldet.
            liveUpdate.disconnectUserSockets(konfiId);

        } catch (err) {
            await client.query('ROLLBACK').catch(rbErr => console.error('Rollback failed:', rbErr));
            console.error('Database error in POST /konfis/:id/promote-teamer:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        } finally {
            client.release();
        }
    });

    return router;
};