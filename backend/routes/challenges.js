// Challenges 2.0 — der erste NICHT-quantitative Baustein der App.
//
// Konfis produzieren eigene Deutungen (Foto, Text, Audio, Video, Link) statt
// Teilnahme zu zählen. Bewusst OHNE Punkte, OHNE custom_badges-Eintrag, OHNE
// Zähler/Ranglisten in der Konfi-Sicht.

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { formatDatum } = require('../utils/zeitformat');
const jwt = require('jsonwebtoken');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { encryptBuffer, decryptBuffer } = require('../utils/photoCrypto');
const { allIdsBelongToOrg } = require('../utils/orgOwnership');
const { deleteChallengeFile } = require('../utils/photoStorage');
const PushService = require('../services/pushService');
const liveUpdate = require('../utils/liveUpdate');
const { pruefeMusikLink, holeLinkMetadaten, ERLAUBTE_DIENSTE_TEXT } = require('../utils/musikLinks');

const MEDIA_TYPES = ['text', 'photo', 'audio', 'video', 'link'];
const VISIBILITIES = ['public', 'konfi_choice', 'private'];
const CHALLENGE_TYPES = ['wahrnehmung', 'beitrag', 'praxis', 'frei'];
const CONSENTS = ['publish', 'private', 'anonymous'];

// Teilnahme-Kreis (Migration 121). NICHT zu verwechseln mit visibility:
// audience = wer einreichen darf, visibility = wer die Beitraege sieht.
const AUDIENCES = ['konfis', 'konfis_und_team', 'nur_team'];

// Rollen, die als "Team" gelten (duerfen bei audience != 'konfis' einreichen).
const TEAM_ROLES = ['org_admin', 'admin', 'teamer'];

// Darf diese Rolle bei dieser Challenge einen eigenen Beitrag einreichen?
// Konfis nur bei 'konfis'/'konfis_und_team', Team nur bei
// 'konfis_und_team'/'nur_team'. super_admin nie (org-fremde Rolle).
function maySubmit(roleName, audience) {
  const aud = audience || 'konfis_und_team';
  if (roleName === 'konfi') return aud === 'konfis' || aud === 'konfis_und_team';
  if (TEAM_ROLES.includes(roleName)) return aud === 'konfis_und_team' || aud === 'nur_team';
  return false;
}

// Content-Type-Mapping für die Datei-Auslieferung (inkl. Audio/Video, weil
// Challenges anders als Chat-Bilder auch Sprachaufnahmen und Clips tragen).
const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4'
};

// ====================================================================
// ZENTRALE SICHTBARKEITSLOGIK — hier und NUR hier
// ====================================================================
//
// Eine Submission ist oeffentlich sichtbar (Galerie für die Konfis der
// zugewiesenen Jahrgänge) genau dann, wenn:
//   moderation_status = 'approved'
//   UND ( challenge.visibility = 'public'
//         ODER (challenge.visibility = 'konfi_choice'
//               UND konfi_consent IN ('publish','anonymous')) )
//
// visibility='private' ist NIE oeffentlich. 'hidden' schlägt alles.
//
// SQL-Fragment für Queries, die challenges als "c" und challenge_submissions
// als "cs" aliasieren.
const PUBLIC_SUBMISSION_SQL = `(
  cs.moderation_status = 'approved'
  AND (
    c.visibility = 'public'
    OR (c.visibility = 'konfi_choice' AND cs.konfi_consent IN ('publish', 'anonymous'))
  )
)`;

// JS-Pendant für bereits geladene Zeilen (Datei-Auslieferung, Export).
// Erwartet { moderation_status, konfi_consent } und { visibility }.
function isSubmissionPublic(submission, challenge) {
  if (!submission || !challenge) return false;
  if (submission.moderation_status !== 'approved') return false;
  if (challenge.visibility === 'public') return true;
  if (challenge.visibility === 'konfi_choice') {
    return submission.konfi_consent === 'publish' || submission.konfi_consent === 'anonymous';
  }
  return false;
}

// Anonyme Beitraege duerfen in Galerie und Export KEINEN Namen tragen — das
// Backend schickt display_name gar nicht erst mit (nicht erst das Frontend
// blendet aus). Der Konsens allein entscheidet: Seit dem nachträglichen
// Anonymisieren durch die Leitung kann konfi_consent='anonymous'
// auch bei visibility='public' (Galerie ohne Namen) und 'private' (Export
// ohne Namen) stehen — die fruehere Kopplung an 'konfi_choice' haette diese
// Beitraege faelschlich MIT Namen ausgeliefert.
function isAnonymous(submission, challenge) {
  return submission.konfi_consent === 'anonymous';
}

// Abgeleiteter Status (nie als Spalte gespeichert).
function deriveStatus(challenge, now = new Date()) {
  if (challenge.is_draft) return 'draft';
  const starts = new Date(challenge.starts_at);
  const ends = new Date(challenge.ends_at);
  if (starts > now) return 'scheduled';
  if (ends < now) return 'ended';
  return 'active';
}

// Eine Challenge ist "gestartet", sobald sie kein Draft mehr ist UND starts_at
// erreicht wurde. Ab dann sind die Konsens-Felder eingefroren.
function hasStarted(challenge, now = new Date()) {
  return !challenge.is_draft && new Date(challenge.starts_at) <= now;
}

function isActive(challenge, now = new Date()) {
  return deriveStatus(challenge, now) === 'active';
}

