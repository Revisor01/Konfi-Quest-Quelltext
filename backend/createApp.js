// --- START OF FILE createApp.js ---
// Express-App Factory ohne Seiteneffekte (kein listen, Socket.IO, SMTP, Cron, Firebase)
// Tests rufen createApp(testDb) auf und bekommen saubere Express-App für supertest.

const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

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
 * @returns {express.Application} Express-App
 */
function createApp(db, options = {}) {
  const {
    transporter = null,
    smtpConfig = {},
    io = null,
    rateLimiters = {},
    uploadsDir = path.join(__dirname, 'uploads'),
  } = options;

  const app = express();
  app.set('trust proxy', 1); // Traefik Reverse Proxy

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

  // Upload-Verzeichnisse erstellen
  [uploadsDir, requestsDir, chatDir, materialDir, challengesDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Chat Upload Config (verschluesselte Dateinamen)
  // memoryStorage: Chat-Datei landet als Buffer in req.file.buffer und wird im
  // Route-Handler (chat.js) verschlüsselt auf die Platte geschrieben.
  const chatUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowedMimes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
        'application/pdf',
        'video/mp4', 'video/quicktime', 'video/webm',
        'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain', 'text/csv'
      ];

      const isAllowed = allowedMimes.includes(file.mimetype);
      if (isAllowed) {
        cb(null, true);
      } else {
        console.warn(`Datei abgelehnt: ${file.originalname} (${file.mimetype})`);
        cb(null, false);
      }
    }
  });

  // Material Upload Config (20MB Limit)
  // memoryStorage: Datei landet als Buffer in req.file.buffer und wird im
  // Route-Handler (material.js) verschlüsselt auf die Platte geschrieben.
  const materialUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowedMimes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
        'application/pdf',
        'video/mp4', 'video/quicktime', 'video/webm',
        'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.oasis.opendocument.spreadsheet',
        'application/vnd.oasis.opendocument.presentation',
        'text/plain', 'text/csv'
      ];

      const isAllowed = allowedMimes.includes(file.mimetype);
      if (isAllowed) {
        cb(null, true);
      } else {
        console.warn(`Material-Datei abgelehnt: ${file.originalname} (${file.mimetype})`);
        cb(null, false);
      }
    }
  });

  // Request Upload Config (nur Bilder, 5MB)
  // memoryStorage: Foto landet als Buffer in req.file.buffer und wird im
  // Route-Handler (konfi.js /upload-photo) verschlüsselt auf die Platte
  // geschrieben. Der Dateiname wird dort nach erfolgreicher Validierung erzeugt.
  const requestUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    }
  });

  // Challenge Upload Config (50MB Limit — Konfis reichen auch Sprachaufnahmen
  // und kurze Videoclips ein, nicht nur Fotos).
  // memoryStorage: Datei landet als Buffer in req.file.buffer und wird im
  // Route-Handler (challenges.js) nach der Magic-Bytes-Prüfung verschlüsselt
  // auf die Platte geschrieben.
  const challengeUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CHALLENGE_UPLOAD_LIMIT },
    fileFilter: (req, file, cb) => {
      const allowedMimes = [
        'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
        'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/aac'
      ];
      const isAllowed = file.mimetype.startsWith('image/') || allowedMimes.includes(file.mimetype);
      if (isAllowed) {
        cb(null, true);
      } else {
        console.warn(`Challenge-Datei abgelehnt: ${file.originalname} (${file.mimetype})`);
        cb(null, false);
      }
    }
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
    filterByJahrgangAccess,
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
    const body = {
      status: dbOk ? 'OK' : 'DEGRADED',
      version: process.env.npm_package_version || require('./package.json').version,
      commit: process.env.GIT_SHA || 'unknown',
      uptimeSeconds: Math.round(process.uptime()),
      checks: {
        database: dbOk ? 'ok' : 'error',
      },
      responseTimeMs: Date.now() - startedAt,
    };
    res.status(dbOk ? 200 : 503).json(body);
  });

  // Roh-Snapshot NUR dieser Replica (für die Peer-Aggregation; auch direkt nutzbar).
  app.get('/api/metrics/local', rbacVerifier, (req, res) => {
    if (!req.user?.is_super_admin) {
      return res.status(403).json({ error: 'Zugriff verweigert' });
    }
    res.json(apmSnapshot());
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
      return res.json(apmMerge([apmSnapshot()]));
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
    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
    try {
      const { rows } = await db.query(
        `SELECT captured_at, total_requests, total_errors, max_in_flight, worst_p95_ms, worst_route
         FROM apm_snapshots
         WHERE captured_at > NOW() - ($1 || ' days')::interval
         ORDER BY captured_at ASC`,
        [String(days)]
      );
      res.json({ days, snapshots: rows });
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
  app.use('/api/admin/konfis', require('./routes/konfi-management')(db, rbacVerifier, roleHelpers, filterByJahrgangAccess, badgesRouter.checkAndAwardBadges));
  app.use('/api/admin/jahrgaenge', require('./routes/jahrgaenge')(db, rbacVerifier, roleHelpers));
  app.use('/api/admin/categories', require('./routes/categories')(db, rbacVerifier, roleHelpers));
  app.use('/api/admin/users', require('./routes/users')(db, rbacVerifier, roleHelpers, ioOrDummy));

  // Allgemeine Routes
  app.use('/api/users', require('./routes/users')(db, rbacVerifier, roleHelpers, ioOrDummy));
  app.use('/api/roles', require('./routes/roles')(db, rbacVerifier, roleHelpers));

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
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
  });

  // wrappedRouter für BackgroundService in server.js verfuegbar machen
  app.wrappedRouter = wrappedRouter;

  return app;
}

module.exports = { createApp };
