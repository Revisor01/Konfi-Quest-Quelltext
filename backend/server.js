// --- START OF FILE server.js ---
// Produktions-Wrapper: Startet Server + Socket.IO + SMTP + Cron + Firebase
// Die Express-App wird von createApp.js erstellt (testbare Factory).

const http = require('http');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

// ====================================================================
// SERVER CONFIGURATION
// ====================================================================

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required!');
  process.exit(1);
}

// ====================================================================
// DATABASE INITIALIZATION
// ====================================================================

const db = require('./database');

// ====================================================================
// HTTP SERVER (ohne App — App kommt nach Socket.IO Setup)
// ====================================================================

const server = http.createServer();

// ====================================================================
// SOCKET.IO SETUP
// ====================================================================

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://konfi-quest.de,https://www.konfi-quest.de').split(',');

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Socket.IO-Events REPLIKA-UEBERGREIFEND verteilen:
// Es laufen zwei Backend-Instanzen hinter Traefik. Ohne Adapter emittet jede
// Instanz nur an ihre EIGENEN Sockets — ein io.emit() der Replika, die den
// Request verarbeitet hat, erreichte Clients auf der anderen Replika NIE
// (betraf alle LiveUpdates und Chat-Events). Der postgres-adapter nutzt die
// vorhandene DB als Event-Bus (NOTIFY/LISTEN); Payloads > ~8000 Bytes laufen
// ueber die Tabelle socket_io_attachments (Migration 109).
const { createAdapter: createPgAdapter } = require('@socket.io/postgres-adapter');
const { Pool: PgPool } = require('pg');

// Eigener kleiner Pool fuer den Adapter (dedizierte LISTEN-Connection + Queries),
// getrennt vom App-Pool in database.js, damit die dauerhafte LISTEN-Verbindung
// keinen App-Slot belegt.
const socketAdapterPool = new PgPool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_SOCKET_ADAPTER_POOL_MAX || '2', 10),
});
socketAdapterPool.on('error', (err) => {
  console.error('Socket.IO-Adapter-Pool Fehler:', err.message);
});
io.adapter(createPgAdapter(socketAdapterPool, {
  errorHandler: (err) => console.error('Socket.IO-Postgres-Adapter Fehler:', err.message),
}));

// Engine-Level Events
io.engine.on('connection_error', (err) => {
  console.warn('Socket.io Engine connection_error:', err.code, err.message);
});

// Socket.io JWT Authentication Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    console.warn('Socket.io Auth fehlgeschlagen:', err.message);
    return next(new Error('Invalid token'));
  }
});

// Socket.io Connection Handler
io.on('connection', (socket) => {
  const userRoom = `user_${socket.user.type}_${socket.user.id}`;
  socket.join(userRoom);

  socket.on('joinRoom', async (roomId) => {
    try {
      const { rows } = await db.query(
        'SELECT organization_id FROM chat_rooms WHERE id = $1',
        [roomId]
      );

      if (rows.length === 0) {
        console.warn(`Socket joinRoom: Room ${roomId} nicht gefunden (User ${socket.user.id})`);
        return;
      }

      const roomOrgId = rows[0].organization_id;
      const userOrgId = socket.user.organization_id;

      if (roomOrgId !== userOrgId) {
        console.warn(`Socket joinRoom: Org-Isolation-Verletzung! User ${socket.user.id} (Org ${userOrgId}) versucht Room ${roomId} (Org ${roomOrgId}) beizutreten`);
        return;
      }

      socket.join(`room_${roomId}`);
    } catch (err) {
      console.error('Socket joinRoom Fehler:', err.message);
    }
  });

  socket.on('leaveRoom', (roomId) => {
    socket.leave(`room_${roomId}`);
  });

  socket.on('typing', async (roomId) => {
    try {
      const { rows } = await db.query(
        'SELECT organization_id FROM chat_rooms WHERE id = $1',
        [roomId]
      );
      if (rows.length === 0) return;
      if (rows[0].organization_id !== socket.user.organization_id) return;
      socket.to(`room_${roomId}`).emit('userTyping', {
        roomId,
        userId: socket.user.id,
        userName: socket.user.display_name
      });
    } catch (err) {
      console.error('Socket typing Fehler:', err.message);
    }
  });

  socket.on('stopTyping', async (roomId) => {
    try {
      const { rows } = await db.query(
        'SELECT organization_id FROM chat_rooms WHERE id = $1',
        [roomId]
      );
      if (rows.length === 0) return;
      if (rows[0].organization_id !== socket.user.organization_id) return;
      socket.to(`room_${roomId}`).emit('userStoppedTyping', {
        roomId,
        userId: socket.user.id
      });
    } catch (err) {
      console.error('Socket stopTyping Fehler:', err.message);
    }
  });

  socket.on('disconnect', (reason) => {
    if (reason === 'server namespace disconnect') {
      console.log(`Socket disconnected for user ${socket.user.id}: forced (role change)`);
    }
  });
});

