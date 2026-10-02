const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { encryptFileToFile, decryptFileToStream, leseKopfBytes } = require('../utils/photoCrypto');
const { allIdsBelongToOrg } = require('../utils/orgOwnership');
const liveUpdate = require('../utils/liveUpdate');
const { istTextTyp, pruefeTextDatei, textInhaltsTyp } = require('../utils/textDatei');

module.exports = (db, rbacVerifier, roleHelpers, materialUpload) => {
  const { requireTeamer, requireAdmin } = roleHelpers;

  //   Material MIT Jahrgang  -> nur Teamer:innen und Admins dieser Jahrgänge
  //   Material OHNE Jahrgang -> alle Teamer:innen und Admins der Gemeinde
  //   org_admin -> immer alles, sonst wäre es nicht verwaltbar
  //
  //   materials.ist_global = true -> alle Teamer:innen der Gemeinde, egal
  //   welche Jahrgänge zugeordnet sind.
  //
  // Der Zweig kam ADDITIV dazu (Migration 137). Der mittlere Zweig ("kein
  // Jahrgang zugeordnet") MUSS bleiben: Bestandsmaterial ohne Jahrgang hat
  // ist_global = false und würde sonst schlagartig für alle Teamer:innen
  // verschwinden. Die Spalte macht die Absicht sichtbar -- vorher war
  // "ohne Jahrgang = für alle" ein unbenannter Nebeneffekt und nicht davon
  // zu unterscheiden, dass jemand die Zuordnung schlicht vergessen hatte.
  //
  // "Für alle" heißt immer: alle TEAMER:INNEN. Konfis kommen an keine
  // Material-Route (requireTeamer).
  //
  // Vorher war die Jahrgangs-Bindung reine Suchhilfe: Gelesen wurde nur die
  // Organisation, also sah jede Teamer:in jedes Material. Zum Zeitpunkt der
  // Umstellung gab es in Produktion noch kein einziges Material — es kann
  // also niemandem etwas verschwinden.
  //
  // Die Bindung an einen Termin (material_events) bleibt bewusst reine
  // Suchhilfe und grenzt nichts ab.
  //
  // Gibt eine SQL-Bedingung auf `m` zurück, oder null, wenn nicht
  // eingeschraenkt werden muss.
  const jahrgangsSchranke = (user, platzhalter) => {
    // org_admin (und is_super_admin-Flag) bleiben ungeschrankt; teamer und
    // admin laufen durch dieselbe Zuweisungs-Pruefung.
    if (user.is_super_admin || user.role_name === 'org_admin') return null;
    if (!['teamer', 'admin'].includes(user.role_name)) return null;
    return `(
      m.ist_global = true
      OR NOT EXISTS (SELECT 1 FROM material_jahrgaenge mj WHERE mj.material_id = m.id)
      OR EXISTS (
        SELECT 1 FROM material_jahrgaenge mj
        JOIN user_jahrgang_assignments uja ON uja.jahrgang_id = mj.jahrgang_id
        WHERE mj.material_id = m.id AND uja.user_id = ${platzhalter} AND uja.can_view = true
      )
    )`;
  };

  //   "Sichtbarkeit ist auch ueberfluessig. Denn: wenn kein Jahrgang dann
  //    global. Fertig. Sonst nur Jahrgang."
  //
  // Der Sichtbarkeits-Umschalter ist aus dem Formular verschwunden. Die
  // Spalte materials.ist_global (Migration 137) BLEIBT -- ausgelieferte
  // Apps lesen das Feld -- aber sie wird jetzt ABGELEITET: Schickt ein
  // Client das Feld ist_global NICHT mit (das neue Formular tut das nicht
  // mehr), gilt beim Anlegen und beim Bearbeiten der Jahrgaenge:
  //
  //   keine Jahrgaenge zugeordnet -> ist_global = true
  //   Jahrgaenge zugeordnet       -> ist_global = false
  //
  // Das aendert an der Lese-Schranke (jahrgangsSchranke oben) NICHTS:
  // Material ohne Jahrgang war schon ueber den mittleren Zweig fuer alle
  // sichtbar, das abgeleitete true benennt denselben Zustand nur. Deshalb
  // braucht die Ableitung auch KEINE org_admin-Pruefung -- sie kann nie
  // mehr Sichtbarkeit gewaehren, als die Jahrgangs-Zuordnung ohnehin
  // ergibt. Schickt ein ALTER Client das Feld dagegen explizit mit, gilt
  // weiter die Regel vom 31.08.: setzen und entziehen nur org_admin
  // (darfGlobalSetzen unten). So verhalten sich Store-Apps mit dem alten
  // Formular exakt wie bisher.
  //
  // Bestand: Altes Material ohne Jahrgang mit ist_global = false bleibt
  // ueber den mittleren Zweig fuer alle sichtbar -- unveraendert. Erst ein
  // Bearbeiten unter der neuen Regel schreibt das Flag passend um.

  //   "Vielleicht will ich ein pdf und ein oder mehrere YouTube Videos.
  //    Also mehr links und beides moeglich."
  //
  // Das Entweder-Oder vom 31.08. ist aufgehoben: Ein Material traegt
  // beliebig viele Dateien UND beliebig viele Links (Tabelle
  // material_links, Migration 142, nach dem Muster von material_files).
  //
  // ALT-APP-VERTRAG: materials.link_url (Migration 135) bleibt bestehen
  // und spiegelt immer den ERSTEN Link (kleinste id). Ausgelieferte Apps
  // kennen nur dieses Feld und sehen so weiterhin einen Link, solange es
  // welche gibt. Schreibt ein alter Client link_url (statt link_urls),
  // aendert er NUR den ersten Link -- weitere Links, die sein Formular
  // nie angezeigt hat, darf er nicht stillschweigend mitloeschen.
  // Das Array `links` kommt ADDITIV in die Antworten.
  //
  // Geprueft wird ueber new URL() und das SCHEMA, nie per String-Suche:
  // `javascript:alert(1)`, `data:text/html,...` und `file:///etc/passwd`
  // fallen damit alle durch. Bewusst NICHT auf eine Host-Erlaubnisliste
  // verengt (anders als die Musikdienste bei den Challenge-Beitraegen) --
  // die Leitung verlinkt hier eigene Seiten und beliebige Fremdquellen.
  const ERLAUBTE_SCHEMATA = ['http:', 'https:'];

  const pruefeLink = (wert) => {
    if (wert === undefined || wert === null || wert === '') return { ok: true, wert: null };
    if (typeof wert !== 'string') return { ok: false };
    const getrimmt = wert.trim();
    if (!getrimmt) return { ok: true, wert: null };
    if (getrimmt.length > 2000) return { ok: false };
    let url;
    try {
      url = new URL(getrimmt);
    } catch {
      return { ok: false };
    }
    if (!ERLAUBTE_SCHEMATA.includes(url.protocol)) return { ok: false };
    return { ok: true, wert: getrimmt };
  };

  const LINK_FEHLER = 'Der Link muss mit http:// oder https:// beginnen';

  // Obergrenze gegen Missbrauch (ein Formular mit hunderten Links waere
  // ohnehin unbenutzbar). Gleiche Groessenordnung wie die 10 Dateien pro
  // Upload-Anfrage.
  const MAX_LINKS = 20;
  const LINK_ANZAHL_FEHLER = `Höchstens ${MAX_LINKS} Links pro Material`;

  // Prueft ein link_urls-Array: jede Adresse einzeln ueber pruefeLink,
  // leere Eintraege fallen still heraus (das Formular schickt keine mit,
  // aber ein leeres Eingabefeld soll kein 400 ausloesen).
  // undefined heisst: Feld nicht geschickt, Links nicht anfassen.
  const pruefeLinkListe = (werte) => {
    if (werte === undefined) return { ok: true, liste: undefined };
    if (!Array.isArray(werte)) return { ok: false, fehler: LINK_FEHLER };
    if (werte.length > MAX_LINKS) return { ok: false, fehler: LINK_ANZAHL_FEHLER };
    const liste = [];
    for (const wert of werte) {
      const geprueft = pruefeLink(wert);
      if (!geprueft.ok) return { ok: false, fehler: LINK_FEHLER };
      if (geprueft.wert !== null) liste.push(geprueft.wert);
    }
    return { ok: true, liste };
  };

  // Ersetzt alle Links eines Materials (DELETE + INSERT, wie die
  // Jahrgangs-Zuordnung) und haelt den Alt-App-Spiegel materials.link_url
  // auf dem ersten Link.
  const schreibeAlleLinks = async (materialId, liste) => {
    await db.query('DELETE FROM material_links WHERE material_id = $1', [materialId]);
    for (const url of liste) {
      await db.query(
        'INSERT INTO material_links (material_id, url) VALUES ($1, $2)',
        [materialId, url]
      );
    }
    await db.query(
      'UPDATE materials SET link_url = $1, updated_at = NOW() WHERE id = $2',
      [liste[0] || null, materialId]
    );
  };

  const ladeLinks = async (materialId) => {
    const { rows } = await db.query(
      'SELECT id, url, created_at FROM material_links WHERE material_id = $1 ORDER BY id',
      [materialId]
    );
    return rows;
  };

  // Nur die Rolle org_admin. Die Routen bleiben bewusst auf requireAdmin --
  // würde man sie auf requireOrgAdmin heben, verlöre ein 'admin' das Anlegen
  // von ganz normalem Material, und das wäre ein Rückschritt.
  //
  // Ein 'admin' sieht und bearbeitet globales Material also weiterhin
  // (Titel, Beschreibung, Dateien, Link) -- nur das Flag selbst kann er
  // weder setzen noch entziehen. Geprüft wird beides: das Setzen (false ->
  // true) und das Entziehen (true -> false).
  const GLOBAL_FEHLER = 'Nur die Gemeindeleitung kann Material für das ganze Team freigeben';

  const darfGlobalSetzen = (user) => user.role_name === 'org_admin';

  //   "Admins sehen Material ihrer Jahrgaenge und globales Material.
  //    Material bearbeiten kann nur der Ersteller!"
  //
  // Die vier Schreibrouten (PUT /:id, DELETE /:id, POST /:id/files,
  // DELETE /files/:fileId) prueften bis dahin nur die Organisation -- jeder
  // 'admin' konnte damit fremdes Material aendern und loeschen. Jetzt gilt:
  //
  // Die DATEI-Routen zaehlen mit: Eine Datei anzuhaengen oder zu loeschen
  // veraendert das Material genauso wie ein neuer Titel -- sonst liesse
  // sich die Regel ueber den Datei-Umweg aushebeln.
  //
  // Ausgelieferte Apps: Die Antwortform aendert sich nicht, nur duerfen
  // manche Anfragen jetzt 403 statt 200. Die App zeigt dafuer die
  // Fehlermeldung an (fehlerText im Formular) -- kein Absturz, nur weniger
  // duerfen. created_by kommt ADDITIV in die Lese-Antworten, damit die
  // Oberflaeche die Aktionen von vornherein ausblenden kann.
  const darfMaterialAendern = (user, createdBy) =>
    user.is_super_admin === true
    || user.role_name === 'org_admin'
    || (createdBy !== null && createdBy === user.id);

  const ERSTELLER_FEHLER = 'Nur wer das Material angelegt hat oder die Gemeindeleitung kann es ändern';

  // Validierungsregeln
  const validateCreateMaterial = [
    body('title').notEmpty().trim().isLength({ min: 1, max: 255 }).withMessage('Titel erforderlich (1-255 Zeichen)'),
    handleValidationErrors
  ];

  const validateUpdateMaterial = [
    param('id').isInt({ min: 1 }).withMessage('Ungültige ID'),
    body('title').optional().trim().isLength({ min: 1, max: 255 }).withMessage('Titel max. 255 Zeichen'),
    handleValidationErrors
  ];

  // Schema: siehe backend/migrations/064_consolidate_inline_schemas.sql

  // ====================================================================
  // MATERIAL ENDPOINTS
  // ====================================================================

  // GET / - Alle Materialien der Organisation laden
  router.get('/', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const { search, event_id, jahrgang_id } = req.query;

      let query = `
        SELECT m.id, m.title, m.description, m.link_url, m.ist_global,
               m.created_at, m.created_by, u.display_name as created_by_name,
               (SELECT COUNT(*) FROM material_files mf WHERE mf.material_id = m.id) as file_count,
               (SELECT COUNT(*) FROM material_links ml WHERE ml.material_id = m.id) as link_count,
               (SELECT COUNT(*) FROM material_events me WHERE me.material_id = m.id) as event_count,
               (SELECT COUNT(*) FROM material_jahrgaenge mj WHERE mj.material_id = m.id) as jahrgang_count
        FROM materials m
        LEFT JOIN users u ON m.created_by = u.id
        WHERE m.organization_id = $1
      `;
      const params = [orgId];
      let paramIndex = 2;

      if (search) {
        query += ` AND (m.title ILIKE $${paramIndex} OR m.description ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      if (event_id) {
        query += ` AND EXISTS (SELECT 1 FROM material_events me WHERE me.material_id = m.id AND me.event_id = $${paramIndex})`;
        params.push(event_id);
        paramIndex++;
      }

      if (jahrgang_id) {
        query += ` AND EXISTS (SELECT 1 FROM material_jahrgaenge mj WHERE mj.material_id = m.id AND mj.jahrgang_id = $${paramIndex})`;
        params.push(jahrgang_id);
        paramIndex++;
      }

      const schranke = jahrgangsSchranke(req.user, `$${paramIndex}`);
      if (schranke) {
        query += ` AND ${schranke}`;
        params.push(req.user.id);
        paramIndex++;

        if (!(req.user.assigned_jahrgaenge || []).some(j => j.can_view)) {
          res.set('X-Kein-Jahrgang-Zugewiesen', 'true');
        }
      }

      query += ' ORDER BY m.created_at DESC';

      const { rows: materials } = await db.query(query, params);

      if (materials.length > 0) {
        const materialIds = materials.map(m => m.id);

        // Tags für alle Materialien laden
        // Events für alle Materialien laden
        const { rows: matEvents } = await db.query(
          `SELECT me.material_id, e.id, e.name
           FROM material_events me
           JOIN events e ON me.event_id = e.id
           WHERE me.material_id = ANY($1)`,
          [materialIds]
        );


        const eventsByMaterial = {};
        for (const ev of matEvents) {
          if (!eventsByMaterial[ev.material_id]) eventsByMaterial[ev.material_id] = [];
          eventsByMaterial[ev.material_id].push({ id: ev.id, name: ev.name });
        }

        // Jahrgänge für alle Materialien laden
        const { rows: matJahrgaenge } = await db.query(
          `SELECT mj.material_id, j.id, j.name
           FROM material_jahrgaenge mj
           JOIN jahrgaenge j ON mj.jahrgang_id = j.id
           WHERE mj.material_id = ANY($1)`,
          [materialIds]
        );

        const jahrgaengeByMaterial = {};
        for (const jg of matJahrgaenge) {
          if (!jahrgaengeByMaterial[jg.material_id]) jahrgaengeByMaterial[jg.material_id] = [];
          jahrgaengeByMaterial[jg.material_id].push({ id: jg.id, name: jg.name });
        }

        for (const material of materials) {
          material.events = eventsByMaterial[material.id] || [];
          material.jahrgaenge = jahrgaengeByMaterial[material.id] || [];
          material.file_count = parseInt(material.file_count, 10);
          material.link_count = parseInt(material.link_count, 10);
          material.event_count = parseInt(material.event_count, 10);
          material.jahrgang_count = parseInt(material.jahrgang_count, 10);
        }
      }

      res.json(materials);
    } catch (err) {
      console.error('Fehler beim Laden der Materialien:', err.message);
      res.status(500).json({ error: 'Fehler beim Laden der Materialien' });
    }
  });

  // GET /by-event/:eventId - Material zu einem bestimmten Event
  router.get('/by-event/:eventId', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const eventId = req.params.eventId;
      const schranke = jahrgangsSchranke(req.user, '$3');

      // Fremder oder unbekannter Termin -> 404 statt 200 [].
      // Beide Apps (2.2.0, 2.3.0) fangen den
      // Fehler ab und zeigen dann keine Materialien -- wie bei der leeren
      // Liste.
      const { rows: [termin] } = await db.query(
        'SELECT id FROM events WHERE id = $1 AND organization_id = $2',
        [eventId, orgId]
      );
      if (!termin) {
        return res.status(404).json({ error: 'Event nicht gefunden' });
      }

      const { rows: materials } = await db.query(
        `SELECT m.id, m.title, m.description, m.link_url, m.ist_global, m.created_at,
                m.created_by, u.display_name as created_by_name,
                (SELECT COUNT(*) FROM material_files mf WHERE mf.material_id = m.id) as file_count
         FROM materials m
         LEFT JOIN users u ON m.created_by = u.id
         WHERE m.organization_id = $1
           AND EXISTS (SELECT 1 FROM material_events me WHERE me.material_id = m.id AND me.event_id = $2)
           ${schranke ? `AND ${schranke}` : ''}
         ORDER BY m.created_at DESC`,
        schranke ? [orgId, eventId, req.user.id] : [orgId, eventId]
      );

      for (const material of materials) {
        material.file_count = parseInt(material.file_count, 10);
      }

      res.json(materials);
    } catch (err) {
      console.error('Fehler beim Laden der Event-Materialien:', err.message);
      res.status(500).json({ error: 'Fehler beim Laden der Event-Materialien' });
    }
  });

  // GET /:id - Einzelnes Material mit Dateien und Tags
  router.get('/:id', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const schranke = jahrgangsSchranke(req.user, '$3');

      const { rows: [material] } = await db.query(
        `SELECT m.id, m.title, m.description, m.link_url, m.ist_global,
                m.created_at, m.created_by, u.display_name as created_by_name
         FROM materials m
         LEFT JOIN users u ON m.created_by = u.id
         WHERE m.id = $1 AND m.organization_id = $2
           ${schranke ? `AND ${schranke}` : ''}`,
        schranke ? [req.params.id, orgId, req.user.id] : [req.params.id, orgId]
      );

      if (!material) {
        return res.status(404).json({ error: 'Material nicht gefunden' });
      }

      // Tags laden

      // Events laden (Many-to-Many)
      const { rows: matEvents } = await db.query(
        `SELECT e.id, e.name, e.event_date
         FROM material_events me
         JOIN events e ON me.event_id = e.id
         WHERE me.material_id = $1
         ORDER BY e.event_date DESC`,
        [material.id]
      );
      material.events = matEvents;

      // Jahrgänge laden (Many-to-Many)
      const { rows: matJahrgaenge } = await db.query(
        `SELECT j.id, j.name
         FROM material_jahrgaenge mj
         JOIN jahrgaenge j ON mj.jahrgang_id = j.id
         WHERE mj.material_id = $1
         ORDER BY j.name`,
        [material.id]
      );
      material.jahrgaenge = matJahrgaenge;

      // Dateien laden
      const { rows: files } = await db.query(
        `SELECT id, original_name, stored_name, mime_type, file_size, created_at
         FROM material_files
         WHERE material_id = $1
         ORDER BY created_at`,
        [material.id]
      );
      material.files = files;

      // Links laden (Migration 142). ADDITIV: link_url oben bleibt der
      // Spiegel des ersten Links fuer ausgelieferte Apps.
      material.links = await ladeLinks(material.id);

      res.json(material);
    } catch (err) {
      console.error('Fehler beim Laden des Materials:', err.message);
      res.status(500).json({ error: 'Fehler beim Laden des Materials' });
    }
  });

  // POST / - Material erstellen
  router.post('/', rbacVerifier, requireAdmin, validateCreateMaterial, async (req, res) => {
    try {
      const { title, description, event_ids, jahrgang_ids, link_url, link_urls, ist_global: global } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Titel ist erforderlich' });
      }

      // Vor dem INSERT abweisen, damit kein Material entsteht, das dann doch
      // nicht global ist. Gilt nur fuer den EXPLIZITEN Alt-Weg -- die
      // Ableitung aus den Jahrgaengen (unten) braucht keine Rolle, weil sie
      // die Sichtbarkeit der Jahrgangs-Zuordnung nur benennt.
      if (global === true && !darfGlobalSetzen(req.user)) {
        return res.status(403).json({ error: GLOBAL_FEHLER });
      }

      // Abgeleitete Sichtbarkeit: Ohne explizites Feld folgt
      // ist_global der Jahrgangs-Zuordnung.
      const istGlobalWert = global !== undefined
        ? global === true
        : (jahrgang_ids || []).length === 0;

      // Links: neue Clients schicken link_urls (Array), alte weiterhin
      // link_url (ein Wert). Beide Wege muenden in dieselbe Liste.
      const linkPruefung = pruefeLinkListe(link_urls);
      if (!linkPruefung.ok) {
        return res.status(400).json({ error: linkPruefung.fehler });
      }
      let linkListe;
      if (linkPruefung.liste !== undefined) {
        linkListe = linkPruefung.liste;
      } else {
        const link = pruefeLink(link_url);
        if (!link.ok) {
          return res.status(400).json({ error: LINK_FEHLER });
        }
        linkListe = link.wert ? [link.wert] : [];
      }

      // Org-Isolation: fremde IDs abweisen (Cross-Org-Referenzen)
      if (!(await allIdsBelongToOrg(db, 'events', event_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Event gehört nicht zu deiner Gemeinde' });
      }
      if (!(await allIdsBelongToOrg(db, 'jahrgaenge', jahrgang_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Jahrgang gehört nicht zu deiner Gemeinde' });
      }

      const { rows: [material] } = await db.query(
        `INSERT INTO materials (title, description, link_url, ist_global, organization_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, title, description, link_url, ist_global, created_at, created_by`,
        [title.trim(), description || null, linkListe[0] || null, istGlobalWert, req.user.organization_id, req.user.id]
      );

      // Alle Links in material_links; link_url oben ist bereits der Spiegel
      // des ersten.
      for (const url of linkListe) {
        await db.query(
          'INSERT INTO material_links (material_id, url) VALUES ($1, $2)',
          [material.id, url]
        );
      }
      // ADDITIV in der Antwort: das vollstaendige Link-Array.
      material.links = await ladeLinks(material.id);

      // Events zuordnen (Many-to-Many)
      const resolvedEventIds = event_ids || [];
      if (resolvedEventIds.length > 0) {
        const eventValues = resolvedEventIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        const eventParams = [material.id, ...resolvedEventIds];
        await db.query(
          `INSERT INTO material_events (material_id, event_id) VALUES ${eventValues}`,
          eventParams
        );
      }

      // Jahrgänge zuordnen (Many-to-Many)
      const resolvedJahrgangIds = jahrgang_ids || [];
      if (resolvedJahrgangIds.length > 0) {
        const jgValues = resolvedJahrgangIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        const jgParams = [material.id, ...resolvedJahrgangIds];
        await db.query(
          `INSERT INTO material_jahrgaenge (material_id, jahrgang_id) VALUES ${jgValues}`,
          jgParams
        );
      }

      res.status(201).json(material);
      // Material-Listen bei Leitung und Teamer:innen aktuell halten — vorher gab
      // es für Material überhaupt kein Live-Update.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'materials', 'refresh');
    } catch (err) {
      console.error('Fehler beim Erstellen des Materials:', err.message);
      res.status(500).json({ error: 'Fehler beim Erstellen des Materials' });
    }
  });

  // PUT /:id - Material bearbeiten
  router.put('/:id', rbacVerifier, requireAdmin, validateUpdateMaterial, async (req, res) => {
    try {
      const { title, description, event_ids, jahrgang_ids, link_url, link_urls, ist_global: global } = req.body;
      const orgId = req.user.organization_id;
      const materialId = req.params.id;

      const linkPruefung = pruefeLinkListe(link_urls);
      if (!linkPruefung.ok) {
        return res.status(400).json({ error: linkPruefung.fehler });
      }
      const link = pruefeLink(link_url);
      if (!link.ok) {
        return res.status(400).json({ error: LINK_FEHLER });
      }

      // Prüfen ob Material existiert und zur Organisation gehört
      const { rows: [existing] } = await db.query(
        'SELECT id, ist_global, created_by FROM materials WHERE id = $1 AND organization_id = $2',
        [materialId, orgId]
      );

      if (!existing) {
        return res.status(404).json({ error: 'Material nicht gefunden' });
      }

      // Ersteller-Regel: erst NACH der Org-Pruefung, damit eine
      // fremde Organisation weiterhin 404 sieht und nicht am 403 ablesen
      // kann, dass es das Material gibt.
      if (!darfMaterialAendern(req.user, existing.created_by)) {
        return res.status(403).json({ error: ERSTELLER_FEHLER });
      }

      // Setzen UND Entziehen sind beim EXPLIZITEN Feld der Leitung
      // vorbehalten (Alt-Formular, Store-Apps). Schickt ein 'admin' den
      // unveraenderten Wert mit (das alte Formular sendet ihn immer mit),
      // aendert sich nichts und die Anfrage geht durch -- sonst koennte er
      // globales Material gar nicht mehr bearbeiten.
      const globalGewuenscht = global === undefined ? existing.ist_global : global === true;
      if (globalGewuenscht !== existing.ist_global && !darfGlobalSetzen(req.user)) {
        return res.status(403).json({ error: GLOBAL_FEHLER });
      }

      // Abgeleitete Sichtbarkeit: Ohne explizites ist_global
      // folgt das Flag der Jahrgangs-Zuordnung, sobald sie mitgeschickt
      // wird. Keine Rollen-Pruefung noetig -- die Ableitung benennt nur die
      // Sichtbarkeit, die die Zuordnung ohnehin ergibt. Wird beides nicht
      // geschickt, bleibt das Flag unveraendert.
      let istGlobalNeu;
      if (global !== undefined) {
        istGlobalNeu = globalGewuenscht;
      } else if (jahrgang_ids !== undefined) {
        istGlobalNeu = jahrgang_ids.length === 0;
      }

      // Org-Isolation: fremde IDs abweisen (Cross-Org-Referenzen)
      if (!(await allIdsBelongToOrg(db, 'events', event_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Event gehört nicht zu deiner Gemeinde' });
      }
      if (!(await allIdsBelongToOrg(db, 'jahrgaenge', jahrgang_ids, req.user.organization_id))) {
        return res.status(400).json({ error: 'Mindestens ein Jahrgang gehört nicht zu deiner Gemeinde' });
      }

      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (title !== undefined) {
        updates.push(`title = $${paramIndex}`);
        params.push(title.trim());
        paramIndex++;
      }
      if (description !== undefined) {
        updates.push(`description = $${paramIndex}`);
        params.push(description);
        paramIndex++;
      }
      if (istGlobalNeu !== undefined) {
        updates.push(`ist_global = $${paramIndex}`);
        params.push(istGlobalNeu);
        paramIndex++;
      }

      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        params.push(materialId);
        await db.query(
          `UPDATE materials SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
          params
        );
      }

      // Links aktualisieren. Zwei Wege:
      //
      //   link_urls (neues Formular) -> ALLE Links ersetzen, Spiegel
      //   link_url auf den ersten setzen (schreibeAlleLinks).
      //
      //   link_url allein (Alt-App-Vertrag) -> NUR den ersten Link
      //   ersetzen bzw. loeschen. Ein alter Client hat weitere Links nie
      //   angezeigt und darf sie deshalb auch nicht stillschweigend
      //   mitloeschen. Leerer String/null loescht den ersten Link; der
      //   Spiegel rueckt auf den naechsten Link nach, damit alte Apps
      //   weiterhin einen Link sehen, solange es welche gibt.
      if (linkPruefung.liste !== undefined) {
        await schreibeAlleLinks(materialId, linkPruefung.liste);
      } else if (link_url !== undefined) {
        const { rows: vorhandene } = await db.query(
          'SELECT id, url FROM material_links WHERE material_id = $1 ORDER BY id',
          [materialId]
        );
        if (link.wert === null) {
          if (vorhandene.length > 0) {
            await db.query('DELETE FROM material_links WHERE id = $1', [vorhandene[0].id]);
          }
          const neuerErster = vorhandene.length > 1 ? vorhandene[1].url : null;
          await db.query(
            'UPDATE materials SET link_url = $1, updated_at = NOW() WHERE id = $2',
            [neuerErster, materialId]
          );
        } else {
          if (vorhandene.length > 0) {
            await db.query('UPDATE material_links SET url = $1 WHERE id = $2', [link.wert, vorhandene[0].id]);
          } else {
            await db.query('INSERT INTO material_links (material_id, url) VALUES ($1, $2)', [materialId, link.wert]);
          }
          await db.query(
            'UPDATE materials SET link_url = $1, updated_at = NOW() WHERE id = $2',
            [link.wert, materialId]
          );
        }
      }

      // Events aktualisieren (DELETE + INSERT)
      const resolvedEventIds = event_ids;
      if (resolvedEventIds !== undefined) {
        await db.query('DELETE FROM material_events WHERE material_id = $1', [materialId]);
        if (resolvedEventIds.length > 0) {
          const eventValues = resolvedEventIds.map((_, i) => `($1, $${i + 2})`).join(', ');
          const eventParams = [materialId, ...resolvedEventIds];
          await db.query(
            `INSERT INTO material_events (material_id, event_id) VALUES ${eventValues}`,
            eventParams
          );
        }
      }

      // Jahrgänge aktualisieren (DELETE + INSERT)
      const resolvedJahrgangIds = jahrgang_ids;
      if (resolvedJahrgangIds !== undefined) {
        await db.query('DELETE FROM material_jahrgaenge WHERE material_id = $1', [materialId]);
        if (resolvedJahrgangIds.length > 0) {
          const jgValues = resolvedJahrgangIds.map((_, i) => `($1, $${i + 2})`).join(', ');
          const jgParams = [materialId, ...resolvedJahrgangIds];
          await db.query(
            `INSERT INTO material_jahrgaenge (material_id, jahrgang_id) VALUES ${jgValues}`,
            jgParams
          );
        }
      }

      res.json({ message: 'Material aktualisiert' });
      // Material-Listen bei Leitung und Teamer:innen aktuell halten — vorher gab
      // es für Material überhaupt kein Live-Update.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'materials', 'refresh');
    } catch (err) {
      console.error('Fehler beim Bearbeiten des Materials:', err.message);
      res.status(500).json({ error: 'Fehler beim Bearbeiten des Materials' });
    }
  });

  // DELETE /:id - Material löschen
  router.delete('/:id', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const materialId = req.params.id;

      // Ersteller-Regel: Loeschen ist die schaerfste Form des
      // Bearbeitens. Erst die Org-Pruefung (404 fuer fremde Organisationen),
      // dann die Ersteller-Pruefung (403).
      const { rows: [existing] } = await db.query(
        'SELECT id, created_by FROM materials WHERE id = $1 AND organization_id = $2',
        [materialId, orgId]
      );

      if (!existing) {
        return res.status(404).json({ error: 'Material nicht gefunden' });
      }

      if (!darfMaterialAendern(req.user, existing.created_by)) {
        return res.status(403).json({ error: ERSTELLER_FEHLER });
      }

      // Dateien vom Dateisystem holen bevor CASCADE löscht
      const { rows: files } = await db.query(
        `SELECT mf.stored_name FROM material_files mf
         JOIN materials m ON mf.material_id = m.id
         WHERE mf.material_id = $1 AND m.organization_id = $2`,
        [materialId, orgId]
      );

      const { rowCount } = await db.query(
        'DELETE FROM materials WHERE id = $1 AND organization_id = $2',
        [materialId, orgId]
      );

      if (rowCount === 0) {
        return res.status(404).json({ error: 'Material nicht gefunden' });
      }

      // Dateien vom Dateisystem löschen
      const materialDir = path.join(__dirname, '..', 'uploads', 'material');
      for (const file of files) {
        try {
          const filePath = path.join(materialDir, file.stored_name);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (fileErr) {
          console.warn(`Konnte Datei ${file.stored_name} nicht löschen:`, fileErr.message);
        }
      }

      res.json({ message: 'Material gelöscht' });
      // Material-Listen bei Leitung und Teamer:innen aktuell halten — vorher gab
      // es für Material überhaupt kein Live-Update.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'materials', 'refresh');
    } catch (err) {
      console.error('Fehler beim Löschen des Materials:', err.message);
      res.status(500).json({ error: 'Fehler beim Löschen des Materials' });
    }
  });

  // ====================================================================
  // DATEI ENDPOINTS
  // ====================================================================

  // POST /:id/files - Dateien zu Material hochladen (AES-256-GCM verschlüsselt)
  router.post('/:id/files', rbacVerifier, requireAdmin, materialUpload.array('files', 10), async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const materialId = req.params.id;

      // Prüfen ob Material existiert und zur Organisation gehört
      const { rows: [material] } = await db.query(
        'SELECT id, created_by FROM materials WHERE id = $1 AND organization_id = $2',
        [materialId, orgId]
      );

      if (!material) {
        return res.status(404).json({ error: 'Material nicht gefunden' });
      }

      // Ersteller-Regel: Eine Datei anzuhaengen IST eine
      // Aenderung am Material -- sonst liesse sich die Regel ueber den
      // Datei-Umweg aushebeln.
      if (!darfMaterialAendern(req.user, material.created_by)) {
        return res.status(403).json({ error: ERSTELLER_FEHLER });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Keine Dateien hochgeladen' });
      }

      // Magic-Bytes-Validierung auf den Kopfbytes der Temporaerdateien (echte
      // Dateitypen erzwingen). diskStorage liefert file.path statt file.buffer;
      // zehn Dateien a 20 MB lagen sonst gleichzeitig im Arbeitsspeicher.
      // Geprueft wird weiterhin ALLES, bevor die ERSTE Datei abgelegt wird.
      const { fileTypeFromBuffer } = await import('file-type');
      const allowedPrefixes = [
        'image/', 'video/', 'audio/', 'application/pdf',
        'application/vnd.openxmlformats', 'application/msword',
        'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
        'application/vnd.oasis.opendocument',
        'application/zip', 'application/x-cfb'
      ];
      for (const file of req.files) {
        if (!file.path) {
          return res.status(400).json({ error: 'Datei konnte nicht gelesen werden' });
        }
        // Text hat keine Magic Bytes: Inhalt pruefen statt dem Header zu
        // vertrauen.
        if (istTextTyp(file.mimetype)) {
          const befund = await pruefeTextDatei(file.path, file.size, req.app.locals.zwischenlager);
          if (befund) {
            return res.status(befund.status).json({ error: `${befund.error} (${file.originalname})` });
          }
          continue;
        }
        const detected = await fileTypeFromBuffer(await leseKopfBytes(file.path));
        if (!detected || !allowedPrefixes.some(p => detected.mime.startsWith(p))) {
          return res.status(415).json({ error: `Dateityp nicht verifizierbar: ${file.originalname}` });
        }
      }

      const crypto = require('crypto');
      const materialDir = path.join(__dirname, '..', 'uploads', 'material');
      await fs.promises.mkdir(materialDir, { recursive: true });

      const insertedFiles = [];
      for (const file of req.files) {
        // Zufaelliger Hex-Dateiname; verschlüsselt schreiben
        const storedName = crypto.randomBytes(32).toString('hex');
        const storedPath = path.join(materialDir, storedName);
        await encryptFileToFile(file.path, storedPath);

        const { rows: [inserted] } = await db.query(
          `INSERT INTO material_files (material_id, original_name, stored_name, mime_type, file_size)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, original_name, mime_type, file_size, created_at`,
          [materialId, file.originalname, storedName, file.mimetype, file.size]
        );
        insertedFiles.push(inserted);
      }

      // updated_at aktualisieren
      await db.query('UPDATE materials SET updated_at = NOW() WHERE id = $1', [materialId]);

      res.status(201).json(insertedFiles);
      // Material-Listen bei Leitung und Teamer:innen aktuell halten — vorher gab
      // es für Material überhaupt kein Live-Update.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'materials', 'refresh');
    } catch (err) {
      console.error('Fehler beim Hochladen der Dateien:', err.message);
      res.status(500).json({ error: 'Fehler beim Hochladen der Dateien' });
    }
  });

  // GET /files/:filename - Datei herunterladen
  router.get('/files/:filename', rbacVerifier, requireTeamer, async (req, res) => {
    try {
      const filename = path.basename(req.params.filename);

      // Path-Traversal-Schutz: Nur Hex-Namen akzeptieren (randomBytes(32) = 64 Hex).
      // Aeltere SHA-256-Namen sind ebenfalls 64 Hex -> selbe Regel.
      if (!/^[a-f0-9]{64}$/.test(filename)) {
        return res.status(400).json({ error: 'Ungültiger Dateiname' });
      }

      // Prüfen ob Datei existiert, zur gleichen Organisation gehört und für
      // diese Teamer:in überhaupt sichtbar ist (Jahrgangs-Schranke).
      const schranke = jahrgangsSchranke(req.user, '$3');
      const { rows: [fileRecord] } = await db.query(
        `SELECT mf.id, mf.original_name, mf.mime_type, mf.file_size
         FROM material_files mf
         JOIN materials m ON mf.material_id = m.id
         WHERE mf.stored_name = $1 AND m.organization_id = $2
           ${schranke ? `AND ${schranke}` : ''}`,
        schranke ? [filename, req.user.organization_id, req.user.id] : [filename, req.user.organization_id]
      );

      if (!fileRecord) {
        return res.status(404).json({ error: 'Datei nicht gefunden' });
      }

      const materialDir = path.join(__dirname, '..', 'uploads', 'material');
      const filePath = path.join(materialDir, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Datei nicht auf dem Server gefunden' });
      }

      // Textdateien immer als text/plain bzw. text/csv mit charset, nicht
      // mit dem beim Hochladen angegebenen Wert.
      const textTyp = istTextTyp(fileRecord.mime_type)
        ? textInhaltsTyp({ mimetype: fileRecord.mime_type })
        : null;
      if (textTyp) {
        res.setHeader('Content-Type', textTyp);
      } else if (fileRecord.mime_type) {
        res.setHeader('Content-Type', fileRecord.mime_type);
      }
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileRecord.original_name)}"`);

      // Stromweise entschluesseln und senden (frueher: ganze Datei in den
      // Arbeitsspeicher).
      try {
        await decryptFileToStream(filePath, res);
      } catch (decErr) {
        console.error('Error decrypting material file:', decErr);
        if (!res.headersSent) {
          return res.status(500).json({ error: 'Datei konnte nicht entschlüsselt werden' });
        }
        res.destroy();
      }
    } catch (err) {
      console.error('Fehler beim Herunterladen der Datei:', err.message);
      res.status(500).json({ error: 'Fehler beim Herunterladen der Datei' });
    }
  });

  // DELETE /files/:fileId - Einzelne Datei löschen
  router.delete('/files/:fileId', rbacVerifier, requireAdmin, async (req, res) => {
    try {
      const orgId = req.user.organization_id;
      const fileId = req.params.fileId;

      // Datei-Info holen und Organisation prüfen
      const { rows: [fileRecord] } = await db.query(
        `SELECT mf.id, mf.stored_name, mf.material_id, m.created_by
         FROM material_files mf
         JOIN materials m ON mf.material_id = m.id
         WHERE mf.id = $1 AND m.organization_id = $2`,
        [fileId, orgId]
      );

      if (!fileRecord) {
        return res.status(404).json({ error: 'Datei nicht gefunden' });
      }

      // Ersteller-Regel: Eine Datei zu loeschen IST eine
      // Aenderung am Material des Erstellers.
      if (!darfMaterialAendern(req.user, fileRecord.created_by)) {
        return res.status(403).json({ error: ERSTELLER_FEHLER });
      }

      // DB-Eintrag löschen
      await db.query('DELETE FROM material_files WHERE id = $1', [fileId]);

      // Datei vom Dateisystem löschen
      const materialDir = path.join(__dirname, '..', 'uploads', 'material');
      const filePath = path.join(materialDir, fileRecord.stored_name);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fileErr) {
        console.warn(`Konnte Datei ${fileRecord.stored_name} nicht löschen:`, fileErr.message);
      }

      // updated_at aktualisieren
      await db.query('UPDATE materials SET updated_at = NOW() WHERE id = $1', [fileRecord.material_id]);

      res.json({ message: 'Datei gelöscht' });
      // Material-Listen bei Leitung und Teamer:innen aktuell halten — vorher gab
      // es für Material überhaupt kein Live-Update.
      liveUpdate.sendToOrgAdmins(req.user.organization_id, 'materials', 'refresh');
    } catch (err) {
      console.error('Fehler beim Löschen der Datei:', err.message);
      res.status(500).json({ error: 'Fehler beim Löschen der Datei' });
    }
  });

  return router;
};
