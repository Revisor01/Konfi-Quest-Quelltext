const express = require('express');
const bcrypt = require('bcrypt');
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations, getPointField } = require('../middleware/validation');
const { checkPointTypeEnabled } = require('../utils/pointTypeGuard');
const { generateBiblicalPassword } = require('../utils/passwordUtils');
const { generateUniqueUsername } = require('../utils/usernameGenerator');
const { benutzernameSperrenUndPruefen } = require('../utils/benutzernameSperre');
const { kontoDatenLoeschen, kontoDateienLoeschen, meldeNachKontoLoeschung } = require('../utils/kontoLoeschen');
const { invalidateUserCache } = require('../middleware/rbac');
const { deletePhotoFile } = require('../utils/photoStorage');
const { checkKonfiLimit, nextTier } = require('../utils/konfiLimit');
const { syncJahrgangChat } = require('../utils/jahrgangChat');
const { removeFromEventChat, addToEventChat } = require('../utils/eventChat');
const { syncTeamChat } = require('../utils/teamChat');
const chatSyncCache = require('../utils/chatSyncCache');
const { getKonfiBadgeProgress } = require('../utils/konfiBadgeProgress');
// Ein Ort fuer "darf dieser Aufrufer in diesem Jahrgang?" — org_admin und
// super_admin sind ausgenommen, admin und teamer brauchen die Zuweisung.
// Hier immer mit { edit: true }: Anlegen und Verschieben sind Schreibwege.
const { darfJahrgang, darfKonfi } = require('../utils/jahrgangsZugriff');
const { istMitgliedDerOrganisation, ladeRolleInGemeinde } = require('../utils/orgMitglieder');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');
const { rueckeNach } = require('../utils/bookingUtils');
const { meldeNachrueckern } = require('../utils/nachrueckMeldung');
const { loescheMitteilungenZuAntraegen } = require('../utils/postfachAufraeumen');
const { nachAntwort } = require('../utils/nachAntwort');
const { meldePasswortGeaendert } = require('../utils/passwortGeaendertMail');
const { kontoSperreAufheben } = require('../utils/kontoSperre');
const router = express.Router();