// liveUpdate mit io initialisieren (DI statt globaler Variable)
const liveUpdate = require('./utils/liveUpdate');
liveUpdate.init(io);

// ====================================================================
// SMTP CONFIGURATION
// ====================================================================

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_SECURE !== 'false',
  auth: {
    user: process.env.SMTP_USER || 'noreply@konfi-quest.de',
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
};

const transporter = nodemailer.createTransport(SMTP_CONFIG);

transporter.verify(function(error, success) {
  if (error) {
    console.error('SMTP connection failed:', error);
  }
});

// ====================================================================
// RATE LIMITING
// ====================================================================

const { ipKeyGenerator } = require('express-rate-limit');

const clientIp = (req) => {
  const real = req.headers['x-real-ip'];
  if (real && typeof real === 'string' && real.trim()) return real.trim();
  return req.ip;
};
const userOrIpKey = (req) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
      if (decoded?.id) return `user:${decoded.id}`;
    } catch {
      // ungueltiges/abgelaufenes Token -> IP-Fallback
    }
  }
  return ipKeyGenerator(clientIp(req));
};

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  keyGenerator: userOrIpKey,
  message: { error: 'Zu viele Anfragen. Bitte versuche es spaeter erneut.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)), // echte Client-IP (X-Real-IP), NICHT Proxy-IP
  message: { error: 'Zu viele Login-Versuche. Bitte warte 15 Minuten.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// Registrierung: Beim Onboarding einer Konfi-Gruppe registrieren sich viele
// hintereinander aus DEMSELBEN Gemeinde-WLAN (gleiche IP). 5/Stunde war viel
// zu eng. Erfolgreiche Registrierungen zaehlen nicht mit, damit nur echte
// Missbrauchs-Schleifen (Fehlversuche) gebremst werden.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)), // echte Client-IP (X-Real-IP)
  message: { error: 'Zu viele Registrierungen. Bitte warte eine Stunde.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

const chatMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: userOrIpKey,
  message: { error: 'Zu viele Nachrichten. Bitte warte einen Moment.' },
  standardHeaders: true,
  legacyHeaders: false
});

const eventBookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: userOrIpKey,
  message: { error: 'Zu viele Buchungsanfragen. Bitte versuche es spaeter erneut.' },
  standardHeaders: true,
  legacyHeaders: false
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: userOrIpKey,
  message: { error: 'Zu viele Uploads. Bitte versuche es spaeter erneut.' },
  standardHeaders: true,
  legacyHeaders: false
});