// allowed_media kommt je nach Treiber als Array oder als JSON-String zurück.
function parseAllowedMedia(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

module.exports = (db, rbacVerifier, roleHelpers, uploadsDir, challengeUpload) => {
  const { requireTeamer, requireAdmin } = roleHelpers;
  const challengeDir = path.join(uploadsDir, 'challenges');

  // ====================================================================
  // HELFER
  // ====================================================================

  function viewableJahrgangIds(req) {
    if (req.user.role_name === 'super_admin') return [];
    if (req.user.role_name === 'org_admin') return null;
    return (req.user.assigned_jahrgaenge || []).filter(j => j.can_view).map(j => j.id);
  }

  async function leadershipMayAccess(req, challengeId) {
    const viewable = viewableJahrgangIds(req);
    if (viewable === null) return true;

    // 'nur_team'-Challenges laufen org-weit über die Rolle (Migration 121) —
    // jeder Teamer der Org darf sie sehen und verwalten, auch ohne
    // Jahrgangs-Zuordnung (die es dort per Definition nicht gibt).
    const { rows: [teamRow] } = await db.query(
      `SELECT 1 FROM challenges WHERE id = $1 AND audience = 'nur_team' LIMIT 1`,
      [challengeId]
    );
    if (teamRow) return true;

    if (viewable.length === 0) return false;
    const { rows: [row] } = await db.query(
      `SELECT 1 FROM challenge_jahrgang_assignments
       WHERE challenge_id = $1 AND jahrgang_id = ANY($2::int[]) LIMIT 1`,
      [challengeId, viewable]
    );
    return !!row;
  }

  // Jahrgang des anfragenden Konfis (konfi_profiles haelt genau einen).
  async function konfiJahrgangId(userId) {
    const { rows: [row] } = await db.query(
      'SELECT jahrgang_id FROM konfi_profiles WHERE user_id = $1',
      [userId]
    );
    return row ? row.jahrgang_id : null;
  }

  // Darf dieser Teilnehmer (Konfi ODER Team) die Challenge sehen/bespielen?
  // Regeln:
  //   audience 'nur_team'        -> Team der Org, ORG-WEIT (keine Jahrgangspruefung)
  //   audience 'konfis*'         -> Jahrgangsbindung:
  //                                 Konfi über konfi_profiles.jahrgang_id,
  //                                 admin/Teamer über zugewiesene Jahrgänge,
  //                                 org_admin immer (sieht alles seiner Org)
  // Gibt { allowed, reason } zurück, damit die Route 403 vs. 404 unterscheiden kann.
  async function participantMayAccess(req, challenge) {
    const role = req.user.role_name;
    const audience = challenge.audience || 'konfis';

    if (audience === 'nur_team') {
      return { allowed: TEAM_ROLES.includes(role) };
    }

    if (role === 'konfi') {
      const jahrgangId = await konfiJahrgangId(req.user.id);
      if (!jahrgangId) return { allowed: false };
      const jahrgangIds = await challengeJahrgangIds(challenge.id);
      return { allowed: jahrgangIds.includes(jahrgangId) };
    }

    // org_admin: immer (leadershipMayAccess gibt für ihn sofort true zurück).
    // admin/teamer: nur bei zugewiesenem Jahrgang — derselbe Weg, damit die
    // Teilnehmer-Sicht nicht weiter ist als die Leitungs-Sicht.
    if (['org_admin', 'admin', 'teamer'].includes(role)) {
      return { allowed: await leadershipMayAccess(req, challenge.id) };
    }

    return { allowed: false };
  }

  // Challenge inkl. Org-Scoping laden.
  // author_name: gecoalescter Anzeige-String (Export-Text "Gestellt von: X").
  // author_user_display_name: NUR der aufgeloeste Benutzername (ohne Freitext-
  // Fallback) — wird von mapChallengeForKonfi gebraucht, um author_freetext
  // und author_display_name getrennt an den Konfi-Client auszuliefern.
  async function loadChallenge(id, organizationId) {
    const { rows: [row] } = await db.query(
      `SELECT c.*,
              COALESCE(au.display_name, c.author_freetext) AS author_name,
              au.display_name AS author_user_display_name
       FROM challenges c
       LEFT JOIN users au ON c.author_user_id = au.id
       WHERE c.id = $1 AND c.organization_id = $2`,
      [id, organizationId]
    );
    return row || null;
  }

  // Jahrgangs-IDs einer Challenge.
  async function challengeJahrgangIds(challengeId) {
    const { rows } = await db.query(
      'SELECT jahrgang_id FROM challenge_jahrgang_assignments WHERE challenge_id = $1',
      [challengeId]
    );
    return rows.map(r => r.jahrgang_id);
  }

  // Einheitliche Aufbereitung einer Challenge für die Konfi-Sicht.
  // author_freetext und author_display_name werden GETRENNT ausgeliefert
  // (statt bereits serverseitig zu einem Namen gecoalesct) — das entspricht
  // dem Vertrag in frontend/src/types/challenges.ts (ChallengeBase) und dem,
  // was getAuthorLabel() im Konfi-Frontend tatsaechlich liest: Freitext hat
  // dort Vorrang, sonst der aufgeloeste Benutzername.
  function mapChallengeForKonfi(row, now = new Date()) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      challenge_type: row.challenge_type,
      audience: row.audience || 'konfis',
      visibility: row.visibility,
      moderated: row.moderated,
      allowed_media: parseAllowedMedia(row.allowed_media),
      allow_multiple: row.allow_multiple,
      badge_icon: row.badge_icon,
      badge_name: row.badge_name,
      author_user_id: row.author_user_id || null,
      author_freetext: row.author_freetext || null,
      // author_user_display_name kommt aus loadChallenge (Detail-Aufruf, roher
      // Benutzername ohne Freitext-Fallback). Die Konfi-Listen-Query liefert
      // dieses Feld nicht, dort ist author_name bereits der rohe display_name
      // (siehe GET /konfi) — deshalb greift der Fallback dort korrekt.
      author_display_name: row.author_user_display_name !== undefined
        ? (row.author_user_display_name || null)
        : (row.author_name || null),
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      status: deriveStatus(row, now),
      has_badge: row.has_badge === true || row.has_badge === 't',
      // has_submission ist der Frontend-Vertrag (types/challenges.ts, KonfiChallenge)
      // für das Corner-Badge "bereits eingereicht" in Liste/Archiv/Dashboard —
      // bewusst NICHT an die Freigabe gekoppelt: eingereicht ist eingereicht,
      // auch wenn der Beitrag noch auf Freigabe wartet.
      has_submission: (parseInt(row.own_submission_count, 10) || 0) > 0,
      own_submission_count: parseInt(row.own_submission_count, 10) || 0
    };
  }

  // Live-Update an alle Konfis der zugewiesenen Jahrgänge.
  // Wird bewusst OHNE await aufgerufen (fire-and-forget, immer nach der
  // Response) — deshalb faengt die Funktion jeden Fehler selbst ab und darf
  // NIE rejecten, sonst kippt der Prozess mit einer unhandled rejection.
  async function notifyJahrgaenge(challengeId, action, data) {
    try {
      const jahrgangIds = await challengeJahrgangIds(challengeId);
      for (const jahrgangId of jahrgangIds) {
        // Typ MUSS 'challenges' heißen — das ist der LiveUpdateType, auf den
        // das Frontend subscribed (LiveUpdateContext). Mit dem frueheren
        // 'challenge' (Singular) kam kein einziges Update an.
        await liveUpdate.sendToJahrgang(jahrgangId, 'challenges', action, data);
      }
    } catch (err) {
      console.error('Live-Update fuer Challenge fehlgeschlagen:', err.message);
    }
  }

  // Live-Update an die Leitung (Admins/Org-Admins/Teamer der Org) — haelt die
  // Verwaltungsliste und den Freigaben-Tab-Badge aktuell, ohne dass jemand
  // manuell neu laden muss. Fire-and-forget wie notifyJahrgaenge.
  async function notifyLeadership(organizationId, action, data) {
    try {
      await liveUpdate.sendToOrgAdmins(organizationId, 'challenges', action, data);
    } catch (err) {
      console.error('Live-Update fuer Challenge-Leitung fehlgeschlagen:', err.message);
    }
  }

  // Datei aus dem Upload-Buffer verschlüsselt ablegen. Gibt den Hex-Dateinamen
  // zurück (die Abruf-Route akzeptiert nur [a-f0-9]+).
  async function storeUploadedFile(buffer) {
    const filename = crypto.randomBytes(32).toString('hex');
    await fs.promises.mkdir(challengeDir, { recursive: true });
    await fs.promises.writeFile(path.join(challengeDir, filename), encryptBuffer(buffer));
    return filename;
  }

  // ====================================================================
  // VALIDIERUNG
  // ====================================================================

  const validateCreate = [
    body('title').trim().notEmpty().isLength({ max: 200 }).withMessage('Titel ist erforderlich (max. 200 Zeichen)'),
    body('description').trim().notEmpty().withMessage('Beschreibung ist erforderlich'),
    body('challenge_type').optional().isIn(CHALLENGE_TYPES).withMessage('Ungültiger Challenge-Typ'),
    body('audience').optional().isIn(AUDIENCES).withMessage('Ungültiger Teilnahme-Kreis'),
    body('visibility').optional().isIn(VISIBILITIES).withMessage('Ungültige Sichtbarkeit'),
    body('moderated').optional().isBoolean().withMessage('Moderation muss ein Boolean sein'),
    body('allowed_media').optional().isArray({ min: 1 }).withMessage('Mindestens eine Medienart ist erforderlich'),
    body('allow_multiple').optional().isBoolean().withMessage('Mehrfach-Einreichung muss ein Boolean sein'),
    body('badge_icon').optional().trim().isLength({ max: 50 }).withMessage('Stempel-Icon max. 50 Zeichen'),
    body('badge_name').trim().notEmpty().isLength({ max: 100 }).withMessage('Stempel-Name ist erforderlich (max. 100 Zeichen)'),
    body('author_user_id').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Ungültige Urheber-ID'),
    body('author_freetext').optional({ nullable: true }).trim().isLength({ max: 200 }).withMessage('Urheber-Freitext max. 200 Zeichen'),
    body('starts_at').isISO8601().withMessage('Startzeitpunkt ist erforderlich'),
    body('ends_at').isISO8601().withMessage('Endzeitpunkt ist erforderlich'),
    body('is_draft').optional().isBoolean().withMessage('Entwurfs-Flag muss ein Boolean sein'),
    body('jahrgang_ids').optional().isArray().withMessage('jahrgang_ids muss ein Array sein'),
    handleValidationErrors
  ];

  const validateUpdate = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('title').optional().trim().notEmpty().isLength({ max: 200 }).withMessage('Titel max. 200 Zeichen'),
    body('description').optional().trim().notEmpty().withMessage('Beschreibung darf nicht leer sein'),
    body('challenge_type').optional().isIn(CHALLENGE_TYPES).withMessage('Ungültiger Challenge-Typ'),
    body('audience').optional().isIn(AUDIENCES).withMessage('Ungültiger Teilnahme-Kreis'),
    body('visibility').optional().isIn(VISIBILITIES).withMessage('Ungültige Sichtbarkeit'),
    body('moderated').optional().isBoolean().withMessage('Moderation muss ein Boolean sein'),
    body('allowed_media').optional().isArray({ min: 1 }).withMessage('Mindestens eine Medienart ist erforderlich'),
    body('allow_multiple').optional().isBoolean().withMessage('Mehrfach-Einreichung muss ein Boolean sein'),
    body('badge_icon').optional().trim().isLength({ max: 50 }).withMessage('Stempel-Icon max. 50 Zeichen'),
    body('badge_name').optional().trim().notEmpty().isLength({ max: 100 }).withMessage('Stempel-Name max. 100 Zeichen'),
    body('starts_at').optional().isISO8601().withMessage('Ungültiger Startzeitpunkt'),
    body('ends_at').optional().isISO8601().withMessage('Ungültiger Endzeitpunkt'),
    body('is_draft').optional().isBoolean().withMessage('Entwurfs-Flag muss ein Boolean sein'),
    body('jahrgang_ids').optional().isArray().withMessage('jahrgang_ids muss ein Array sein'),
    handleValidationErrors
  ];

  const validateModerate = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('action').isIn(['approve', 'hide', 'unhide', 'anonymize'])
      .withMessage('Ungültige Moderations-Aktion'),
    body('reason').optional({ nullable: true }).isString().trim()
      .isLength({ max: 500 }).withMessage('Begründung max. 500 Zeichen'),
    handleValidationErrors
  ];

  // ====================================================================
  // KONFI-ENDPUNKTE
  // ====================================================================

  // GET /konfi — aktive Challenges, Archiv und eigene Stempel.
  // Konfi sieht ausschliesslich Challenges seiner Jahrgänge, nie Entwuerfe.
  // Auch für Teamer/Admins: sie nehmen bei audience 'konfis_und_team' und
  // 'nur_team' selbst teil (User-Entscheid 08.08.). Der Pfad heißt weiterhin
  // /konfi — er ist der TEILNEHMER-Einstieg, nicht der Rollen-Einstieg.
  router.get('/konfi', rbacVerifier, async (req, res) => {
    try {
      const role = req.user.role_name;
      const isTeam = TEAM_ROLES.includes(role);
      if (role !== 'konfi' && !isTeam) {
        return res.status(403).json({ error: 'Kein Zugriff auf Challenges' });
      }

      // Konfi: genau ein Jahrgang. admin/Teamer: zugewiesene Jahrgänge.
      // org_admin: alle Jahrgänge der Org (viewable === null).
      let jahrgangIds = null;
      if (role === 'konfi') {
        const jahrgangId = await konfiJahrgangId(req.user.id);
        if (!jahrgangId) {
          return res.json({ active: [], archive: [], marks: [], offene_stempel: [] });
        }
        jahrgangIds = [jahrgangId];
      } else {
        jahrgangIds = viewableJahrgangIds(req);
      }

      // Sichtbare Challenges: entweder über die Jahrgangs-Zuordnung
      // (audience 'konfis'/'konfis_und_team') oder org-weit für das Team
      // (audience 'nur_team'). Konfis sehen 'nur_team' NIE.
      const params = [req.user.organization_id, req.user.id];
      let scopeCondition;
      if (role === 'konfi') {
        params.push(jahrgangIds);
        scopeCondition = `c.audience <> 'nur_team' AND EXISTS (
          SELECT 1 FROM challenge_jahrgang_assignments cja
          WHERE cja.challenge_id = c.id AND cja.jahrgang_id = ANY($3::int[])
        )`;
      } else if (jahrgangIds === null) {
        // org_admin/admin: alles der Org, aber nur wo das Team mitmachen darf
        scopeCondition = `c.audience IN ('konfis_und_team', 'nur_team')`;
      } else if (jahrgangIds.length === 0) {
        // Teamer ohne Jahrgänge: nur die org-weiten Team-Challenges
        scopeCondition = `c.audience = 'nur_team'`;
      } else {
        params.push(jahrgangIds);
        scopeCondition = `(
          c.audience = 'nur_team'
          OR (c.audience = 'konfis_und_team' AND EXISTS (
            SELECT 1 FROM challenge_jahrgang_assignments cja
            WHERE cja.challenge_id = c.id AND cja.jahrgang_id = ANY($3::int[])
          ))
        )`;
      }

      const { rows } = await db.query(
        `SELECT c.*,
                au.display_name AS author_name,
                EXISTS (
                  SELECT 1 FROM challenge_submissions s
                  WHERE s.challenge_id = c.id AND s.user_id = $2
                    AND s.moderation_status = 'approved'
                ) AS has_badge,
                (
                  SELECT COUNT(*) FROM challenge_submissions s2
                  WHERE s2.challenge_id = c.id AND s2.user_id = $2
                ) AS own_submission_count,
                -- Wann der Stempel verliehen wurde: der FRUEHESTE freigegebene
                -- eigene Beitrag. Bei mehreren zaehlt der erste — der Stempel
                -- entstand mit ihm, spaetere Beitraege wiederholen ihn nur.
                -- approved_at ist nullable (Bestandszeilen vor Migration 146
                -- tragen es nicht), deshalb faellt es auf created_at zurueck:
                -- ein Datum, das um Stunden danebenliegt, ist im Popover
                -- brauchbarer als gar keins.
                (
                  SELECT MIN(COALESCE(s3.approved_at, s3.created_at))
                  FROM challenge_submissions s3
                  WHERE s3.challenge_id = c.id AND s3.user_id = $2
                    AND s3.moderation_status = 'approved'
                ) AS earned_at
         FROM challenges c
         LEFT JOIN users au ON c.author_user_id = au.id
         WHERE c.organization_id = $1
           AND c.is_draft = false
           AND c.starts_at <= NOW()
           AND ${scopeCondition}
         ORDER BY c.starts_at DESC`,
        params
      );

      const now = new Date();
      const active = [];
      const archive = [];
      const marks = [];
      // Stempel, die es zu holen gab oder gibt, die diese Person aber nicht
      // hat. BEWUSST EIN EIGENES FELD, nicht mit einem Merker in `marks`:
      // Die Apps im Store (2.1.1) zeichnen JEDEN Eintrag aus `marks` als
      // erhaltenen Stempel. Ein Merker "nicht erhalten" wuerde dort schlicht
      // ignoriert — fremde Stempel erschienen als eigene. `marks` bleibt
      // deshalb unveraendert die Liste der ERHALTENEN; alte Apps sehen das
      // neue Feld gar nicht und zeigen weiter genau das, was sie bisher
      // zeigten.
      const offene_stempel = [];

      for (const row of rows) {
        const mapped = mapChallengeForKonfi(row, now);
        if (mapped.status === 'active') {
          active.push(mapped);
        } else if (mapped.status === 'ended') {
          archive.push(mapped);
        }
        if (mapped.has_badge) {
          marks.push({
            challenge_id: row.id,
            badge_icon: row.badge_icon,
            badge_name: row.badge_name,
            title: row.title,
            // NEU: Datum der Verleihung und der Challenge-Text fuers Popover.
            earned_at: row.earned_at ? new Date(row.earned_at).toISOString() : null,
            description: row.description || null
          });
        } else if (row.badge_name) {
          offene_stempel.push({
            challenge_id: row.id,
            badge_icon: row.badge_icon,
            badge_name: row.badge_name,
            title: row.title,
            description: row.description || null,
            status: mapped.status,
            ends_at: row.ends_at ? new Date(row.ends_at).toISOString() : null
          });
        }
      }

      res.json({ active, archive, marks, offene_stempel });
    } catch (err) {
      console.error('Database error in GET /challenges/konfi:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // GET /konfi/:id — Detail inkl. Galerie (oeffentliche Beitraege) und eigenen
  // Beitraegen (immer, mit Status).
  router.get('/konfi/:id',
    rbacVerifier,
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors,
    async (req, res) => {
      try {
        const role = req.user.role_name;
        if (role !== 'konfi' && !TEAM_ROLES.includes(role)) {
          return res.status(403).json({ error: 'Kein Zugriff auf Challenges' });
        }
        const challengeId = parseInt(req.params.id, 10);

        const challenge = await loadChallenge(challengeId, req.user.organization_id);
        if (!challenge || challenge.is_draft || new Date(challenge.starts_at) > new Date()) {
          return res.status(404).json({ error: 'Challenge nicht gefunden' });
        }
        // Konfis sehen 'nur_team'-Challenges gar nicht -> 404 statt 403
        // (die Existenz soll nicht durchsickern).
        if (role === 'konfi' && (challenge.audience === 'nur_team')) {
          return res.status(404).json({ error: 'Challenge nicht gefunden' });
        }

        const access = await participantMayAccess(req, challenge);
        if (!access.allowed) {
          return res.status(403).json({ error: 'Kein Zugriff auf diese Challenge' });
        }

        // Galerie: NUR oeffentliche Beitraege (zentrale Logik), fremde
        // Beitraege. Bei 'anonymous' wird der Name in SQL bereits auf NULL
        // gesetzt — display_name verlässt das Backend gar nicht erst.
        // role_label/jahrgang_name machen transparent, wer schreibt: bei
        // mehreren Jahrgängen sehen die Konfis so, dass ein Beitrag aus einem
        // anderen Jahrgang kommt, und Team-Beitraege sind als solche erkennbar
        // (User-Entscheid 08.08.) — bei anonymen Beitraegen bleibt beides NULL.
        const { rows: gallery } = await db.query(
          `SELECT cs.id, cs.media_type, cs.text_content, cs.file_path, cs.file_name,
                  cs.link_url, cs.link_title, cs.link_author, cs.link_album, cs.created_at,
                  CASE WHEN cs.konfi_consent = 'anonymous'
                       THEN NULL ELSE u.display_name END AS display_name,
                  CASE WHEN cs.konfi_consent = 'anonymous'
                       THEN NULL ELSE r.name END AS role_name,
                  CASE WHEN cs.konfi_consent = 'anonymous'
                       THEN NULL ELSE j.name END AS jahrgang_name,
                  COALESCE(cs.konfi_consent = 'anonymous', false) AS is_anonymous
           FROM challenge_submissions cs
           JOIN challenges c ON cs.challenge_id = c.id
           JOIN users u ON cs.user_id = u.id
           LEFT JOIN roles r ON u.role_id = r.id
           LEFT JOIN konfi_profiles kp ON kp.user_id = u.id
           LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
           WHERE cs.challenge_id = $1
             AND cs.user_id <> $2
             AND ${PUBLIC_SUBMISSION_SQL}
           -- Die id als zweites Kriterium: Ohne sie ist die
           -- Reihenfolge bei gleichem Zeitstempel nach SQL UNDEFINIERT --
           -- PostgreSQL darf sie beliebig liefern. Zwei Beitraege in
           -- derselben Sekunde sind in einer Gruppe von Konfis normal, und
           -- die Galerie sortierte sich dann zwischen zwei Aufrufen um.
           -- Die id waechst monoton, der spaeter eingefuegte steht also
           -- oben -- genau das, was "neueste zuerst" meint.
           ORDER BY cs.created_at DESC, cs.id DESC`,
          [challengeId, req.user.id]
        );

        const { rows: own } = await db.query(
          `SELECT id, media_type, text_content, file_path, file_name, link_url,
                  link_title, link_author, link_album, konfi_consent, moderation_status,
                  moderation_note, created_at
           FROM challenge_submissions
           WHERE challenge_id = $1 AND user_id = $2
           -- Eindeutig sortieren, siehe Galerie oben.
           ORDER BY created_at DESC, id DESC`,
          [challengeId, req.user.id]
        );

        res.json({
          challenge: mapChallengeForKonfi({
            ...challenge,
            // Stempel erst nach Freigabe — dieselbe Regel wie in der Liste
            // (GET /konfi): nur ein approved-Beitrag zählt.
            has_badge: own.some(s => s.moderation_status === 'approved'),
            own_submission_count: own.length
          }),
          gallery,
          own_submissions: own
        });
      } catch (err) {
        console.error('Database error in GET /challenges/konfi/:id:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    }
  );

  // POST /konfi/:id/submissions — Beitrag einreichen.
  // multipart (Feld 'file') für photo/audio/video, JSON für text/link.
  router.post('/konfi/:id/submissions',
    rbacVerifier,
    challengeUpload.single('file'),
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors,
    async (req, res) => {
      try {
        const role = req.user.role_name;
        if (role !== 'konfi' && !TEAM_ROLES.includes(role)) {
          return res.status(403).json({ error: 'Kein Zugriff auf Challenges' });
        }
        const challengeId = parseInt(req.params.id, 10);
        const { media_type, text_content, link_url, konfi_consent } = req.body;

        if (!MEDIA_TYPES.includes(media_type)) {
          return res.status(400).json({ error: 'Ungültige Medienart' });
        }

        const challenge = await loadChallenge(challengeId, req.user.organization_id);
        if (!challenge || challenge.is_draft) {
          return res.status(404).json({ error: 'Challenge nicht gefunden' });
        }

        // Teilnahme-Kreis prüfen (audience). Erst der Zugriff auf die
        // Challenge, dann die Frage, ob diese Rolle hier einreichen darf.
        const access = await participantMayAccess(req, challenge);
        if (!access.allowed) {
          return res.status(403).json({ error: 'Kein Zugriff auf diese Challenge' });
        }
        if (!maySubmit(role, challenge.audience)) {
          return res.status(403).json({
            error: challenge.audience === 'nur_team'
              ? 'Diese Challenge ist nur für das Team.'
              : 'Bei dieser Challenge reichen nur die Konfis Beiträge ein.'
          });
        }

        if (!isActive(challenge)) {
          return res.status(409).json({ error: 'Diese Challenge läuft gerade nicht.' });
        }

        const allowedMedia = parseAllowedMedia(challenge.allowed_media);
        if (!allowedMedia.includes(media_type)) {
          return res.status(400).json({ error: 'Diese Medienart ist für diese Challenge nicht erlaubt.' });
        }

        // Mehrfach-Einreichung
        if (!challenge.allow_multiple) {
          const { rows: [existing] } = await db.query(
            'SELECT 1 FROM challenge_submissions WHERE challenge_id = $1 AND user_id = $2 LIMIT 1',
            [challengeId, req.user.id]
          );
          if (existing) {
            return res.status(409).json({ error: 'Du hast für diese Challenge bereits einen Beitrag abgegeben.' });
          }
        }

        // Inhaltliche Pflichtfelder je Medienart
        const trimmedText = typeof text_content === 'string' ? text_content.trim() : '';
        if (media_type === 'text' && !trimmedText) {
          return res.status(400).json({ error: 'Bitte schreibe einen Text.' });
        }
        // Erlaubnisliste (utils/musikLinks): Link-Beitraege nehmen nur noch
        // Musikdienste an. Die Pruefung laeuft auf Hostname-Basis, damit
        // Umgehungen wie ?x=open.spotify.com oder fremde Subdomains nicht
        // durchrutschen.
        if (media_type === 'link' && !pruefeMusikLink(link_url).ok) {
          return res.status(400).json({
            error: `Hier gehen nur Musik-Links: ${ERLAUBTE_DIENSTE_TEXT}. Bitte teile den Link direkt aus einer dieser Apps.`
          });
        }
        if (['photo', 'audio', 'video'].includes(media_type) && !req.file) {
          return res.status(400).json({ error: 'Bitte wähle eine Datei aus.' });
        }

        // Konsens: nur bei visibility='konfi_choice' relevant. Das Frontend zeigt
        // die Auswahl dort als Pflichtfeld; kommt trotzdem nichts an, gilt
        // 'publish' als Fallback. Bei public/private wird NICHTS gespeichert,
        // damit die zentrale Sichtbarkeitslogik eindeutig bleibt.
        let consent = null;
        if (challenge.visibility === 'konfi_choice') {
          consent = konfi_consent || 'publish';
          if (!CONSENTS.includes(consent)) {
            return res.status(400).json({ error: 'Ungültige Sichtbarkeits-Auswahl' });
          }
        }

        // Datei verarbeiten (Magic-Bytes-Prüfung wie im Chat: der Header eines
        // Uploads ist Client-Angabe, der echte Typ steht in den ersten Bytes).
        let filePath = null;
        let fileName = null;
        if (req.file) {
          if (!req.file.buffer) {
            return res.status(400).json({ error: 'Datei konnte nicht gelesen werden' });
          }
          const { fileTypeFromBuffer } = await import('file-type');
          const detected = await fileTypeFromBuffer(req.file.buffer);
          const expectedPrefix = media_type === 'photo' ? 'image/'
            : media_type === 'audio' ? 'audio/'
              : 'video/';
          // Manche Container (m4a/mp4/mov) werden als video/* erkannt, obwohl nur
          // eine Tonspur drin ist — deshalb bei Audio auch video/mp4 zulassen.
          const audioFallback = media_type === 'audio'
            && detected && ['video/mp4', 'video/quicktime', 'application/mp4'].includes(detected.mime);
          if (!detected || (!detected.mime.startsWith(expectedPrefix) && !audioFallback)) {
            return res.status(415).json({ error: 'Dateityp konnte nicht verifiziert werden' });
          }
          filePath = await storeUploadedFile(req.file.buffer);
          fileName = req.file.originalname;
        }

        // Auto-Approve: ohne Moderation gilt der Beitrag sofort als freigegeben.
        const moderationStatus = challenge.moderated ? 'pending' : 'approved';

        // Titel/Interpret EINMALIG serverseitig holen (oEmbed bzw. iTunes-
        // Lookup) und speichern. Kein Cover, keine Bild-URL — beim Betrachten
        // der Beitraege soll kein Musikdienst kontaktiert werden. Schlaegt der
        // Abruf fehl (Timeout, Kurzlink, Dienst down), wird der Beitrag
        // trotzdem gespeichert — das Einreichen scheitert nie an Fremdservern.
        let linkMeta = null;
        if (media_type === 'link') {
          linkMeta = await holeLinkMetadaten(link_url);
        }

        const { rows: [created] } = await db.query(
          `INSERT INTO challenge_submissions
             (challenge_id, user_id, organization_id, media_type, text_content,
              file_path, file_name, link_url, link_title, link_author, link_album,
              konfi_consent, moderation_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id, media_type, text_content, file_path, file_name, link_url,
                     link_title, link_author, link_album, konfi_consent, moderation_status, created_at`,
          [
            challengeId,
            req.user.id,
            req.user.organization_id,
            media_type,
            trimmedText || null,
            filePath,
            fileName,
            media_type === 'link' ? link_url : null,
            linkMeta ? linkMeta.title : null,
            linkMeta ? linkMeta.author : null,
            linkMeta ? linkMeta.album : null,
            consent,
            moderationStatus
          ]
        );

        res.status(201).json(created);

        // Fire-and-forget NACH der Antwort: Push an die Leitung (immer, auch
        // wenn der Beitrag sofort oeffentlich ist) und — bei der ERSTEN
        // FREIGEGEBENEN eigenen Submission zu dieser Challenge — der
        // "Abzeichen erhalten"-Push. Das Abzeichen ist abgeleitet (EXISTS
        // eigene approved-Submission, s.o.): Ohne Moderation ist der Beitrag
        // sofort approved, der Push feuert hier. Bei moderierten Challenges
        // gibt es das Abzeichen erst mit der Freigabe — der Push feuert dann
        // in PUT /admin/submissions/:id/moderate.
        (async () => {
          try {
            await PushService.sendChallengeSubmissionToLeadership(
              db,
              req.user.organization_id,
              challengeId,
              challenge.title,
              req.user.display_name,
              challenge.moderated
            );
          } catch (pushErr) {
            console.error('Push für Challenge-Beitrag fehlgeschlagen:', pushErr.message);
          }

          try {
            // Feed-Push an die Jahrgangs-Konfis — NUR wenn der Beitrag jetzt
            // schon oeffentlich ist. Bei moderierten Challenges ist er das
            // nicht; dort feuert der Push erst mit der Freigabe (PUT
            // /admin/submissions/:id/moderate).
            //
            // Dieselbe Sichtbarkeitsregel wie die Galerie (isSubmissionPublic):
            // Wer den Beitrag nicht sehen darf, erfaehrt auch nichts von ihm.
            const sichtbar = isSubmissionPublic(
              { moderation_status: moderationStatus, konfi_consent },
              challenge
            );
            if (sichtbar) {
              const anonym = isAnonymous({ konfi_consent }, challenge);
              await PushService.sendChallengeFeedToJahrgaenge(
                db,
                req.user.organization_id,
                challengeId,
                challenge.title,
                req.user.id,
                anonym ? null : req.user.display_name,
                media_type
              );
            }
          } catch (pushErr) {
            console.error('Feed-Push fehlgeschlagen:', pushErr.message);
          }

          try {
            if (moderationStatus === 'approved') {
              const { rows: [{ count: approvedCount }] } = await db.query(
                `SELECT COUNT(*)::int AS count FROM challenge_submissions
                 WHERE challenge_id = $1 AND user_id = $2
                   AND moderation_status = 'approved'`,
                [challengeId, req.user.id]
              );
              // Genau 1 => die soeben erstellte Submission ist die erste freigegebene.
              if (approvedCount === 1) {
                await PushService.sendChallengeBadgeEarnedToKonfi(
                  db,
                  req.user.id,
                  challengeId,
                  challenge.title
                );
              }
            }
          } catch (badgeErr) {
            console.error('Abzeichen-Push für Challenge-Beitrag fehlgeschlagen:', badgeErr.message);
          }
        })();

        // Live-Update nur, wenn der Beitrag sofort oeffentlich sichtbar ist.
        if (isSubmissionPublic(created, challenge)) {
          notifyJahrgaenge(challengeId, 'submission_update', { challengeId });
        }
        // Leitung bekommt IMMER ein Update (Liste + Freigaben-Badge).
        notifyLeadership(req.user.organization_id, 'submission_update', { challengeId });
      } catch (err) {
        console.error('Database error in POST /challenges/konfi/:id/submissions:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    }
  );

  // DELETE /konfi/submissions/:id — bewusst gesperrt (Design-Entscheidung):
  // Konfis duerfen eingereichte Beitraege NICHT mehr eigenstaendig zurueckziehen.
  // Ein einmal eingereichter Beitrag ist verbindlich; das Ausblenden bleibt
  // Sache der Leitung (PUT /admin/submissions/:id/moderate). Der Endpoint
  // bleibt als Route bestehen (stabile URL, klarer Fehlercode statt 404 für
  // alle Aufrufer), antwortet aber immer mit 403 — unabhaengig davon, ob die
  // Submission existiert oder wem sie gehört.
  router.delete('/konfi/submissions/:id',
    rbacVerifier,
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors,
    async (req, res) => {
      return res.status(403).json({
        error: 'Eingereichte Beiträge lassen sich nicht mehr zurückziehen. Wende dich an deine Leitung, falls ein Beitrag entfernt werden soll.'
      });
    }
  );

  // ====================================================================
  // DATEI-AUSLIEFERUNG
  // ====================================================================
  router.get('/files/:filename', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Kein Token vorhanden' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ error: 'Ungültiger Token' });
    }

    try {
      const filename = path.basename(req.params.filename);
      if (!/^[a-f0-9]+$/.test(filename)) {
        return res.status(400).json({ error: 'Ungültiger Dateiname' });
      }

      // AKTIVE Org berücksichtigen (Multi-Org, Org-Switcher) — derselbe Header
      // wie rbacVerifier (X-Active-Organization). Ohne das wuerde ein Multi-Org-
      // Admin, der auf eine Sekundaer-Org umgeschaltet hat, hier weiterhin gegen
      // seine PRIMAER-Org geprüft und faende jede Datei der aktiven Org nicht
      // (404), obwohl alle anderen Admin-Endpoints korrekt die aktive Org sehen.
      // LEFT JOIN auf roles (statt INNER JOIN): konsistent zu verifyTokenRBAC —
      // ein User ohne (aufloesbare) Rolle soll nicht 401 "Nicht angemeldet"
      // auslösen, sondern unten sauber an mayAccess=false scheitern (403).
      const { rows: [requesterRow] } = await db.query(
        `SELECT u.id, u.organization_id, r.name AS role_name, kp.jahrgang_id
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         LEFT JOIN konfi_profiles kp ON kp.user_id = u.id
         WHERE u.id = $1 AND u.deleted_at IS NULL`,
        [decoded.id]
      );
      if (!requesterRow) {
        return res.status(401).json({ error: 'Nicht angemeldet' });
      }

      const requester = { ...requesterRow, assigned_jahrgaenge: [] };
      const headerOrg = parseInt(req.headers['x-active-organization']);
      const tokenOrg = decoded.active_organization_id ? parseInt(decoded.active_organization_id) : null;
      const requestedActiveOrg = Number.isInteger(headerOrg) ? headerOrg
        : (Number.isInteger(tokenOrg) ? tokenOrg : null);
      if (requestedActiveOrg && requestedActiveOrg !== requester.organization_id) {
        const { rows: [membership] } = await db.query(
          `SELECT uo.organization_id, r.name AS role_name
           FROM user_organizations uo
           JOIN roles r ON uo.role_id = r.id
           WHERE uo.user_id = $1 AND uo.organization_id = $2`,
          [decoded.id, requestedActiveOrg]
        );
        if (!membership) {
          return res.status(403).json({ error: 'Kein Zugriff auf diese Organisation' });
        }
        requester.organization_id = membership.organization_id;
        requester.role_name = membership.role_name;
      }

      if (['admin', 'teamer'].includes(requester.role_name)) {
        const { rows: assigned } = await db.query(
          `SELECT j.id, uja.can_view
           FROM user_jahrgang_assignments uja
           JOIN jahrgaenge j ON uja.jahrgang_id = j.id
           WHERE uja.user_id = $1 AND j.organization_id = $2`,
          [decoded.id, requester.organization_id]
        );
        requester.assigned_jahrgaenge = assigned;
      }

      const { rows: [row] } = await db.query(
        `SELECT cs.id, cs.user_id, cs.file_name, cs.moderation_status, cs.konfi_consent,
                c.id AS challenge_id, c.visibility, c.audience, c.organization_id
         FROM challenge_submissions cs
         JOIN challenges c ON cs.challenge_id = c.id
         WHERE cs.file_path = $1 AND cs.organization_id = $2`,
        [filename, requester.organization_id]
      );
      if (!row) {
        return res.status(404).json({ error: 'Datei nicht gefunden' });
      }

      const isOwner = row.user_id === requester.id;
      let mayAccess = isOwner;

      if (!mayAccess && requester.role_name === 'org_admin') {
        // org_admin sieht alle Dateien seiner (aktiven) Org, ohne
        // Jahrgangs-Einschraenkung — identisch zu leadershipMayAccess().
        mayAccess = true;
      } else if (!mayAccess && ['admin', 'teamer'].includes(requester.role_name)) {
        // 'nur_team'-Challenges sind org-weit (keine Jahrgangs-Zuordnung) —
        // dort darf jede:r aus dem Team der Org die Dateien sehen, sonst könnte
        // sie/er die eigene Team-Runde nicht anschauen (Migration 121).
        if (row.audience === 'nur_team') {
          mayAccess = true;
        } else {
          // Sonst nur für Submissions aus einem der zugewiesenen Jahrgänge —
          // konsistent zu leadershipMayAccess()/viewableJahrgangIds() oben in
          // dieser Datei (Moderations-Sicht ist sonst weiter als die restlichen
          // Leitungs-Endpunkte, über die die Challenge erst gefunden wird).
          const viewable = (requester.assigned_jahrgaenge || [])
            .filter(j => j.can_view)
            .map(j => j.id);
          if (viewable.length > 0) {
            const jahrgangIds = await challengeJahrgangIds(row.challenge_id);
            mayAccess = jahrgangIds.some(id => viewable.includes(id));
          }
        }
      }

      // 'nur_team' ist für Konfis unsichtbar — auch die Dateien (Migration 121).
      if (!mayAccess && requester.role_name === 'konfi' && row.audience !== 'nur_team') {
        // Konfi darf nur oeffentliche Beitraege aus seinem Jahrgang sehen.
        // row trägt sowohl Submission- als auch Challenge-Felder (ein JOIN),
        // die zentrale Logik bekommt beide Sichten explizit uebergeben.
        const submissionView = { moderation_status: row.moderation_status, konfi_consent: row.konfi_consent };
        const challengeView = { visibility: row.visibility };
        if (isSubmissionPublic(submissionView, challengeView) && requester.jahrgang_id) {
          const jahrgangIds = await challengeJahrgangIds(row.challenge_id);
          mayAccess = jahrgangIds.includes(requester.jahrgang_id);
        }
      }

      if (!mayAccess) {
        return res.status(403).json({ error: 'Zugriff verweigert' });
      }

      const filePath = path.join(challengeDir, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Datei nicht auf dem Server gefunden' });
      }

      if (row.file_name) {
        const ext = path.extname(row.file_name).toLowerCase();
        if (CONTENT_TYPES[ext]) {
          res.setHeader('Content-Type', CONTENT_TYPES[ext]);
        }
      }

      const fileBuffer = await fs.promises.readFile(filePath);
      let mediaBuffer;
      try {
        mediaBuffer = decryptBuffer(fileBuffer);
      } catch (decErr) {
        console.error('Error decrypting challenge file:', decErr);
        return res.status(500).json({ error: 'Datei konnte nicht entschlüsselt werden' });
      }
      res.send(mediaBuffer);
    } catch (error) {
      console.error('Error serving challenge file:', error);
      res.status(500).json({ error: 'Serverfehler' });
    }
  });

  // ====================================================================
  // LEITUNGS-ENDPUNKTE (org_admin / admin / teamer)
  // ====================================================================

  // GET /admin/authors — Personen der Org, die als Urheber:in einer Challenge
  // ausgewaehlt werden können. Bewusst ALLE Rollen (auch Konfis) — eine
  // Challenge kann ausdruecklich von einem Konfi stammen (anders als
  // GET /admin/users, das Konfis kategorisch ausschliesst und org_admin
  // vorbehalten ist). Teamer sehen dabei nur Konfis ihrer zugewiesenen
  // Jahrgänge (gleiche Sichtbarkeitsgrenze wie sonst in dieser Datei),
  // org_admin/admin sehen alle Konfis der Organisation.
  router.get('/admin/authors', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const viewable = viewableJahrgangIds(req);
      const params = [req.user.organization_id];
      let konfiJahrgangFilter = '';
      if (viewable !== null) {
        if (viewable.length === 0) {
          konfiJahrgangFilter = "AND r.name <> 'konfi'";
        } else {
          params.push(viewable);
          konfiJahrgangFilter = `AND (r.name <> 'konfi' OR kp.jahrgang_id = ANY($2::int[]))`;
        }
      }

      const { rows } = await db.query(
        `SELECT u.id, u.display_name, r.name AS role_name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         LEFT JOIN konfi_profiles kp ON kp.user_id = u.id
         WHERE u.organization_id = $1
           AND u.deleted_at IS NULL
           AND r.name IN ('org_admin', 'admin', 'teamer', 'konfi')
           ${konfiJahrgangFilter}
         ORDER BY (r.name = 'konfi'), u.display_name`,
        params
      );

      res.json(rows);
    } catch (err) {
      console.error('Database error in GET /challenges/admin/authors:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // GET /admin — alle Challenges der Org (inkl. Entwuerfe) mit Zaehlern.
  // Teamer sehen nur Challenges ihrer zugewiesenen Jahrgänge.
  router.get('/admin', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const viewable = viewableJahrgangIds(req);
      // $1 = Organisation, $2 = eigene User-ID (für die Teilnahme-Felder,
      // deshalb IMMER belegt), $3 = optionale Jahrgangs-Liste.
      const params = [req.user.organization_id, req.user.id];
      let jahrgangFilter = '';
      if (viewable !== null) {
        if (viewable.length === 0) {
          // NICHT fuer super_admin: viewableJahrgangIds gibt auch fuer ihn
          // [] zurueck, aber aus einem anderen Grund -- er hat keinen Zugriff
          // auf Jahrgangsdaten, nicht "keine Zuweisung". Heute weist ihn
          // schon requireTeamer mit 403 ab (rbac.js), der Guard hier ist die
          // Absicherung, falls sich das einmal aendert -- der Hinweis waere
          // fuer ihn in jedem Fall falsch.
          if (req.user.role_name === 'super_admin') {
            return res.json([]);
          }
          res.set('X-Kein-Jahrgang-Zugewiesen', 'true');
          jahrgangFilter = `AND c.audience = 'nur_team'`;
        } else {
          params.push(viewable);
          // 'nur_team' ist org-weit ohne Jahrgangs-Zuordnung -> für jeden Teamer
          // sichtbar, sonst könnte er seine eigene Team-Runde nicht verwalten.
          jahrgangFilter = `AND (
            c.audience = 'nur_team'
            OR EXISTS (
              SELECT 1 FROM challenge_jahrgang_assignments cja2
              WHERE cja2.challenge_id = c.id AND cja2.jahrgang_id = ANY($3::int[])
            )
          )`;
        }
      }

      const { rows } = await db.query(
        `SELECT c.*,
                COALESCE(au.display_name, c.author_freetext) AS author_name,
                au.display_name AS author_display_name,
                (SELECT COUNT(*) FROM challenge_submissions s WHERE s.challenge_id = c.id) AS submission_count,
                (SELECT COUNT(*) FROM challenge_submissions s WHERE s.challenge_id = c.id AND s.moderation_status = 'pending') AS pending_count,
                -- Eigene Teilnahme: Seit der Zusammenlegung von "Verwalten" und
                -- "Mitmachen" (11.08.) zeigt EINE Liste beides. Deshalb liefert
                -- dieser Endpunkt zusaetzlich, was GET /challenges/konfi für
                -- die Teilnehmer-Sicht liefert — sonst müsste das Frontend
                -- zwei Listen mischen.
                EXISTS (
                  SELECT 1 FROM challenge_submissions s
                  WHERE s.challenge_id = c.id AND s.user_id = $2
                    AND s.moderation_status = 'approved'
                ) AS has_badge,
                -- Wann der eigene Stempel verdient wurde. ADDITIV
                -- und wortgleich zur Konfi-Liste oben: Ohne dieses Feld konnte
                -- das Stempel-Popover in der Leitungs- und Teamer-Ansicht kein
                -- Datum zeigen -- dieselbe Kachel nannte bei Konfis den Tag und
                -- hier nichts. Ausgelieferte Apps ignorieren das neue Feld.
                (
                  SELECT MIN(COALESCE(s3.approved_at, s3.created_at))
                  FROM challenge_submissions s3
                  WHERE s3.challenge_id = c.id AND s3.user_id = $2
                    AND s3.moderation_status = 'approved'
                ) AS earned_at,
                (SELECT COUNT(*) FROM challenge_submissions s
                  WHERE s.challenge_id = c.id AND s.user_id = $2) AS own_submission_count,
                COALESCE(
                  (SELECT json_agg(json_build_object('id', j.id, 'name', j.name) ORDER BY j.name)
                   FROM challenge_jahrgang_assignments cja
                   JOIN jahrgaenge j ON cja.jahrgang_id = j.id
                   WHERE cja.challenge_id = c.id),
                  '[]'::json
                ) AS jahrgaenge
         FROM challenges c
         LEFT JOIN users au ON c.author_user_id = au.id
         WHERE c.organization_id = $1
         ${jahrgangFilter}
         ORDER BY c.starts_at DESC, c.id DESC`,
        params
      );

      const now = new Date();
      res.json(rows.map(row => ({
        ...row,
        allowed_media: parseAllowedMedia(row.allowed_media),
        submission_count: parseInt(row.submission_count, 10) || 0,
        pending_count: parseInt(row.pending_count, 10) || 0,
        // COUNT kommt vom Treiber als String — ohne Parsen liefe '1' ins
        // Frontend, obwohl der Typ (AdminChallenge) eine Zahl verspricht.
        own_submission_count: parseInt(row.own_submission_count, 10) || 0,
        status: deriveStatus(row, now),
        locked: hasStarted(row, now)
      })));
    } catch (err) {
      console.error('Database error in GET /challenges/admin:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // POST /admin — Challenge anlegen (Entwurf oder direkt geplant).
  router.post('/admin', rbacVerifier, requireTeamer, validateCreate, async (req, res) => {
    const client = await db.getClient();
    try {
      const {
        title, description, challenge_type, audience, visibility, moderated, allowed_media,
        allow_multiple, badge_icon, badge_name, author_user_id, author_freetext,
        starts_at, ends_at, is_draft, jahrgang_ids
      } = req.body;

      if (new Date(ends_at) <= new Date(starts_at)) {
        return res.status(400).json({ error: 'Das Ende muss nach dem Start liegen.' });
      }

      // 'nur_team' läuft org-weit über die Rolle — Jahrgänge werden dort
      // bewusst NICHT gespeichert (sonst wuerde die Zuordnung suggerieren, sie
      // wuerde den Kreis einschraenken).
      // Default 'konfis_und_team' (Migration 122): das Team ist immer dabei.
      const newAudience = AUDIENCES.includes(audience) ? audience : 'konfis_und_team';
      const teamOnly = newAudience === 'nur_team';

      const media = Array.isArray(allowed_media) && allowed_media.length > 0
        ? allowed_media
        : ['text', 'photo'];
      if (media.some(m => !MEDIA_TYPES.includes(m))) {
        return res.status(400).json({ error: 'Ungültige Medienart' });
      }

      // Org-Isolation: fremde Jahrgänge/Urheber abweisen.
      if (!teamOnly && jahrgang_ids && jahrgang_ids.length > 0) {
        if (!(await allIdsBelongToOrg(db, 'jahrgaenge', jahrgang_ids, req.user.organization_id))) {
          return res.status(403).json({ error: 'Ungültige Jahrgänge' });
        }
        // Teamer duerfen nur ihre eigenen Jahrgänge bespielen.
        const viewable = viewableJahrgangIds(req);
        if (viewable !== null && !jahrgang_ids.every(id => viewable.includes(Number(id)))) {
          return res.status(403).json({ error: 'Kein Zugriff auf einen der gewählten Jahrgänge' });
        }
      }
      if (author_user_id) {
        const { rows: [author] } = await db.query(
          'SELECT id FROM users WHERE id = $1 AND organization_id = $2',
          [author_user_id, req.user.organization_id]
        );
        if (!author) {
          return res.status(400).json({ error: 'Urheber nicht gefunden' });
        }
      }

      await client.query('BEGIN');

      const { rows: [created] } = await client.query(
        `INSERT INTO challenges
           (organization_id, title, description, challenge_type, audience, visibility, moderated,
            allowed_media, allow_multiple, badge_icon, badge_name, author_user_id,
            author_freetext, created_by, starts_at, ends_at, is_draft)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          req.user.organization_id,
          title,
          description,
          challenge_type || 'frei',
          newAudience,
          visibility || 'konfi_choice',
          moderated !== undefined ? moderated : true,
          JSON.stringify(media),
          allow_multiple !== undefined ? allow_multiple : true,
          badge_icon || 'flag',
          badge_name,
          author_user_id || null,
          author_freetext || null,
          req.user.id,
          starts_at,
          ends_at,
          is_draft !== undefined ? is_draft : true
        ]
      );

      if (!teamOnly && jahrgang_ids && jahrgang_ids.length > 0) {
        await client.query(
          `INSERT INTO challenge_jahrgang_assignments (challenge_id, jahrgang_id)
           SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
          [created.id, jahrgang_ids]
        );
      }

      await client.query('COMMIT');

      res.status(201).json({
        ...created,
        allowed_media: parseAllowedMedia(created.allowed_media),
        status: deriveStatus(created)
      });

      // Live-Update: Das Anlegen meldete bisher GAR NICHTS — obwohl das Formular
      // standardmaessig direkt veroeffentlicht. Konfis und die uebrige Leitung
      // sahen die neue Challenge erst nach manuellem Neuladen.
      // Entwuerfe gehen nur an die Leitung, Konfis sehen sie ohnehin nicht.
      if (!created.is_draft) {
        notifyJahrgaenge(created.id, 'create', { challengeId: created.id });
      }
      notifyLeadership(req.user.organization_id, 'create', { challengeId: created.id });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in POST /challenges/admin:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      client.release();
    }
  });

  // PUT /admin/:id — vor Start: alles. Nach Start nur noch
  // title/description/ends_at/badge_icon/badge_name; visibility, moderated,
  // starts_at und allowed_media sind eingefroren (Konsens-Integritaet).
  router.put('/admin/:id', rbacVerifier, requireTeamer, validateUpdate, async (req, res) => {
    const client = await db.getClient();
    try {
      const challengeId = parseInt(req.params.id, 10);
      const challenge = await loadChallenge(challengeId, req.user.organization_id);
      if (!challenge) {
        return res.status(404).json({ error: 'Challenge nicht gefunden' });
      }
      if (!(await leadershipMayAccess(req, challengeId))) {
        return res.status(403).json({ error: 'Kein Zugriff auf diese Challenge' });
      }

      const started = hasStarted(challenge);
      const {
        title, description, challenge_type, audience, visibility, moderated, allowed_media,
        allow_multiple, badge_icon, badge_name, author_user_id, author_freetext,
        starts_at, ends_at, is_draft, jahrgang_ids
      } = req.body;

      if (started) {
        const lockedChanges = [];
        if (audience !== undefined && audience !== (challenge.audience || 'konfis')) lockedChanges.push('Teilnahme-Kreis');
        if (visibility !== undefined && visibility !== challenge.visibility) lockedChanges.push('Sichtbarkeit');
        if (moderated !== undefined && moderated !== challenge.moderated) lockedChanges.push('Moderation');
        if (starts_at !== undefined && new Date(starts_at).getTime() !== new Date(challenge.starts_at).getTime()) lockedChanges.push('Startzeitpunkt');
        if (allowed_media !== undefined
          && JSON.stringify(allowed_media) !== JSON.stringify(parseAllowedMedia(challenge.allowed_media))) {
          lockedChanges.push('erlaubte Medienarten');
        }
        if (lockedChanges.length > 0) {
          return res.status(409).json({
            error: `Nach dem Start der Challenge lässt sich Folgendes nicht mehr ändern: ${lockedChanges.join(', ')}. Die Konfis haben unter diesen Bedingungen eingereicht.`
          });
        }
      }

      const newStartsAt = started ? challenge.starts_at : (starts_at !== undefined ? starts_at : challenge.starts_at);
      const newEndsAt = ends_at !== undefined ? ends_at : challenge.ends_at;
      if (new Date(newEndsAt) <= new Date(newStartsAt)) {
        return res.status(400).json({ error: 'Das Ende muss nach dem Start liegen.' });
      }

      // audience wie visibility nach dem Start eingefroren (s.o.).
      const effectiveAudience = started
        ? (challenge.audience || 'konfis')
        : (AUDIENCES.includes(audience) ? audience : (challenge.audience || 'konfis'));
      const teamOnly = effectiveAudience === 'nur_team';

      let media = parseAllowedMedia(challenge.allowed_media);
      if (!started && allowed_media !== undefined) {
        if (!Array.isArray(allowed_media) || allowed_media.length === 0 || allowed_media.some(m => !MEDIA_TYPES.includes(m))) {
          return res.status(400).json({ error: 'Ungültige Medienart' });
        }
        media = allowed_media;
      }

      if (!teamOnly && jahrgang_ids !== undefined && jahrgang_ids.length > 0) {
        if (!(await allIdsBelongToOrg(db, 'jahrgaenge', jahrgang_ids, req.user.organization_id))) {
          return res.status(403).json({ error: 'Ungültige Jahrgänge' });
        }
        const viewable = viewableJahrgangIds(req);
        if (viewable !== null && !jahrgang_ids.every(id => viewable.includes(Number(id)))) {
          return res.status(403).json({ error: 'Kein Zugriff auf einen der gewählten Jahrgänge' });
        }
      }
      if (author_user_id) {
        const { rows: [author] } = await db.query(
          'SELECT id FROM users WHERE id = $1 AND organization_id = $2',
          [author_user_id, req.user.organization_id]
        );
        if (!author) {
          return res.status(400).json({ error: 'Urheber nicht gefunden' });
        }
      }

      await client.query('BEGIN');

      const { rows: [updated] } = await client.query(
        `UPDATE challenges SET
           title = $1,
           description = $2,
           challenge_type = $3,
           audience = $4,
           visibility = $5,
           moderated = $6,
           allowed_media = $7::jsonb,
           allow_multiple = $8,
           badge_icon = $9,
           badge_name = $10,
           author_user_id = $11,
           author_freetext = $12,
           starts_at = $13,
           ends_at = $14,
           is_draft = $15,
           updated_at = NOW()
         WHERE id = $16 AND organization_id = $17
         RETURNING *`,
        [
          title !== undefined ? title : challenge.title,
          description !== undefined ? description : challenge.description,
          !started && challenge_type !== undefined ? challenge_type : challenge.challenge_type,
          effectiveAudience,
          started ? challenge.visibility : (visibility !== undefined ? visibility : challenge.visibility),
          started ? challenge.moderated : (moderated !== undefined ? moderated : challenge.moderated),
          JSON.stringify(media),
          !started && allow_multiple !== undefined ? allow_multiple : challenge.allow_multiple,
          badge_icon !== undefined ? badge_icon : challenge.badge_icon,
          badge_name !== undefined ? badge_name : challenge.badge_name,
          author_user_id !== undefined ? (author_user_id || null) : challenge.author_user_id,
          author_freetext !== undefined ? (author_freetext || null) : challenge.author_freetext,
          newStartsAt,
          newEndsAt,
          started ? false : (is_draft !== undefined ? is_draft : challenge.is_draft),
          challengeId,
          req.user.organization_id
        ]
      );

      if (!started && teamOnly) {
        // Wechsel auf 'nur_team': Jahrgangs-Zuordnungen abraeumen, damit keine
        // verwaiste Zuordnung eine Einschraenkung suggeriert, die nicht greift.
        await client.query('DELETE FROM challenge_jahrgang_assignments WHERE challenge_id = $1', [challengeId]);
      } else if (!started && jahrgang_ids !== undefined) {
        await client.query('DELETE FROM challenge_jahrgang_assignments WHERE challenge_id = $1', [challengeId]);
        if (jahrgang_ids.length > 0) {
          await client.query(
            `INSERT INTO challenge_jahrgang_assignments (challenge_id, jahrgang_id)
             SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
            [challengeId, jahrgang_ids]
          );
        }
      }

      await client.query('COMMIT');

      res.json({
        ...updated,
        allowed_media: parseAllowedMedia(updated.allowed_media),
        status: deriveStatus(updated),
        locked: hasStarted(updated)
      });

      notifyJahrgaenge(challengeId, 'challenge_update', { challengeId });
      // Auch die Leitung benachrichtigen: sonst sieht die Verwaltungsliste die
      // Änderung nicht — und reine Team-Challenges (ohne Jahrgänge) erreichten
      // überhaupt niemanden.
      notifyLeadership(req.user.organization_id, 'challenge_update', { challengeId });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Database error in PUT /challenges/admin/:id:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    } finally {
      client.release();
    }
  });

  router.delete('/admin/:id',
    rbacVerifier,
    requireAdmin,
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    query('force').optional().isIn(['true', 'false']).withMessage('Ungültiger force-Parameter'),
    handleValidationErrors,
    async (req, res) => {
      try {
        const challengeId = parseInt(req.params.id, 10);
        const challenge = await loadChallenge(challengeId, req.user.organization_id);
        if (!challenge) {
          return res.status(404).json({ error: 'Challenge nicht gefunden' });
        }
        if (!(await leadershipMayAccess(req, challengeId))) {
          return res.status(403).json({ error: 'Kein Zugriff auf diese Challenge' });
        }

        // Jahrgänge VOR dem Löschen merken: danach sind die Zuordnungen weg
        // und notifyJahrgaenge findet niemanden mehr.
        const betroffeneJahrgaenge = await challengeJahrgangIds(challengeId);

        const force = req.query.force === 'true';
        if (hasStarted(challenge) && !force) {
          return res.status(409).json({
            error: 'Diese Challenge läuft bereits oder ist beendet. Beim Löschen gehen alle Beiträge der Konfis verloren — bitte ausdrücklich bestätigen.'
          });
        }

        // Dateien VOR dem DB-Delete einsammeln (danach sind die Zeilen weg).
        const { rows: files } = await db.query(
          'SELECT file_path FROM challenge_submissions WHERE challenge_id = $1 AND file_path IS NOT NULL',
          [challengeId]
        );

        await db.query('DELETE FROM challenges WHERE id = $1 AND organization_id = $2',
          [challengeId, req.user.organization_id]);

        for (const f of files) {
          await deleteChallengeFile(f.file_path);
        }

        res.json({ message: 'Challenge gelöscht' });

        // Ohne diese Meldung blieb die geloeschte Challenge bei Konfis in der
        // Liste stehen und der Aufruf lief ins Leere.
        for (const jahrgangId of betroffeneJahrgaenge) {
          liveUpdate.sendToJahrgang(jahrgangId, 'challenges', 'delete', { challengeId })
            .catch((err) => console.error('Live-Update Challenge-Loeschung:', err.message));
        }
        notifyLeadership(req.user.organization_id, 'delete', { challengeId });
      } catch (err) {
        console.error('Database error in DELETE /challenges/admin/:id:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    }
  );

  // GET /admin/:id/submissions — Sammelansicht für die Leitung: ALLE Beitraege
  // mit Konfi-Name, Konsens und Status (die Leitung sieht immer alles, auch
  // anonyme Beitraege mit Namen — Anonymitaet gilt gegenueber der Gruppe).
  router.get('/admin/:id/submissions',
    rbacVerifier,
    requireTeamer,
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors,
    async (req, res) => {
      try {
        const challengeId = parseInt(req.params.id, 10);
        const challenge = await loadChallenge(challengeId, req.user.organization_id);
        if (!challenge) {
          return res.status(404).json({ error: 'Challenge nicht gefunden' });
        }
        if (!(await leadershipMayAccess(req, challengeId))) {
          return res.status(403).json({ error: 'Kein Zugriff auf diese Challenge' });
        }

        const { rows } = await db.query(
          `SELECT cs.id, cs.user_id, cs.media_type, cs.text_content, cs.file_path,
                  cs.file_name, cs.link_url, cs.link_title, cs.link_author, cs.link_album,
                  cs.konfi_consent, cs.moderation_status,
                  cs.hidden_at, cs.moderation_note, cs.created_at,
                  u.display_name,
                  j.name AS jahrgang_name
           FROM challenge_submissions cs
           JOIN users u ON cs.user_id = u.id
           LEFT JOIN konfi_profiles kp ON kp.user_id = u.id
           LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
           WHERE cs.challenge_id = $1
           -- Eindeutig sortieren, siehe Galerie oben. Hier faellt es beim
           -- Moderieren auf: Eine Liste, die sich bei jedem Aktualisieren
           -- umsortiert, laesst einen den Ueberblick verlieren.
           ORDER BY cs.created_at DESC, cs.id DESC`,
          [challengeId]
        );

        res.json({
          challenge: {
            ...challenge,
            allowed_media: parseAllowedMedia(challenge.allowed_media),
            status: deriveStatus(challenge),
            locked: hasStarted(challenge)
          },
          submissions: rows.map(row => ({
            ...row,
            // Für die Leitung transparent machen, ob dieser Beitrag in der
            // Gruppen-Galerie mit oder ohne Namen erscheint.
            is_public: isSubmissionPublic(row, challenge),
            is_anonymous: isAnonymous(row, challenge)
          }))
        });
      } catch (err) {
        console.error('Database error in GET /challenges/admin/:id/submissions:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    }
  );

  // PUT /admin/submissions/:id/moderate —
  // { action: 'approve'|'hide'|'unhide'|'anonymize', reason? }.
  // Ausblenden geht IMMER, auch bei visibility='public' — hidden schlägt alles.
  // reason (optional, nur bei 'hide'): Begruendung, die die einreichende
  // Person bei ihrem Beitrag sieht.
  router.put('/admin/submissions/:id/moderate',
    rbacVerifier,
    requireTeamer,
    validateModerate,
    async (req, res) => {
      try {
        const submissionId = parseInt(req.params.id, 10);
        const { action, reason } = req.body;
        const note = typeof reason === 'string' && reason.trim() ? reason.trim() : null;

        const { rows: [submission] } = await db.query(
          `SELECT cs.id, cs.challenge_id, cs.user_id, cs.moderation_status,
                  cs.konfi_consent, cs.media_type, cs.approved_at,
                  c.visibility, c.title AS challenge_title,
                  u.display_name AS einreicher_name
           FROM challenge_submissions cs
           JOIN challenges c ON cs.challenge_id = c.id
           JOIN users u ON u.id = cs.user_id
           WHERE cs.id = $1 AND cs.organization_id = $2`,
          [submissionId, req.user.organization_id]
        );
        if (!submission) {
          return res.status(404).json({ error: 'Beitrag nicht gefunden' });
        }
        if (!(await leadershipMayAccess(req, submission.challenge_id))) {
          return res.status(403).json({ error: 'Kein Zugriff auf diesen Beitrag' });
        }

        if (action === 'anonymize') {
          // 'private' ist die staerkste Zusage des Konfi ("nur die Leitung") —
          // die darf die Moderation NICHT aufweichen.
          if (submission.konfi_consent === 'private') {
            return res.status(409).json({
              error: 'Dieser Beitrag ist nur für die Leitung freigegeben. Diese Zusage lässt sich nicht ändern.'
            });
          }
          if (submission.konfi_consent === 'anonymous') {
            return res.status(409).json({
              error: 'Dieser Beitrag ist bereits anonym. Anonymität lässt sich nicht zurücknehmen.'
            });
          }
          const { rows: [row] } = await db.query(
            `UPDATE challenge_submissions SET konfi_consent = 'anonymous'
             WHERE id = $1 RETURNING id, moderation_status, konfi_consent`,
            [submissionId]
          );
          res.json(row);
          notifyJahrgaenge(submission.challenge_id, 'submission_update', { challengeId: submission.challenge_id });
          notifyLeadership(req.user.organization_id, 'submission_update', { challengeId: submission.challenge_id });
          return;
        }

        let updated;
        if (action === 'hide') {
          ({ rows: [updated] } = await db.query(
            `UPDATE challenge_submissions
             SET moderation_status = 'hidden', hidden_by = $2, hidden_at = NOW(),
                 moderation_note = $3
             WHERE id = $1 RETURNING id, moderation_status, moderation_note`,
            [submissionId, req.user.id, note]
          ));
        } else {
          // approve und unhide fuehren beide zu 'approved' und raeumen die
          // hidden-Metadaten ab (ein wieder eingeblendeter Beitrag ist
          // freigegeben) — inklusive der Ausblende-Begruendung.
          // approved_by/approved_at halten fest, WER freigegeben hat
          // (Migration 146). Fuers Ausblenden gab es hidden_by/hidden_at
          // laengst; die Freigabe -- also die eigentliche Moderationsarbeit --
          // hinterliess bisher keine Spur. Der Jahresrueckblick macht sie
          // daraus sichtbar.
          //
          // BEWUSST NUR HIER und nicht beim Einreichen: Bei unmoderierten
          // Challenges entsteht 'approved' automatisch, ohne dass jemand
          // hingesehen hat. Dort bleibt die Spalte NULL -- niemand bekommt
          // Arbeit gutgeschrieben, die er nicht geleistet hat.
          ({ rows: [updated] } = await db.query(
            `UPDATE challenge_submissions
             SET moderation_status = 'approved', hidden_by = NULL, hidden_at = NULL,
                 moderation_note = NULL,
                 approved_by = $2, approved_at = NOW()
             WHERE id = $1 RETURNING id, moderation_status, moderation_note`,
            [submissionId, req.user.id]
          ));
        }

        res.json(updated);

        // Fire-and-forget NACH der Antwort: Pushes an die einreichende Person.
        (async () => {
          try {
            // Ausgeblendet: die einreichende Person erfaehrt es (mit
            // Begruendung, falls eine eingetragen wurde) — ausser jemand
            // blendet den EIGENEN Beitrag aus, dann weiss er es ohnehin.
            if (action === 'hide' && submission.user_id !== req.user.id) {
              await PushService.sendChallengeSubmissionHiddenToUser(
                db,
                submission.user_id,
                submission.challenge_id,
                submission.challenge_title,
                note
              );
            }
            // Abzeichen erst nach Freigabe: Ist die soeben freigegebene
            // Submission die ERSTE freigegebene dieser Person bei dieser
            // Challenge, ist das Abzeichen jetzt verdient -> Push. Bewusst nur
            // bei 'approve' (nicht 'unhide'): ein wieder eingeblendeter
            // Beitrag war schon einmal freigegeben.
            // Erst mit der Freigabe wird der Beitrag im Feed sichtbar —
            // hier feuert deshalb der Feed-Push fuer moderierte Challenges.
            // Bewusst NUR bei 'approve': Ein wieder eingeblendeter Beitrag
            // ('unhide') war schon einmal sichtbar, dafuer gaebe es sonst eine
            // zweite Mitteilung.
            //
            // Und nur bei der ERSTEN Freigabe: `approved_at` ist
            // die Spur, dass dieser Beitrag schon einmal durch war. Ohne die
            // Pruefung schickte ein zweiter Klick auf "Freigeben" dem ganzen
            // Jahrgang erneut "Neuer Beitrag von X" -- moeglich per
            // Doppelklick (die Swipe-Aktion prueft kein isBusy) oder wenn die
            // Antwort verlorengeht und die App den Aufruf wiederholt. Ein
            // 'approve' nach einem 'hide' zaehlt genauso: Der Jahrgang kennt
            // den Beitrag bereits, dieselbe Ueberlegung wie bei 'unhide'.
            // Der Abzeichen-Push weiter unten war ueber approvedCount === 1
            // laengst so abgesichert.
            //
            // Zwei Merkmale, weil eines allein nicht reicht: `approved_at`
            // bleibt bei UNmoderierten Challenges bewusst NULL (dort entsteht
            // 'approved' automatisch, siehe Kommentar beim UPDATE oben), und
            // `moderation_status` steht bei einem ausgeblendeten Beitrag auf
            // 'hidden'. Zusammen decken sie beide Wege ab, auf denen ein
            // Beitrag schon einmal im Feed stand.
            const schonEinmalFreigegeben =
              submission.approved_at !== null || submission.moderation_status === 'approved';
            if (action === 'approve' && !schonEinmalFreigegeben) {
              const sichtbar = isSubmissionPublic(
                { moderation_status: 'approved', konfi_consent: submission.konfi_consent },
                { visibility: submission.visibility }
              );
              if (sichtbar) {
                const anonym = isAnonymous(
                  { konfi_consent: submission.konfi_consent },
                  { visibility: submission.visibility }
                );
                await PushService.sendChallengeFeedToJahrgaenge(
                  db,
                  req.user.organization_id,
                  submission.challenge_id,
                  submission.challenge_title,
                  submission.user_id,
                  anonym ? null : submission.einreicher_name,
                  submission.media_type
                );
              }
            }

            if (action === 'approve') {
              const { rows: [{ count: approvedCount }] } = await db.query(
                `SELECT COUNT(*)::int AS count FROM challenge_submissions
                 WHERE challenge_id = $1 AND user_id = $2
                   AND moderation_status = 'approved'`,
                [submission.challenge_id, submission.user_id]
              );
              if (approvedCount === 1) {
                await PushService.sendChallengeBadgeEarnedToKonfi(
                  db,
                  submission.user_id,
                  submission.challenge_id,
                  submission.challenge_title
                );
              }
            }
          } catch (pushErr) {
            console.error('Push nach Challenge-Moderation fehlgeschlagen:', pushErr.message);
          }
        })();

        notifyJahrgaenge(submission.challenge_id, 'submission_update', { challengeId: submission.challenge_id });
        notifyLeadership(req.user.organization_id, 'submission_update', { challengeId: submission.challenge_id });
      } catch (err) {
        console.error('Database error in PUT /challenges/admin/submissions/:id/moderate:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    }
  );

  router.delete('/admin/submissions/:id',
    rbacVerifier,
    requireAdmin,
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors,
    async (req, res) => {
      try {
        const submissionId = parseInt(req.params.id, 10);

        const { rows: [submission] } = await db.query(
          `SELECT cs.id, cs.challenge_id, cs.user_id, cs.file_path
           FROM challenge_submissions cs
           WHERE cs.id = $1 AND cs.organization_id = $2`,
          [submissionId, req.user.organization_id]
        );
        if (!submission) {
          return res.status(404).json({ error: 'Beitrag nicht gefunden' });
        }
        if (!(await leadershipMayAccess(req, submission.challenge_id))) {
          return res.status(403).json({ error: 'Kein Zugriff auf diesen Beitrag' });
        }

        await db.query(
          'DELETE FROM challenge_submissions WHERE id = $1 AND organization_id = $2',
          [submissionId, req.user.organization_id]
        );
        // Nach dem DB-Delete, bewusst fehlertolerant (loggt nur).
        await deleteChallengeFile(submission.file_path);

        res.json({ message: 'Beitrag gelöscht' });

        // Galerie der Konfis und Leitungs-Liste aktualisieren. War es der
        // einzige freigegebene Beitrag der Person, verschwindet damit auch
        // das daraus abgeleitete Abzeichen — wie beim Ausblenden.
        notifyJahrgaenge(submission.challenge_id, 'submission_update', { challengeId: submission.challenge_id });
        notifyLeadership(req.user.organization_id, 'submission_update', { challengeId: submission.challenge_id });
      } catch (err) {
        console.error('Database error in DELETE /challenges/admin/submissions/:id:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    }
  );

  // GET /admin/:id/export — text/plain mit allen Texten und Links, damit die
  // Leitung daraus eine Liturgie, eine Playlist oder eine Wand bauen kann.
  // Anonyme Beitraege erscheinen ohne Namen.
  router.get('/admin/:id/export',
    rbacVerifier,
    requireTeamer,
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    handleValidationErrors,
    async (req, res) => {
      try {
        const challengeId = parseInt(req.params.id, 10);
        const challenge = await loadChallenge(challengeId, req.user.organization_id);
        if (!challenge) {
          return res.status(404).json({ error: 'Challenge nicht gefunden' });
        }
        if (!(await leadershipMayAccess(req, challengeId))) {
          return res.status(403).json({ error: 'Kein Zugriff auf diese Challenge' });
        }

        const { rows } = await db.query(
          `SELECT cs.media_type, cs.text_content, cs.link_url, cs.link_title, cs.link_album,
                  cs.link_author, cs.konfi_consent, cs.moderation_status, cs.created_at,
                  u.display_name
           FROM challenge_submissions cs
           JOIN users u ON cs.user_id = u.id
           WHERE cs.challenge_id = $1
             AND cs.moderation_status <> 'hidden'
             AND (
               $2 = 'private'
               OR (cs.moderation_status = 'approved'
                   AND ($2 = 'public' OR cs.konfi_consent IN ('publish', 'anonymous')))
             )
           ORDER BY cs.created_at ASC`,
          [challengeId, challenge.visibility]
        );

        const lines = [];
        lines.push(challenge.title);
        lines.push('='.repeat(challenge.title.length));
        lines.push('');
        if (challenge.author_name) {
          lines.push(`Gestellt von: ${challenge.author_name}`);
          lines.push('');
        }
        lines.push(challenge.description);
        lines.push('');
        lines.push(`Beiträge: ${rows.length}`);
        lines.push('');

        for (const row of rows) {
          const anonymous = isAnonymous(row, challenge);
          const name = anonymous ? 'Anonym' : row.display_name;
          const datum = formatDatum(row.created_at);
          lines.push(`--- ${name} (${datum}) ---`);
          if (row.text_content) {
            lines.push(row.text_content);
          }
          if (row.link_url) {
            // Interpret – Titel (Album): so liest sich eine Playlist, und so
            // steht es auch in der App. Die URL bleibt trotzdem drin, sie ist
            // der eigentliche Inhalt.
            const kopf = [row.link_author, row.link_title].filter(Boolean).join(' – ');
            const meta = row.link_album ? `${kopf} (${row.link_album})` : kopf;
            if (meta) {
              lines.push(meta);
            }
            lines.push(row.link_url);
          }
          if (!row.text_content && !row.link_url && row.file_name) {
            lines.push(`[${row.media_type}: ${row.file_name}]`);
          }
          lines.push('');
        }

        const filenameSafe = challenge.title.replace(/[^a-zA-Z0-9äöüÄÖÜß _-]/g, '').trim() || 'challenge';
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filenameSafe)}.txt"`);
        res.send(lines.join('\n'));
      } catch (err) {
        console.error('Database error in GET /challenges/admin/:id/export:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
      }
    }
  );

  return router;
};

// Sichtbarkeitslogik auch für Tests und andere Module exportierbar machen,
// ohne dass jemand sie nachbaut.
module.exports.PUBLIC_SUBMISSION_SQL = PUBLIC_SUBMISSION_SQL;
module.exports.isSubmissionPublic = isSubmissionPublic;
module.exports.isAnonymous = isAnonymous;
module.exports.deriveStatus = deriveStatus;
module.exports.hasStarted = hasStarted;
