const express = require('express');
const { gruppenFuerRolle, bereinigeStumm } = require('../utils/pushGruppen');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { challengeNeuigkeitenJeChallenge, challengeNeuigkeitenLeitungJeChallenge } = require('../utils/challengeNeuigkeiten');
const { appIconSummenAllerGemeinden } = require('../utils/appIconBadge');
const { leitungSiehtChallengeSql } = require('../utils/challengeLeitungSicht');
const { leitungSiehtAlleAntraege, gebundeneLeitungSiehtAntragSql } = require('../utils/antragLeitungSicht');
const { leitungSiehtAlleTermine, gebundeneLeitungSiehtTerminSql, terminWartetAufVerbuchungSql } = require('../utils/terminLeitungSicht');
const { kennwortFuersProtokoll, diagnoseHinweisFuersProtokoll } = require('../utils/protokoll');
const { wegAusAnmeldung, startbildschirmAusAnmeldung } = require('../utils/appSymbolWeg');

module.exports = (db, verifyTokenRBAC) => {
  const router = express.Router();

  // Validierungsregeln
  const validateDeviceToken = [
    body('token').notEmpty().withMessage('Push-Token ist erforderlich'),
    body('platform').isIn(['ios', 'android', 'web']).withMessage('Ungültige Plattform'),
    body('app_version').optional({ nullable: true }).isString().isLength({ max: 32 }),
    body('app_build').optional({ nullable: true }).isString().isLength({ max: 32 }),
    handleValidationErrors
  ];

  const validateDeleteToken = [
    body('device_id').notEmpty().withMessage('Geräte-ID ist erforderlich'),
    body('platform').notEmpty().withMessage('Plattform ist erforderlich'),
    handleValidationErrors
  ];

  router.get('/badge-counts', verifyTokenRBAC, async (req, res) => {
    try {
      const userId = req.user.id;
      const userType = req.user.type;
      const organizationId = req.user.organization_id;

      const chatQuery = `
        SELECT r.id AS room_id,
               (
                 SELECT COUNT(*)
                 FROM chat_messages m
                 WHERE m.room_id = r.id
                 AND m.deleted_at IS NULL
                 AND m.created_at > COALESCE(crs.last_read_at, '1970-01-01')
                 AND m.created_at <= NOW()
                 -- Eigene Nachrichten zählen nicht als ungelesen. Ohne diese
                 -- Zeile stand nach der eigenen letzten Nachricht eine Eins am
                 -- Reiter, die erst beim Oeffnen des Raums verschwand — und wer
                 -- ihn nicht mehr oeffnete, sah sie dauerhaft. Die Zählung im
                 -- Hintergrunddienst schließt sie seit jeher aus
                 -- (backgroundService.js), diese hier nicht.
                 AND NOT (m.user_id = $1 AND m.user_type = $2)
               ) AS unread_count
        FROM chat_rooms r
        INNER JOIN chat_participants p ON r.id = p.room_id AND p.user_id = $1 AND p.user_type = $2
        LEFT JOIN chat_read_status crs ON r.id = crs.room_id AND crs.user_id = $1 AND crs.user_type = $2
        WHERE r.organization_id = $3
      `;

      // Pending-Zähler nur für Admin-Typen (Konfis/Teamer nutzen sie im
      // Frontend nicht — BadgeContext zeigt sie nur für isAdmin).
      const isAdminType = userType === 'admin';
      const zero = Promise.resolve({ rows: [{ c: 0 }] });

      const istGebundenerAdmin = req.user.role_name === 'admin' && !req.user.is_super_admin;

      // Offene Challenge-Freigaben: org_admin org-weit; Teamer und gebundene
      // Admins nur für Challenges ihrer zugewiesenen Jahrgänge (gleiche
      // Grenze wie viewableJahrgangIds in routes/challenges.js — niemand soll
      // auf Freigaben gestupst werden, deren Challenge er gar nicht oeffnen
      // darf).
      const eigeneJahrgangIds = (userType === 'teamer' || istGebundenerAdmin)
        ? (req.user.assigned_jahrgaenge || []).filter(j => j.can_view).map(j => j.id)
        : [];
      let challengesPromise = Promise.resolve({ rows: [] });
      if (isAdminType && !istGebundenerAdmin) {
        challengesPromise = db.query(
          `SELECT cs.challenge_id, COUNT(*)::int AS c
           FROM challenge_submissions cs
           JOIN challenges c ON cs.challenge_id = c.id
           WHERE c.organization_id = $1 AND cs.moderation_status = 'pending'
           GROUP BY cs.challenge_id`,
          [organizationId]
        );
      } else if (userType === 'teamer' || istGebundenerAdmin) {
        // 'nur_team'-Challenges laufen org-weit ueber die Rolle (Migration 121):
        // Jede:r Teamer:in der Organisation darf sie sehen und moderieren, auch
        // ohne Jahrgangs-Zuordnung -- die es dort per Definition nicht gibt.
        // Dieselbe Ausnahme steht in challenges.js (leadershipMayAccess und die
        // Listen-Abfrage).
        challengesPromise = db.query(
          `SELECT cs.challenge_id, COUNT(*)::int AS c
           FROM challenge_submissions cs
           JOIN challenges c ON cs.challenge_id = c.id
           WHERE c.organization_id = $1
             AND cs.moderation_status = 'pending'
             AND ${leitungSiehtChallengeSql({ rolle: '$3', jahrgaenge: '$2::int[]' })}
           GROUP BY cs.challenge_id`,
          [organizationId, eigeneJahrgangIds, req.user.role_name]
        );
      }

      // Die Fortschrittsberechnung braucht es dafuer NICHT: user_badges.seen
      // gilt fuer beide Rollen, custom_badges.target_role trennt sie. Eine
      // COUNT-Abfrage genuegt.
      // Die Leitung kann keine Abzeichen verdienen -> immer 0.
      const badgesPromise = (userType === 'konfi' || userType === 'teamer')
        ? db.query(
            `SELECT COUNT(*)::int AS c
             FROM user_badges ub
             JOIN custom_badges cb ON ub.badge_id = cb.id
             WHERE ub.user_id = $1
               AND ub.organization_id = $2
               AND ub.seen = false
               AND COALESCE(cb.target_role, 'konfi') = $3`,
            [userId, organizationId, userType]
          )
        : zero;

      let requestsPromise = zero;
      if (isAdminType && leitungSiehtAlleAntraege(req.user)) {
        requestsPromise = db.query(
          `SELECT COUNT(*)::int AS c
           FROM activity_requests ar
           JOIN activities a ON ar.activity_id = a.id
           WHERE a.organization_id = $1 AND ar.status = 'pending'`,
          [organizationId]
        );
      } else if (isAdminType) {
        requestsPromise = db.query(
          `SELECT COUNT(*)::int AS c
           FROM activity_requests ar
           JOIN activities a ON ar.activity_id = a.id
           WHERE a.organization_id = $1 AND ar.status = 'pending'
             AND ${gebundeneLeitungSiehtAntragSql({ jahrgaenge: '$2::int[]' })}`,
          [organizationId, eigeneJahrgangIds]
        );
      }

      // pendingEvents: fuer gebundene Admins mit demselben Sichtbarkeits-
      // Filter wie die Terminliste (events/lesen.js) — Termine ohne Jahrgang
      // und Teamer-Termine zaehlen immer, jahrgangsgebundene nur aus
      // zugewiesenen Jahrgaengen.
      //
      // Abgesagte Termine zaehlen NICHT: Der "Verbuchen"-Tab blendet sie aus,
      // also stuende sonst eine rote Zahl am Reiter, hinter der eine leere
      // Liste wartet — dieselbe Fehlerklasse wie oben bei der
      // Jahrgangs-Bindung. `IS NOT TRUE` statt `= FALSE`, weil die Spalte
      // nullable ist: Termine aus dem Altbestand haben dort NULL und sind
      // damit nicht abgesagt.
      let eventsPromise = zero;
      if (isAdminType) {
        const gebunden = !leitungSiehtAlleTermine(req.user);
        const eventSichtFilter = gebunden
          ? `AND ${gebundeneLeitungSiehtTerminSql({ jahrgaenge: '$2::int[]' })}`
          : '';
        const eventParams = gebunden
          ? [organizationId, eigeneJahrgangIds]
          : [organizationId];
        eventsPromise = db.query(
          `SELECT COUNT(*)::int AS c
           FROM events e
           WHERE e.organization_id = $1
           AND ${terminWartetAufVerbuchungSql()}
           ${eventSichtFilter}`,
          eventParams
        );
      }

      const neuigkeitenPromise = (userType === 'konfi')
        ? challengeNeuigkeitenJeChallenge(db, [{ id: userId, type: userType, organization_id: organizationId }])
        : challengeNeuigkeitenLeitungJeChallenge(db, [{
            id: userId,
            type: userType,
            organization_id: organizationId,
            role_name: (req.user.role_name === 'admin' && req.user.is_super_admin) ? 'org_admin' : req.user.role_name,
            assigned_jahrgaenge: req.user.assigned_jahrgaenge || []
          }]);

      // Postfach: ungelesene Mitteilungen des KONTOS ueber alle
      // Organisationen -- dieselbe Zaehlung wie GET /postfach.ungelesen, damit
      // Glocke und Liste nie auseinanderlaufen. Bewusst OHNE Org-Filter (siehe
      // Begruendung an der Postfach-Route).
      const postfachPromise = db.query(
        `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
        [userId]
      );

      const [chatRes, requestsRes, eventsRes, challengesRes, badgesRes, neuigkeiten, postfachRes] = await Promise.all([
        db.query(chatQuery, [userId, userType, organizationId]),
        requestsPromise,
        eventsPromise,
        challengesPromise,
        badgesPromise,
        neuigkeitenPromise,
        postfachPromise
      ]);

      const byRoom = {};
      let total = 0;
      chatRes.rows.forEach((r) => {
        const unread = parseInt(r.unread_count, 10) || 0;
        byRoom[r.room_id] = unread;
        total += unread;
      });

      // Wie chat.byRoom: Zahl je Challenge fuer den Listeneintrag, Summe
      // fuer Reiter und App-Icon.
      const byChallenge = {};
      let neuigkeitenTotal = 0;
      neuigkeiten.forEach((r) => {
        if (!(r.c > 0)) return;
        byChallenge[r.challenge_id] = r.c;
        neuigkeitenTotal += r.c;
      });

      // Konfis: bleibt leer. Ihre Kugel liest challengeUpdates (dort zaehlen
      // auch Moderation eigener Beitraege und die neue Challenge -- das sind
      // keine "neuen Beitraege"); ein Doppel desselben Wertes haette nur eine
      // zweite Stelle geschaffen, die auseinanderlaufen kann.
      const neueBeitraegeByChallenge = {};
      const neueWartendByChallenge = {};
      let neueBeitraegeTotal = 0;
      if (userType !== 'konfi') {
        neuigkeiten.forEach((r) => {
          if (!(r.neu > 0)) return;
          neueBeitraegeByChallenge[r.challenge_id] = r.neu;
          neueBeitraegeTotal += r.neu;
          if (r.neu_wartend > 0) neueWartendByChallenge[r.challenge_id] = r.neu_wartend;
        });
      }

      // Offene Freigaben der Leitung, dieselbe Form. Fuer Konfis bleibt es
      // leer/0 -- ihr Anteil steht in challengeUpdates. Die beiden Zahlen
      // meinen Verschiedenes (Neuigkeiten vs. zu erledigende Freigaben) und
      // werden deshalb NIE in ein Feld gemischt; der Server liefert je
      // Rolle nur den passenden Anteil.
      const freigabenByChallenge = {};
      let freigabenTotal = 0;
      challengesRes.rows.forEach((r) => {
        freigabenByChallenge[r.challenge_id] = r.c;
        freigabenTotal += r.c;
      });

      res.json({
        chat: { total, byRoom },
        pendingRequests: requestsRes.rows[0]?.c || 0,
        pendingEvents: eventsRes.rows[0]?.c || 0,
        // Unveraendert eine Zahl: Store-Apps 2.2.x lesen sie so.
        pendingChallenges: freigabenTotal,
        newBadges: badgesRes.rows[0]?.c || 0,
        challengeUpdates: { total: neuigkeitenTotal, byChallenge },
        challengeApprovals: { total: freigabenTotal, byChallenge: freigabenByChallenge },
        challengeNeueBeitraege: {
          total: neueBeitraegeTotal,
          byChallenge: neueBeitraegeByChallenge,
          wartendByChallenge: neueWartendByChallenge
        },
        postfach: { ungelesen: postfachRes.rows[0]?.c || 0 }
      });
    } catch (err) {
      console.error('Database error in GET /notifications/badge-counts:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // GET /badge-counts/je-organisation
  //
  // EIGENE ROUTE, NICHT IN badge-counts: badge-counts wird bei jeder Zaehler-
  // Aktualisierung von JEDEM Konto abgefragt -- auch von den vielen Konfis,
  // die nur eine Gemeinde haben und den Umschalter nie sehen. Die Auflistung
  // hier braucht nur, wer den Umschalter oeffnet; die App fragt sie genau dann.
  // badge-counts bleibt unveraendert (Alt-App-Vertrag, Store-Apps 2.2.x).
  //
  // DIE ROLLE GILT JE GEMEINDE (utils/orgMitglieder.js): org_admin in A und
  // Teamer:in in B -> fuer B die Teamer-Zaehler. Die Jahrgangsbindung gilt
  // ebenso je Gemeinde, ueber die Zuweisungen auf DEREN Jahrgaenge.
  //
  // Zwei Abfragen fuer die Zugehoerigkeit plus EINE Zaehlrunde ueber alle
  // Gemeinden zusammen -- nicht eine Runde je Gemeinde.
  //
  // Sicherheitsgrenze: ausschliesslich req.user.id aus dem Token. Es gibt
  // keinen Parameter, mit dem sich eine fremde Gemeinde erfragen liesse; wer
  // einer Gemeinde nicht angehoert, bekommt fuer sie keinen Eintrag.
  router.get('/badge-counts/je-organisation', verifyTokenRBAC, async (req, res) => {
    try {
      const jePerson = await appIconSummenAllerGemeinden(db, [req.user.id]);
      const person = jePerson.get(Number(req.user.id));

      // Ein Objekt je Gemeinde (nicht nur eine Zahl), damit spaeter eine
      // Aufschluesselung dazukommen kann, ohne die Form zu aendern. Auch
      // Gemeinden mit 0 stehen drin: So kann die App "nichts offen" von
      // "keine Angabe" unterscheiden.
      const jeOrganisation = {};
      if (person) {
        for (const [organizationId, offen] of person.jeOrganisation) {
          jeOrganisation[organizationId] = { offen };
        }
      }
      res.json({ jeOrganisation });
    } catch (err) {
      console.error('Database error in GET /notifications/badge-counts/je-organisation:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ==========================================================================
  // POSTFACH
  //
  // Die Tabelle notifications wurde bis dahin an sechs Stellen GESCHRIEBEN
  // (Antragsentscheid, Abzeichen, Konfi- und Teamer-Meldungen), aber nirgends
  // gelesen: Wer eine Push-Nachricht wegwischte, hatte sie verloren. Diese
  // Routen machen daraus ein Postfach.
  //
  // Sicherheitsgrenze ist ausschliesslich notifications.user_id aus dem
  // geprueften Token -- dieselbe Grenze wie bei device-token und preferences.
  // ==========================================================================

  const POSTFACH_LIMIT_DEFAULT = 30;
  const POSTFACH_LIMIT_MAX = 100;

  // Liefert eine positive Ganzzahl oder null. Query-Parameter kommen als
  // Strings; "30abc" oder "-5" gelten als ungueltig, nicht als 30 bzw. 5.
  const positiveGanzzahl = (wert) => {
    if (typeof wert !== 'string' || !/^\d+$/.test(wert)) return null;
    const zahl = parseInt(wert, 10);
    return zahl > 0 && Number.isSafeInteger(zahl) ? zahl : null;
  };

  // data ist jsonb (prod-schema.sql): pg liefert bereits ein Objekt oder
  // null. Die App verlaesst sich auf "immer ein Objekt" -- deshalb NULL -> {}.
  // Der String-Zweig faengt den Fall ab, dass eine Schreibstelle doppelt
  // serialisiert hat (jsonb mit einem JSON-String als Wert); ein Parse-Fehler
  // ergibt ebenfalls {}, nie einen 500er fuer die ganze Liste.
  const alsObjekt = (data) => {
    if (data === null || data === undefined) return {};
    if (typeof data === 'string') {
      try {
        const geparst = JSON.parse(data);
        return geparst && typeof geparst === 'object' && !Array.isArray(geparst) ? geparst : {};
      } catch {
        return {};
      }
    }
    return typeof data === 'object' && !Array.isArray(data) ? data : {};
  };

  // GET /postfach?limit=30&vor=<id>
  // Neueste zuerst, Cursor ueber die id (monoton steigend, deshalb stabil
  // auch wenn waehrend des Blaetterns neue Eintraege dazukommen -- ein
  // OFFSET wuerde dann Eintraege doppelt oder gar nicht zeigen).
  router.get('/postfach', verifyTokenRBAC, async (req, res) => {
    try {
      const userId = req.user.id;
      const limit = Math.min(positiveGanzzahl(req.query.limit) || POSTFACH_LIMIT_DEFAULT, POSTFACH_LIMIT_MAX);
      const vor = positiveGanzzahl(req.query.vor);

      const params = [userId];
      let cursorFilter = '';
      if (vor !== null) {
        params.push(vor);
        cursorFilter = `AND n.id < $${params.length}`;
      }
      // limit + 1: ein Eintrag mehr als angezeigt verraet, ob es weitere gibt,
      // ohne eine zweite COUNT-Abfrage.
      params.push(limit + 1);

      const [eintraegeRes, ungelesenRes] = await Promise.all([
        db.query(
          `SELECT n.id, n.title, n.message, n.type, n.data, n.read_at, n.created_at,
                  n.organization_id,
                  COALESCE(o.display_name, o.name) AS organization_name
           FROM notifications n
           LEFT JOIN organizations o ON o.id = n.organization_id
           WHERE n.user_id = $1 ${cursorFilter}
           ORDER BY n.id DESC
           LIMIT $${params.length}`,
          params
        ),
        // Unabhaengig von der Seite: die Glocke zeigt alles Ungelesene, nicht
        // nur das der ersten 30.
        db.query(
          `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
          [userId]
        )
      ]);

      const weitere = eintraegeRes.rows.length > limit;
      const eintraege = eintraegeRes.rows.slice(0, limit).map((r) => ({
        id: r.id,
        title: r.title,
        message: r.message,
        type: r.type,
        data: alsObjekt(r.data),
        read_at: r.read_at,
        created_at: r.created_at,
        organization_id: r.organization_id,
        organization_name: r.organization_name ?? null
      }));

      res.json({ eintraege, ungelesen: ungelesenRes.rows[0]?.c || 0, weitere });
    } catch (err) {
      console.error('Database error in GET /notifications/postfach:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // PUT /postfach/gelesen -- alle eigenen ungelesenen auf einmal.
  // Steht bewusst VOR /postfach/:id/gelesen. Die Pfade kollidieren zwar nicht
  // (zwei gegen drei Segmente), aber so kann "gelesen" nie als :id gelesen
  // werden, falls die Einzelroute je auf zwei Segmente gekuerzt wird.
  router.put('/postfach/gelesen', verifyTokenRBAC, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
        [req.user.id]
      );
      res.json({ success: true, anzahl: rowCount });
    } catch (err) {
      console.error('Database error in PUT /notifications/postfach/gelesen:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // PUT /postfach/:id/gelesen -- eine eigene Mitteilung.
  // Idempotent: eine bereits gelesene Mitteilung liefert 200 mit dem
  // vorhandenen read_at. Fremde und nicht vorhandene Mitteilungen sind beide
  // 404 -- ein 403 wuerde verraten, dass die id existiert.
  router.put('/postfach/:id/gelesen', verifyTokenRBAC, async (req, res) => {
    const id = positiveGanzzahl(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Ungültige Mitteilungs-ID' });
    }
    try {
      const userId = req.user.id;
      const { rows } = await db.query(
        `UPDATE notifications SET read_at = NOW()
         WHERE id = $1 AND user_id = $2 AND read_at IS NULL
         RETURNING read_at`,
        [id, userId]
      );
      if (rows.length > 0) {
        return res.json({ success: true, id, read_at: rows[0].read_at });
      }
      // 0 Zeilen: entweder schon gelesen (dann idempotent 200) oder nicht
      // vorhanden bzw. fremd (404).
      const { rows: vorhanden } = await db.query(
        `SELECT read_at FROM notifications WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      if (vorhanden.length === 0) {
        return res.status(404).json({ error: 'Mitteilung nicht gefunden' });
      }
      res.json({ success: true, id, read_at: vorhanden[0].read_at });
    } catch (err) {
      console.error('Database error in PUT /notifications/postfach/:id/gelesen:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Push-Einstellungen des eingeloggten Users: Hauptschalter UND die
  // stummgeschalteten Gruppen.
  router.get('/preferences', verifyTokenRBAC, async (req, res) => {
    try {
      const { rows: [row] } = await db.query(
        'SELECT push_enabled, push_gruppen_stumm FROM users WHERE id = $1',
        [req.user.id]
      );
      const stumm = (row && row.push_gruppen_stumm) || [];
      res.json({
        push_enabled: row ? row.push_enabled : true,
        stumm,
        gruppen: gruppenFuerRolle(req.user.type).map((g) => ({
          id: g.id,
          name: g.name,
          beschreibung: g.beschreibung,
          aktiv: !stumm.includes(g.id)
        }))
      });
    } catch (err) {
      console.error('Database error in GET /preferences:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Setzt Hauptschalter und/oder stummgeschaltete Gruppen.
  router.put('/preferences', verifyTokenRBAC, [
    body('push_enabled').optional().isBoolean().withMessage('push_enabled muss true oder false sein'),
    body('stumm').optional().isArray().withMessage('stumm muss eine Liste sein'),
    handleValidationErrors
  ], async (req, res) => {
    const { push_enabled } = req.body;
    const hatSchalter = typeof push_enabled === 'boolean';
    const hatStumm = req.body.stumm !== undefined;
    if (!hatSchalter && !hatStumm) {
      return res.status(400).json({ error: 'push_enabled oder stumm erforderlich' });
    }
    const stumm = hatStumm ? bereinigeStumm(req.body.stumm) : null;
    if (hatStumm && stumm === null) {
      return res.status(400).json({ error: 'stumm enthält eine unbekannte Gruppe' });
    }
    try {
      const { rows: [row] } = await db.query(
        `UPDATE users
            SET push_enabled = COALESCE($1::boolean, push_enabled),
                push_gruppen_stumm = COALESCE($2::text[], push_gruppen_stumm)
          WHERE id = $3
      RETURNING push_enabled, push_gruppen_stumm`,
        [hatSchalter ? push_enabled : null, stumm, req.user.id]
      );
      res.json({
        success: true,
        push_enabled: row ? row.push_enabled : push_enabled,
        stumm: row ? row.push_gruppen_stumm : (stumm || [])
      });
    } catch (err) {
      console.error('Database error in PUT /preferences:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Speichert oder aktualisiert einen Geräte-Token für Push-Benachrichtigungen
  router.post('/device-token', verifyTokenRBAC, validateDeviceToken, async (req, res) => {
    const { token, platform, device_id, app_version, app_build } = req.body;
    const userId = req.user.id;
    const userType = req.user.type;
    const appSymbolWeg = wegAusAnmeldung(req.body.app_symbol_weg);
    const startbildschirm = startbildschirmAusAnmeldung(req.body.startbildschirm);

    if (!token || !platform) {
      return res.status(400).json({ error: 'Token und Plattform erforderlich' });
    }

    try {
      // Device ID generieren falls nicht vorhanden
      const finalDeviceId = device_id || `${platform}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Ein FCM-Token darf nur GENAU EINMAL existieren: weder bei einem anderen
      // User (Account-Wechsel) noch beim selben User unter anderer device_id
      // (z.B. neue identifierForVendor nach App-Neuinstallation) — sonst wird
      // derselbe Push mehrfach an dasselbe Geraet gesendet.
      const { rowCount: uebernommen } = await db.query(
        `DELETE FROM push_tokens
         WHERE token = $1
           AND NOT (user_id = $2 AND platform = $3 AND device_id = $4)`,
        [token, userId, platform, finalDeviceId]
      );
      // Stand VOR der Meldung, nur fuer das Protokoll unten.
      const { rows: [vorher] } = await db.query(
        'SELECT token, app_version, app_build FROM push_tokens WHERE user_id = $1 AND platform = $2 AND device_id = $3',
        [userId, platform, finalDeviceId]
      );

      // Upsert: Token speichern oder aktualisieren
      await db.query(`
        INSERT INTO push_tokens (user_id, user_type, token, platform, device_id, updated_at,
                                 app_version, app_build, app_symbol_weg, startbildschirm)
        VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)
        ON CONFLICT (user_id, platform, device_id)
        DO UPDATE SET
          token = EXCLUDED.token,
          user_type = EXCLUDED.user_type,
          updated_at = NOW(),
          -- COALESCE, nicht blind ueberschreiben: Meldet sich eine aeltere
          -- App-Fassung ohne die Felder, soll die zuletzt BEKANNTE Angabe
          -- stehen bleiben statt durch NULL ersetzt zu werden.
          app_version = COALESCE(EXCLUDED.app_version, push_tokens.app_version),
          app_build = COALESCE(EXCLUDED.app_build, push_tokens.app_build),
          app_symbol_weg = COALESCE(EXCLUDED.app_symbol_weg, push_tokens.app_symbol_weg),
          startbildschirm = COALESCE(EXCLUDED.startbildschirm, push_tokens.startbildschirm)`,
        [userId, userType, token, platform, finalDeviceId,
         app_version || null, app_build || null,
         // Nur Android kennt einen Weg (iOS setzt die Zahl ueber aps.badge).
         platform === 'android' ? appSymbolWeg : null,
         platform === 'android' ? startbildschirm : null]
      );

      /*
       * PROTOKOLL NUR BEI EINEM WECHSEL.
       *
       * Jetzt eine Zeile, wenn sich etwas aendert: neues Geraet (neu), neues
       * Token (Tokenwechsel), andere App-Fassung (App-Wechsel) oder ein Token,
       * das von einem anderen Konto oder Geraeteeintrag herueberkommt
       * (übernommen). Ob sich ein Geraet ueberhaupt meldet, zeigt
       * push_tokens.updated_at -- es steigt bei jeder Meldung.
       *
       * Absichtlich OHNE den Token selbst -- der ist ein Zugangsschluessel zum
       * Zustellen von Nachrichten und gehoert in kein Protokoll. Die letzten
       * sechs Zeichen genuegen, um zwei Registrierungen zu unterscheiden.
       */
      const gruende = [];
      if (!vorher) gruende.push('neu');
      else {
        if (vorher.token !== token) gruende.push('Tokenwechsel');
        const fassungNeu = (app_version && app_version !== vorher.app_version)
          || (app_build && app_build !== vorher.app_build);
        if (fassungNeu) gruende.push('App-Wechsel');
      }
      if (uebernommen > 0) gruende.push('übernommen');
      if (gruende.length > 0) {
        console.log(
          '[PUSH] Registrierung (%s): user=%s (%s) platform=%s app=%s/%s geraet=%s token=…%s symbol=%s start=%s',
          gruende.join(', '),
          userId, userType, platform,
          app_version || 'unbekannt', app_build || '?',
          String(finalDeviceId).slice(0, 12),
          String(token).slice(-6),
          appSymbolWeg || '-', startbildschirm || '-'
        );
      }

      res.json({ success: true, message: 'Token erfolgreich gespeichert' });

    } catch (err) {
      console.error('Database error in POST /device-token:', err);
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Token für diesen Benutzer und dieses Gerät existiert bereits.' });
      }
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  /*
   * Die App meldet, WARUM keine Registrierung zustande kam.
   *
   * Der eigentliche Grund, aus dem die Android-Fehlersuche so zaeh war: Wenn
   * gar kein Token entsteht, gibt es auch keinen POST /device-token — und
   * damit serverseitig KEINE Spur. "Die App fragt nicht" und "die App fragt,
   * bekommt aber nichts" sahen identisch aus, naemlich wie Stille.
   *
   * Diese Route nimmt genau diese Stille auf. Sie speichert nichts, sie
   * protokolliert nur: Damit lassen sich die Faelle unterscheiden, ohne dass
   * jemand ein Geraet an den Rechner haengen muss.
   *
   * Absichtlich anspruchslos: kein Schema, keine Pflichtfelder ausser dem
   * Grund -- die App soll melden koennen, auch wenn sie selbst nicht weiss,
   * was schiefgeht. Ins Protokoll geht aber nur, was wie ein Kennwort
   * aussieht: Bis dahin stand dort jeder
   * Wert roh, der Hinweis mit bis zu 200 Zeichen Freitext. Vom Hinweis
   * bleiben die Zahl der Versuche und die Fehlercodes (utils/protokoll.js).
   */
  router.post('/push-diagnose', verifyTokenRBAC, async (req, res) => {
    const { grund, berechtigung, plattform, app_version, app_build, hinweis } = req.body || {};
    console.log(
      '[PUSH-DIAGNOSE] user=%s (%s) grund=%s berechtigung=%s plattform=%s app=%s/%s %s',
      req.user.id, req.user.type,
      grund ? kennwortFuersProtokoll(grund, /^[A-Za-z0-9-]{1,40}$/, 'unlesbar') : 'ohne-angabe',
      kennwortFuersProtokoll(berechtigung, /^[a-z-]{1,30}$/),
      kennwortFuersProtokoll(plattform, /^(ios|android|web)$/),
      kennwortFuersProtokoll(app_version, /^\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'unbekannt'),
      kennwortFuersProtokoll(app_build, /^\d{1,7}$/),
      diagnoseHinweisFuersProtokoll(hinweis)
    );
    res.json({ success: true });
  });

  // Entfernt einen Geräte-Token beim Logout
  router.delete('/device-token', verifyTokenRBAC, validateDeleteToken, async (req, res) => {
    const { device_id, platform } = req.body;
    const userId = req.user.id;

    if (!device_id || !platform) {
      return res.status(400).json({ error: 'Geräte-ID und Plattform erforderlich' });
    }

    try {
      // Ein Geraete-Token gehoert dem Nutzer und dem Geraet, nicht einer
      // Organisation — `push_tokens` hat gar keine `organization_id`. Die
      // fruehere Verengung ueber `users.organization_id` verglich die PRIMAER-Org
      // des Kontos mit der AKTIVEN Org aus dem Token. Bei Mehrfach-Mitgliedschaft
      // sind das verschiedene Werte: Das DELETE traf 0 Zeilen, meldete aber
      // Erfolg, und das abgemeldete Geraet bekam weiter Push-Nachrichten.
      // Die Absicherung ist `pt.user_id = $1` aus dem geprueften Token — mehr
      // braucht es nicht, und `/auth/logout` loescht bereits genauso.
      const { rowCount } = await db.query(
        `DELETE FROM push_tokens
         WHERE user_id = $1
           AND platform = $2
           AND device_id = $3`,
        [userId, platform, device_id]
      );

      res.json({
        success: true,
        message: 'Push-Token für dieses Gerät entfernt',
        changes: rowCount
      });

    } catch (err) {
      console.error('Database error in DELETE /device-token:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  return router;
};