// Konfis: Teamer darf ansehen, Admin darf bearbeiten
module.exports = (db, rbacVerifier, { requireAdmin, requireTeamer }, checkAndAwardBadges) => {

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

    const mitgliederSql = `
        SELECT u.id, r.name AS role_name
          FROM users u
          JOIN roles r ON r.id = u.role_id
         WHERE u.organization_id = $1
           AND r.name = ANY($2::text[])
           AND u.deleted_at IS NULL
        UNION
        SELECT u.id, r.name AS role_name
          FROM user_organizations uo
          JOIN users u ON u.id = uo.user_id
          JOIN roles r ON r.id = uo.role_id
         WHERE uo.organization_id = $1
           AND u.organization_id IS DISTINCT FROM $1
           AND r.name = ANY($2::text[])
           AND u.deleted_at IS NULL`;

    // GET all teamers for the admin's organization
    router.get('/teamer', rbacVerifier, requireTeamer, async (req, res) => {
        try {
            const query = `
                WITH mitglieder AS (${mitgliederSql})
                SELECT u.id, u.display_name as name, u.username, u.teamer_since,
                       STRING_AGG(DISTINCT j.name, ', ' ORDER BY j.name) as jahrgang_name,
                       -- ADDITIV: die IDs zu den Namen. Die
                       -- Teilnehmerauswahl am Termin bietet nur Personen aus
                       -- den Jahrgaengen des Termins an und braucht dafuer
                       -- die IDs statt der zusammengefuegten Namen.
                       ARRAY_REMOVE(ARRAY_AGG(DISTINCT j.id), NULL)::int[] as jahrgang_ids,
                       COALESCE(badge_counts.badge_count, 0)::int as badge_count,
                       COALESCE(cert_counts.cert_count, 0)::int as cert_count
                FROM mitglieder m
                JOIN users u ON u.id = m.id
                LEFT JOIN user_jahrgang_assignments uja ON u.id = uja.user_id
                LEFT JOIN jahrgaenge j ON uja.jahrgang_id = j.id AND j.organization_id = $1
                LEFT JOIN (
                    SELECT ub.user_id, COUNT(*) as badge_count
                    FROM user_badges ub
                    JOIN custom_badges cb ON ub.badge_id = cb.id
                    WHERE cb.target_role = 'teamer' AND cb.organization_id = $1
                    GROUP BY ub.user_id
                ) badge_counts ON u.id = badge_counts.user_id
                LEFT JOIN (
                    SELECT user_id, COUNT(*) as cert_count
                    FROM user_certificates
                    WHERE organization_id = $1
                    GROUP BY user_id
                ) cert_counts ON u.id = cert_counts.user_id
                GROUP BY u.id, u.display_name, u.username, u.teamer_since,
                         badge_counts.badge_count, cert_counts.cert_count
                ORDER BY u.display_name
            `;
            const { rows } = await db.query(query, [req.user.organization_id, ['teamer']]);
            res.json(rows);
        } catch (err) {
            console.error('Database error in GET /konfis/teamer:', err);
            res.status(500).json({ error: 'Datenbankfehler' });
        }
    });

    // GET alle Admins/Org-Admins der Organisation.
    //
    // Zweck: Die Leitung soll sich einem Termin ZUORDNEN koennen — wie eine
    // Teamer:in, bewusst und pro Termin — und kommt dadurch in den Chat zum
    // Termin. Ein automatisches Hineinrutschen in jeden Event-Chat ist
    // ausdruecklich NICHT gewollt.
    //
    // Eigene Route statt eines Filter-Parameters an /teamer: Deren Antwort ist
    // ein Vertrag der ausgelieferten Apps (Teamer-Verwaltung), und ein
    // zusaetzlicher Query-Parameter haette dort stillschweigend Admins in
    // Listen gespuelt, die "Teamer:innen" ueberschrieben sind.
    //
    // Keine Zaehler (Abzeichen/Zertifikate): Die Liste dient nur der Auswahl.
    // Ausgeliefert wird nur, was die Auswahl braucht — keine Login-Daten
    // ausser dem username, wie bei /teamer.
    router.get('/leitung', rbacVerifier, requireTeamer, async (req, res) => {
        try {
            // role_name ist die Rolle in DIESER Gemeinde, die
            // Jahrgaenge nur die dieser Gemeinde -- siehe mitgliederSql oben.
            const { rows } = await db.query(
                `WITH mitglieder AS (${mitgliederSql})
                 SELECT u.id, u.display_name as name, u.username, m.role_name,
                        -- ADDITIV: Jahrgaenge und Vollzugriffs-Flag,
                        -- damit die Teilnehmerauswahl am Termin nur Leitung
                        -- aus den Jahrgaengen des Termins anbietet. org_admin
                        -- und super_admin sind davon ausgenommen — das Flag
                        -- steht deshalb mit dabei.
                        u.is_super_admin,
                        ARRAY_REMOVE(ARRAY_AGG(DISTINCT j.id), NULL)::int[] as jahrgang_ids
                   FROM mitglieder m
                   JOIN users u ON u.id = m.id
                   LEFT JOIN user_jahrgang_assignments uja ON uja.user_id = u.id
                   LEFT JOIN jahrgaenge j ON j.id = uja.jahrgang_id AND j.organization_id = $1
                  GROUP BY u.id, u.display_name, u.username, m.role_name, u.is_super_admin
                  ORDER BY u.display_name`,
                [req.user.organization_id, ['admin', 'org_admin']]
            );
            res.json(rows);
        } catch (err) {
            console.error('Database error in GET /konfis/leitung:', err);
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

            let username = await generateUniqueUsername(client, name);
            while (await benutzernameSperrenUndPruefen(client, username)) {
                username = await generateUniqueUsername(client, name);
            }

            // First verify that the jahrgang exists
            const jahrgangCheckQuery = "SELECT id FROM jahrgaenge WHERE id = $1 AND organization_id = $2";
            const { rows: [jahrgangExists] } = await client.query(jahrgangCheckQuery, [jahrgang_id, req.user.organization_id]);

            if (!jahrgangExists) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Jahrgang nicht gefunden oder gehört nicht zu Ihrer Gemeinde' });
            }

            if (!darfJahrgang(req, jahrgang_id, { edit: true })) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
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

            // Ein vorher durchprobierter Benutzername startet frei (Sperre je
            // Konto nach Fehlversuchen, utils/kontoSperre.js).
            await kontoSperreAufheben(client, userId);

            // Jahrgangs-Chat synchronisieren: legt den Chat bei Bedarf an und
            // fuegt den neuen Konfi (sowie weiterhin alle Soll-Mitglieder) hinzu.
            await syncJahrgangChat(client, jahrgang_id, req.user.organization_id, req.user.id);

            // Einschreibung in die kuenftigen Pflicht-Events des Jahrgangs --
            // INNERHALB der Transaktion,
            // wie beim Jahrgangswechsel (PUT unten).
            // Bis dahin lief sie nach dem COMMIT auf dem Pool, Fehler nur ins
            // Log: Scheiterte sie, gab es die Konfi in keinem Pflicht-Event,
            // und die Leitung bekam trotzdem 201 samt Passwort. Jetzt ganz
            // oder gar nicht; ein Fehler endet im catch unten (ROLLBACK, 500).
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
            const { rows: gebucht } = await client.query(enrollFutureEventsQuery, [userId, req.user.organization_id, jahrgang_id]);
            // Auch in die Chats der Pflichttermine eintreten (falls die
            // Leitung dort einen angelegt hat) — sonst fehlt der neue Konfi
            // in Chats, in denen sein ganzer Jahrgang sitzt.
            for (const row of gebucht) {
              await addToEventChat(client, row.event_id, userId, req.user.organization_id);
            }

            await client.query('COMMIT');

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
        const nachgerueckteJahrgang = [];
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
                return res.status(400).json({ error: 'Jahrgang nicht gefunden oder gehört nicht zu Ihrer Gemeinde' });
            }

            if (currentProfile && currentProfile.jahrgang_id
                && !darfJahrgang(req, currentProfile.jahrgang_id, { edit: true })) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
            }
            if (!darfJahrgang(req, jahrgang_id, { edit: true })) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
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
                     RETURNING eb.event_id, eb.status, eb.timeslot_id`,
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

                  // Nur bestaetigte Buchungen geben einen Platz frei; eine
                  // geloeschte Wartelisten-Buchung aendert an der Kapazitaet
                  // nichts. Immer 'konfi' — hier wird ein Konfi verschoben.
                  for (const row of abgemeldet) {
                    if (row.status !== 'confirmed') continue;
                    const [promoted] = await rueckeNach(client, {
                      eventId: row.event_id,
                      timeslotId: row.timeslot_id,
                      seite: 'konfi'
                    });
                    if (promoted) nachgerueckteJahrgang.push({ eventId: row.event_id, userId: promoted });
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
                // (utils/eventChat.js: syncEventChat, gerufen aus
                // routes/events/verwaltung.js). Existiert kein Chat, passiert
                // nichts (Anlage bleibt Sache der Leitung).
                for (const row of gebucht) {
                  await addToEventChat(client, row.event_id, parseInt(req.params.id, 10), req.user.organization_id);
                }
            }

            await client.query('COMMIT');

            res.json({ message: 'Konfi erfolgreich aktualisiert' });

            // Wer nachgerueckt ist, erfaehrt es — nach dem COMMIT.
            await meldeNachrueckern(db, req.user.organization_id, nachgerueckteJahrgang);

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

    router.delete('/:id', rbacVerifier, requireAdmin, validateParamId, async (req, res) => {
        const userId = req.params.id;
        const client = await db.getClient();
        let ergebnis = null;
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

            const loeschZugriff = await darfKonfi(client, req, userId, { edit: true });
            if (!loeschZugriff.erlaubt) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
            }

            ergebnis = await kontoDatenLoeschen(client, userId);

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(rbErr => console.error('Rollback failed:', rbErr));
 console.error('Database error in DELETE /konfis/:id:', err);
            return res.status(500).json({ error: 'Datenbankfehler' });
        } finally {
            client.release();
        }

        // Nach dem COMMIT: erst die Dateien, dann die Antwort. Ein Fehler
        // dabei kippt die festgeschriebene Loeschung nicht (wirft nie).
        await kontoDateienLoeschen(ergebnis?.dateien);
        res.json({ message: 'Konfi erfolgreich gelöscht' });

        // Rechte-Cache leeren: Sonst
        // bediente die laufende Sitzung des geloeschten Kontos die API
        // noch bis zu 30 Sekunden weiter (TTL in rbac.js).
        invalidateUserCache(parseInt(userId));
        // Socket trennen: sonst empfaengt das geloeschte Konto weiter
        // Org-Updates, bis die App neu gestartet wird.
        liveUpdate.disconnectUserSockets(userId);

        nachAntwort(req, async () => {
            await meldeNachKontoLoeschung(db, ergebnis);

            // Live-Update NACH der Response: geloeschter Konfi aus der Admin-Liste entfernen.
            liveUpdate.sendToOrgAdmins(req.user.organization_id, 'konfis', 'delete', { konfiId: userId });
        }, 'DELETE /admin/konfis/:id (Meldungen nach Kontoloeschung)');
    });

    // Regenerate password for a konfi
    router.post('/:id/regenerate-password', rbacVerifier, requireAdmin, validateParamId, async (req, res) => {
        const newPassword = generateBiblicalPassword();
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // Jahrgangs-Bindung: Ein neues Passwort uebernimmt das
            // Konto — das darf nur, wer den Jahrgang des Konfis bearbeiten
            // darf. Vorher genuegte die Organisation; ein Admin konnte damit
            // das Passwort JEDES Konfis der Gemeinde neu setzen und sich als
            // dieser anmelden. Die Rollenpruefung haelt Leitungskonten
            // draussen: Die Route haengt unter /admin/konfis, aktualisierte
            // aber bisher jeden users-Datensatz der Org.
            //
            // Leitungsrollen bleiben ausgeschlossen. Wer ein Leitungspasswort
            // setzen will, nimmt die Benutzerverwaltung — dort ist die
            // Hierarchie geprueft.
            const { rows: [zielPerson] } = await client.query(
                `SELECT u.id, r.name AS rolle FROM users u
                 JOIN roles r ON u.role_id = r.id
                 WHERE u.id = $1 AND u.organization_id = $2
                   AND r.name IN ('konfi', 'teamer') AND u.deleted_at IS NULL`,
                [req.params.id, req.user.organization_id]
            );
            if (!zielPerson) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Person nicht gefunden' });
            }

            // Bei Konfis entscheidet der Jahrgang (darfKonfi). Teamer:innen
            // haengen an mehreren Jahrgaengen oder an keinem — dieselbe
            // Ausnahme wie ueberall sonst ("ein Admin sieht ALLE
            // Teamer:innen", siehe utils/jahrgangsZugriff.js). Fuer sie
            // genuegt deshalb die Organisation, die oben schon geprueft ist.
            if (zielPerson.rolle === 'konfi') {
                const pwZugriff = await darfKonfi(client, req, req.params.id, { edit: true });
                if (!pwZugriff.erlaubt) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
                }
            }

            const updateUserQuery = `
                UPDATE users SET password_hash = $1, token_invalidated_at = NOW()
                WHERE id = $2 AND organization_id = $3`;
            const { rowCount } = await client.query(updateUserQuery, [hashedPassword, req.params.id, req.user.organization_id]);

            if (rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Konfi nicht gefunden' });
            }

            // Refresh-Tokens widerrufen — sonst ist die Invalidierung oben
            // wirkungslos: Der Refresh-Token laeuft 90 Tage und holt laufend
            // frische Access-Tokens.
            await client.query(
                'UPDATE refresh_tokens SET revoked_at = NOW(), expires_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
                [req.params.id]
            );

            // Push-Tokens mitloeschen: Der Versand haengt nur an user_id, nicht
            // an einer gueltigen Sitzung. Ein ausgesperrtes Geraet bekaeme sonst
            // weiter Push-Nachrichten samt Chat-Inhalten.
            await client.query('DELETE FROM push_tokens WHERE user_id = $1', [req.params.id]);


            // Neues Passwort: Eine Sperre nach Fehlversuchen endet damit
            // -- der Weg, den die Leitung geht,
            // wenn ein Kind ausgesperrt ist.
            await kontoSperreAufheben(client, req.params.id);

            await client.query('COMMIT');
            res.json({ message: 'Passwort erfolgreich neu generiert', temporaryPassword: newPassword });

            // Bestaetigung an die hinterlegte Adresse, falls es eine gibt
            // Das Einmalpasswort steht
            // NICHT darin -- die Leitung gibt es persoenlich weiter.
            nachAntwort(req, () => meldePasswortGeaendert(db, parseInt(req.params.id, 10), { durchLeitung: true }),
                'POST /admin/konfis/:id/regenerate-password (Mail)');

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
                       -- Rolle in DIESER Gemeinde: zuhause die am
                       -- Konto, sonst die aus user_organizations. Siehe unten.
                       CASE WHEN u.organization_id = $2 THEN r.name ELSE uo_r.name END as role_name
                FROM users u
                JOIN roles r ON u.role_id = r.id
                LEFT JOIN user_organizations uo
                  ON uo.user_id = u.id AND uo.organization_id = $2
                 AND u.organization_id IS DISTINCT FROM $2
                LEFT JOIN roles uo_r ON uo_r.id = uo.role_id
                -- Das Konfi-Profil nur aus der Stamm-Gemeinde: Eine per
                -- Einladung hier mitarbeitende Teamer:in bringt sonst Punkte
                -- und Jahrgang ihrer Konfi-Zeit aus der anderen Gemeinde mit.
                LEFT JOIN konfi_profiles kp ON u.id = kp.user_id AND u.organization_id = $2
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
                -- Mitglied DIESER Gemeinde: Konfis und Team der
                -- Stamm-Gemeinde wie bisher, dazu Teamer:innen, die per
                -- Einladung hier sind. Seit sie in der Team-Liste stehen
                -- (GET /teamer ueber beide Quellen), fuehrte ihr Eintrag hier
                -- sonst auf 404. Konfis gibt es nur in der Stamm-Gemeinde.
                WHERE u.id = $1 AND u.deleted_at IS NULL
                  AND ((u.organization_id = $2 AND r.name IN ('konfi', 'teamer'))
                       OR uo_r.name = 'teamer')
            `;
            const { rows: [konfi] } = await db.query(konfiQuery, [konfiId, req.user.organization_id]);

            if (!konfi) {
                return res.status(404).json({ error: 'Benutzer nicht gefunden' });
            }

            // Bei Konfis entscheidet der Jahrgang (darfKonfi). Teamer:innen
            // haengen an mehreren Jahrgaengen oder an keinem — dieselbe
            // Ausnahme wie ueberall sonst ("ein Admin sieht ALLE Teamer:innen",
            // siehe utils/jahrgangsZugriff.js). Fuer sie genuegt die
            // Organisation, die die Abfrage oben schon geprueft hat.
            if (konfi.role_name === 'konfi') {
                const zugriff = await darfKonfi(db, req, konfiId);
                if (!zugriff.erlaubt) {
                    return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
                }
            }

            // points = der bei der Vergabe gutgeschriebene Wert (Migration 163),
            // Bestand ohne Wert fällt auf den Wert der Aktivität zurück. Steht
            // BEWUSST hinter ka.* — pg nimmt bei gleichem Feldnamen die letzte
            // Spalte. Feldname und Typ bleiben, die Store-Apps lesen `points`.
            const activitiesQuery = `
                SELECT ka.*, a.name, COALESCE(ka.points, a.points) AS points, a.type, a.target_role, u.display_name as admin_name
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
                  AND cb.organization_id = $3
            `;
            // Nur Badges DIESER Gemeinde -- Badges bleiben an der
            // Gemeinde, in der sie entstanden sind.
            const { rows: [badgeResult] } = await db.query(badgeQuery, [konfiId, konfi.role_name, req.user.organization_id]);

            // Gezaehlt wird GENAU wie im eigenen Profil (challenges.js,
            // GET /challenges/konfi): nur EIGENE und FREIGEGEBENE Beitraege
            // (moderation_status='approved'), nicht jede Challenge, die ein
            // Abzeichen vergibt. Ein Stempel je Challenge, auch bei mehreren
            // freigegebenen Beitraegen — deshalb DISTINCT ueber challenge_id.
            const stempelQuery = `
                SELECT c.id AS challenge_id, c.badge_icon, c.badge_name, c.title,
                       c.description,
                       MIN(COALESCE(s.approved_at, s.created_at)) AS earned_at
                FROM challenge_submissions s
                JOIN challenges c ON c.id = s.challenge_id
                WHERE s.user_id = $1
                  AND s.moderation_status = 'approved'
                  AND c.organization_id = $2
                GROUP BY c.id, c.badge_icon, c.badge_name, c.title, c.description
                ORDER BY c.title
            `;
            const { rows: challengeMarks } = await db.query(stempelQuery, [konfiId, req.user.organization_id]);

            // Gescopet wie die Konfi-Sicht selbst (challenges.js GET /konfi):
            // nur gestartete, keine Entwuerfe, und nur Challenges des eigenen
            // Jahrgangs. Ohne Jahrgang (Teamer:innen haben keinen in
            // konfi_profiles) bleibt die Liste leer statt org-weit zu werden —
            // sonst saehe die Leitung dort Challenges, an denen die Person nie
            // haette teilnehmen koennen.
            //
            // EIGENES FELD, nicht in challengeMarks gemischt: Die Apps im
            // Store zeichnen jeden Eintrag daraus als erhaltenen Stempel.
            let offeneStempel = [];
            if (konfi.jahrgang_id) {
                const offeneQuery = `
                    SELECT c.id AS challenge_id, c.badge_icon, c.badge_name, c.title,
                           c.description,
                           CASE WHEN c.ends_at IS NOT NULL AND c.ends_at < NOW()
                                THEN 'ended' ELSE 'active' END AS status,
                           c.ends_at
                    FROM challenges c
                    JOIN challenge_jahrgang_assignments cja ON cja.challenge_id = c.id
                    WHERE c.organization_id = $2
                      AND cja.jahrgang_id = $3
                      AND c.is_draft = false
                      AND c.starts_at <= NOW()
                      AND c.audience <> 'nur_team'
                      AND c.badge_name IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM challenge_submissions s
                        WHERE s.challenge_id = c.id AND s.user_id = $1
                          AND s.moderation_status = 'approved'
                      )
                    ORDER BY c.title
                `;
                const { rows } = await db.query(offeneQuery,
                    [konfiId, req.user.organization_id, konfi.jahrgang_id]);
                offeneStempel = rows;
            }

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
                    SELECT ka.id, a.name as title, COALESCE(ka.points, a.points) AS points, a.type as category,
                           ka.completed_date as date, 'activity' as source_type,
                           NULL::timestamptz as event_date
                    FROM user_activities ka
                    JOIN activities a ON ka.activity_id = a.id
                    WHERE ka.user_id = $1 AND ka.organization_id = $2
                    ORDER BY ka.completed_date DESC
                `;
                const { rows: histAct } = await db.query(histActivities, [konfiId, req.user.organization_id]);

                const histBonus = `
                    SELECT id, description as title, points, type as category,
                           completed_date as date, 'bonus' as source_type,
                           NULL::timestamptz as event_date
                    FROM bonus_points
                    WHERE konfi_id = $1 AND organization_id = $2
                    ORDER BY completed_date DESC
                `;
                const { rows: histBon } = await db.query(histBonus, [konfiId, req.user.organization_id]);

                const histEvents = `
                    SELECT ep.id, e.name as title, ep.points, ep.point_type as category,
                           ep.awarded_date as date, 'event' as source_type,
                           e.event_date
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
                // Neues Feld, additiv: alte App-Versionen lesen es
                // nicht, nichts Bestehendes faellt weg oder aendert den Typ.
                challengeMarks,
                // Ebenfalls additiv: die grauen Stempel.
                offeneStempel,
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
            // Jahrgangs-Bindung: Bisher genuegte die Organisation —
            // jede:r Teamer:in und jeder Admin konnte die Event-Punkte JEDES
            // Konfis der Gemeinde abrufen. Gleiche Stufe (view) wie die
            // Detailansicht GET /:id, die dieselben Daten zeigt.
            const zugriff = await darfKonfi(db, req, konfiId);
            if (!zugriff.gefunden) {
                return res.status(404).json({ error: 'Konfi nicht gefunden' });
            }
            if (!zugriff.erlaubt) {
                return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
            }

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
            // Konfi IN DIESER GEMEINDE (Badge-Progress ist konfi-spezifisch;
            // Teamer haben eigene Badges über teamer.js). BEIDE QUELLEN
            // die Rolle in dieser Gemeinde -- users.role_id
            // zuhause, user_organizations.role_id in einer weiteren
            // (ladeRolleInGemeinde, prueft auch deleted_at) -- und das Profil
            // hier (darfKonfi). Vorher `u.organization_id = aktive Gemeinde`
            // mit der Rolle am Konto: Eine Konfi, die ueber
            // user_organizations hier Konfi ist, bekam 404, waehrend
            // /:id/event-points (nur darfKonfi) fuer sie antwortete.
            const rolleHier = await ladeRolleInGemeinde(db, konfiId, req.user.organization_id);
            const zugriff = rolleHier === 'konfi'
                ? await darfKonfi(db, req, konfiId)
                : { gefunden: false, erlaubt: false };

            if (!zugriff.gefunden) {
                return res.status(404).json({ error: 'Konfi nicht gefunden' });
            }

            // Jahrgangs-Bindung: Abzeichen samt Fortschritt sind
            // Konfi-Daten — sichtbar nur, wer den Jahrgang sehen darf (view),
            // wie die Detailansicht GET /:id. org_admin bleibt ausgenommen.
            if (!zugriff.erlaubt) {
                return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
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
            // Jahrgangs-Bindung: Die Anwesenheitsstatistik listet
            // verpasste Pflichttermine samt Entschuldigungsgruenden — Konfi-
            // Daten, die nur sehen darf, wer den Jahrgang sehen darf (view).
            //
            // Konfi einer anderen Gemeinde -> 404.
            // Vorher las die Route konfi_profiles ohne Gemeinde:
            // Eine fremde Kennung ergab 403 statt 404 und verriet damit, dass
            // es sie gibt. darfKonfi sucht nur in der aktiven Gemeinde und
            // liefert den Jahrgang gleich mit (wie GET /:id/event-points).
            const zugriff = await darfKonfi(db, req, konfiId);
            if (!zugriff.gefunden) {
                return res.status(404).json({ error: 'Konfi nicht gefunden' });
            }
            if (!zugriff.erlaubt) {
                return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
            }

            const jahrgangId = zugriff.jahrgangId;

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
            const zugriff = await darfKonfi(db, req, req.params.id);
            if (!zugriff.gefunden) {
                return res.status(404).json({ error: 'Konfi nicht gefunden' });
            }
            if (!zugriff.erlaubt) {
                return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
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
                await checkAndAwardBadges(db, req.params.id, { organizationId: req.user.organization_id });
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

            // Jahrgangs-Bindung: Loeschen zieht dem Konfi Punkte
            // ab — gleiche Stufe (view) wie das Vergeben (POST bonus-points),
            // damit Vergeben und Zuruecknehmen nicht auseinanderlaufen.
            const zugriff = await darfKonfi(client, req, req.params.id);
            if (!zugriff.erlaubt) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
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
                await checkAndAwardBadges(db, req.params.id, { organizationId: req.user.organization_id });
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

            if (isTeamerActivity) {
                // GEMEINDEGRENZE AUCH FUER TEAMER-AKTIVITAETEN.
                // Der Konfi-Zweig unten prueft
                // die Zielperson ueber darfKonfi; dieser Zweig pruefte sie gar
                // nicht (keine Punkte, kein Jahrgang). Eine Leitung der
                // Gemeinde A haengte so einer Teamer:in der Gemeinde B eine
                // Zuordnung an und loeste deren Abzeichenlauf aus. Jetzt wie
                // assign-activity (activities.js) -> 404, aber ueber BEIDE
                // Quellen der Zugehoerigkeit: Wer ueber user_organizations in
                // dieser Gemeinde mitarbeitet, bekommt die Aktivitaet weiter.
                if (!(await istMitgliedDerOrganisation(db, req.params.id, req.user.organization_id))) {
                    return res.status(404).json({ error: 'Person nicht gefunden' });
                }
            }

            if (!isTeamerActivity) {
                // Jahrgangs-Bindung: dieselbe Pruefung wie
                // assign-activity (activities.js) und bonus-points — vergeben
                // darf nur, wer den Konfi sehen darf (view). Teamer-
                // Aktivitaeten (target_role='teamer') bleiben ausgenommen:
                // Teamer:innen sieht ein Admin laut Regel alle.
                const zugriff = await darfKonfi(db, req, req.params.id);
                if (!zugriff.gefunden) {
                    return res.status(404).json({ error: 'Konfi nicht gefunden' });
                }
                if (!zugriff.erlaubt) {
                    return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
                }

                // Guard: Punkte-Typ muss für den Jahrgang aktiviert sein
                const { enabled: ptEnabled, error: ptError } = await checkPointTypeEnabled(db, req.params.id, activity.type);
                if (!ptEnabled) return res.status(400).json({ error: ptError });
            }

            const client = await db.getClient();
            try {
                await client.query('BEGIN');

                // points: Wert der Aktivität zum Zeitpunkt der Vergabe, am Beleg
                // festgehalten.
                const query = `
                    INSERT INTO user_activities (user_id, activity_id, completed_date, comment, admin_id, organization_id, created_at, points)
                    VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`;
                await client.query(query, [req.params.id, activity_id, completed_date, comment || '', req.user.id, req.user.organization_id, activity.points]);

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
                await checkAndAwardBadges(db, req.params.id, { organizationId: req.user.organization_id });
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
            // points = was bei der Vergabe gutgeschrieben wurde (Migration 163),
            // nicht der aktuelle Wert der Aktivität — sonst zieht das Löschen
            // nach einer Änderung des Punktwerts zu viel oder zu wenig ab
            // Bestand ohne Wert: a.points wie vorher.
            const getActivityQuery = `
                SELECT ka.*, COALESCE(ka.points, a.points) AS points, a.type, a.target_role
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

            // Jahrgangs-Bindung: Loeschen zieht Punkte ab —
            // gleiche Stufe (view) wie das Vergeben (POST /:id/activities).
            // Teamer-Aktivitaeten bleiben ausgenommen (Teamer-Ausnahme).
            if (activity.target_role !== 'teamer') {
                const zugriff = await darfKonfi(client, req, req.params.id);
                if (!zugriff.erlaubt) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
                }
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

            // Punkte nur abziehen, wenn es welche gab. Teamer-Aktivitaeten
            // haben keinen Punktetyp und 0 Punkte — getPointField() kennt nur
            // 'gottesdienst' und 'gemeinde' und warf hier bedingungslos
            // 'Ungueltiger Punktetyp'. Die Route antwortete dadurch mit 500,
            // und KEINE Teamer-Aktivitaet liess sich loeschen.
            // Dieselbe
            // Fallunterscheidung steht beim Vergeben schon
            // (POST /:id/activities oben und activities.js) — nur das
            // Zuruecknehmen wurde nicht mitgedacht.
            const istTeamerAktivitaet = activity.target_role === 'teamer';
            if (!istTeamerAktivitaet && activity.points && activity.type) {
                const updateField = getPointField(activity.type);
                const updateQuery = `
                    UPDATE konfi_profiles
                    SET ${updateField} = GREATEST(0, ${updateField} - $1)
                    WHERE user_id = $2`;
                await client.query(updateQuery, [activity.points, req.params.id]);
            }

            await client.query('COMMIT');

            // Badge-Check NACH COMMIT (verwendet db Pool)
            try {
                await checkAndAwardBadges(db, req.params.id, { organizationId: req.user.organization_id });
            } catch (badgeErr) {
 console.error('Error checking badges after activity removal:', badgeErr);
                // Don't fail the request if badge checking fails
            }

            res.json({ message: 'Aktivität erfolgreich gelöscht' });

            // Live Update: Die Punktemeldung nur, wenn sich wirklich Punkte
            // geaendert haben. Teamer:innen haben kein Punktekonto — eine
            // Meldung 'points: -0' wuerde dort eine Aenderung vortaeuschen,
            // die es nicht gibt. Die Listen-Aktualisierung fuer die Admins
            // geht in beiden Faellen raus.
            if (!istTeamerAktivitaet && activity.points) {
                liveUpdate.sendToUser('konfi', parseInt(req.params.id), 'dashboard', 'update', { points: -activity.points });
            }
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

    // Dauerhafte Kopie der Konfi-Zeit (utils/konfiHistorie.js, Migration 170).
    // Hier und nicht oben bei den Importen: Die Datei teilen sich zwei
    // Arbeitsstraenge, die Befoerderung ist die einzige Nutzerin.
    const { legeKonfiHistorieAn } = require('../utils/konfiHistorie');

    // POST promote konfi to teamer
    router.post('/:id/promote-teamer', rbacVerifier, requireAdmin, validateParamId, async (req, res) => {
        const konfiId = parseInt(req.params.id);

        const client = await db.getClient();
        const nachgerueckteBefoerderung = [];
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

            // Jahrgangs-Bindung: Befoerdern veraendert den Konfi
            // grundlegend (Rolle, Buchungen und offene Antraege werden
            // geloescht) — das darf nur, wer den Jahrgang des Konfis
            // bearbeiten darf (edit). org_admin/super_admin ausgenommen.
            const befoerderungsZugriff = await darfKonfi(client, req, konfiId, { edit: true });
            if (!befoerderungsZugriff.erlaubt) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Kein Zugriff auf diesen Konfi' });
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

            await legeKonfiHistorieAn(client, konfiId, req.user.organization_id, {
                anlass: 'befoerderung',
                erstelltVon: req.user.id
            });

            // 3. Rolle ändern + teamer_since setzen
            await client.query('UPDATE users SET role_id = $1, teamer_since = CURRENT_DATE WHERE id = $2', [teamerRole.id, konfiId]);
            await client.query(
                'UPDATE user_organizations SET role_id = $1 WHERE user_id = $2 AND organization_id = $3',
                [teamerRole.id, konfiId, req.user.organization_id]
            );

            // 4. Event-Buchungen löschen.
            //
            // seite: 'konfi' ist hier FEST verdrahtet und nicht aus der Rolle
            // abgeleitet: Die Rolle ist eine Zeile weiter oben schon auf
            // 'teamer' gewechselt. Die Plaetze, die gleich frei werden, waren
            // aber Konfi-Plaetze -- die Person hat sie als Konfi belegt. Aus
            // der neuen Rolle zu schliessen hiesse, einen Konfi-Platz an eine
            // wartende Teamer:in zu geben.
            const { rows: freiwerdend } = await client.query(
                "SELECT event_id, timeslot_id FROM event_bookings WHERE user_id = $1 AND status = 'confirmed'",
                [konfiId]
            );
            // Alle Termine mit einer Buchung, gleich welcher Status -- ihre
            // Termin-Chats verlaesst die Person in Schritt 9b.
            const { rows: gebuchteTermine } = await client.query(
                'SELECT DISTINCT event_id FROM event_bookings WHERE user_id = $1',
                [konfiId]
            );
            await client.query('DELETE FROM event_bookings WHERE user_id = $1', [konfiId]);
            for (const platz of freiwerdend) {
                const [promoted] = await rueckeNach(client, {
                    eventId: platz.event_id,
                    timeslotId: platz.timeslot_id,
                    seite: 'konfi'
                });
                if (promoted) nachgerueckteBefoerderung.push({ eventId: platz.event_id, userId: promoted });
            }

            const { rows: offeneAntraege } = await client.query(
                "SELECT id, photo_filename FROM activity_requests WHERE user_id = $1 AND status = 'pending'",
                [konfiId]
            );
            const pendingFotos = offeneAntraege.filter(a => a.photo_filename);
            await client.query("DELETE FROM activity_requests WHERE user_id = $1 AND status = 'pending'", [konfiId]);
            // Postfach: Die Mitteilungen zu den geloeschten
            // offenen Antraegen gehen mit -- "Neuer Antrag eingegangen" bei
            // der Leitung und "Antrag eingereicht" bei der befoerderten
            // Person (utils/postfachAufraeumen.js).
            await loescheMitteilungenZuAntraegen(client, offeneAntraege.map(a => a.id));

            // 6. KEINE automatische Jahrgangs-Zuweisung mehr.
            //
            // Bis dahin wurde der Konfi-Jahrgang hier automatisch nach
            // user_jahrgang_assignments uebertragen — mit can_view UND
            // can_edit. Die frisch befoerderte Person sah damit sofort alle
            // Konfis ihres alten Jahrgangs (die eigene Peergroup) samt
            // Punkten, Antraegen und Anwesenheiten und durfte dort sogar
            // bearbeiten — ohne dass irgendjemand das entschieden haette.

            // 7. konfi_profiles BLEIBT bestehen
            // 8. user_badges BLEIBEN bestehen
            // 9. Chat-Teilnahmen: user_type aktualisieren damit Räume sichtbar bleiben
            await client.query("UPDATE chat_participants SET user_type = 'teamer' WHERE user_id = $1 AND user_type = 'konfi'", [konfiId]);
            await client.query("UPDATE chat_read_status SET user_type = 'teamer' WHERE user_id = $1 AND user_type = 'konfi'", [konfiId]);

            const { rows: [altesProfil] } = await client.query(
                'SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1',
                [konfiId]
            );
            if (altesProfil?.jahrgang_id) {
                await syncJahrgangChat(client, altesProfil.jahrgang_id, req.user.organization_id, req.user.id);
            }
            for (const { event_id: eventId } of gebuchteTermine) {
                await removeFromEventChat(client, eventId, konfiId, req.user.organization_id);
            }
            await syncTeamChat(client, req.user.organization_id, req.user.id);


            await client.query('COMMIT');
            // Der naechste GET /chat/rooms gleicht mit der neuen Rolle ab.
            chatSyncCache.invalidate(req.user.organization_id, konfiId);

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

            // Wer nachgerueckt ist, erfaehrt es — nach dem COMMIT und
            // fehlertolerant: Ein Push-Fehler darf die Befoerderung nicht kippen.
            await meldeNachrueckern(db, req.user.organization_id, nachgerueckteBefoerderung);

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