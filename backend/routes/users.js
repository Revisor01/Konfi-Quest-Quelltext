const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations } = require('../middleware/validation');
const { checkUserHierarchy, filterUsersByHierarchy, istSuperAdminKonto } = require('../utils/roleHierarchy');
const { validatePassword } = require('../utils/passwordUtils');
const { generateUniqueUsername } = require('../utils/usernameGenerator');
const { invalidateUserCache } = require('../middleware/rbac');
const { syncJahrgangChat } = require('../utils/jahrgangChat');
const { darfJahrgang } = require('../utils/jahrgangsZugriff');
const { syncTeamChat } = require('../utils/teamChat');
const chatSyncCache = require('../utils/chatSyncCache');
const { kontoDatenLoeschen, kontoDateienLoeschen, meldeNachKontoLoeschung } = require('../utils/kontoLoeschen');
const liveUpdate = require('../utils/liveUpdate');
const { nachAntwort } = require('../utils/nachAntwort');
const { meldePasswortGeaendert } = require('../utils/passwortGeaendertMail');
const { kontoSperreAufheben } = require('../utils/kontoSperre');
const { benutzernameSperrenUndPruefen, MELDUNG_VERGEBEN } = require('../utils/benutzernameSperre');
const { gemeindeZugehoerigkeitRaeumen, inWeitereGemeindeUmziehen } = require('../utils/mitgliedschaftEnde');
const { pruefeKonfiOderTeam } = require('../utils/konfiOderTeam');

