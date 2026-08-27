const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');

module.exports = (db, rbacVerifier, roleHelpers) => {
  const { requireAdmin, requireOrgAdmin } = roleHelpers;
  const PushService = require('../services/pushService');

  // Schema-Migrationen: siehe backend/migrations/075_wrapped.sql

  // Deutsche Monatsnamen
  const MONAT_NAMEN = [
    '', 'Januar', 'Februar', 'M\u00e4rz', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
  ];

  // ====================================================================
  // HILFSFUNKTIONEN
  // ====================================================================

  async function generateKonfiSnapshot(client, userId, orgId, jahrgangId, year) {
    // Punkte aus konfi_profiles
    const { rows: [profile] } = await client.query(
      `SELECT kp.gottesdienst_points, kp.gemeinde_points
       FROM konfi_profiles kp
       WHERE kp.user_id = $1 AND kp.jahrgang_id = $2`,
      [userId, jahrgangId]
    );
    const gottesdienst = profile ? profile.gottesdienst_points : 0;
    const gemeinde = profile ? profile.gemeinde_points : 0;

    // Bonus-Punkte
    const { rows: [bonusRow] } = await client.query(
      `SELECT COALESCE(SUM(points), 0) as total FROM bonus_points WHERE konfi_id = $1 AND organization_id = $2`,
      [userId, orgId]
    );
    const bonus = parseInt(bonusRow.total, 10) || 0;

    // Events besucht
    const { rows: [eventCount] } = await client.query(
      `SELECT COUNT(*) as count FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       JOIN event_jahrgang_assignments eja ON e.id = eja.event_id AND eja.jahrgang_id = $3
       WHERE eb.user_id = $1 AND eb.status = 'confirmed' AND eb.attendance_status = 'present'
         AND e.organization_id = $2`,
      [userId, orgId, jahrgangId]
    );
    const totalAttended = parseInt(eventCount.count, 10) || 0;

    // Gottesdienst-Count (Events mit point_type = 'gottesdienst')
    const { rows: [gdCountRow] } = await client.query(
      `SELECT COUNT(*) as count FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       WHERE eb.user_id = $1 AND eb.status = 'confirmed' AND eb.attendance_status = 'present'
         AND e.organization_id = $2 AND e.point_type = 'gottesdienst'`,
      [userId, orgId]
    );
    const gottesdienstCount = parseInt(gdCountRow.count, 10) || 0;

    // Kategorie-Verteilung (Aktivitäten nach Kategorie)
    const { rows: kategorieVerteilung } = await client.query(
      `SELECT COALESCE(a.category, a.type) as kategorie, COUNT(*) as count
       FROM user_activities ua
       JOIN activities a ON ua.activity_id = a.id
       WHERE ua.user_id = $1 AND ua.organization_id = $2
       GROUP BY COALESCE(a.category, a.type)
       ORDER BY count DESC`,
      [userId, orgId]
    );

    // Gesamt-Events verfuegbar für diesen Jahrgang
    const { rows: [totalEventsRow] } = await client.query(
      `SELECT COUNT(DISTINCT e.id) as count FROM events e
       JOIN event_jahrgang_assignments eja ON e.id = eja.event_id AND eja.jahrgang_id = $2
       WHERE e.organization_id = $1`,
      [orgId, jahrgangId]
    );
    const totalAvailable = parseInt(totalEventsRow.count, 10) || 0;

    // Lieblings-Event (letztes besuchtes)
    const { rows: favoriteRows } = await client.query(
      `SELECT e.name, e.event_date FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       WHERE eb.user_id = $1 AND eb.status = 'confirmed' AND eb.attendance_status = 'present'
         AND e.organization_id = $2
       ORDER BY e.event_date DESC LIMIT 1`,
      [userId, orgId]
    );
    const lieblingsEvent = favoriteRows.length > 0
      ? { name: favoriteRows[0].name, date: favoriteRows[0].event_date }
      : null;

    // Badges
    const { rows: badgeRows } = await client.query(
      `SELECT cb.name, cb.icon, cb.color FROM user_badges ub
       JOIN custom_badges cb ON ub.badge_id = cb.id
       WHERE ub.user_id = $1 AND ub.organization_id = $2
       ORDER BY ub.awarded_date DESC`,
      [userId, orgId]
    );
    const { rows: [totalBadgesRow] } = await client.query(
      `SELECT COUNT(*) as count FROM custom_badges WHERE organization_id = $1`,
      [orgId]
    );
    const totalBadgesAvailable = parseInt(totalBadgesRow.count, 10) || 0;

    // Pflicht-Events
    const { rows: [pflichtRow] } = await client.query(
      `SELECT
        COUNT(*) FILTER (WHERE eb.attendance_status = 'present') as besucht,
        COUNT(*) as gesamt
       FROM events e
       JOIN event_jahrgang_assignments eja ON e.id = eja.event_id AND eja.jahrgang_id = $3
       LEFT JOIN event_bookings eb ON eb.event_id = e.id AND eb.user_id = $1
       WHERE e.organization_id = $2 AND e.mandatory = true AND e.cancelled IS NOT TRUE`,
      [userId, orgId, jahrgangId]
    );
    const pflichtBesucht = parseInt(pflichtRow?.besucht || '0', 10);
    const pflichtGesamt = parseInt(pflichtRow?.gesamt || '0', 10);

    // Absagen
    const { rows: [cancelRow] } = await client.query(
      `SELECT COUNT(*) as count FROM event_bookings
       WHERE user_id = $1 AND status = 'cancelled'`,
      [userId]
    );
    const eventAbgesagt = parseInt(cancelRow.count, 10) || 0;

    // Aktivster Monat (Aktivitäten + Events kombiniert)
    const { rows: monatRows } = await client.query(
      `SELECT monat, COUNT(*) as count FROM (
         SELECT EXTRACT(MONTH FROM completed_date)::int as monat
         FROM user_activities WHERE user_id = $1 AND organization_id = $2
         UNION ALL
         SELECT EXTRACT(MONTH FROM e.event_date)::int as monat
         FROM event_bookings eb
         JOIN events e ON eb.event_id = e.id
         WHERE eb.user_id = $1 AND eb.status = 'confirmed' AND eb.attendance_status = 'present'
           AND e.organization_id = $2
       ) combined
       GROUP BY monat
       ORDER BY count DESC
       LIMIT 1`,
      [userId, orgId]
    );
    const aktivsterMonat = monatRows.length > 0
      ? { monat: monatRows[0].monat, monat_name: MONAT_NAMEN[monatRows[0].monat] || '', aktivitaeten: parseInt(monatRows[0].count, 10) }
      : { monat: 0, monat_name: '', aktivitaeten: 0 };

    // Endspurt: Vergleich mit Zielwerten aus jahrgaenge
    const { rows: [jahrgang] } = await client.query(
      `SELECT target_gottesdienst, target_gemeinde, gottesdienst_enabled, gemeinde_enabled
       FROM jahrgaenge WHERE id = $1`,
      [jahrgangId]
    );

    // Konfirmationstermin je Jahrgang aus dem is_konfirmation-Event ableiten
    // (frueheste nicht-cancelled Konfirmation, org-gescopt) -- ersetzt die alte
    // Jahrgang-Stichtag-Spalte.
    const { rows: [konfirmationRow] } = await client.query(
      `SELECT MIN(e.event_date) AS termin
         FROM events e
         JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
        WHERE eja.jahrgang_id = $1
          AND e.is_konfirmation = true
          AND e.organization_id = $2
          AND (e.cancelled IS NULL OR e.cancelled = false)`,
      [jahrgangId, orgId]
    );
    const konfirmationTermin = konfirmationRow && konfirmationRow.termin ? konfirmationRow.termin : null;

    let zielTotal = 0;
    let aktuellTotal = gottesdienst + gemeinde;
    if (jahrgang) {
      if (jahrgang.gottesdienst_enabled) zielTotal += (jahrgang.target_gottesdienst || 0);
      if (jahrgang.gemeinde_enabled) zielTotal += (jahrgang.target_gemeinde || 0);
    }
    const fehlendePunkte = Math.max(0, zielTotal - aktuellTotal);
    const endspurtAktiv = aktuellTotal < zielTotal;

    // highlight_type berechnen: ueber_das_ziel hat hoechste Prio
    let highlightType = 'events_held';
    if (aktuellTotal >= zielTotal && zielTotal > 0) {
      highlightType = 'ueber_das_ziel';
    } else {
      const candidates = [
        { type: 'events_held', value: totalAttended },
        { type: 'badge_collector', value: badgeRows.length },
        { type: 'gottesdienst_treue', value: gottesdienstCount },
        { type: 'gemeinde_aktiv', value: gemeinde }
      ];
      let maxVal = -1;
      for (const c of candidates) {
        if (c.value > maxVal) {
          maxVal = c.value;
          highlightType = c.type;
        }
      }
    }

    // Deterministischer Formulierung-Seed
    const formulierungSeed = (userId * 31 + year * 17) % 97;

    // Zeitraum: aus dem Konfirmationstermin (is_konfirmation-Event) ableiten.
    // Kein Termin -> Kalenderjahr-Fallback (year-1-09-01 .. year-07-31).
    const zeitraumStart = konfirmationTermin
      ? new Date(new Date(konfirmationTermin).getFullYear() - 1, 8, 1).toISOString().split('T')[0]
      : `${year - 1}-09-01`;
    const zeitraumEnde = konfirmationTermin
      ? new Date(konfirmationTermin).toISOString().split('T')[0]
      : `${year}-07-31`;

    // Challenge-Momente: eigene Beitraege im Wrapped-Zeitraum (max 12, neueste zuerst).
    // Defensiv: Auf Alt-Deployments ohne Challenge-Tabellen liefern wir ein leeres Array
    // statt die gesamte Snapshot-Generierung scheitern zu lassen.
    let challengeMomente = [];
    try {
      const { rows: submissionRows } = await client.query(
        `SELECT c.title AS challenge_title,
                c.badge_icon,
                cs.media_type,
                cs.file_path,
                cs.file_name,
                cs.text_content,
                cs.link_url,
                cs.link_title,
                cs.link_author,
                cs.created_at
           FROM challenge_submissions cs
           JOIN challenges c ON cs.challenge_id = c.id
          WHERE cs.user_id = $1
            AND cs.organization_id = $2
            AND cs.moderation_status <> 'hidden'
            AND cs.created_at >= $3::date
            AND cs.created_at < ($4::date + INTERVAL '1 day')
          ORDER BY cs.created_at DESC
          LIMIT 12`,
        [userId, orgId, zeitraumStart, zeitraumEnde]
      );
      challengeMomente = submissionRows.map(s => ({
        challenge_title: s.challenge_title,
        badge_icon: s.badge_icon,
        media_type: s.media_type,
        file_path: s.file_path,
        file_name: s.file_name,
        text_content: s.text_content
          ? (s.text_content.length > 200 ? `${s.text_content.slice(0, 200)}...` : s.text_content)
          : null,
        link_url: s.link_url,
        link_title: s.link_title,
        link_author: s.link_author,
        created_at: s.created_at
      }));
    } catch (challengeErr) {
      console.warn('Wrapped: Challenge-Momente konnten nicht geladen werden:', challengeErr.message);
      challengeMomente = [];
    }

    return {
      version: 2,
      highlight_type: highlightType,
      formulierung_seed: formulierungSeed,
      slides: {
        challenge_momente: challengeMomente,
        punkte: {
          gottesdienst,
          gemeinde,
          total: gottesdienst + gemeinde,
          bonus
        },
        events: {
          total_attended: totalAttended,
          total_available: totalAvailable,
          lieblings_event: lieblingsEvent,
          abgesagt: eventAbgesagt
        },
        badges: {
          total_earned: badgeRows.length,
          total_available: totalBadgesAvailable,
          badges: badgeRows.map(b => ({ name: b.name, icon: b.icon, color: b.color }))
        },
        pflicht: {
          besucht: pflichtBesucht,
          gesamt: pflichtGesamt
        },
        aktivster_monat: aktivsterMonat,
        endspurt: {
          aktiv: endspurtAktiv,
          fehlende_punkte: fehlendePunkte,
          ziel_total: zielTotal,
          aktuell_total: aktuellTotal
        },
        zeitraum: {
          start: zeitraumStart,
          ende: zeitraumEnde
        },
        gottesdienst: {
          count: gottesdienstCount
        },
        kategorie: {
          verteilung: kategorieVerteilung.map(k => ({ kategorie: k.kategorie, count: parseInt(k.count, 10) })),
          top_kategorie: kategorieVerteilung.length > 0 ? kategorieVerteilung[0].kategorie : null
        }
      }
    };
  }

  async function generateTeamerSnapshot(client, userId, orgId, year) {
    // Events geleitet (Teamer war als Teilnehmer gebucht)
    const { rows: [eventsGeleitetRow] } = await client.query(
      `SELECT COUNT(*) as count FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       WHERE eb.user_id = $1 AND eb.status = 'confirmed' AND eb.attendance_status = 'present'
         AND e.organization_id = $2`,
      [userId, orgId]
    );
    const eventsGeleitet = parseInt(eventsGeleitetRow.count, 10) || 0;

    // Event mit meisten Teilnehmern
    const { rows: topEventRows } = await client.query(
      `SELECT e.name, COUNT(eb2.id) as teilnehmer
       FROM event_bookings eb
       JOIN events e ON eb.event_id = e.id
       LEFT JOIN event_bookings eb2 ON e.id = eb2.event_id AND eb2.status = 'confirmed' AND eb2.attendance_status = 'present'
       WHERE eb.user_id = $1 AND eb.status = 'confirmed' AND eb.attendance_status = 'present'
         AND e.organization_id = $2
       GROUP BY e.id, e.name
       ORDER BY teilnehmer DESC
       LIMIT 1`,
      [userId, orgId]
    );
    const meisteTeilnehmerEvent = topEventRows.length > 0
      ? { name: topEventRows[0].name, count: parseInt(topEventRows[0].teilnehmer, 10) }
      : null;

    // Konfis betreut (über zugewiesene Jahrgänge)
    const { rows: konfiRows } = await client.query(
      `SELECT COUNT(DISTINCT kp.user_id) as total,
              ARRAY_AGG(DISTINCT j.name) as jahrgaenge
       FROM user_jahrgang_assignments uja
       JOIN jahrgaenge j ON uja.jahrgang_id = j.id
       JOIN konfi_profiles kp ON kp.jahrgang_id = j.id
       WHERE uja.user_id = $1 AND j.organization_id = $2`,
      [userId, orgId]
    );
    const totalKonfis = konfiRows.length > 0 ? parseInt(konfiRows[0].total, 10) || 0 : 0;
    const jahrgaengeNamen = konfiRows.length > 0 && konfiRows[0].jahrgaenge
      ? konfiRows[0].jahrgaenge.filter(Boolean)
      : [];

    // Badges
    const { rows: teamerBadges } = await client.query(
      `SELECT cb.name, cb.icon, cb.color FROM user_badges ub
       JOIN custom_badges cb ON ub.badge_id = cb.id
       WHERE ub.user_id = $1 AND ub.organization_id = $2
       ORDER BY ub.awarded_date DESC`,
      [userId, orgId]
    );

    // Zertifikate
    const { rows: certRows } = await client.query(
      `SELECT ct.name, uc.issued_date FROM user_certificates uc
       JOIN certificate_types ct ON uc.certificate_type_id = ct.id
       WHERE uc.user_id = $1 AND uc.organization_id = $2
       ORDER BY uc.issued_date DESC`,
      [userId, orgId]
    );

    // Jahre aktiv (teamer_since)
    const { rows: [userRow] } = await client.query(
      `SELECT teamer_since FROM users WHERE id = $1`,
      [userId]
    );
    const teamerSeit = userRow && userRow.teamer_since ? userRow.teamer_since : null;
    const jahreAktiv = teamerSeit
      ? Math.max(1, Math.floor((Date.now() - new Date(teamerSeit).getTime()) / (365.25 * 24 * 60 * 60 * 1000)))
      : 0;

    return {
      version: 1,
      slides: {
        events_geleitet: {
          total: eventsGeleitet,
          meiste_teilnehmer_event: meisteTeilnehmerEvent
        },
        konfis_betreut: {
          total_konfis: totalKonfis,
          jahrgaenge: jahrgaengeNamen
        },
        badges: {
          total_earned: teamerBadges.length,
          badges: teamerBadges.map(b => ({ name: b.name, icon: b.icon, color: b.color }))
        },
        zertifikate: {
          total: certRows.length,
          zertifikate: certRows.map(c => ({ name: c.name, issued_date: c.issued_date }))
        },
        engagement: {
          teamer_seit: teamerSeit,
          jahre_aktiv: jahreAktiv
        },
        zeitraum: {
          year
        }
      }
    };
  }

  /**
   * Parallele Hilfsfunktion: Generiert und speichert einen Konfi-Snapshot.
   * Holt eigenen DB-Client aus dem Pool (kein geteilter Client für parallele Queries).
   */
  async function generateAndSaveKonfiSnapshot(dbRef, userId, orgId, jahrgangId, year) {
    const konfiClient = await dbRef.getClient();
    try {
      const snapshot = await generateKonfiSnapshot(konfiClient, userId, orgId, jahrgangId, year);
      await konfiClient.query(
        `INSERT INTO wrapped_snapshots (user_id, organization_id, wrapped_type, jahrgang_id, year, data, computed_at)
         VALUES ($1, $2, 'konfi', $3, $4, $5, NOW())
         ON CONFLICT (user_id, wrapped_type, year)
         DO UPDATE SET data = EXCLUDED.data, computed_at = NOW(), jahrgang_id = EXCLUDED.jahrgang_id, organization_id = EXCLUDED.organization_id`,
        [userId, orgId, jahrgangId, year, JSON.stringify(snapshot)]
      );
      return { userId, ok: true };
    } catch (err) {
      console.error(`Wrapped generation error for konfi ${userId}:`, err.message);
      return { userId, ok: false, err };
    } finally {
      konfiClient.release();
    }
  }

  // ====================================================================
  // ENDPOINTS
  // ====================================================================

  // GET /me - Eigenen Wrapped-Snapshot abrufen
  router.get('/me', rbacVerifier, async (req, res) => {
    try {
      const roleName = req.user.role_name;
      const wrappedType = (roleName === 'teamer') ? 'teamer' : 'konfi';
      const currentYear = new Date().getFullYear();

      const { rows } = await db.query(
        `SELECT data, computed_at, year FROM wrapped_snapshots
         WHERE user_id = $1 AND wrapped_type = $2
         ORDER BY year DESC LIMIT 1`,
        [req.user.id, wrappedType]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Kein Wrapped-Snapshot vorhanden' });
      }

      if (roleName === 'konfi') {
        const { rows: [gate] } = await db.query(
          `SELECT EXISTS(
             SELECT 1 FROM jahrgaenge j
             JOIN konfi_profiles kp ON kp.jahrgang_id = j.id
             WHERE kp.user_id = $1
               AND j.wrapped_released_at IS NOT NULL
               AND j.wrapped_released_at <= NOW()
           ) AS released`,
          [req.user.id]
        );
        if (!gate || !gate.released) {
          return res.status(403).json({ error: 'Wrapped ist noch nicht freigegeben' });
        }
      }

      res.json({
        data: rows[0].data,
        computed_at: rows[0].computed_at,
        year: rows[0].year,
        wrapped_type: wrappedType
      });
    } catch (err) {
      console.error('Error loading wrapped snapshot:', err);
      res.status(500).json({ error: 'Fehler beim Laden des Wrapped-Snapshots' });
    }
  });

  // POST /generate/:jahrgangId - Konfi-Snapshots für alle Konfis eines Jahrgangs generieren
  router.post('/generate/:jahrgangId',
    rbacVerifier,
    requireAdmin,
    param('jahrgangId').isInt({ min: 1 }),
    handleValidationErrors,
    async (req, res) => {
      const client = await db.getClient();
      try {
        const jahrgangId = parseInt(req.params.jahrgangId, 10);

        // Jahrgang validieren: gehört zur Org des Admins
        const { rows: [jahrgang] } = await client.query(
          `SELECT id, name FROM jahrgaenge WHERE id = $1 AND organization_id = $2`,
          [jahrgangId, req.user.organization_id]
        );
        if (!jahrgang) {
          return res.status(404).json({ error: 'Jahrgang nicht gefunden' });
        }

        const currentYear = new Date().getFullYear();

        await client.query('BEGIN');

        // Alle Konfis des Jahrgangs laden
        const { rows: konfis } = await client.query(
          `SELECT kp.user_id FROM konfi_profiles kp
           JOIN users u ON kp.user_id = u.id
           JOIN roles r ON u.role_id = r.id
           WHERE kp.jahrgang_id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL`,
          [jahrgangId]
        );

        // Parallele Snapshot-Generierung (jeder Konfi holt eigenen DB-Client)
        const results = await Promise.allSettled(
          konfis.map(konfi => generateAndSaveKonfiSnapshot(db, konfi.user_id, req.user.organization_id, jahrgangId, currentYear))
        );
        const generated = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
        const errors = results.length - generated;

        // wrapped_released_at setzen (auch bei erneutem Generieren)
        await client.query(
          `UPDATE jahrgaenge SET wrapped_released_at = NOW() WHERE id = $1`,
          [jahrgangId]
        );

        await client.query('COMMIT');

        // Push-Notification an alle Konfis
        try {
          const konfiIds = konfis.map(k => k.user_id);
          await PushService.sendWrappedReleased(db, konfiIds, 'konfi', req.user.organization_id);
        } catch (pushErr) {
          console.error('Push-Notification für Konfi-Wrapped fehlgeschlagen:', pushErr);
        }

        res.json({
          message: `Wrapped f\u00fcr ${generated} Konfis generiert`,
          generated,
          errors,
          jahrgang: jahrgang.name,
          year: currentYear
        });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error generating konfi wrapped:', err);
        res.status(500).json({ error: 'Fehler beim Generieren der Konfi-Wrapped-Snapshots' });
      } finally {
        client.release();
      }
    }
  );

  // POST /generate-teamer - Teamer-Snapshots für alle Teamer der Organisation generieren
  router.post('/generate-teamer',
    rbacVerifier,
    requireOrgAdmin,
    async (req, res) => {
      const client = await db.getClient();
      try {
        const currentYear = new Date().getFullYear();

        await client.query('BEGIN');

        // Alle Teamer der Organisation laden
        const { rows: teamers } = await client.query(
          `SELECT u.id as user_id FROM users u
           JOIN roles r ON u.role_id = r.id
           WHERE r.name = 'teamer' AND u.organization_id = $1`,
          [req.user.organization_id]
        );

        let generated = 0;
        let errors = 0;

        for (const teamer of teamers) {
          try {
            const snapshot = await generateTeamerSnapshot(client, teamer.user_id, req.user.organization_id, currentYear);

            await client.query(
              `INSERT INTO wrapped_snapshots (user_id, organization_id, wrapped_type, year, data, computed_at)
               VALUES ($1, $2, 'teamer', $3, $4, NOW())
               ON CONFLICT (user_id, wrapped_type, year)
               DO UPDATE SET data = EXCLUDED.data, computed_at = NOW(), organization_id = EXCLUDED.organization_id`,
              [teamer.user_id, req.user.organization_id, currentYear, JSON.stringify(snapshot)]
            );
            generated++;
          } catch (err) {
            console.error(`Wrapped generation error for teamer ${teamer.user_id}:`, err.message);
            errors++;
          }
        }

        await client.query('COMMIT');

        // Push-Notification an alle Teamer:innen
        try {
          const teamerIds = teamers.map(t => t.user_id);
          await PushService.sendWrappedReleased(db, teamerIds, 'teamer', req.user.organization_id);
        } catch (pushErr) {
          console.error('Push-Notification für Teamer-Wrapped fehlgeschlagen:', pushErr);
        }

        res.json({
          message: `Wrapped f\u00fcr ${generated} Teamer:innen generiert`,
          generated,
          errors,
          year: currentYear
        });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error generating teamer wrapped:', err);
        res.status(500).json({ error: 'Fehler beim Generieren der Teamer-Wrapped-Snapshots' });
      } finally {
        client.release();
      }
    }
  );

  // DELETE /:jahrgangId - Wrapped-Snapshots für einen Jahrgang löschen
  router.delete('/:jahrgangId',
    rbacVerifier,
    requireOrgAdmin,
    param('jahrgangId').isInt({ min: 1 }),
    handleValidationErrors,
    async (req, res) => {
      const client = await db.getClient();
      try {
        const jahrgangId = parseInt(req.params.jahrgangId, 10);

        // Jahrgang validieren
        const { rows: [jahrgang] } = await client.query(
          `SELECT id FROM jahrgaenge WHERE id = $1 AND organization_id = $2`,
          [jahrgangId, req.user.organization_id]
        );
        if (!jahrgang) {
          return res.status(404).json({ error: 'Jahrgang nicht gefunden' });
        }

        await client.query('BEGIN');

        const { rowCount } = await client.query(
          `DELETE FROM wrapped_snapshots WHERE jahrgang_id = $1 AND organization_id = $2`,
          [jahrgangId, req.user.organization_id]
        );

        await client.query(
          `UPDATE jahrgaenge SET wrapped_released_at = NULL WHERE id = $1`,
          [jahrgangId]
        );

        await client.query('COMMIT');
        res.json({ message: `${rowCount} Wrapped-Snapshots gel\u00f6scht`, deleted: rowCount });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error deleting wrapped snapshots:', err);
        res.status(500).json({ error: 'Fehler beim L\u00f6schen der Wrapped-Snapshots' });
      } finally {
        client.release();
      }
    }
  );

  // GET /history/:userId - Alle Wrapped-Snapshots eines Users
  router.get('/history/:userId',
    rbacVerifier,
    param('userId').isInt({ min: 1 }),
    handleValidationErrors,
    async (req, res) => {
      try {
        const targetUserId = parseInt(req.params.userId, 10);
        // Sicherheitspruefung: Nur eigene Daten ODER Admin der gleichen Org
        const roleName = req.user.role_name;
        if (req.user.id !== targetUserId) {
          if (roleName !== 'admin' && roleName !== 'org_admin') {
            return res.status(403).json({ error: 'Keine Berechtigung' });
          }
          // Admin: Pruefen ob User zur gleichen Org gehört
          const { rows: [targetUser] } = await db.query(
            'SELECT organization_id FROM users WHERE id = $1', [targetUserId]
          );
          if (!targetUser || targetUser.organization_id !== req.user.organization_id) {
            return res.status(403).json({ error: 'Keine Berechtigung' });
          }
        }

        const { rows } = await db.query(
          `SELECT id, wrapped_type, year, data, computed_at
           FROM wrapped_snapshots
           WHERE user_id = $1
           ORDER BY year DESC, wrapped_type`,
          [targetUserId]
        );

        res.json(rows);
      } catch (err) {
        console.error('Error loading wrapped history:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Wrapped-Historie' });
      }
    }
  );

  // ====================================================================
  // BATCH-GENERIERUNG (für backgroundService Cron)
  // ====================================================================

  /**
   * Generiert Konfi-Wrapped für alle Konfis eines Jahrgangs.
   * Wird vom Cron oder Admin-Endpoint aufgerufen.
   */
  router.generateAllKonfiWrapped = async (dbRef, jahrgangId, orgId, year) => {
    const client = await dbRef.getClient();
    try {
      await client.query('BEGIN');

      const { rows: konfis } = await client.query(
        `SELECT kp.user_id FROM konfi_profiles kp
         JOIN users u ON kp.user_id = u.id
         JOIN roles r ON u.role_id = r.id
         WHERE kp.jahrgang_id = $1 AND r.name = 'konfi' AND u.deleted_at IS NULL`,
        [jahrgangId]
      );

      // Parallele Snapshot-Generierung (jeder Konfi holt eigenen DB-Client)
      const results = await Promise.allSettled(
        konfis.map(konfi => generateAndSaveKonfiSnapshot(dbRef, konfi.user_id, orgId, jahrgangId, year))
      );
      const generated = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
      const errors = results.length - generated;

      // wrapped_released_at setzen
      await client.query(
        `UPDATE jahrgaenge SET wrapped_released_at = NOW() WHERE id = $1`,
        [jahrgangId]
      );

      await client.query('COMMIT');

      // Push (fire-and-forget, dbRef statt client da client released wird)
      try {
        const konfiIds = konfis.map(k => k.user_id);
        await PushService.sendWrappedReleased(dbRef, konfiIds, 'konfi', orgId);
      } catch (pushErr) {
        console.error('Wrapped-Cron Push fehlgeschlagen:', pushErr);
      }

      return { generated, errors };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  /**
   * Generiert Teamer-Wrapped für alle Teamer einer Organisation.
   * Wird vom Cron oder Admin-Endpoint aufgerufen.
   */
  router.generateAllTeamerWrapped = async (dbRef, orgId, year) => {
    const client = await dbRef.getClient();
    try {
      await client.query('BEGIN');

      const { rows: teamers } = await client.query(
        `SELECT u.id as user_id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name = 'teamer' AND u.organization_id = $1`,
        [orgId]
      );

      let generated = 0;
      let errors = 0;

      for (const teamer of teamers) {
        try {
          const snapshot = await generateTeamerSnapshot(client, teamer.user_id, orgId, year);
          await client.query(
            `INSERT INTO wrapped_snapshots (user_id, organization_id, wrapped_type, year, data, computed_at)
             VALUES ($1, $2, 'teamer', $3, $4, NOW())
             ON CONFLICT (user_id, wrapped_type, year)
             DO UPDATE SET data = EXCLUDED.data, computed_at = NOW(), organization_id = EXCLUDED.organization_id`,
            [teamer.user_id, orgId, year, JSON.stringify(snapshot)]
          );
          generated++;
        } catch (err) {
          console.error(`Wrapped-Cron: Teamer ${teamer.user_id} Fehler:`, err.message);
          errors++;
        }
      }

      await client.query('COMMIT');

      // Push (fire-and-forget)
      try {
        const teamerIds = teamers.map(t => t.user_id);
        await PushService.sendWrappedReleased(dbRef, teamerIds, 'teamer', orgId);
      } catch (pushErr) {
        console.error('Wrapped-Cron Push fehlgeschlagen:', pushErr);
      }

      return { generated, errors };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  return router;
};
