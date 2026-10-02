// --- START OF FILE createApp.js ---
// Express-App Factory ohne Seiteneffekte (kein listen, Socket.IO, SMTP, Cron, Firebase)
// Tests rufen createApp(testDb) auf und bekommen saubere Express-App für supertest.

const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { cronLeaderVorhanden } = require('./utils/cronLeader');
const { dateiFilter } = require('./utils/uploadTypen');

// Upload-Limit für Challenge-Beitraege (Audio/Video sind deutlich größer als
// Chat-Anhänge). Als Konstante, weil der zentrale Multer-Error-Handler weiter
// unten die Fehlermeldung anhand der betroffenen Route differenzieren muss.
const CHALLENGE_UPLOAD_LIMIT = 50 * 1024 * 1024;

/**
 * Erstellt eine Express-App mit allen Routes und Middleware.
 * @param {object} db - Datenbank-Objekt mit query() und getClient()
 * @param {object} options - Optionale Konfiguration
 * @param {object} options.transporter - SMTP-Transporter (Default: Dummy)
 * @param {object} options.smtpConfig - SMTP-Konfiguration (Default: {})
 * @param {object} options.io - Socket.IO-Instanz (Default: Dummy)
 * @param {object} options.rateLimiters - Rate-Limiter-Objekte (Default: {})
 * @param {string} options.uploadsDir - Upload-Verzeichnis (Default: ./uploads)
 * @param {Function} options.holeStoreVersion - Store-Version-Abfrage fuer /api/app-version (Default: utils/storeVersion, Tests injizieren einen Stub)
 * @returns {express.Application} Express-App
 */
