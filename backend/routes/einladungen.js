const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { canCreateRole } = require('../utils/roleHierarchy');
const { nachAntwort } = require('../utils/nachAntwort');
const { rollenAnzeigename } = require('../utils/rollenNamen');
const { invalidateUserCache } = require('../middleware/rbac');
const liveUpdate = require('../utils/liveUpdate');
const { loescheMitteilungenZuEinladung } = require('../utils/postfachAufraeumen');
const { istIrgendwoKonfi, pruefeKonfiOderTeam } = require('../utils/konfiOderTeam');

// Einladung einer bestehenden Person in eine weitere Gemeinde.
//
// WARUM EINE BESTAETIGUNG: Eine Mitgliedschaft aendert, was jemand sieht und
// darf. Sie entsteht deshalb nicht ueber den Kopf der Person hinweg -- bis zur
// Annahme steht in org_einladungen nur eine Absicht.
//
// DIE GRENZEN, jede einzeln im Test mit Gegenprobe:
//  - nur org_admin darf einladen (requireOrgAdmin)
//  - niemals die konfi-Rolle. canCreateRole('org_admin','konfi') liefert TRUE,
//    die Hierarchie allein sichert das also NICHT ab.
//  - die Rolle muss zur einladenden Gemeinde gehoeren (roles.organization_id)
//  - niemand laedt sich selbst ein
//  - keine zweite Einladung, wenn schon Mitglied oder schon eine offene da ist
//  - annehmen und ablehnen darf nur die eingeladene Person selbst
//  - eine abgelaufene Einladung laesst sich nicht mehr annehmen (410)
module.exports = (db, rbacVerifier, roleHelpers) => {
  const { requireOrgAdmin } = roleHelpers;
  const PushService = require('../services/pushService');
  const emailService = require('../services/emailService');

  // 14 Tage wie die Einladungscodes fuer Konfis (Migration 079).
  const GUELTIG_MS = 14 * 24 * 60 * 60 * 1000;

  /** Die Einladung samt Namen -- fuer Liste, Annahme und Ablehnung. */
  const EINLADUNG_FELDER = `
      e.id, e.organization_id, e.user_id, e.role_id, e.status,
      e.expires_at, e.created_at,
      o.display_name AS organization_display_name, o.name AS organization_name,
      r.name AS role_name, r.display_name AS role_display_name,
      lader.display_name AS eingeladen_von_name`;
  const EINLADUNG_JOINS = `
      FROM org_einladungen e
      JOIN organizations o ON o.id = e.organization_id
      JOIN roles r ON r.id = e.role_id
      LEFT JOIN users lader ON lader.id = e.eingeladen_von`;

  // ==================================================================
  // Die Leitung: einladen, sehen, zurueckziehen
  // ==================================================================

  router.post('/',
    rbacVerifier, requireOrgAdmin,
    body('kennung').isString().trim().isLength({ min: 1, max: 255 }),
    body('role_id').isInt({ min: 1 }),
    handleValidationErrors,
    async (req, res) => {
      const organizationId = req.user.organization_id;
      const { kennung, role_id } = req.body;

      try {
        // Die Rolle muss zu DIESER Gemeinde gehoeren. Rollen sind je
        // Organisation eigene Zeilen -- ohne die Pruefung bekaeme jemand die
        // Rolle einer fremden Gemeinde (dasselbe Muster wie auth.js:985).
        const { rows: [rolle] } = await db.query(
          'SELECT id, name FROM roles WHERE id = $1 AND organization_id = $2',
          [role_id, organizationId]
        );
        if (!rolle) {
          return res.status(400).json({ error: 'Ungültige Rolle für diese Gemeinde' });
        }

        // KONFI NIE. Steht hier zusaetzlich zum CHECK der Migration, weil
        // canCreateRole('org_admin', 'konfi') true liefert -- die Hierarchie
        // allein wuerde es durchlassen.
        if (rolle.name === 'konfi') {
          return res.status(400).json({
            error: 'Konfis werden über einen Einladungscode aufgenommen, nicht über eine Einladung.',
            error_code: 'konfi_nicht_moeglich'
          });
        }
        if (!canCreateRole(req.user.role_name, rolle.name)) {
          return res.status(403).json({ error: `Du kannst die Rolle '${rolle.name}' nicht vergeben.` });
        }

        // Benutzername ODER E-Mail, beides exakt. Keine
        // Teilsuche: Sonst liesse sich der Bestand fremder Gemeinden
        // durchblaettern.
        const { rows: [ziel] } = await db.query(
          `SELECT u.id, u.display_name, u.username, u.email, r.name AS role_name
             FROM users u
             JOIN roles r ON r.id = u.role_id
            WHERE u.deleted_at IS NULL
              AND (LOWER(u.username) = LOWER($1) OR LOWER(u.email) = LOWER($1))
            LIMIT 1`,
          [kennung]
        );
        if (!ziel || ziel.role_name === 'konfi' || await istIrgendwoKonfi(db, ziel.id)) {
          return res.status(404).json({
            error: 'Kein Konto mit diesem Benutzernamen oder dieser E-Mail-Adresse.',
            error_code: 'nicht_gefunden'
          });
        }
        if (Number(ziel.id) === Number(req.user.id)) {
          return res.status(400).json({ error: 'Du kannst dich nicht selbst einladen.' });
        }

        // Schon Mitglied? Beide Quellen -- Stamm-Gemeinde und
        // user_organizations (utils/orgMitglieder.js beschreibt das Muster).
        const { rows: [mitglied] } = await db.query(
          `SELECT 1 FROM users u
            WHERE u.id = $1 AND u.organization_id = $2
            UNION ALL
           SELECT 1 FROM user_organizations uo
            WHERE uo.user_id = $1 AND uo.organization_id = $2
            LIMIT 1`,
          [ziel.id, organizationId]
        );
        if (mitglied) {
          return res.status(409).json({
            error: `${ziel.display_name} arbeitet bereits in dieser Gemeinde.`,
            error_code: 'schon_mitglied'
          });
        }

        const expiresAt = new Date(Date.now() + GUELTIG_MS);
        let einladung;
        const client = await db.getClient();
        try {
          await client.query('BEGIN');
          // ABGELAUFENE EINLADUNG RAEUMEN: Nach 14 Tagen bleibt
          // der Status 'offen', nur expires_at liegt zurueck. Der Teilindex
          // idx_org_einladungen_offen kennt nur den Status -- ohne diesen
          // Schritt sperrte die abgelaufene Einladung jede neue fuer dieselbe
          // Person (409), obwohl Liste und Karte sie laengst nicht mehr
          // zeigten. Sie geht samt Postfach-Eintrag; beantwortete Einladungen
          // (Verlauf) und die anderer Personen bleiben.
          const { rows: abgelaufen } = await client.query(
            `DELETE FROM org_einladungen
              WHERE organization_id = $1 AND user_id = $2
                AND status = 'offen' AND expires_at <= NOW()
              RETURNING id`,
            [organizationId, ziel.id]
          );
          for (const { id } of abgelaufen) {
            await loescheMitteilungenZuEinladung(client, id);
          }
          const { rows: [neu] } = await client.query(
            `INSERT INTO org_einladungen
               (organization_id, user_id, role_id, eingeladen_von, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, expires_at`,
            [organizationId, ziel.id, rolle.id, req.user.id, expiresAt]
          );
          await client.query('COMMIT');
          einladung = neu;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          // Der Teilindex idx_org_einladungen_offen laesst nur EINE offene
          // Einladung je Person und Gemeinde zu.
          if (err.code === '23505') {
            return res.status(409).json({
              error: `Für ${ziel.display_name} steht bereits eine Einladung offen.`,
              error_code: 'schon_eingeladen'
            });
          }
          throw err;
        } finally {
          client.release();
        }

        // Antwortform: das Noetige fuer die Liste, additiv erweiterbar.
        res.status(201).json({
          id: einladung.id,
          user_id: ziel.id,
          display_name: ziel.display_name,
          username: ziel.username,
          role_id: rolle.id,
          role_name: rolle.name,
          status: 'offen',
          expires_at: einladung.expires_at
        });

        // Postfach, Push und E-Mail NACH der Antwort: Die Einladung steht
        // bereits, der Versand ist Beiwerk (utils/nachAntwort.js).
        nachAntwort(req, async () => {
          const orgName = req.user.organization_name || 'einer Gemeinde';
          await PushService.sendGemeindeEinladungToUser(
            db, ziel.id, orgName, rollenAnzeigename(rolle.name), einladung.id, organizationId
          );
          if (ziel.email) {
            await emailService.sendGemeindeEinladungEmail(
              ziel.email, ziel.display_name, orgName,
              rollenAnzeigename(rolle.name), einladung.expires_at
            );
          }
        }, 'Einladung melden');
      } catch (err) {
        console.error('Database error in POST /einladungen:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    });

  router.get('/', rbacVerifier, requireOrgAdmin, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT ${EINLADUNG_FELDER}, ziel.display_name AS display_name, ziel.username
         ${EINLADUNG_JOINS}
         JOIN users ziel ON ziel.id = e.user_id
          WHERE e.organization_id = $1 AND e.status = 'offen' AND e.expires_at > NOW()
          ORDER BY e.created_at DESC`,
        [req.user.organization_id]
      );
      res.json(rows);
    } catch (err) {
      console.error('Database error in GET /einladungen:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  router.delete('/:id',
    rbacVerifier, requireOrgAdmin,
    param('id').isInt({ min: 1 }), handleValidationErrors,
    async (req, res) => {
      try {
        // Status und Postfach in EINER Transaktion: "Einladung in eine
        // Gemeinde ... Tippe, um zu antworten" geht mit dem Zurueckziehen
        // Vorher blieb der Eintrag bei der eingeladenen Person
        // stehen, zaehlte als ungelesen und fuehrte ins leere Profil
        // (utils/postfachAufraeumen.js). Scheitert das Aufraeumen, bleibt
        // auch die Einladung offen -- kein halber Stand.
        const client = await db.getClient();
        let zurueckgezogen = false;
        try {
          await client.query('BEGIN');
          const { rowCount } = await client.query(
            `UPDATE org_einladungen
                SET status = 'zurueckgezogen', beantwortet_at = NOW()
              WHERE id = $1 AND organization_id = $2 AND status = 'offen'`,
            [req.params.id, req.user.organization_id]
          );
          if (rowCount) {
            await loescheMitteilungenZuEinladung(client, req.params.id);
            zurueckgezogen = true;
          }
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw txErr;
        } finally {
          client.release();
        }
        if (!zurueckgezogen) {
          return res.status(404).json({ error: 'Einladung nicht gefunden' });
        }
        res.json({ message: 'Einladung zurückgezogen' });
      } catch (err) {
        console.error('Database error in DELETE /einladungen:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    });

  // ==================================================================
  // Die eingeladene Person: sehen, annehmen, ablehnen
  // ==================================================================

  router.get('/meine', rbacVerifier, async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT ${EINLADUNG_FELDER}
         ${EINLADUNG_JOINS}
          WHERE e.user_id = $1 AND e.status = 'offen' AND e.expires_at > NOW()
          ORDER BY e.created_at DESC`,
        [req.user.id]
      );
      res.json(rows);
    } catch (err) {
      console.error('Database error in GET /einladungen/meine:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  /** Gemeinsame Vorpruefung von Annehmen und Ablehnen. */
  const holeEigeneEinladung = async (id, userId) => {
    const { rows: [e] } = await db.query(
      `SELECT id, organization_id, user_id, role_id, status, expires_at, eingeladen_von
         FROM org_einladungen WHERE id = $1`,
      [id]
    );
    // Eine fremde Einladung wird wie eine nicht vorhandene behandelt: Sonst
    // liesse sich durch Durchprobieren erkennen, welche Kennungen es gibt.
    if (!e || Number(e.user_id) !== Number(userId)) {
      return { fehler: { status: 404, body: { error: 'Einladung nicht gefunden' } } };
    }
    if (e.status !== 'offen') {
      return { fehler: { status: 409, body: { error: 'Diese Einladung ist bereits beantwortet.', error_code: 'schon_beantwortet' } } };
    }
    // Zweistufig wie bei den Einladungscodes: "gibt es nicht" und "abgelaufen"
    // sind unterscheidbare Antworten (auth.js:898-916).
    if (new Date(e.expires_at) <= new Date()) {
      return { fehler: { status: 410, body: { error: 'Diese Einladung ist abgelaufen.', error_code: 'expired' } } };
    }
    return { einladung: e };
  };

  const meldeAntwort = async (einladung, angenommen) => {
    const { rows: [namen] } = await db.query(
      `SELECT u.display_name AS person, r.display_name AS rolle_anzeige, r.name AS rolle,
              COALESCE(o.display_name, o.name) AS gemeinde
         FROM users u, roles r, organizations o
        WHERE u.id = $1 AND r.id = $2 AND o.id = $3`,
      [einladung.user_id, einladung.role_id, einladung.organization_id]
    );
    await PushService.sendEinladungBeantwortetToLeitung(db, {
      einladungId: einladung.id,
      organizationId: einladung.organization_id,
      eingeladenVon: einladung.eingeladen_von,
      eingeladenId: einladung.user_id,
      personName: namen?.person,
      rolleName: rollenAnzeigename(namen?.rolle, namen?.rolle_anzeige),
      orgName: namen?.gemeinde,
      angenommen
    });
  };

  router.post('/:id/annehmen',
    rbacVerifier, param('id').isInt({ min: 1 }), handleValidationErrors,
    async (req, res) => {
      try {
        const { fehler, einladung } = await holeEigeneEinladung(req.params.id, req.user.id);
        if (fehler) return res.status(fehler.status).json(fehler.body);

        const { rows: [angebot] } = await db.query('SELECT name FROM roles WHERE id = $1', [einladung.role_id]);
        const konflikt = await pruefeKonfiOderTeam(db, {
          userId: einladung.user_id,
          organizationId: einladung.organization_id,
          rolle: angebot && angebot.name
        });
        if (konflikt) return res.status(409).json(konflikt);

        const client = await db.getClient();
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE org_einladungen
                SET status = 'angenommen', beantwortet_at = NOW()
              WHERE id = $1 AND status = 'offen'`,
            [einladung.id]
          );
          await loescheMitteilungenZuEinladung(client, einladung.id);
          // Die Mitgliedschaft entsteht ERST hier -- das ist der Kern des
          // Features. ON CONFLICT DO NOTHING, falls sie zwischenzeitlich von
          // Hand angelegt wurde.
          await client.query(
            `INSERT INTO user_organizations (user_id, organization_id, role_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [einladung.user_id, einladung.organization_id, einladung.role_id]
          );
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw txErr;
        } finally {
          client.release();
        }

        // Ohne das haelt der RBAC-Cache (30 s) die alte Zugehoerigkeit fest --
        // der Gemeinde-Umschalter zeigte die neue Gemeinde erst verspaetet.
        invalidateUserCache(req.user.id);

        const { rows: [org] } = await db.query(
          'SELECT id, name, slug, display_name FROM organizations WHERE id = $1',
          [einladung.organization_id]
        );
        res.json({ message: 'Einladung angenommen', organization: org });

        // Die einladende Leitung erfaehrt es, und die Benutzerliste
        // der Gemeinde laedt nach -- dort steht die Person jetzt (Live-
        // Signal 'users' wie in routes/users.js).
        nachAntwort(req, async () => {
          liveUpdate.sendToOrgAdmins(einladung.organization_id, 'users', 'update', { userId: Number(einladung.user_id) });
          await meldeAntwort(einladung, true);
        }, 'Einladung angenommen melden');
      } catch (err) {
        console.error('Database error in POST /einladungen/annehmen:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    });

  router.post('/:id/ablehnen',
    rbacVerifier, param('id').isInt({ min: 1 }), handleValidationErrors,
    async (req, res) => {
      try {
        const { fehler, einladung } = await holeEigeneEinladung(req.params.id, req.user.id);
        if (fehler) return res.status(fehler.status).json(fehler.body);

        // Status und Postfach in EINER Transaktion wie beim Zurueckziehen
        // Der Eintrag "Tippe, um zu antworten" geht mit der
        // Absage; die Absage an die Leitung (meldeAntwort unten) bleibt.
        const client = await db.getClient();
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE org_einladungen
                SET status = 'abgelehnt', beantwortet_at = NOW()
              WHERE id = $1 AND status = 'offen'`,
            [einladung.id]
          );
          await loescheMitteilungenZuEinladung(client, einladung.id);
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw txErr;
        } finally {
          client.release();
        }
        res.json({ message: 'Einladung abgelehnt' });

        // Auch die Absage erfaehrt die einladende Leitung.
        nachAntwort(req, () => meldeAntwort(einladung, false), 'Einladung abgelehnt melden');
      } catch (err) {
        console.error('Database error in POST /einladungen/ablehnen:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    });

  return router;
};