// User management routes
// WICHTIGER HINWEIS: Das übergebene 'db'-Objekt ist eine PostgreSQL Pool-Instanz.
// Transaktionen verwenden einen dedizierten Client via db.getClient() (pool.connect()).
// Users: Nur org_admin darf verwalten
module.exports = (db, rbacVerifier, { requireOrgAdmin, requireAdmin }, io) => {

  // Validierungsregeln
  const validateCreateUser = [
    // username optional: Fehlt er, wird er aus display_name erzeugt — wie bei
    // Konfis (konfi-management.js:154). Wird einer mitgeschickt, gelten die
    // gewohnten Zeichenregeln.
    body('username').optional({ checkFalsy: true })
      .isLength({ min: 3, max: 50 }).withMessage('Benutzername muss zwischen 3 und 50 Zeichen lang sein')
      .matches(/^[a-zA-Z0-9.-]+$/).withMessage('Benutzername darf nur Buchstaben, Zahlen, Punkt (.) und Bindestrich (-) enthalten'),
    body('display_name').trim().notEmpty().withMessage('Anzeigename ist erforderlich'),
    commonValidations.password,
    body('role_id').isInt({ min: 1 }).withMessage('Ungültige Rollen-ID'),
    handleValidationErrors
  ];

  const validateUpdateUser = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    // Gleiche Zeichenregeln wie beim Anlegen (commonValidations.username) —
    // sonst kann ein Update Usernamen mit Leerzeichen/Sonderzeichen einschleusen.
    body('username').optional()
      .isLength({ min: 3, max: 50 }).withMessage('Benutzername muss zwischen 3 und 50 Zeichen lang sein')
      .matches(/^[a-zA-Z0-9.-]+$/).withMessage('Benutzername darf nur Buchstaben, Zahlen, Punkt (.) und Bindestrich (-) enthalten — keine Leerzeichen oder anderen Sonderzeichen'),
    body('display_name').optional().trim().notEmpty().withMessage('Anzeigename darf nicht leer sein'),
    handleValidationErrors
  ];

  const validateUserId = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors
  ];

  const validateResetPassword = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('password').isLength({ min: 8 }).withMessage('Passwort muss mindestens 8 Zeichen lang sein'),
    handleValidationErrors
  ];

  const validateJahrgangAssignments = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('jahrgang_assignments').isArray().withMessage('jahrgang_assignments muss ein Array sein'),
    handleValidationErrors
  ];

  // Hierarchie-Middleware mit DB-Zugriff
  // Diese Middleware erfordert eine Modifikation in der checkUserHierarchy-Funktion,
  // um asynchron zu sein und das db-Objekt korrekt zu verwenden, falls es dort
  // ebenfalls Datenbankabfragen durchführt. Hier wird angenommen, dass die
  // Übergabe von req.db ausreicht.
  const userHierarchyMiddleware = (operation) => {
    return (req, res, next) => {
      // Das 'db' Objekt wird hier explizit an den Request angehängt.
      // In einer Express-Anwendung ist es oft besser, die DB-Verbindung
      // über eine dedizierte Middleware am Anfang der Kette bereitzustellen.
      req.db = db;
      return checkUserHierarchy(operation)(req, res, next);
    };
  };

  // Get users in current organization
  // Auch die Liste: Wer Teamer:innen anlegen darf, muss sie sehen koennen.
  // can_edit pro Zeile kommt weiterhin aus der Hierarchie -- ein Admin sieht
  // org_admins in der Liste, kann sie aber nicht bearbeiten.
  router.get('/', rbacVerifier, requireAdmin, async (req, res) => {
    const organizationId = req.user.organization_id;

    // BEIDE Quellen der Zugehoerigkeit.
    // Bis dahin stand hier allein `u.organization_id = $1`: Wer ueber eine
    // Gemeinde-Einladung (user_organizations) hier mitarbeitet, fehlte in
    // "Benutzer:innen" -- der einzige Weg zur Detailansicht, zur Rolle und
    // zu den Jahrgaengen. Eine eingeladene Admin hatte so nie einen Jahrgang,
    // eine eingeladene Teamer:in erreichte keine Konfi. Detailroute,
    // Jahrgangszuweisung und checkUserHierarchy kannten beide Quellen
    // laengst; die Liste nicht.
    //
    // Die Rolle ist die DIESER Gemeinde (uo.role_id fuer Zusatzmitglieder),
    // die Jahrgaenge zaehlen nur die dieser Gemeinde (j.organization_id),
    // und `mitgliedschaft` ('stamm' | 'weitere') sagt der Oberflaeche, was
    // hier verwaltbar ist: in einer weiteren Gemeinde nur Rolle und
    // Jahrgaenge (PUT/DELETE unten). Additives Feld -- die Antwortform der
    // Store-Apps bleibt.
    const query = `
      WITH mitglieder AS (
        SELECT u.id, u.role_id, 'stamm'::text AS mitgliedschaft
          FROM users u
         WHERE u.organization_id = $1
        UNION ALL
        SELECT uo.user_id AS id, uo.role_id, 'weitere'::text AS mitgliedschaft
          FROM user_organizations uo
          JOIN users u ON u.id = uo.user_id
         WHERE uo.organization_id = $1 AND u.organization_id <> $1
      )
      SELECT u.id, u.username, u.email, u.display_name, u.role_title, u.is_active,
             u.last_login_at, u.created_at, u.updated_at,
             r.name as role_name, r.display_name as role_display_name,
             r.description as role_description,
             m.mitgliedschaft,
             COUNT(DISTINCT j.id) as assigned_jahrgaenge_count,
             (SELECT COUNT(*)::int
                FROM user_organizations uw
               WHERE uw.user_id = u.id
                 AND uw.organization_id <> $1
                 AND uw.organization_id <> u.organization_id)
             + CASE WHEN u.organization_id <> $1 THEN 1 ELSE 0 END AS weitere_gemeinden
      FROM mitglieder m
      JOIN users u ON u.id = m.id
      LEFT JOIN roles r ON r.id = m.role_id
      LEFT JOIN user_jahrgang_assignments uja ON uja.user_id = u.id
      LEFT JOIN jahrgaenge j ON j.id = uja.jahrgang_id AND j.organization_id = $1
      WHERE r.name NOT IN ('konfi', 'super_admin')
      GROUP BY u.id, r.name, r.display_name, r.description, m.mitgliedschaft
      ORDER BY u.created_at DESC
    `;

    try {
      const { rows: users } = await db.query(query, [organizationId]);

      // Markiere Users als editierbar basierend auf Hierarchie statt sie zu filtern
      const usersWithEditability = users.map(user => ({
        ...user,
        can_edit: filterUsersByHierarchy([user], req.user.role_name).length > 0
      }));
      res.json(usersWithEditability);

    } catch (err) {
 console.error('Database error in GET /users:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get single user with details
  router.get('/:id', rbacVerifier, requireAdmin, userHierarchyMiddleware('view'), async (req, res) => {
    const { id } = req.params;
    const organizationId = req.user.organization_id;

    // Beide Quellen der Zugehoerigkeit, wie in
    // checkUserHierarchy: sonst waere eine Person aus user_organizations zwar
    // verwaltbar, aber nicht anzeigbar -- die Oberflaeche laedt diese Route,
    // bevor sie Jahrgaenge zuweisen laesst. Die Rolle wird dabei fuer DIESE
    // Gemeinde aufgeloest (uo.role_id), damit die Anzeige nicht die Rolle der
    // Stamm-Gemeinde behauptet.
    const userQuery = `
      SELECT u.id, u.username, u.email, u.display_name, u.role_title, u.is_active,
             u.last_login_at, u.created_at, u.updated_at,
             COALESCE(uo.role_id, u.role_id) as role_id,
             r.name as role_name, r.display_name as role_display_name,
             CASE WHEN u.organization_id = $2 THEN 'stamm' ELSE 'weitere' END AS mitgliedschaft
      FROM users u
      LEFT JOIN user_organizations uo
             ON uo.user_id = u.id AND uo.organization_id = $2
                AND u.organization_id <> $2
      LEFT JOIN roles r ON r.id = COALESCE(uo.role_id, u.role_id)
      WHERE u.id = $1 AND (u.organization_id = $2 OR uo.organization_id = $2)
    `;

    // Nur die Jahrgaenge DIESER Gemeinde. Ohne den Filter zeigte
    // die Detailansicht einer Person, die in mehreren Gemeinden arbeitet, auch
    // deren Jahrgaenge aus den anderen -- die Schwester-Route
    // GET /:id/jahrgaenge filtert seit jeher ueber j.organization_id.
    const jahrgaengeQuery = `
      SELECT j.id, j.name, uja.can_view, uja.can_edit, uja.assigned_at,
             assigner.display_name as assigned_by_name
      FROM user_jahrgang_assignments uja
      JOIN jahrgaenge j ON uja.jahrgang_id = j.id
      LEFT JOIN users assigner ON uja.assigned_by = assigner.id
      WHERE uja.user_id = $1 AND j.organization_id = $2
      ORDER BY j.name
    `;

    try {
      const { rows: [user] } = await db.query(userQuery, [id, organizationId]);

      if (!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      const { rows: jahrgaenge } = await db.query(jahrgaengeQuery, [id, organizationId]);

      res.json({
        ...user,
        assigned_jahrgaenge: jahrgaenge
      });

    } catch (err) {
 console.error('Database error in GET /users/%s:', id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  router.post('/', rbacVerifier, requireAdmin, userHierarchyMiddleware('create'), validateCreateUser, async (req, res) => {
    const organizationId = req.user.organization_id;
    const { username: gewuenschterName, email, display_name, role_title, password, role_id } = req.body;

    if (!display_name || !password || !role_id) {
      return res.status(400).json({ error: 'Name, Passwort und Rolle sind erforderlich' });
    }

    try {
      const nameErzeugt = !(gewuenschterName && gewuenschterName.trim());
      let username = nameErzeugt
        ? await generateUniqueUsername(db, display_name)
        : gewuenschterName.trim();

      if (!username) {
        return res.status(400).json({ error: 'Aus dem Namen liess sich kein Benutzername bilden' });
      }

      // Verify role exists in organization (name wird unten für den Chat-Sync gebraucht)
      const roleCheckQuery = "SELECT id, name FROM roles WHERE id = $1 AND organization_id = $2";
      const { rows: [role] } = await db.query(roleCheckQuery, [role_id, organizationId]);

      if (!role) {
        return res.status(400).json({ error: 'Ungültige Rolle für diese Gemeinde' });
      }

      // Passwort-Policy und Hash VOR der Transaktion (bcrypt belegt sonst die
      // Verbindung); gemeldet wird ein Policy-Fehler wie bisher erst nach der
      // Namenspruefung.
      const passwordError = validatePassword(password);
      const passwordHash = passwordError ? null : await bcrypt.hash(password, 10);

      const client = await db.getClient();
      let newUser;
      try {
        await client.query('BEGIN');
        while (await benutzernameSperrenUndPruefen(client, username)) {
          if (!nameErzeugt) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: MELDUNG_VERGEBEN });
          }
          // Einen erzeugten Namen hat eine gleichzeitige Anlage eben vergeben:
          // den naechsten freien nehmen (anna.muster -> anna.muster2).
          username = await generateUniqueUsername(client, display_name);
        }

        if (passwordError) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: passwordError });
        }

        const insertQuery = `
          INSERT INTO users (organization_id, username, email, display_name, role_title, password_hash, role_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `;
        const insertParams = [organizationId, username, email, display_name, role_title || null, passwordHash, role_id];
        ({ rows: [newUser] } = await client.query(insertQuery, insertParams));
        // Ein vorher durchprobierter Benutzername startet frei (utils/kontoSperre.js).
        await kontoSperreAufheben(client, newUser.id);
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      res.status(201).json({
        id: newUser.id,
        message: 'Benutzer erfolgreich erstellt',
        username,
        display_name
      });

      // Live-Update NACH der Response: neuer Benutzer in der Benutzer-Liste.
      liveUpdate.sendToOrgAdmins(organizationId, 'users', 'create', { userId: newUser.id });

      // Chat-Mitgliedschaft INLINE pflegen (der TTL-Sync-Cache verlässt sich
      // darauf, dass Mutations-Handler das tun — sonst erscheinen neue
      // Teamer:innen/Admins erst nach bis zu 10 Minuten im Team-Chat).
      if (['org_admin', 'admin', 'teamer'].includes(role.name)) {
        try {
          await syncTeamChat(db, organizationId, req.user.id);
          // Org-Admins sind ausserdem in ALLEN Jahrgangs-Chats der Org.
          if (role.name === 'org_admin') {
            const { rows: jgs } = await db.query(
              'SELECT id FROM jahrgaenge WHERE organization_id = $1', [organizationId]
            );
            for (const jg of jgs) {
              await syncJahrgangChat(db, jg.id, organizationId, req.user.id);
            }
          }
        } catch (syncErr) {
          console.error('Chat-Sync nach Benutzer-Anlage fehlgeschlagen:', syncErr.message);
        }
      }

    } catch (err) {
      // '23505' is the code for unique_violation in PostgreSQL
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Benutzername oder E-Mail existiert bereits' });
      }
 console.error('Database error in POST /users:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Update user
  router.put('/:id', rbacVerifier, requireAdmin, userHierarchyMiddleware('update'), validateUpdateUser, async (req, res) => {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    const { username, email, display_name, role_title, role_id, is_active, password } = req.body;

    try {
      // Gehoert die Person zu dieser Gemeinde? BEIDE Quellen:
      // Stamm-Gemeinde am Konto ODER Mitglied
      // ueber user_organizations. `stamm` entscheidet unten, WAS hier
      // geaendert werden darf.
      const { rows: [user] } = await db.query(
        `SELECT u.id, u.username, u.email, u.display_name, u.role_title, u.is_active,
                (u.organization_id = $2) AS stamm
           FROM users u
          WHERE u.id = $1
            AND (u.organization_id = $2
                 OR EXISTS (SELECT 1 FROM user_organizations uo
                             WHERE uo.user_id = u.id AND uo.organization_id = $2))`,
        [id, organizationId]
      );
      if (!user) {
        return res.status(404).json({ error: 'Benutzer in dieser Gemeinde nicht gefunden' });
      }

      // Verify role exists in organization if role_id is provided
      let neueRolle = null;
      if (role_id) {
        const { rows: [role] } = await db.query("SELECT id, name FROM roles WHERE id = $1 AND organization_id = $2", [role_id, organizationId]);
        if (!role) {
          return res.status(400).json({ error: 'Ungültige Rolle für diese Gemeinde' });
        }
        neueRolle = role;
      }

      // IN EINER WEITEREN GEMEINDE NUR DIE ROLLE. Name, Benutzername, E-Mail,
      // Passwort und Sperre haengen am Konto und damit an der Stamm-Gemeinde
      // -- sonst koennte die Leitung von Gemeinde B ueber das Passwort einer
      // eingeladenen Teamer:in in deren Stamm-Gemeinde A hineinkommen
      // Unveraenderte Kontofelder
      // duerfen mitkommen, weil die Oberflaeche das ganze Formular schickt;
      // ein geaenderter Wert ist ein 400, kein stilles Weglassen.
      if (!user.stamm) {
        const lesart = (v) => (typeof v === 'string' ? (v.trim() || null) : (v ?? null));
        const gleich = (neu, alt) => neu === undefined || lesart(neu) === lesart(alt);
        const kontoUnveraendert =
          gleich(username, user.username) && gleich(email, user.email) &&
          gleich(display_name, user.display_name) && gleich(role_title, user.role_title) &&
          gleich(is_active, user.is_active) && !password;
        if (!kontoUnveraendert) {
          return res.status(400).json({
            error: 'In einer weiteren Gemeinde lässt sich nur die Rolle ändern. Name, Benutzername, E-Mail, Passwort und Sperre verwaltet die Stamm-Gemeinde.',
            error_code: 'nur_rolle_in_weiterer_gemeinde'
          });
        }
        if (role_id === undefined) {
          return res.status(400).json({ error: 'Keine Felder zum Aktualisieren' });
        }
      }

      // KONFI UND TEAM NIE ZUGLEICH, auch nicht ueber
      // Gemeindegrenzen: In einer weiteren Gemeinde gibt es keine Konfis, und
      // zuhause wird nur Konfi, wer keine weitere Gemeinde hat. Bis dahin
      // schrieb dieser Weg jede Rolle der Gemeinde -- die Oberflaeche bietet
      // die Konfi-Rolle nicht an, der Server liess sie aber zu.
      if (neueRolle) {
        const konflikt = await pruefeKonfiOderTeam(db, { userId: id, organizationId, rolle: neueRolle.name });
        if (konflikt) {
          return res.status(409).json(konflikt);
        }
      }

      let updateParams = [];
      let updateFields = [];

      function addUpdate(field, value) {
        if (value !== undefined) {
          updateFields.push(`${field} = $${updateParams.length + 1}`);
          updateParams.push(value);
        }
      }

      addUpdate('username', username);
      addUpdate('email', email);
      addUpdate('display_name', display_name);
      addUpdate('role_title', role_title);
      addUpdate('role_id', role_id);
      addUpdate('is_active', is_active);

      if (password) {
        // Policy auch beim Bearbeiten prüfen:
        // Das optionale password-Feld wurde bisher ungeprueft gehasht — weder
        // über den Validator noch inline. Beim Anlegen (Zeile 181) gilt die
        // Policy laengst; über den Bearbeiten-Weg liess sie sich umgehen.
        const passwortFehler = validatePassword(password);
        if (passwortFehler) {
          return res.status(400).json({ error: passwortFehler });
        }
        updateFields.push(`password_hash = $${updateParams.length + 1}`);
        updateParams.push(await bcrypt.hash(password, 10));
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'Keine Felder zum Aktualisieren' });
      }

      let rowCount;
      if (user.stamm) {
        updateFields.push('updated_at = NOW()');

        updateParams.push(id, organizationId);
        const whereClause = `WHERE id = $${updateParams.length - 1} AND organization_id = $${updateParams.length}`;
        const updateQuery = `UPDATE users SET ${updateFields.join(', ')} ${whereClause}`;

        // DIE ZEILE DER STAMM-GEMEINDE IN user_organizations WECHSELT MIT
        // Migration 101 hat jedes damalige Konto mit seiner
        // Rolle auch dort eingetragen. Wechselte danach nur users.role_id,
        // stand in user_organizations die alte Rolle -- aus einer Teamer:in,
        // die Konfi war, wurde fuer jede Abfrage ueber user_organizations
        // wieder eine Konfi. Beides in EINER Transaktion.
        const client = await db.getClient();
        try {
          await client.query('BEGIN');

          const neuerName = username !== undefined && username !== null
            && String(username).toLowerCase() !== String(user.username || '').toLowerCase();
          if (neuerName && await benutzernameSperrenUndPruefen(client, username, { ausser: id })) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: MELDUNG_VERGEBEN });
          }

          ({ rowCount } = await client.query(updateQuery, updateParams));
          if (rowCount > 0 && neueRolle) {
            await client.query(
              'UPDATE user_organizations SET role_id = $1 WHERE user_id = $2 AND organization_id = $3',
              [neueRolle.id, id, organizationId]
            );
          }
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw txErr;
        } finally {
          client.release();
        }
      } else {
        // Zusatzmitglied: Die Rolle gilt je Gemeinde und steht in
        // user_organizations -- users.role_id (Stamm-Gemeinde) bleibt.
        ({ rowCount } = await db.query(
          'UPDATE user_organizations SET role_id = $1 WHERE user_id = $2 AND organization_id = $3',
          [role_id, id, organizationId]
        ));
      }

      if (rowCount === 0) {
        // This case should theoretically not be hit due to the initial check, but is good for safety.
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      // Neues Passwort: Eine Sperre nach Fehlversuchen endet damit.
      // Nach dem UPDATE, damit ein im selben Zug geaenderter Benutzername zaehlt.
      if (password) await kontoSperreAufheben(db, id);

      res.json({ message: 'Benutzer erfolgreich aktualisiert' });

      // Neues Passwort gesetzt: Bestaetigung an die hinterlegte Adresse
      // ohne das Passwort. Nach der
      // Antwort; "durch die Leitung" nur, wenn es nicht das eigene Konto ist.
      if (password) {
        nachAntwort(req, () => meldePasswortGeaendert(db, parseInt(id, 10), {
          durchLeitung: Number(id) !== Number(req.user.id)
        }), 'PUT /users/:id (Passwort-Mail)');
      }

      // Live-Update NACH der Response: geaenderter Benutzer in der Benutzer-Liste.
      liveUpdate.sendToOrgAdmins(organizationId, 'users', 'update', { userId: parseInt(id) });

      // Rechte-Cache dieser Person leeren -- bei JEDER Aenderung, nicht nur beim
      // Rollenwechsel: is_active=false
      // wirkte sonst erst nach dem 30-Sekunden-TTL von rbac.js, die alte
      // Sitzung arbeitete bis dahin weiter (reproduziert: PUT is_active=false,
      // direkt danach GET mit der alten Sitzung -> 200). Auch Name und
      // Rollentitel stehen im Cache; eine Aenderung soll sofort gelten.
      invalidateUserCache(parseInt(id));

      // Rollen- oder Aktiv-Status-Wechsel ändert die Soll-Mitgliedschaft in
      // Team-/Jahrgangs-Chats -> INLINE syncen (TTL-Cache verlässt sich darauf)
      // und den Sync-Cache des Users invalidieren.
      if (role_id !== undefined || is_active !== undefined) {
        try {
          chatSyncCache.invalidate(organizationId, parseInt(id));
          await syncTeamChat(db, organizationId, req.user.id);
          const { rows: assigned } = await db.query(
            'SELECT jahrgang_id FROM user_jahrgang_assignments WHERE user_id = $1',
            [id]
          );
          for (const a of assigned) {
            await syncJahrgangChat(db, a.jahrgang_id, organizationId, req.user.id);
          }
        } catch (syncErr) {
          console.error('Chat-Sync nach Benutzer-Aenderung fehlgeschlagen:', syncErr.message);
        }
      }

      // Deaktivierung (is_active=false): Aktive Sockets trennen, damit ein noch
      // verbundener Client mit deaktiviertem Konto nicht weiter Live-Updates
      // mitliest. Deckt alle drei Raum-Typen ab (konfi/teamer/admin).
      if (is_active === false) {
        liveUpdate.disconnectUserSockets(parseInt(id));
      }

      // Bei Rollenänderung: Socket.io-Verbindungen des Users trennen
      // damit der Client sich mit neuem Token (neue Rolle) neu verbindet
      if (role_id !== undefined && io) {
        // User-Room-Name folgt dem Pattern aus server.js: user_{type}_{id}
        // Beide möglichen Typen prüfen (admin und konfi)
        const userRoomAdmin = `user_admin_${id}`;
        const userRoomKonfi = `user_konfi_${id}`;

        for (const roomName of [userRoomAdmin, userRoomKonfi]) {
          const sockets = await io.in(roomName).fetchSockets();
          for (const s of sockets) {
            s.emit('forceDisconnect', { reason: 'role_changed' });
            s.disconnect(true);
          }
        }
      }

    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Benutzername oder E-Mail existiert bereits' });
      }
 console.error('Database error in PUT /users/%s:', id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ZIELGEMEINDE: bevorzugt eine aktive; eine gesperrte nur, wenn es keine
  // andere gibt -- das Konto bleibt auch dann, die andere Gemeinde soll es
  // behalten. Darunter die aelteste Mitgliedschaft (user_organizations.
  // created_at): dort arbeitet die Person am laengsten mit. Bei Gleichstand
  // entscheidet die Zeilen-ID, also die Reihenfolge des Anlegens --
  // Migration 101 hat den Altbestand in einem Zug mit demselben Zeitstempel
  // angelegt, und created_at darf NULL sein.
  async function kontoZiehtUm(req, res, userId, organizationId) {
    const client = await db.getClient();
    let ziel = null;
    try {
      await client.query('BEGIN');
      // Zeile sperren: Zwei gleichzeitige Entfernungen laufen nacheinander,
      // die zweite findet die Person hier nicht mehr (Fall 3 antwortet 404).
      const { rows: [hier] } = await client.query(
        'SELECT id FROM users WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [userId, organizationId]
      );
      // Zielgemeinde waehlen, umziehen und Zuweisungen, Chat-Plaetze und
      // Postfach DIESER Gemeinde raeumen -- dieselbe Funktion wie beim
      // Loeschen einer ganzen Gemeinde (utils/mitgliedschaftEnde.js).
      if (hier) {
        ziel = await inWeitereGemeindeUmziehen(client, userId, organizationId);
      }
      if (!ziel) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // Keine Namen fremder Gemeinden in der Antwort: Wohin das Konto gezogen
    // ist, geht diese Gemeinde nichts an.
    res.json({
      message: 'Aus dieser Gemeinde entfernt; das Konto bleibt in einer anderen Gemeinde bestehen',
      konto_bleibt: true
    });

    // Danach wie bei jeder Aenderung an Rolle oder Zugehoerigkeit. Die Sockets
    // werden getrennt, weil sie noch in den Raeumen DIESER Gemeinde sitzen
    // und ihr persoenlicher Raum am Rollentyp haengt (user_teamer_/user_admin_,
    // server.js) -- beim Wiederverbinden gilt die neue Stamm-Gemeinde.
    try {
      invalidateUserCache(userId);
      chatSyncCache.invalidate(organizationId, userId);
      chatSyncCache.invalidate(ziel.organization_id, userId);
      liveUpdate.disconnectUserSockets(userId);
      liveUpdate.sendToOrgAdmins(organizationId, 'users', 'delete', { userId });
      // In der neuen Stamm-Gemeinde wird aus "weitere" jetzt "stamm".
      liveUpdate.sendToOrgAdmins(ziel.organization_id, 'users', 'update', { userId });
    } catch (nachErr) {
      console.error('Nacharbeit nach Umzug von User %s fehlgeschlagen:', userId, nachErr);
    }
    return true;
  }

  // DREI FAELLE, je nachdem, wo die Person zuhause ist:
  //  1. Anderswo zuhause, hier ueber user_organizations: nur die Mitgliedschaft
  //     hier endet.
  //  2. Hier zuhause UND in weiteren Gemeinden Mitglied: das Konto zieht in
  //     eine davon um, hier ist sie danach nicht mehr.
  //  3. Nur hier Mitglied: das Konto wird geloescht.
  // Das Feld konto_bleibt (additiv) sagt der Oberflaeche, was geschehen ist.
  router.delete('/:id', rbacVerifier, requireAdmin, userHierarchyMiddleware('delete'), validateUserId, async (req, res) => {
    const { id } = req.params;
    const organizationId = req.user.organization_id;

    // Prevent self-deletion
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Du kannst dein eigenes Konto nicht löschen' });
    }

    try {
      const { rows: [konto] } = await db.query('SELECT organization_id FROM users WHERE id = $1', [id]);
      if (konto && Number(konto.organization_id) !== Number(organizationId)) {
        const client = await db.getClient();
        let betroffeneJahrgaenge = [];
        try {
          await client.query('BEGIN');
          const { rowCount } = await client.query(
            'DELETE FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
            [id, organizationId]
          );
          if (rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Benutzer in dieser Gemeinde nicht gefunden' });
          }
          ({ jahrgangIds: betroffeneJahrgaenge } =
            await gemeindeZugehoerigkeitRaeumen(client, id, organizationId));
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          console.error('Database error in DELETE /users/%s (Mitgliedschaft):', id, err);
          return res.status(500).json({ error: 'Datenbankfehler' });
        } finally {
          client.release();
        }

        res.json({ message: 'Mitgliedschaft in dieser Gemeinde beendet', konto_bleibt: true });

        // Danach wie bei jeder Aenderung an Rolle oder Zugehoerigkeit: Rechte-
        // Cache, Chat-Mitgliedschaften, offene Sockets (der naechste Aufruf
        // mit dieser Gemeinde im Token bekommt 403 und faellt zurueck).
        invalidateUserCache(parseInt(id));
        chatSyncCache.invalidate(organizationId, parseInt(id));
        try {
          await syncTeamChat(db, organizationId, req.user.id);
          for (const jahrgangId of betroffeneJahrgaenge) {
            await syncJahrgangChat(db, jahrgangId, organizationId, req.user.id);
          }
        } catch (syncErr) {
          console.error('Chat-Sync nach Ende der Mitgliedschaft fehlgeschlagen:', syncErr.message);
        }
        liveUpdate.disconnectUserSockets(parseInt(id));
        liveUpdate.sendToOrgAdmins(organizationId, 'users', 'delete', { userId: parseInt(id) });
        return;
      }
    } catch (err) {
      console.error('Error checking membership source:', err);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }

    // Prüfe ob letzter Org-Admin
    try {
      const targetUser = await db.query('SELECT role_id FROM users WHERE id = $1 AND organization_id = $2', [id, organizationId]);
      if (targetUser.rows[0]) {
        const targetRole = await db.query('SELECT name FROM roles WHERE id = $1', [targetUser.rows[0].role_id]);
        if (targetRole.rows[0]?.name === 'org_admin') {
          const orgAdminCount = await db.query(
            'SELECT COUNT(*)::int as count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = $1 AND u.organization_id = $2 AND u.id != $3',
            ['org_admin', organizationId, id]
          );
          if (orgAdminCount.rows[0].count === 0) {
            return res.status(409).json({ error: 'Die letzte Gemeindeleitung kann nicht gelöscht werden' });
          }
        }
      }
    } catch (err) {
      console.error('Error checking last org_admin:', err);
      return res.status(500).json({ error: 'Datenbankfehler' });
    }

    // HIER ZUHAUSE, ABER AUCH ANDERSWO MITGLIED: DAS KONTO ZIEHT UM.
    //
    // Bis dahin lief hier die Kontoloeschung weiter unten -- und nahm per
    // CASCADE (user_organizations.user_id) die Mitgliedschaften in allen
    // anderen Gemeinden mit. Wer ein Jahr in Gemeinde A war und laengst in B
    // mitarbeitet, verlor mit dem Aufraeumen in A auch B.
    //
    // Die Pruefung auf den letzten Org-Admin oben gilt auch hier: Nach dem
    // Umzug fehlt die Person dieser Gemeinde genauso wie nach einer Loeschung.
    // Hierarchie und Super-Admin-Schutz hat userHierarchyMiddleware bereits
    // geprueft.
    try {
      const umgezogen = await kontoZiehtUm(req, res, parseInt(id), organizationId);
      if (umgezogen) return;
    } catch (err) {
      console.error('Database error in DELETE /users/%s (Umzug):', id, err);
      if (!res.headersSent) return res.status(500).json({ error: 'Datenbankfehler' });
      return;
    }

    const client = await db.getClient();
    // Vor dem try deklariert, weil die Nacharbeit hinter dem finally sie braucht.
    let ergebnis = null;
    let nichtGefunden = false;
    try {
      await client.query('BEGIN');
      // Gehoert das Konto (noch) hierher? Die Zeile bleibt bis zum COMMIT
      // gesperrt -- ein gleichzeitiger Umzug oder eine Selbstloeschung wartet.
      const { rows: [ziel] } = await client.query(
        'SELECT id FROM users WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [id, organizationId]
      );
      if (!ziel) {
        await client.query('ROLLBACK');
        nichtGefunden = true;
      } else {
        ergebnis = await kontoDatenLoeschen(client, id);
        await client.query('COMMIT');
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in DELETE /users/%s:', id, err);
      return res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      // KEIN client.release() im try — nur hier. Die Nacharbeit unten
      // (Sockets trennen, Dateien, Antwort, Live-Update) lief frueher NACH
      // dem Release im try: ein Fehler dort landete im Transaktions-catch und
      // setzte ein ROLLBACK auf eine Verbindung ab, die inzwischen ein
      // anderer Request aus dem Pool hatte.
      client.release();
    }

    if (nichtGefunden) {
      return res.status(404).json({ error: 'Benutzer in dieser Gemeinde nicht gefunden' });
    }

    try {
      // Rechte-Cache leeren: rbac.js
      // haelt das Benutzerobjekt 30 Sekunden -- ohne diese Zeile bediente die
      // laufende Sitzung der geloeschten Person die API so lange weiter.
      invalidateUserCache(parseInt(id));

      // Aktive Socket-Verbindungen des geloeschten Users sofort trennen — sonst
      // liest ein noch verbundener Client mit toter Session weiter Live-Updates
      // mit, bis er von selbst neu verbindet. Nach dem COMMIT (User ist weg).
      liveUpdate.disconnectUserSockets(parseInt(id));
    } catch (nachErr) {
      // Der Benutzer ist geloescht — das ist festgeschrieben. Ein Fehler beim
      // Aufraeumen darf die Antwort nicht mehr in einen 500 kippen.
      console.error('Aufraeumen nach DELETE /users/%s fehlgeschlagen:', id, nachErr);
    }
    // Dateien nach dem COMMIT (wirft nie, protokolliert ohne Dateinamen).
    await kontoDateienLoeschen(ergebnis?.dateien);

    res.json({ message: 'Benutzer erfolgreich gelöscht', konto_bleibt: false });

    // Nachgerueckte benachrichtigen (je Gemeinde ihres Events), Chatlisten
    // der Gespraechspartner:innen auffrischen. Wirft nie. UEBER nachAntwort
    // Vorher stand hier ein blankes await nach res.json --
    // warteAufNachwehen wusste davon nichts, und kontoLoeschenWege ("Team-Platz
    // nachruecken") war wacklig, je nachdem, ob der Push vor der Pruefung kam.
    nachAntwort(req, async () => {
      await meldeNachKontoLoeschung(db, ergebnis);

      // Live-Update NACH der Response: geloeschter Benutzer aus der Benutzer-Liste.
      try {
        liveUpdate.sendToOrgAdmins(organizationId, 'users', 'delete', { userId: parseInt(id) });
      } catch (liveErr) {
        console.error('Live-Update nach DELETE /users/%s fehlgeschlagen:', id, liveErr);
      }
    }, 'DELETE /users/:id (Meldungen nach Kontoloeschung)');
  });

  router.post('/:id/jahrgaenge', rbacVerifier, requireAdmin, userHierarchyMiddleware('update'), validateJahrgangAssignments, async (req, res) => {
    const { id: userId } = req.params;
    const organizationId = req.user.organization_id;
    const { jahrgang_assignments } = req.body; // [{ jahrgang_id, can_view, can_edit }]

    if (!Array.isArray(jahrgang_assignments)) {
      return res.status(400).json({ error: 'jahrgang_assignments muss ein Array sein' });
    }

    try {
        // Gehoert die Person zu dieser Gemeinde? BEIDE Quellen:
        // Stamm-Gemeinde am Konto ODER Zusatzzugehoerigkeit ueber
        // user_organizations. Vorher stand hier allein organization_id, und wer
        // ueber user_organizations in der Gemeinde arbeitet, bekam 404 --
        // dasselbe Muster wie bei den Push-Empfaengern (utils/orgMitglieder.js).
        // Die Rollen-Hierarchie prueft userHierarchyMiddleware, ebenfalls ueber
        // beide Quellen und mit der Rolle DIESER Gemeinde.
        const { rows: [user] } = await db.query(
            `SELECT u.id
               FROM users u
              WHERE u.id = $1
                AND (u.organization_id = $2
                     OR EXISTS (SELECT 1 FROM user_organizations uo
                                 WHERE uo.user_id = u.id AND uo.organization_id = $2))`,
            [userId, organizationId]
        );
        if (!user) {
            return res.status(404).json({ error: 'Benutzer in dieser Gemeinde nicht gefunden' });
        }

        const client = await db.getClient();
        // Frueher Ausstieg aus der Transaktion: Status und Antwort merken und
        // erst hinter dem finally senden. Im try steht nur BEGIN..COMMIT.
        let fruehAntwort = null;
        try {
        await client.query('BEGIN');

        // Get current assignments to determine chat changes
        const { rows: currentAssignments } = await client.query(
            "SELECT jahrgang_id FROM user_jahrgang_assignments WHERE user_id = $1",
            [userId]
        );
        const currentJahrgangIds = currentAssignments.map(a => a.jahrgang_id);
        const newJahrgangIds = jahrgang_assignments.map(a => parseInt(a.jahrgang_id, 10));

        // Welche Jahrgaenge darf der Aufrufer ueberhaupt anfassen?
        //
        // Die Frage "darf dieser Aufrufer in diesem Jahrgang?" beantwortet der
        // gemeinsame Baustein utils/jahrgangsZugriff.js. { edit: true }, weil
        // das Setzen einer Zuweisung ein Schreibweg ist.
        const darfDiesenJahrgang = (id) => darfJahrgang(req, id, { edit: true });

        // Verlangt der Aufrufer einen Jahrgang, den er selbst nicht bearbeiten
        // darf, ist das ein 403 — nicht ein stilles Weglassen.
        const fremdesZiel = newJahrgangIds.filter(id => !darfDiesenJahrgang(id));
        if (fremdesZiel.length > 0) {
            await client.query('ROLLBACK');
            fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf diesen Jahrgang' } };
        } else {

        // Bestehende Zuweisungen ausserhalb der eigenen Jahrgaenge bleiben
        // stehen: Nur die eigenen werden ersetzt.
        const behaltenIds = currentJahrgangIds.filter(id => !darfDiesenJahrgang(id));

        // Alle betroffenen Jahrgänge (alt + neu) — für diese wird nach dem
        // Setzen der Zuweisungen der Chat synchronisiert (Beitritt bei neuer
        // Zuweisung, Entfernung bei Entzug — Org-Admins bleiben immer drin).
        const affectedJahrgangIds = Array.from(new Set([...currentJahrgangIds, ...newJahrgangIds]));

        // Delete existing assignments for this user — aber nur die, die der
        // Aufrufer selbst verantworten darf.
        //
        // Der JOIN auf jahrgaenge bindet das DELETE zusaetzlich an die
        // Organisation, so wie der Insert-Pfad weiter unten es tut. Praktisch
        // erreichbar ist damit heute nichts: Der Zielbenutzer wird zweifach
        // org-gebunden geladen, eine org-fremde Zuweisung kann ueber die API
        // gar nicht erst entstehen. Die Grenze steht hier trotzdem explizit,
        // damit sie nicht allein von den Aufrufern weiter oben abhaengt.
        if (behaltenIds.length > 0) {
            await client.query(
                `DELETE FROM user_jahrgang_assignments uja
                 USING jahrgaenge j
                 WHERE uja.jahrgang_id = j.id
                   AND uja.user_id = $1
                   AND j.organization_id = $2
                   AND NOT (uja.jahrgang_id = ANY($3::bigint[]))`,
                [userId, organizationId, behaltenIds]
            );
        } else {
            await client.query(
                `DELETE FROM user_jahrgang_assignments uja
                 USING jahrgaenge j
                 WHERE uja.jahrgang_id = j.id
                   AND uja.user_id = $1
                   AND j.organization_id = $2`,
                [userId, organizationId]
            );
        }

        // Alle uebergebenen Zuweisungen werden geschrieben: Ein Jahrgang aus
        // behaltenIds kann hier nicht mehr auftauchen (er haette oben den 403
        // ausgeloest), die Mengen sind also disjunkt.
        const einzufuegen = jahrgang_assignments;

        if (einzufuegen.length > 0) {
            // First, verify all jahrgaenge exist in the organization
            const jahrgangIds = einzufuegen.map(a => a.jahrgang_id);
            const placeholders = jahrgangIds.map((_, i) => `$${i + 2}`).join(',');
            const verifyQuery = `SELECT id FROM jahrgaenge WHERE organization_id = $1 AND id IN (${placeholders})`;
            const { rows: validJahrgaenge } = await client.query(verifyQuery, [organizationId, ...jahrgangIds]);

            // Laengenvergleich (nicht Set): Ein doppelt geschickter Jahrgang
            // wird so weiterhin mit 400 abgewiesen statt am UNIQUE-Index
            // (user_id, jahrgang_id) mit 500 zu scheitern.
            if (validJahrgaenge.length !== jahrgangIds.length) {
                await client.query('ROLLBACK');
                fruehAntwort = { status: 400, body: { error: 'Mindestens eine Jahrgangs-ID ist ungültig oder gehört nicht zu dieser Gemeinde.' } };
            } else {
            // Now, insert all new assignments
            for (const assignment of einzufuegen) {
                const { jahrgang_id, can_view = true, can_edit = false } = assignment;
                const insertQuery = `
                    INSERT INTO user_jahrgang_assignments (user_id, jahrgang_id, can_view, can_edit, assigned_by)
                    VALUES ($1, $2, $3, $4, $5)
                `;
                await client.query(insertQuery, [userId, jahrgang_id, can_view, can_edit, req.user.id]);
            }
            }
        }

        if (!fruehAntwort) {
            // Chat-Mitgliedschaft für ALLE betroffenen Jahrgänge (alt + neu)
            // zentral synchronisieren: zugewiesene Admins/Teamer treten bei,
            // entzogene fliegen raus, Org-Admins bleiben immer drin, Chat wird bei
            // Bedarf angelegt. Ersetzt die frueheren manuellen Add/Remove-Schleifen
            // (die Teamer faelschlich als 'admin' eintrugen und Org-Admins ignorierten).
            for (const jahrgangId of affectedJahrgangIds) {
                await syncJahrgangChat(client, jahrgangId, organizationId, req.user.id);
            }

            await client.query('COMMIT');
        }
        }
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw txErr;
        } finally {
          // KEIN client.release() im try — nur hier.
          client.release();
        }

        if (fruehAntwort) {
            return res.status(fruehAntwort.status).json(fruehAntwort.body);
        }

        // Die Zuweisungen haengen im rbac-Cache des betroffenen Benutzers
        // (30 s TTL, rbac.js:180-192). Ohne diese Zeile wirkt eine frisch
        // gegebene oder entzogene Zuweisung bis zu eine halbe Minute lang
        // nicht — seit sie ueber Schreibrechte entscheidet ist
        // das nicht mehr nur eine Anzeigefrage.
        invalidateUserCache(parseInt(userId));

        res.json({
            message: jahrgang_assignments.length > 0 ? 'Jahrgangs-Zuweisungen aktualisiert' : 'Alle Jahrgangs-Zuweisungen entfernt',
            assignments_count: jahrgang_assignments.length
        });

        // Live-Update NACH der Response: geaenderte Jahrgangs-Zuweisung wirkt auf
        // die Benutzer-Liste (Zugehoerigkeit/Anzeige).
        liveUpdate.sendToOrgAdmins(organizationId, 'users', 'update', { userId: parseInt(userId) });

    } catch (err) {
      console.error('Database error in POST /users/%s/jahrgaenge:', userId, err);
        if (!res.headersSent) res.status(500).json({ error: 'Datenbankfehler beim Zuweisen der Jahrgänge' });
    }
  });


  // Get current user's jahrgang assignments (must be before /:id route)
  router.get('/me/jahrgaenge', rbacVerifier, async (req, res) => {
    const userId = req.user.id;
    const organizationId = req.user.organization_id;

    const query = `
      SELECT j.id, j.name, uja.can_view, uja.can_edit, uja.assigned_at,
             assigner.display_name as assigned_by_name
      FROM user_jahrgang_assignments uja
      JOIN jahrgaenge j ON uja.jahrgang_id = j.id
      LEFT JOIN users assigner ON uja.assigned_by = assigner.id
      WHERE uja.user_id = $1 AND j.organization_id = $2
      ORDER BY j.name
    `;

    try {
      const { rows } = await db.query(query, [userId, organizationId]);
      res.json(rows);
    } catch (err) {
      console.error('Database error in GET /users/me/jahrgaenge:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Get user's jahrgang assignments
  // Wie POST /:id/jahrgaenge: requireAdmin + Hierarchie ('view'), damit die
  // Leitung die Zuweisungen der von ihr verwalteten Teamer:innen sehen kann,
  // die von Admins/Org-Admins aber nicht.
  router.get('/:id/jahrgaenge', rbacVerifier, requireAdmin, userHierarchyMiddleware('view'), async (req, res) => {
    const { id } = req.params;
    const organizationId = req.user.organization_id;

    const query = `
      SELECT j.id, j.name, uja.can_view, uja.can_edit, uja.assigned_at,
             assigner.display_name as assigned_by_name
      FROM user_jahrgang_assignments uja
      JOIN jahrgaenge j ON uja.jahrgang_id = j.id
      LEFT JOIN users assigner ON uja.assigned_by = assigner.id
      WHERE uja.user_id = $1 AND j.organization_id = $2
      ORDER BY j.name
    `;

    try {
      const { rows } = await db.query(query, [id, organizationId]);
      res.json(rows);
    } catch (err) {
 console.error('Database error in GET /users/%s/jahrgaenge:', id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ENTFERNT: /users/:id/permissions Route
  // Permissions sind jetzt rollen-basiert (hardcoded), keine DB-Abfrage mehr nötig
  // ENTFERNT: zweite /me/jahrgaenge Route (Duplikat, lieferte andere Spaltenaliase)

  // Reset password for a user (super_admin or org_admin of same org)
  router.put('/:id/reset-password', rbacVerifier, validateResetPassword, async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    const passwordError = validatePassword(password || '');
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    try {
      // Prüfen ob User existiert
      const { rows: [targetUser] } = await db.query(`
        SELECT u.id, u.organization_id, u.is_super_admin, r.name as role_name
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1
      `, [id]);

      if (!targetUser) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      const isSuperAdmin = req.user.is_super_admin === true;
      const isOrgAdmin = req.user.role_name === 'org_admin';
      const isSameOrg = req.user.organization_id === targetUser.organization_id;

      // super_admin darf alle resetten, org_admin nur in eigener Org
      if (!isSuperAdmin && !(isOrgAdmin && isSameOrg)) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }

      if (istSuperAdminKonto(targetUser) && !isSuperAdmin) {
        return res.status(403).json({ error: 'Super-Admin-Konten kann nur ein Super-Admin bearbeiten.' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      // org-gescopt: id ist eindeutig, organization_id als defensiver Zusatzfilter (matcht den oben geladenen targetUser)
      await db.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW(), token_invalidated_at = NOW() WHERE id = $2 AND organization_id = $3',
        [hashedPassword, id, targetUser.organization_id]
      );
      // Neues Passwort: Eine Sperre nach Fehlversuchen endet damit.
      await kontoSperreAufheben(db, id);

      // Refresh-Tokens widerrufen. Ohne das ist die Invalidierung oben
      // wirkungslos: Der Refresh-Token laeuft 90 Tage und holt sich laufend
      // frische Access-Tokens.
      await db.query(
        'UPDATE refresh_tokens SET revoked_at = NOW(), expires_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [id]
      );

      // Push-Tokens der beendeten Sitzungen mitloeschen: Der Versand haengt im
      // pushService nur an user_id, NICHT an einer gueltigen Sitzung. Ohne die
      // Loeschung bekaeme ein gerade ausgesperrtes Geraet weiter Push-Nachrichten
      // samt Chat-Inhalten — unbegrenzt, weil jede Zustellung updated_at
      // auffrischt und die 30-Tage-Bereinigung dadurch nie greift.
      await db.query('DELETE FROM push_tokens WHERE user_id = $1', [id]);

      // Bestehende Socket-Verbindungen des Users trennen: Nach einem Passwort-
      // Reset soll die alte Session nicht über einen offenen Socket weiterlaufen.
      // Der Client verbindet sich nach dem nächsten (Re-)Login mit frischem Token.
      liveUpdate.disconnectUserSockets(parseInt(id));

      res.json({ message: 'Passwort erfolgreich zurückgesetzt' });

      // Bestaetigung an die hinterlegte Adresse, ohne das
      // Passwort -- die Leitung gibt es persoenlich weiter.
      nachAntwort(req, () => meldePasswortGeaendert(db, parseInt(id, 10), {
        durchLeitung: Number(id) !== Number(req.user.id)
      }), 'PUT /users/:id/reset-password (Mail)');

    } catch (err) {
 console.error('Database error in PUT /users/%s/reset-password:', id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};