function createApp(db, options = {}) {
  const {
    transporter = null,
    smtpConfig = {},
    io = null,
    rateLimiters = {},
    uploadsDir = path.join(__dirname, 'uploads'),
    corsOrigins = null,
    holeStoreVersion = null,
    istCronLeader = null,
  } = options;

  const app = express();
  app.set('trust proxy', 1); // Traefik Reverse Proxy

  // CORS nur, wenn ausdruecklich Ursprünge uebergeben werden.
  //
  // In Produktion liegen Oberflaeche und API hinter DERSELBEN Domain
  // (konfi-quest.de) — dort ist jede Anfrage gleichen Ursprungs und CORS
  // schlicht nicht noetig. Deshalb stand hier nie etwas; nur Socket.IO hatte
  // eine eigene Liste (server.js:42).
  if (corsOrigins && corsOrigins.length > 0) {
    const cors = require('cors');
    app.use(cors({ origin: corsOrigins, credentials: true }));
  }

  // NUR im Test: Jede Antwort schliesst ihre Verbindung.
  //
  // Ohne Keep-Alive kann kein Nachlauf einen fremden Request treffen. Im Test
  // kostet das nichts; Produktion bleibt unberuehrt (Bedingung NODE_ENV).
  if (process.env.NODE_ENV === 'test') {
    app.use((req, res, next) => {
      res.set('Connection', 'close');
      next();
    });
  }

  // ====================================================================
  // SECURITY HEADERS
  // ====================================================================

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
        'frame-ancestors': ["'none'"],
      },
    },
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
    xContentTypeOptions: true,
    xFrameOptions: { action: 'deny' },
    xXssProtection: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  }));


  // ====================================================================
  // RATE LIMITING (nur wenn uebergeben)
  // ====================================================================

  if (rateLimiters.general) {
    app.use(rateLimiters.general);
  }

  // APM: misst Request-Dauer/Fehlerrate pro Route (in-memory) und loggt langsame
  // Requests. Frueh registriert, damit alle Routen erfasst werden.
  const { apmMiddleware, snapshot: apmSnapshot, mergeSnapshots: apmMerge, REPLICA_ID: apmReplicaId } = require('./utils/apm');
  app.use(apmMiddleware);

  app.use(express.json());

  // Express 5: req.body ist bei fehlendem/leerem Body undefined (in Express 4
  // war es {}). Damit die vielen `const { x } = req.body`-Destrukturierungen
  // in den Routen nicht crashen, hier zentral auf {} defaulten.
  app.use((req, _res, next) => {
    if (req.body === undefined) {
      req.body = {};
    }
    next();
  });

  // ====================================================================
  // FILE UPLOADS SETUP
  // ====================================================================

  const requestsDir = path.join(uploadsDir, 'requests');
  const chatDir = path.join(uploadsDir, 'chat');
  const materialDir = path.join(uploadsDir, 'material');
  const challengesDir = path.join(uploadsDir, 'challenges');
  // Zwischenlager fuer angenommene, noch nicht verschluesselte Uploads.
  // Liegt IM Upload-Verzeichnis, damit es dasselbe gemountete Volume nutzt
  // und nicht das Container-Dateisystem fuellt.
  const tmpDir = path.join(uploadsDir, 'tmp');

  // Upload-Verzeichnisse erstellen
  [uploadsDir, requestsDir, chatDir, materialDir, challengesDir, tmpDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Reste aus einem harten Abbruch (OOM-Kill, SIGKILL) beim Start wegraeumen.
  // Beim normalen Beenden raeumt die Middleware unten auf; ein gekillter
  // Prozess kommt dazu nicht mehr, und ohne diesen Lauf wuechse das
  // Zwischenlager ueber Deploys hinweg still an.
  try {
    for (const name of fs.readdirSync(tmpDir)) {
      try { fs.unlinkSync(path.join(tmpDir, name)); } catch { /* parallele Replica war schneller */ }
    }
  } catch { /* Verzeichnis nicht lesbar — kein Grund, den Start zu verhindern */ }

  // Zwischenlager-Speicher fuer ALLE Upload-Routen.
  //
  // Vorher: multer.memoryStorage(). Eine angenommene Datei lag komplett im
  // Heap — bei 50 MB Challenge-Limit und 512 MB Container-Grenze reichten
  // rechnerisch neun gleichzeitige Uploads fuer einen OOM-Kill durch Docker.
  // Der Rate-Limiter bremst die RATE (100 je 15 min), nicht die
  // GLEICHZEITIGKEIT.
  //
  // Jetzt: diskStorage. Die Datei landet unter uploads/tmp/, die Route liest
  // nur die ersten Bytes fuer die Magic-Bytes-Pruefung und verschluesselt
  // danach stromweise (photoCrypto.encryptFileToFile) an ihren Platz. Im Heap
  // liegen nie mehr als 64 KiB je Upload.
  //
  // WICHTIG: Im Route-Handler gibt es deshalb kein req.file.buffer mehr,
  // sondern req.file.path. Das Aufraeumen der Temporaerdatei macht die
  // Middleware weiter unten — auch im Fehlerfall und bei abgebrochenen
  // Uploads.
  // Fuer Routen, die eine Temporaerdatei selbst lesen (utils/textDatei.js):
  // gelesen wird nur, was hier liegt.
  app.locals.zwischenlager = tmpDir;
  const zwischenlager = multer.diskStorage({
    destination: (req, file, cb) => cb(null, tmpDir),
    filename: (req, file, cb) => cb(null, require('crypto').randomBytes(24).toString('hex')),
  });


  const DATEINAME_ZEICHENSATZ = 'utf8';

  // Chat Upload Config (verschluesselte Dateinamen)
  const chatUpload = multer({
    storage: zwischenlager,
    defParamCharset: DATEINAME_ZEICHENSATZ,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: dateiFilter('chat'),
  });

  // Material Upload Config (20MB Limit)
  const materialUpload = multer({
    storage: zwischenlager,
    defParamCharset: DATEINAME_ZEICHENSATZ,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: dateiFilter('material'),
  });

  // Request Upload Config (nur Bilder, 5MB)
  const requestUpload = multer({
    storage: zwischenlager,
    defParamCharset: DATEINAME_ZEICHENSATZ,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: dateiFilter('antrag'),
  });

  // Challenge Upload Config (50MB Limit — Konfis reichen auch Sprachaufnahmen
  // und kurze Videoclips ein, nicht nur Fotos).
  const challengeUpload = multer({
    storage: zwischenlager,
    defParamCharset: DATEINAME_ZEICHENSATZ,
    limits: { fileSize: CHALLENGE_UPLOAD_LIMIT },
    fileFilter: dateiFilter('challenge'),
  });

  // Zwischenlager aufraeumen — ausnahmslos.
  //
  // Ein diskStorage ohne Aufraeumen tauscht ein Speicherleck gegen ein
  // Plattenleck. Diese Middleware haengt sich an 'close' des Response-Objekts:
  // das feuert bei Erfolg, bei jedem Fehler UND wenn der Client die Verbindung
  // abbricht (abgebrochener Upload) — anders als 'finish', das nur bei
  // vollstaendig gesendeter Antwort feuert.
  //
  // Verschoben wird nie: die Routen verschluesseln die Datei an ihren Platz und
  // lassen das Original hier liegen. Ein Loeschen ist damit immer richtig, und
  // ein ENOENT (Route hat schon selbst aufgeraeumt) ist kein Fehler.
  app.use((req, res, next) => {
    res.on('close', () => {
      const dateien = [];
      if (req.file) dateien.push(req.file);
      if (Array.isArray(req.files)) dateien.push(...req.files);
      else if (req.files && typeof req.files === 'object') {
        for (const liste of Object.values(req.files)) {
          if (Array.isArray(liste)) dateien.push(...liste);
        }
      }
      for (const datei of dateien) {
        if (!datei || !datei.path) continue;
        fs.unlink(datei.path, (err) => {
          if (err && err.code !== 'ENOENT') {
            console.error('Zwischenlager-Datei nicht geloescht:', datei.path, err.message);
          }
        });
      }
    });
    next();
  });

  // ====================================================================
  // AUTHENTICATION MIDDLEWARE
  // ====================================================================

  const JWT_SECRET = process.env.JWT_SECRET;

  const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };

  // ====================================================================
  // RBAC MIDDLEWARE SETUP
  // ====================================================================

  const {
    verifyTokenRBAC,
    requireSuperAdmin,
    requireOrgAdmin,
    requireAdmin,
    requireTeamer
  } = require('./middleware/rbac');

  const rbacVerifier = verifyTokenRBAC(db);
  const roleHelpers = { requireSuperAdmin, requireOrgAdmin, requireAdmin, requireTeamer };

  // ====================================================================
  // DUMMY-OBJEKTE FUER TESTS
  // ====================================================================

  const ioOrDummy = io || {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    in: () => ({ emit: () => {} }),
  };

  const transporterOrDummy = transporter || { sendMail: async () => ({}) };

  // ====================================================================
  // ROUTE IMPORTS + SETUP
  // ====================================================================

  const badgesRouter = require('./routes/badges')(db, rbacVerifier, roleHelpers);
  const activitiesRouter = require('./routes/activities')(db, rbacVerifier, roleHelpers, badgesRouter.checkAndAwardBadges, ioOrDummy);

  // ====================================================================
  // ROUTE MOUNTING
  // ====================================================================

  // Health-Endpoint — BEWUSST minimal (Liveness für Docker-Healthcheck +
  // Traefik). NICHT mit DB-Checks aufblaehen: ein haengender DB-Check wuerde
  // sonst den gesunden Container vom Healthcheck killen lassen.
  app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Konfi Points API is running' });
  });

  // App-Version-Endpunkt — BEWUSST ohne Auth (wie /health): meldet den Apps
  // die aktuell im Store veroeffentlichte Version fuer den Update-Hinweis.
  // Quelle und Begruendung: utils/storeVersion.js (iTunes-Lookup, gecacht).
  app.use('/api/app-version', require('./routes/appVersion')(
    holeStoreVersion ? { holeStoreVersion } : {}
  ));

  // Status-Endpoint — Detail-Readiness für Status-Page / Uptime Kuma.
  // Getrennt von /health, weil er echte Abhaengigkeiten prüft (DB) und damit
  // langsamer/haengbar ist. Gibt 200 bei gesunder DB, sonst 503.
  app.get('/api/status', async (req, res) => {
    const startedAt = Date.now();
    let dbOk = false;
    try {
      await db.query('SELECT 1');
      dbOk = true;
    } catch (e) {
      dbOk = false;
    }
    // Migrationsstand: Eine beim Start
    // uebersprungene Migration stand bisher nur im Container-Log, waehrend
    // hier "database: ok" stand -- und genau die Routen, die die neue Spalte
    // brauchen, liefen auf 500. Jetzt additiv: checks.migrations ('ok' |
    // 'fehler' | 'laeuft') und die Namen der fehlgeschlagenen Dateien. Der
    // Status bleibt 200: Die Datenbank ist da, der Deploy-Verify prueft das
    // Feld getrennt. Fehlt db.migrationsstand (Test-Pool, eigenes db-Objekt),
    // fehlen die Felder.
    const migrationen = typeof db.migrationsstand === 'function' ? db.migrationsstand() : undefined;
    // Cron-Leader, additiv: `cron_leader`
    // sagt, ob DIESE Replica die Hintergrund-Jobs faehrt (nur, wenn server.js
    // die Funktion durchreicht); `checks.cron_leader` sagt, ob IRGENDEINE
    // sie faehrt -- aus pg_locks abgelesen, deshalb von jeder Replica aus
    // gleich beantwortet und damit fuer eine externe Ueberwachung brauchbar
    // (Traefik verteilt /api/status zufaellig). 'fehlt' heisst: niemand
    // haelt den Lock -- Erinnerungen, Auto-Loeschung und Co. stehen.
    let leaderVorhanden;
    if (dbOk) {
      try {
        leaderVorhanden = (await cronLeaderVorhanden(db)) ? 'ok' : 'fehlt';
      } catch (e) {
        leaderVorhanden = 'unbekannt';
      }
    }
    const body = {
      status: dbOk ? 'OK' : 'DEGRADED',
      version: process.env.npm_package_version || require('./package.json').version,
      commit: process.env.GIT_SHA || 'unknown',
      uptimeSeconds: Math.round(process.uptime()),
      ...(typeof istCronLeader === 'function' ? { cron_leader: istCronLeader() === true } : {}),
      checks: {
        database: dbOk ? 'ok' : 'error',
        ...(migrationen !== undefined ? {
          migrations: migrationen === null ? 'laeuft' : (migrationen.fehlgeschlagen.length === 0 ? 'ok' : 'fehler'),
        } : {}),
        ...(leaderVorhanden !== undefined ? { cron_leader: leaderVorhanden } : {}),
      },
      ...(migrationen ? {
        migrationen: {
          gesamt: migrationen.gesamt,
          neu: migrationen.neu,
          fehlgeschlagen: migrationen.fehlgeschlagen.map(f => f.file),
        },
      } : {}),
      responseTimeMs: Date.now() - startedAt,
    };
    res.status(dbOk ? 200 : 503).json(body);
  });

  // Zustand des Datenbank-Pools als ZUSATZFELD im Metrik-Schnappschuss.
  //
  // Warum hier und nicht in /api/health: Der Gesundheitspfad ist oeffentlich
  // erreichbar und Traefik prueft ihn alle 5 Sekunden. Pool-Innereien gehoeren
  // nicht nach draussen, und der Aufruf darf nicht teurer werden.
  //
  // wartend > 0 ist die Zahl, auf die es ankommt: Anfragen stehen an, weil
  // alle Pool-Plaetze belegt sind. Ein Konfi-Dashboard belegt allein zehn
  // (neun parallele Abfragen plus die aeussere Verbindung).
  const schnappschussMitPool = () => {
    const snap = apmSnapshot();
    // db ist normalerweise das Singleton aus database.js; wer createApp mit
    // einem eigenen Objekt aufruft, bekommt das Feld schlicht nicht.
    const pool = typeof db.poolZustand === 'function' ? db.poolZustand() : null;
    // NUR HINZUFUEGEN, nichts umbenennen oder weglassen: aeltere
    // Oberflaechen-Fassungen lesen dieselbe Antwort weiter.
    return pool ? { ...snap, dbPool: pool } : snap;
  };

  // Roh-Snapshot NUR dieser Replica (für die Peer-Aggregation; auch direkt nutzbar).
  app.get('/api/metrics/local', rbacVerifier, (req, res) => {
    if (!req.user?.is_super_admin) {
      return res.status(403).json({ error: 'Zugriff verweigert' });
    }
    res.json(schnappschussMitPool());
  });

  // Metrics-Endpoint — APM-Aggregate (langsamste/meistgenutzte Routen, parallele
  // Requests, Live-Verlauf, letzte Fehler). Nur super_admin, da es interne
  // Performance-Daten preisgibt.
  //
  // Mehrere Replicas: jede Replica haelt nur ihre eigenen In-Memory-Daten. Ist
  // METRICS_PEERS gesetzt (z.B. "http://backend:5000,http://backend2:5000"), fragt
  // dieser Endpoint ALLE Peers (/api/metrics/local) ab und mergt sie zu einem
  // Gesamtbild inkl. Lastverteilung pro Replica. Ohne METRICS_PEERS -> nur lokal.
  app.get('/api/metrics', rbacVerifier, async (req, res) => {
    if (!req.user?.is_super_admin) {
      return res.status(403).json({ error: 'Zugriff verweigert' });
    }
    const peers = (process.env.METRICS_PEERS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (peers.length === 0) {
      // Single-Replica: lokaler Snapshot, einheitliches Format (mit replicas-Feld).
      return res.json(apmMerge([schnappschussMitPool()]));
    }
    const auth = req.headers.authorization || '';
    const fetchPeer = async (base) => {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 4000);
        const r = await fetch(`${base}/api/metrics/local`, {
          headers: { Authorization: auth },
          signal: ctrl.signal,
        });
        clearTimeout(to);
        if (!r.ok) return null;
        return await r.json();
      } catch (e) {
        return null;
      }
    };
    const snaps = await Promise.all(peers.map(fetchPeer));
    const merged = apmMerge(snaps.filter(Boolean));
    if (!merged) {
      // Alle Peers nicht erreichbar -> wenigstens lokale Sicht liefern.
      return res.json(apmMerge([apmSnapshot()]));
    }
    res.json(merged);
  });

  // Persistente APM-Historie (über Deploys hinweg). Liefert die gespeicherten
  // Snapshots der letzten N Tage; das Dashboard bildet daraus Deltas pro Intervall.
  app.get('/api/metrics/history', rbacVerifier, async (req, res) => {
    if (!req.user?.is_super_admin) {
      return res.status(403).json({ error: 'Zugriff verweigert' });
    }
    // Bis zu zwei Jahre abrufbar, so weit die Aufbewahrung reicht
    // (backgroundService räumt Älteres weg). Die Vorgabe bleibt eine Woche:
    // Wer nichts angibt, will den aktuellen Verlauf, nicht die Historie.
    // Der Index auf captured_at DESC trägt auch den grossen Bereich.
    const days = Math.min(730, Math.max(1, parseInt(req.query.days, 10) || 7));
    // Verdichtung ab 31 Tagen:
    // days=730 lieferte 210.000 Rohzeilen und 35 MB fuer ein Mobil-Dashboard.
    // Bis 30 Tage bleibt es roh (alle fuenf Minuten, das Dashboard fragt 14),
    // 31 bis 180 Tage ein Punkt je Stunde, darueber ein Punkt je Tag -- der
    // Zwei-Jahres-Verlauf sind damit rund 730 Zeilen. Je Fenster gilt der
    // LETZTE Schnappschuss fuer die kumulierten Zaehler (total_requests,
    // total_errors: das Dashboard bildet Deltas aufeinanderfolgender Punkte,
    // die bleiben so richtig) und das MAXIMUM fuer max_in_flight und
    // worst_p95_ms samt der Route dieser Spitze. Antwortform additiv:
    // snapshots bleibt ein Array mit denselben Feldern, neu ist aufloesung.
    const aufloesung = days <= 30 ? '5min' : (days <= 180 ? 'stunde' : 'tag');
    try {
      let rows;
      if (aufloesung === '5min') {
        ({ rows } = await db.query(
          `SELECT captured_at, total_requests, total_errors, max_in_flight, worst_p95_ms, worst_route
           FROM apm_snapshots
           WHERE captured_at > NOW() - ($1 || ' days')::interval
           ORDER BY captured_at ASC`,
          [String(days)]
        ));
      } else {
        ({ rows } = await db.query(
          `WITH s AS (
             SELECT date_trunc($2, captured_at) AS fenster, captured_at,
                    total_requests, total_errors, max_in_flight, worst_p95_ms, worst_route
               FROM apm_snapshots
              WHERE captured_at > NOW() - ($1 || ' days')::interval
           ),
           letzte AS (
             SELECT DISTINCT ON (fenster) fenster, captured_at, total_requests, total_errors
               FROM s ORDER BY fenster, captured_at DESC
           ),
           spitze AS (
             SELECT DISTINCT ON (fenster) fenster, worst_p95_ms, worst_route
               FROM s ORDER BY fenster, worst_p95_ms DESC NULLS LAST, captured_at DESC
           ),
           hoch AS (
             SELECT fenster, MAX(max_in_flight) AS max_in_flight FROM s GROUP BY fenster
           )
           SELECT l.captured_at, l.total_requests, l.total_errors,
                  h.max_in_flight, p.worst_p95_ms, p.worst_route
             FROM letzte l
             JOIN spitze p USING (fenster)
             JOIN hoch h USING (fenster)
            ORDER BY l.captured_at ASC`,
          [String(days), aufloesung === 'stunde' ? 'hour' : 'day']
        ));
      }
      res.json({ days, aufloesung, snapshots: rows });
    } catch (err) {
      console.error('Database error in GET /api/metrics/history:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // Auth Routes
  // Anmeldung für die API-Doku. Bewusst ohne rbacVerifier: Die Doku hängt nicht
  // an einem Konto, sondern an einem gemeinsamen Passwort (DOCS_PASSWORD).
  // Streng limitiert: ein einzelnes Passwort ohne Benutzernamen wäre sonst
  // einfach durchprobierbar.
  if (rateLimiters.docsLoginLimiter) {
    app.post('/api/docs-auth/anmelden', rateLimiters.docsLoginLimiter);
  }
  app.use('/api/docs-auth', require('./routes/docsAuth')());

  app.use('/api/auth', require('./routes/auth')(db, verifyToken, transporterOrDummy, smtpConfig, {
    authLimiter: rateLimiters.authLimiter,
    registerLimiter: rateLimiters.registerLimiter,
  }, rbacVerifier));

  // Konfi Routes
  app.use('/api/konfi', require('./routes/konfi')(db, { verifyTokenRBAC: rbacVerifier }, requestUpload));

  // Chat Routes (mit optionalem Rate-Limiter)
  if (rateLimiters.chatMessageLimiter) {
    app.post('/api/chat/rooms/:roomId/messages', rateLimiters.chatMessageLimiter, rateLimiters.uploadLimiter);
  }
  // Team-Chat leeren loescht alle Nachrichten samt Dateien -- eigener,
  // enger Limiter statt des weiten generalLimiter.
  if (rateLimiters.chatClearLimiter) {
    app.delete('/api/chat/rooms/:roomId/messages', rateLimiters.chatClearLimiter);
  }
  app.use('/api/chat', require('./routes/chat')(db, { verifyTokenRBAC: rbacVerifier }, uploadsDir, chatUpload, ioOrDummy));

  // Notifications
  app.use('/api/notifications', require('./routes/notifications')(db, rbacVerifier));

  // Events (mit optionalem Rate-Limiter)
  if (rateLimiters.eventBookingLimiter) {
    app.post('/api/events/:id/book', rateLimiters.eventBookingLimiter);
  }
  app.use('/api/events', require('./routes/events')(db, rbacVerifier, roleHelpers, badgesRouter.checkAndAwardBadges));

  // Konfi Foto-Upload (mit optionalem Rate-Limiter)
  if (rateLimiters.uploadLimiter) {
    app.post('/api/konfi/upload-photo', rateLimiters.uploadLimiter);
  }

  if (rateLimiters.uploadLimiter) {
    app.post('/api/challenges/konfi/:id/submissions', rateLimiters.uploadLimiter);
  }

  // Settings
  app.use('/api/settings', require('./routes/settings')(db, rbacVerifier, roleHelpers));

  // Admin Routes
  app.use('/api/admin/activities', activitiesRouter);
  app.use('/api/admin/badges', badgesRouter);
  // Nur im Test: Die Sperre der Abzeichen-Nachpruefung zuruecksetzen. Die
  // Test-App wird pro Datei einmal erzeugt, der Merker lebt also ueber alle
  // Tests der Datei hinweg (siehe routes/badges.js).
  if (process.env.NODE_ENV === 'test' && badgesRouter.sperreZuruecksetzen) {
    app.locals.badgeSperreZuruecksetzen = badgesRouter.sperreZuruecksetzen;
  }
  app.use('/api/admin/konfis', require('./routes/konfi-management')(db, rbacVerifier, roleHelpers, badgesRouter.checkAndAwardBadges));
  app.use('/api/admin/jahrgaenge', require('./routes/jahrgaenge')(db, rbacVerifier, roleHelpers));
  app.use('/api/admin/categories', require('./routes/categories')(db, rbacVerifier, roleHelpers));
  app.use('/api/admin/users', require('./routes/users')(db, rbacVerifier, roleHelpers, ioOrDummy));

  // Allgemeine Routes
  app.use('/api/users', require('./routes/users')(db, rbacVerifier, roleHelpers, ioOrDummy));
  app.use('/api/roles', require('./routes/roles')(db, rbacVerifier, roleHelpers));
  app.use('/api/einladungen', require('./routes/einladungen')(db, rbacVerifier, roleHelpers));

  // Organizations (mit optionalem Rate-Limiter)
  if (rateLimiters.orgLimiter) {
    app.use('/api/organizations', rateLimiters.orgLimiter, require('./routes/organizations')(db, rbacVerifier, roleHelpers));
  } else {
    app.use('/api/organizations', require('./routes/organizations')(db, rbacVerifier, roleHelpers));
  }

  app.use('/api/levels', require('./routes/levels')(db, rbacVerifier, roleHelpers));
  app.use('/api/teamer', require('./routes/teamer')(db, rbacVerifier, roleHelpers));

  const wrappedRouter = require('./routes/wrapped')(db, rbacVerifier, roleHelpers);
  app.use('/api/wrapped', wrappedRouter);
  app.use('/api/material', require('./routes/material')(db, rbacVerifier, roleHelpers, materialUpload));
  app.use('/api/challenges', require('./routes/challenges')(db, rbacVerifier, roleHelpers, uploadsDir, challengeUpload));

  // ====================================================================
  // ERROR HANDLING
  // ====================================================================

  app.use((err, req, res, next) => {
    // Multer-Limit (zu grosse Datei) als klares 413 statt generischem 500 —
    // das Frontend zeigt err.response.data.error direkt dem User an.
    // Das Limit ist pro Upload-Config verschieden, deshalb wird die Meldung
    // anhand der betroffenen Route differenziert (sonst steht bei einem
    // 40-MB-Video faelschlich "max. 5 MB" und der Konfi versteht nicht, warum
    // die kleinere Datei ebenfalls scheitert).
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      if (req.path.startsWith('/api/challenges') || req.originalUrl.startsWith('/api/challenges')) {
        return res.status(413).json({ error: 'Datei ist zu groß (max. 50 MB).' });
      }
      if (req.path.startsWith('/api/material') || req.originalUrl.startsWith('/api/material')) {
        return res.status(413).json({ error: 'Datei ist zu groß (max. 20 MB).' });
      }
      return res.status(413).json({ error: 'Datei ist zu groß (max. 5 MB).' });
    }

    if (err && err.code === 'DATEITYP_ABGELEHNT') {
      return res.status(415).json({ error: err.message });
    }

    // Fehler beim Lesen des Anfrage-Koerpers sind Fehler der ANFRAGE, nicht
    // des Servers. Bis dahin endeten
    // ungueltiges JSON und ein Koerper ueber dem Limit (express.json, 100 kB)
    // als 500 "Something went wrong!" -- mit vollem Stack im Log je Anfrage
    // und als Serverfehler in den Betriebszahlen. Damit liess sich das Log
    // fluten. Jetzt: der Status, den der Body-Parser selbst vergibt (400,
    // 413, 415), eine deutsche Meldung und keine Log-Zeile.
    const clientStatus = anfrageFehlerStatus(err);
    if (clientStatus) {
      return res.status(clientStatus).json({ error: ANFRAGE_FEHLER_TEXTE[err.type] });
    }

    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
  });

  // wrappedRouter für BackgroundService in server.js verfuegbar machen
  app.wrappedRouter = wrappedRouter;

  return app;
}

// Fehler des Body-Parsers (body-parser 2 / raw-body, ueber express.json):
// Sie tragen err.type und einen 4xx-Status. 'stream.encoding.set' und
// 'stream.not.readable' sind 500er und bleiben es -- das sind Fehler im
// Server-Aufbau, nicht in der Anfrage.
const ANFRAGE_FEHLER_TEXTE = {
  'entity.parse.failed': 'Die Anfrage enthält kein gültiges JSON.',
  'entity.too.large': 'Die Anfrage ist zu groß.',
  'parameters.too.many': 'Die Anfrage ist zu groß.',
  'encoding.unsupported': 'Die Kodierung der Anfrage wird nicht unterstützt.',
  'charset.unsupported': 'Der Zeichensatz der Anfrage wird nicht unterstützt.',
  'request.aborted': 'Die Anfrage wurde abgebrochen.',
  'request.size.invalid': 'Die Anfrage ist unvollständig.',
};

function anfrageFehlerStatus(err) {
  if (!err || typeof err.type !== 'string' || !Object.hasOwn(ANFRAGE_FEHLER_TEXTE, err.type)) return null;
  const status = Number(err.status || err.statusCode);
  return status >= 400 && status < 500 ? status : null;
}

module.exports = { createApp };