const orgLimiter = rateLimit({
  // Deckt ALLE /api/organizations-Routen ab. GET (Lesen: Liste, Detail, Admins)
  // wird per skip ausgenommen und faellt auf den generalLimiter. Nur Schreib-Ops
  // (POST/PUT/PATCH/DELETE) zaehlen hier, pro User (nicht pro IP).
  windowMs: 15 * 60 * 1000,
  max: 500,
  keyGenerator: userOrIpKey,
  skip: (req) => req.method === 'GET',
  message: { error: 'Zu viele Anfragen an die Organisationsverwaltung. Bitte versuche es spaeter erneut.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ====================================================================
// EXPRESS APP (via createApp Factory)
// ====================================================================

const { createApp } = require('./createApp');

const app = createApp(db, {
  transporter,
  smtpConfig: SMTP_CONFIG,
  io,
  rateLimiters: {
    general: generalLimiter,
    authLimiter,
    registerLimiter,
    chatMessageLimiter,
    eventBookingLimiter,
    uploadLimiter,
    orgLimiter,
  },
});

// HTTP-Requests an Express-App weiterleiten
server.on('request', app);

// ====================================================================
// CHAT SYSTEM INITIALIZATION
// ====================================================================

const { initializeChatRooms } = require('./utils/chatUtils');
setImmediate(() => initializeChatRooms(db));

// ====================================================================
// BACKGROUND SERVICES INITIALIZATION
// ====================================================================

// Hintergrund-Jobs (Cron: Auto-Deletion, Reminder, APM-Snapshots, Token-Cleanup,
// Wrapped) duerfen bei MEHREREN Backend-Replicas (Zero-Downtime-Setup) nur EINMAL
// laufen, sonst gibt es Doppel-Pushes/-Loeschungen/-Snapshots. Nur die Replica mit
// RUN_BACKGROUND_JOBS!=='false' startet sie. Default = an (Single-Replica/lokal
// unveraendert); im 2-Replica-Stack setzt nur backend2 RUN_BACKGROUND_JOBS=false.
const BackgroundService = require('./services/backgroundService');
if (process.env.RUN_BACKGROUND_JOBS !== 'false') {
  BackgroundService.startAllServices(db, { wrappedRouter: app.wrappedRouter });
  console.warn('Hintergrund-Jobs gestartet (diese Replica ist der Cron-Leader).');
} else {
  console.warn('Hintergrund-Jobs DEAKTIVIERT (RUN_BACKGROUND_JOBS=false) — andere Replica ist Cron-Leader.');
}

// ====================================================================
// SERVER STARTUP
// ====================================================================

// Firebase Status ermitteln
let firebaseStatus = 'Nicht konfiguriert';
try {
  const firebase = require('./push/firebase');
  const fbApp = firebase.initializeFirebase();
  if (fbApp) firebaseStatus = 'Verbunden';
} catch (e) {
  // Firebase nicht verfuegbar
}

const uploadsDir = require('path').join(__dirname, 'uploads');
const smtpStatus = SMTP_CONFIG.auth.pass ? 'Konfiguriert' : 'Nicht konfiguriert';

server.listen(PORT, () => {
  console.log('========================================');
  console.log('  KONFI QUEST API - Server gestartet');
  console.log('========================================');
  console.log(`  Port:         ${PORT}`);
  console.log(`  Environment:  ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Database:     PostgreSQL (verbunden)`);
  console.log(`  WebSocket:    Bereit`);
  console.log(`  Uploads:      ${uploadsDir}`);
  console.log('----------------------------------------');
  console.log('  Services:');
  console.log(`  - SMTP:       ${smtpStatus}`);
  console.log(`  - Firebase:   ${firebaseStatus}`);
  console.log('  - Background: Gestartet');
  console.log('========================================');
});

// ====================================================================
// GRACEFUL SHUTDOWN
// ====================================================================

const gracefulShutdown = (signal) => {
  console.warn(`${signal} empfangen - Graceful Shutdown...`);
  server.close(async () => {
    console.warn('HTTP-Server geschlossen.');
    try {
      await db.end();
      console.warn('Datenbankverbindung geschlossen.');
    } catch (err) {
      console.error('Fehler beim Schliessen der Datenbankverbindung:', err.message);
    }
    try {
      await socketAdapterPool.end();
      console.warn('Socket.IO-Adapter-Pool geschlossen.');
    } catch (err) {
      console.error('Fehler beim Schliessen des Adapter-Pools:', err.message);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Shutdown-Timeout erreicht - erzwinge Beendigung');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
