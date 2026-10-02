const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors, commonValidations } = require('../middleware/validation');
const liveUpdate = require('../utils/liveUpdate');
const emailService = require('../services/emailService');
const { syncJahrgangChat } = require('../utils/jahrgangChat');
const { darfJahrgang } = require('../utils/jahrgangsZugriff');
const { canManageRole } = require('../utils/roleHierarchy');
const { loescheMitteilungenZuJahrgang } = require('../utils/postfachAufraeumen');
const { ladeLoeschumfang, materialGlobalMachen } = require('../utils/jahrgangLoeschen');
const { loescheTermin, loescheChatRaeume, entferneChatDateien } = require('../utils/terminLoeschen');
const { loescheChallenge, entferneChallengeDateien } = require('../utils/challengeLoeschen');
const { sichereKonfiZeitBefoerderter, ROLLE_IN_PROFIL_GEMEINDE } = require('../utils/konfiHistorie');
const { adresseFuersProtokoll } = require('../utils/protokoll');

// Jahrgänge: Teamer darf ansehen, Admin darf bearbeiten, NUR org_admin darf anlegen
module.exports = (db, rbacVerifier, { requireOrgAdmin, requireAdmin, requireTeamer }) => {

  // Schema-Migrationen: siehe backend/migrations/064_consolidate_inline_schemas.sql

  // Validierungsregeln
  //
  // Punkteziele ab 1: Der
  // Regler der Leitung reicht in jeder App-Fassung von 1 bis 20, und jede
  // Anzeige rechnet `ziel || 10` -- eine 0 hiess also ueberall 10, waehrend
  // die Datenbank 0 hielt. Die Schnittstelle nimmt jetzt nur, was der Regler
  // kann.
  const validateCreateJahrgang = [
    commonValidations.name,
    body('gottesdienst_enabled').optional().isBoolean().withMessage('gottesdienst_enabled muss Boolean sein'),
    body('gemeinde_enabled').optional().isBoolean().withMessage('gemeinde_enabled muss Boolean sein'),
    body('konfspruch_enabled').optional().isBoolean().withMessage('konfspruch_enabled muss Boolean sein'),
    body('target_gottesdienst').optional().isInt({ min: 1 }).withMessage('target_gottesdienst muss mindestens 1 sein'),
    body('target_gemeinde').optional().isInt({ min: 1 }).withMessage('target_gemeinde muss mindestens 1 sein'),
    // Direkt-Zuweisung beim Anlegen: OPTIONAL, damit ausgelieferte
    // Apps (die das Feld nicht senden) sich exakt wie bisher verhalten.
    // Form wie bei POST /users/:id/jahrgaenge, nur gespiegelt: dort Jahrgaenge
    // pro Person, hier Personen pro Jahrgang.
    body('user_assignments').optional().isArray().withMessage('user_assignments muss ein Array sein'),
    body('user_assignments.*.user_id').isInt({ min: 1 }).withMessage('user_id muss eine positive Ganzzahl sein'),
    body('user_assignments.*.can_view').optional().isBoolean().withMessage('can_view muss Boolean sein'),
    body('user_assignments.*.can_edit').optional().isBoolean().withMessage('can_edit muss Boolean sein'),
    handleValidationErrors
  ];

  const validateUpdateJahrgang = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    commonValidations.name,
    body('gottesdienst_enabled').optional().isBoolean().withMessage('gottesdienst_enabled muss Boolean sein'),
    body('gemeinde_enabled').optional().isBoolean().withMessage('gemeinde_enabled muss Boolean sein'),
    body('konfspruch_enabled').optional().isBoolean().withMessage('konfspruch_enabled muss Boolean sein'),
    body('target_gottesdienst').optional().isInt({ min: 1 }).withMessage('target_gottesdienst muss mindestens 1 sein'),
    body('target_gemeinde').optional().isInt({ min: 1 }).withMessage('target_gemeinde muss mindestens 1 sein'),
    handleValidationErrors
  ];

  const validateJahrgangId = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors
  ];

  // GET all jahrgaenge for the admin's organization
  router.get('/', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      let jahrgangFilter = '';
      const params = [req.user.organization_id];
      if (!req.user.is_super_admin && req.user.role_name !== 'org_admin') {
        const sichtbare = (req.user.assigned_jahrgaenge || [])
          .filter(j => j.can_view)
          .map(j => j.id);
        if (sichtbare.length === 0) {
          // Grund der leeren Liste mitliefern (dasselbe Muster wie GET
          // /admin/konfis): keine Zuweisung, nicht "keine Jahrgaenge".
          res.set('X-Kein-Jahrgang-Zugewiesen', 'true');
          return res.json([]);
        }
        params.push(sichtbare);
        jahrgangFilter = ' AND j.id = ANY($2::int[])';
      }

      const query = `SELECT j.*,
        (SELECT COUNT(*) FROM konfi_profiles kp JOIN users u ON kp.user_id = u.id WHERE kp.jahrgang_id = j.id AND u.organization_id = j.organization_id)::int as konfi_count,
        (SELECT COALESCE(SUM(kp.gottesdienst_points), 0) FROM konfi_profiles kp WHERE kp.jahrgang_id = j.id AND kp.gottesdienst_points > 0)::int as gottesdienst_points_total,
        (SELECT COALESCE(SUM(kp.gemeinde_points), 0) FROM konfi_profiles kp WHERE kp.jahrgang_id = j.id AND kp.gemeinde_points > 0)::int as gemeinde_points_total
      FROM jahrgaenge j WHERE j.organization_id = $1${jahrgangFilter} ORDER BY j.name DESC`;
      const { rows: jahrgaenge } = await db.query(query, params);
      res.json(jahrgaenge);
    } catch (err) {
 console.error('Database error in GET /api/jahrgaenge:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // POST a new jahrgang
  //
  // Direkt-Zuweisung: user_assignments = [{ user_id, can_view?, can_edit? }]
  // ist OPTIONAL — fehlt das Feld, verhaelt sich die Route exakt wie bisher
  // (ausgelieferte Apps senden es nicht und duerfen nicht brechen). Wen der
  // org_admin zuweisen darf, entscheidet dieselbe Regel wie bei POST
  // /users/:id/jahrgaenge: canManageRole (roleHierarchy.js) — keine zweite
  // Rechte-Erfindung. Defaults can_view=true/can_edit=false und assigned_by
  // ebenfalls wie dort. Anlage + Zuweisungen laufen in EINER Transaktion:
  // Wird eine Zuweisung abgewiesen, bleibt kein halb angelegter Jahrgang
  // zurueck.
  router.post('/', rbacVerifier, requireOrgAdmin, validateCreateJahrgang, async (req, res) => {
    const { name, gottesdienst_enabled, gemeinde_enabled, konfspruch_enabled, target_gottesdienst, target_gemeinde, user_assignments } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }

    const zuweisungen = Array.isArray(user_assignments) ? user_assignments : [];

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

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
      const { rows: [newJahrgang] } = await client.query(query, params);

      const assignedUserIds = [];
      if (zuweisungen.length > 0) {
        const userIds = zuweisungen.map(z => parseInt(z.user_id, 10));

        // Doppelt geschickte Personen mit 400 abweisen statt am UNIQUE-Index
        // (user_id, jahrgang_id) mit 500 zu scheitern — dasselbe Muster wie
        // der Laengenvergleich in POST /users/:id/jahrgaenge.
        if (new Set(userIds).size !== userIds.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Mindestens eine Person ist doppelt angegeben' });
        }

        // Zielpersonen org-gescopt laden: eine fremde oder unbekannte Person
        // ist ein 404 — dieselbe Antwort wie checkUserHierarchy fuer
        // Zielbenutzer ausserhalb der eigenen Organisation.
        const { rows: zielUsers } = await client.query(
          `SELECT u.id, r.name AS role_name
           FROM users u JOIN roles r ON u.role_id = r.id
           WHERE u.id = ANY($1::int[]) AND u.organization_id = $2`,
          [userIds, req.user.organization_id]
        );
        if (zielUsers.length !== userIds.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Benutzer in dieser Gemeinde nicht gefunden' });
        }

        // Rollen-Grenze: canManageRole ist DIE Quelle (fuer org_admin heisst
        // das: alle Rollen der eigenen Org, aber kein super_admin). Verletzung
        // ist ein 403 — und dank Transaktion entsteht dabei auch kein Jahrgang.
        const verboten = zielUsers.find(u => !canManageRole(req.user.role_name, u.role_name));
        if (verboten) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: `Du kannst Benutzer mit der Rolle '${verboten.role_name}' nicht bearbeiten.` });
        }

        for (const zuweisung of zuweisungen) {
          const { user_id, can_view = true, can_edit = false } = zuweisung;
          await client.query(
            `INSERT INTO user_jahrgang_assignments (user_id, jahrgang_id, can_view, can_edit, assigned_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [user_id, newJahrgang.id, can_view, can_edit, req.user.id]
          );
          assignedUserIds.push(parseInt(user_id, 10));
        }
      }

      await client.query('COMMIT');

      // Die Zuweisungen haengen im rbac-Cache der betroffenen Benutzer (30 s
      // TTL) — ohne Invalidierung waere der frische Jahrgang fuer sie bis zu
      // eine halbe Minute unsichtbar.
      for (const userId of assignedUserIds) {
        require('../middleware/rbac').invalidateUserCache(userId);
      }

      // Jahrgangs-Chat sofort anlegen + Mitglieder synchronisieren (Org-Admins,
      // zugewiesene Admins/Teamer, Konfis — die eben geschriebenen Zuweisungen
      // sind zu diesem Zeitpunkt committed und kommen direkt mit in den Raum).
      // Frueher entstand der Chat erst lazy beim ersten Chat-Tab-Aufruf eines
      // Konfis — neue Orgs/Jahrgänge hatten dadurch gar keinen Chat. Fehler
      // hier darf die Anlage nicht scheitern lassen.
      try {
        await syncJahrgangChat(db, newJahrgang.id, req.user.organization_id, req.user.id);
      } catch (chatErr) {
        console.error('Jahrgangs-Chat konnte nicht angelegt werden:', chatErr.message);
      }

      // Antwortform: unveraendert die volle Jahrgangs-Zeile; assigned_user_ids
      // kommt ADDITIV dazu (ausgelieferte Apps lesen es schlicht nicht).
      res.status(201).json({ ...newJahrgang, assigned_user_ids: assignedUserIds });

      // Live-Update an alle Admins senden
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'jahrgaenge', 'create');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Jahrgang-Name existiert bereits in dieser Gemeinde' });
      }
 console.error('Database error in POST /api/jahrgaenge:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      client.release();
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

      if (!darfJahrgang(req, req.params.id, { edit: true })) {
        return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
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
      // bestehenden Wert unverändert.
      // Mindestens eine Punktart muss aktiv bleiben. Die Oberflaeche sperrt den
      // jeweils letzten Schalter (AdminJahrgaengeePage.tsx:324/356), der Server
      // tat es bisher nicht — per API liess sich ein Jahrgang erzeugen, in dem
      // gar keine Punkte mehr vergeben werden können (pointTypeGuard blockt
      // dann beide Arten). Geprueft wird der ENDZUSTAND, nicht die Eingabe:
      // nicht mitgeschickte Felder behalten ihren bisherigen Wert.
      const endzustandGottesdienst = gottesdienst_enabled !== undefined
        ? gottesdienst_enabled : currentJahrgang.gottesdienst_enabled;
      const endzustandGemeinde = gemeinde_enabled !== undefined
        ? gemeinde_enabled : currentJahrgang.gemeinde_enabled;
      if (!endzustandGottesdienst && !endzustandGemeinde) {
        return res.status(400).json({
          error: 'Mindestens eine Punktart muss aktiv bleiben — sonst lassen sich in diesem Jahrgang gar keine Punkte mehr vergeben.'
        });
      }

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
 console.error('Database error in PUT /api/jahrgaenge/:id:', req.params.id, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Was beim Loeschen dieses Jahrgangs mitgeht -- fuer den
  // Bestaetigungsdialog. Dieselben Rechte und dieselbe
  // Regel-Stelle wie DELETE (utils/jahrgangLoeschen.js), damit die Zahlen im
  // Dialog genau das sind, was dann verschwindet. Aeltere Apps rufen die
  // Route nicht und fragen weiter ohne Zahlen nach.
  router.get('/:id/loeschvorschau', rbacVerifier, requireAdmin, validateJahrgangId, async (req, res) => {
    const jahrgangId = req.params.id;
    try {
      const { rows: [jahrgangDa] } = await db.query(
        'SELECT id FROM jahrgaenge WHERE id = $1 AND organization_id = $2',
        [jahrgangId, req.user.organization_id]
      );
      if (!jahrgangDa) {
        return res.status(404).json({ error: 'Jahrgang nicht gefunden' });
      }
      if (!darfJahrgang(req, jahrgangId, { edit: true })) {
        return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
      }

      const umfang = await ladeLoeschumfang(db, jahrgangId, req.user.organization_id);
      const { rows: [zahlen] } = await db.query(
        `SELECT
           (SELECT COUNT(*)::int FROM konfi_profiles kp
              JOIN users u ON kp.user_id = u.id
             WHERE kp.jahrgang_id = $1 AND ${ROLLE_IN_PROFIL_GEMEINDE} = 'konfi') AS aktive_konfis,
           (SELECT COUNT(*)::int FROM konfi_profiles kp
              JOIN users u ON kp.user_id = u.id
             WHERE kp.jahrgang_id = $1 AND COALESCE(${ROLLE_IN_PROFIL_GEMEINDE}, '') <> 'konfi') AS befoerderte,
           (SELECT COUNT(*)::int FROM chat_messages cm
              JOIN chat_rooms cr ON cm.room_id = cr.id
             WHERE cr.type = 'jahrgang' AND cr.jahrgang_id = $1) AS chat_nachrichten`,
        [jahrgangId]
      );
      const jetzt = Date.now();

      res.json({
        aktive_konfis: zahlen.aktive_konfis,
        befoerderte: zahlen.befoerderte,
        chat_nachrichten: zahlen.chat_nachrichten,
        events_geloescht: umfang.termineLoeschen.length,
        events_kuenftig: umfang.termineLoeschen.filter((t) => new Date(t.event_date).getTime() > jetzt).length,
        events_behalten: umfang.termineBehalten.length,
        challenges_geloescht: umfang.challengesLoeschen.length,
        challenges_behalten: umfang.challengesBehalten.length,
        material_global: umfang.materialNeuFuerAlle.length
      });
    } catch (err) {
      console.error('Database error in GET /api/jahrgaenge/:id/loeschvorschau:', jahrgangId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // DELETE a jahrgang
  //
  // EINE TRANSAKTION: Bis hierher liefen rund
  // zwanzig Abfragen einzeln auf dem Pool. Brach das Loeschen zwischen
  // Chat-Aufraeumen und DELETE FROM jahrgaenge ab, blieb ein Jahrgang ohne
  // Chat zurueck. Jetzt geht alles oder nichts; die Dateien der Anhaenge
  // und Beitraege verschwinden erst nach dem COMMIT.
  //
  // TERMINE UND CHALLENGES DES JAHRGANGS GEHEN MIT --
  // welche, steht in utils/jahrgangLoeschen.js; wie, in utils/terminLoeschen.js
  // und utils/challengeLoeschen.js (dieselben Wege wie beim Einzel-Loeschen).
  // Zwei Abweichungen vom Einzel-Loeschen, beide gewollt:
  //   - Vergebene Event-Punkte bleiben gutgeschrieben. Die Teilnahme hat
  //     stattgefunden; der Jahrgang wird aufgeraeumt, nicht berichtigt. Wer
  //     davon betroffen ist, ist ohnehin nicht mehr aktive Konfi dieses
  //     Jahrgangs (die blockieren das Loeschen).
  //   - Keine Absage-Mitteilung an Angemeldete: Das Loeschen eines Jahrgangs
  //     ist Aufraeumen, kein Ereignis fuer das Handy. Die Leitung sieht die
  //     Zahl der Termine -- auch der kuenftigen -- vorher im Dialog.
  // Die Stempel des Teams aus den geloeschten Challenges bleiben
  // (bewahrte_stempel, Migration 169).
  router.delete('/:id', rbacVerifier, requireAdmin, validateJahrgangId, async (req, res) => {
    const jahrgangId = req.params.id;
    const forceDelete = req.query.force === 'true';
    const organizationId = req.user.organization_id;

    const client = await db.getClient();
    let fruehAntwort = null;
    const chatDateien = [];
    const challengeDateien = [];
    let geloeschteTermine = 0;
    let geloeschteChallenges = 0;
    try {
      await client.query('BEGIN');

      const { rows: [jahrgangDa] } = await client.query(
        'SELECT id FROM jahrgaenge WHERE id = $1 AND organization_id = $2 FOR UPDATE',
        [jahrgangId, organizationId]
      );

      const checkKonfisQuery = `
        SELECT COUNT(*)::int as count
        FROM konfi_profiles kp
        JOIN users u ON kp.user_id = u.id
        WHERE kp.jahrgang_id = $1 AND ${ROLLE_IN_PROFIL_GEMEINDE} = 'konfi'
      `;
      // Chat-Raeume des Jahrgangs samt Zahl ihrer Nachrichten
      const checkChatQuery = `
        SELECT cr.id,
               (SELECT COUNT(*) FROM chat_messages WHERE room_id = cr.id)::int as message_count
        FROM chat_rooms cr
        WHERE cr.type = 'jahrgang' AND cr.jahrgang_id = $1
      `;

      let chatRooms = [];
      if (!jahrgangDa) {
        fruehAntwort = { status: 404, body: { error: 'Jahrgang nicht gefunden' } };
      } else if (!darfJahrgang(req, jahrgangId, { edit: true })) {
        fruehAntwort = { status: 403, body: { error: 'Kein Zugriff auf diesen Jahrgang' } };
      } else {
        const { rows: [konfiUsage] } = await client.query(checkKonfisQuery, [jahrgangId]);
        if (konfiUsage.count > 0) {
          fruehAntwort = { status: 409, body: { error: `Jahrgang kann nicht gelöscht werden: ${konfiUsage.count} Konfi(s) zugeordnet.` } };
        } else {
          ({ rows: chatRooms } = await client.query(checkChatQuery, [jahrgangId]));
          const roomsWithMessages = chatRooms.filter(room => room.message_count > 0);
          if (roomsWithMessages.length > 0 && !forceDelete) {
            fruehAntwort = { status: 409, body: {
              error: `Jahrgang kann nicht gelöscht werden: Chat-Raum enthält ${roomsWithMessages[0].message_count} Nachricht(en).`,
              canForceDelete: true
            } };
          }
        }
      }

      if (fruehAntwort) {
        await client.query('ROLLBACK');
      } else {
        await sichereKonfiZeitBefoerderter(client, jahrgangId, organizationId, req.user.id);

        // 1. Chat des Jahrgangs (mit oder ohne Nachrichten, s.o.)
        chatDateien.push(...await loescheChatRaeume(client, chatRooms.map(room => room.id)));

        // 2. Termine und Challenges, die nur diesem Jahrgang gehoeren
        const umfang = await ladeLoeschumfang(client, jahrgangId, organizationId);
        for (const termin of umfang.termineLoeschen) {
          const ergebnis = await loescheTermin(client, termin.id, { punkteZuruecknehmen: false });
          chatDateien.push(...ergebnis.dateien);
          if (ergebnis.geloescht) geloeschteTermine++;
        }
        for (const challengeId of umfang.challengesLoeschen) {
          const ergebnis = await loescheChallenge(client, challengeId, organizationId, { teamStempelBewahren: true });
          challengeDateien.push(...ergebnis.dateien);
          if (ergebnis.geloescht) geloeschteChallenges++;
        }

        // 2b. Material, das nur an diesem Jahrgang haengt, wird ausdruecklich
        // global -- VOR dem Jahrgang, dessen Kaskade die
        // Zuordnungen nimmt. Material mit weiteren Jahrgaengen verliert nur
        // die Zuordnung (Schritt 5).
        await materialGlobalMachen(client, umfang);

        // 3. konfi_profiles beförderter Ex-Konfis (Rolle != konfi) werden vom
        // Jahrgang GELOEST (jahrgang_id = NULL), NICHT gelöscht. Sonst blockiert
        // der NO-ACTION-FK konfi_profiles.jahrgang_id den Jahrgang-Delete.
        // WICHTIG: Die WERTE des beförderten Konfis (gottesdienst_points/
        // gemeinde_points, current_level_id, konfspruch_*) stehen IN
        // konfi_profiles -> das Profil MUSS erhalten bleiben, damit er seine
        // Werte später noch einsehen kann. Nur die Bindung an den geloeschten
        // Jahrgang fällt weg.
        // Dieselbe Abgrenzung wie Sperre und Sicherung: Rolle in der Gemeinde
        // des Profils (ROLLE_IN_PROFIL_GEMEINDE); wer dort nicht mehr Mitglied
        // ist, gilt nicht als aktive Konfi und wird ebenfalls geloest.
        await client.query(`
          UPDATE konfi_profiles kp
          SET jahrgang_id = NULL
          FROM users u
          WHERE kp.user_id = u.id
            AND kp.jahrgang_id = $1 AND COALESCE(${ROLLE_IN_PROFIL_GEMEINDE}, '') <> 'konfi'
        `, [jahrgangId]);

        // 4. Rueckblick-Ausgaben des Jahrgangs:
        // Seit Migration 162 haengt wrapped_ausgaben.jahrgang_id mit
        // ON DELETE SET NULL am Jahrgang -- die Ausgaben und damit die
        // Snapshots befoerderter Ex-Konfis ueberleben das Loeschen, genau
        // wie ihr konfi_profiles-Eintrag oben. Vorher nahm ein CASCADE
        // Ausgabe und Snapshots mit; ohne Jahrgang ist der Rueckblick nicht
        // neu erzeugbar. Was hier noch weg darf: Konfi-Ausgaben dieses
        // Jahrgangs OHNE einen einzigen Snapshot -- die haetten sonst als
        // leere, jahrgangslose Huelle in der Liste der Leitung gestanden.
        await client.query(`
          DELETE FROM wrapped_ausgaben a
          WHERE a.jahrgang_id = $1 AND a.wrapped_type = 'konfi'
            AND NOT EXISTS (SELECT 1 FROM wrapped_snapshots s WHERE s.ausgabe_id = a.id)
        `, [jahrgangId]);

        // 5. Der Jahrgang. Zuordnungen von Terminen, Challenges, Material,
        // Personen und Einladungscodes gehen per ON DELETE CASCADE mit
        // (Material ohne weiteren Jahrgang ist seit 2b global).
        const { rowCount } = await client.query(
          'DELETE FROM jahrgaenge WHERE id = $1 AND organization_id = $2',
          [jahrgangId, organizationId]
        );

        if (rowCount === 0) {
          await client.query('ROLLBACK');
          fruehAntwort = { status: 404, body: { error: 'Jahrgang nicht gefunden' } };
        } else {
          // 6. Die Warnung "Jahrgang wird bald geloescht" ist erledigt -- weg
          // damit aus dem Postfach der Leitung (utils/postfachAufraeumen.js).
          await loescheMitteilungenZuJahrgang(client, jahrgangId);
          await client.query('COMMIT');
        }
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
 console.error('Database error in DELETE /api/jahrgaenge/:jahrgangId:', jahrgangId, err);
      return res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      client.release();
    }

    if (fruehAntwort) {
      return res.status(fruehAntwort.status).json(fruehAntwort.body);
    }

    // Dateien erst nach dem COMMIT: Ein ROLLBACK soll keine Anhaenge und
    // Beitraege verlieren, deren Zeilen noch stehen.
    await entferneChatDateien(chatDateien);
    await entferneChallengeDateien(challengeDateien);

    res.json({ message: 'Jahrgang erfolgreich gelöscht' });

    // Live-Update an alle Admins senden
    liveUpdate.sendToOrgAdmins(organizationId, 'jahrgaenge', 'delete');
    // Termin- und Challenge-Listen neu laden lassen -- nur die Anzahl, kein
    // Inhalt.
    if (geloeschteTermine > 0) {
      liveUpdate.sendToOrg(organizationId, 'events', 'delete', { count: geloeschteTermine });
    }
    if (geloeschteChallenges > 0) {
      liveUpdate.sendToOrg(organizationId, 'challenges', 'delete', { count: geloeschteChallenges });
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

      if (!darfJahrgang(req, jahrgangId)) {
        return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
      }

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
        SELECT eb.event_id, eb.user_id, eb.status, eb.attendance_status,
               eb.excuse_reason, eb.attendance_note
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
      console.error('Database error in GET /api/admin/jahrgaenge/:jahrgangId/attendance-matrix:', jahrgangId, err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ------------------------------------------------------------------
  // Hilfsfunktionen für die Konfispruch-Liste + den Konfirmationstermin
  // ------------------------------------------------------------------

  // Loest für jeden Konfi eines Jahrgangs den gewaehlten Konfispruch auf
  // (Listen-Wahl ODER Freitext, genau wie der Builder in konfi.js:486-522).
  // WICHTIG (W1): Die Uebersetzung kommt aus der DEDIZIERTEN Spalte
  // kp.konfspruch_translation (NICHT users.bible_translation -- das ist die
  // separate Tageslosungs-Praeferenz; sie lag bis Migration 132 als
  // kp.bible_translation daneben, liegt seither nur noch an users).
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

    // Alle Listen-Sprueche der Konfis in EINER Abfrage holen statt pro Konfi
    // einzeln (N+1). Vorbild: material.js laedt Events/Jahrgaenge fuer alle
    // Materialien gebuendelt und ordnet sie danach im Speicher zu.
    // Die Uebersetzung haengt am Konfi, nicht am Spruch -> das Paar
    // (spruch_id, translation) ist der Schluessel; deshalb wird das
    // Uebersetzungs-JOIN ueber genau die vorkommenden Paare gefuehrt.
    const spruchPaare = [];
    const paarGesehen = new Set();
    for (const konfi of konfis) {
      if (!konfi.konfspruch_id) continue;
      const translation = konfi.konfspruch_translation || 'luther2017';
      const schluessel = `${konfi.konfspruch_id}|${translation}`;
      if (paarGesehen.has(schluessel)) continue;
      paarGesehen.add(schluessel);
      spruchPaare.push({ id: konfi.konfspruch_id, translation });
    }

    const spruecheNachSchluessel = new Map();
    if (spruchPaare.length > 0) {
      const { rows: geladeneSprueche } = await db.query(`
        SELECT ks.id, ks.reference, ku.text, paar.translation
        FROM unnest($1::int[], $2::text[]) AS paar(spruch_id, translation)
        JOIN konfsprueche ks ON ks.id = paar.spruch_id
        LEFT JOIN konfspruch_uebersetzungen ku
          ON ku.spruch_id = ks.id AND ku.translation = paar.translation
        WHERE ks.is_active = true
          AND (ks.organization_id IS NULL OR ks.organization_id = $3)
      `, [
        spruchPaare.map(p => p.id),
        spruchPaare.map(p => p.translation),
        organizationId
      ]);
      for (const spruch of geladeneSprueche) {
        spruecheNachSchluessel.set(`${spruch.id}|${spruch.translation}`, spruch);
      }
    }

    const result = [];
    for (const konfi of konfis) {
      let konfspruch = null;
      if (konfi.konfspruch_id) {
        // Listen-Wahl: gewaehlte Konfispruch-Uebersetzung aus der Sammel-Abfrage.
        const spruchTranslation = konfi.konfspruch_translation || 'luther2017';
        const spruch = spruecheNachSchluessel.get(`${konfi.konfspruch_id}|${spruchTranslation}`);
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

      if (!darfJahrgang(req, jahrgangId)) {
        return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
      }

      const sprueche = await buildSpruecheList(jahrgangId, req.user.organization_id);
      res.json(sprueche);
    } catch (err) {
      console.error('Database error in GET /api/admin/jahrgaenge/:jahrgangId/sprueche:', jahrgangId, err);
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

      // Jahrgangs-Bindung: Der Versand schickt dieselben Daten
      // wie Matrix bzw. Sprueche-Liste — gleiche Schranke (view) wie dort.
      if (!darfJahrgang(req, jahrgangId)) {
        return res.status(403).json({ error: 'Kein Zugriff auf diesen Jahrgang' });
      }

      // E-Mail-Adresse der Admin:in laden (req.user enthält KEINE email -> aus users-Tabelle).
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
          SELECT eb.user_id, eb.status, eb.attendance_status
          FROM event_bookings eb
          WHERE eb.event_id = ANY($1::int[])
            AND eb.user_id = ANY($2::int[])
        `, [eventIds, konfis.map(k => k.user_id)]) : { rows: [] };

        const totalEvents = eventIds.length;
        rows = konfis.map(k => {
          const own = bookings.filter(b => b.user_id === k.user_id);
          const present = own.filter(b => b.attendance_status === 'present').length;
          const optedOut = own.filter(b => b.status === 'opted_out').length;
          return {
            display_name: k.display_name,
            present_count: present,
            total_count: totalEvents - optedOut
          };
        });
      }

      // Ohne Jahrgangsname und Adresse:
      // Kennung und Domain genuegen, um einen Versand wiederzufinden.
      console.log(`[matrix-email] Versand angefordert: Jahrgang ${jahrgangId}, type=${type}, an=Konto ${req.user.id} (${adresseFuersProtokoll(adminRow.email)}), rows=${rows.length}`);
      const mailResult = await emailService.sendKonfiMatrixEmail(
        adminRow.email,
        adminRow.display_name,
        jahrgang.name,
        type,
        rows
      );
      console.log(`[matrix-email] Versand-Ergebnis:`, JSON.stringify(mailResult));
      res.json({ success: true });
    } catch (err) {
      console.error('Database error in POST /api/admin/jahrgaenge/:jahrgangId/matrix-email:', jahrgangId, err);
      res.status(500).json({ error: 'Fehler beim Senden der E-Mail' });
    }
  });

  return router;
};
