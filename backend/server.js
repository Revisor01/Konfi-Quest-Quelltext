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
const { socketRaumEreignisse } = require('./utils/chatRoomAccess');
const { socketAnmeldung } = require('./utils/socketAnmeldung');
const { Sammelzeile, sammelzeilenAusgeben } = require('./utils/sammelzeile');

// Gemeinsamer Zaehler-Speicher fuer die Rate-Limiter:
// Ohne `store` zaehlte express-rate-limit je Prozess
// im Speicher, und hinter Traefik mit zwei Replicas galt jedes Limit doppelt
// (40 statt 20 Doku-Passwort-Versuche, 600 statt 300 Login-Fehlversuche);
// 429 kam scheinbar zufaellig. Der Store zaehlt in der vorhandenen Postgres
// (Tabelle rate_limit_zaehler, Migration 167) und faellt bei einem
// Datenbankausfall auf den Speicher je Prozess zurueck. Jeder Limiter
// bekommt seine EIGENE Instanz mit eigenem Praefix.
//
// Bewusst NICHT geteilt: der allgemeine Flutschutz (generalLimiter, 2000 je
// Viertelstunde). Er liegt vor JEDER Anfrage -- auch vor den
// Gesundheitspruefungen von Traefik und Docker -- und ein Datenbankschreiben
// je API-Aufruf waere fuer eine Bremse, die kein Passwort schuetzt, der
// falsche Preis. Er zaehlt weiter je Replica; effektiv also das Doppelte.
const { PostgresRateLimitStore } = require('./utils/rateLimitStore');
const geteilterZaehler = (name) => new PostgresRateLimitStore(db, { prefix: name });

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
// über die Tabelle socket_io_attachments (Migration 109).
const { createAdapter: createPgAdapter } = require('@socket.io/postgres-adapter');
const { Pool: PgPool } = require('pg');
const { mitVerbindungsschutz } = require('./utils/socketAdapterVerbindung');

// Eigener kleiner Pool für den Adapter (dedizierte LISTEN-Connection + Queries),
// getrennt vom App-Pool in database.js, damit die dauerhafte LISTEN-Verbindung
// keinen App-Slot belegt.
const socketAdapterPool = new PgPool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_SOCKET_ADAPTER_POOL_MAX || '2', 10),
  // Wie der App-Pool (database.js): Nach einem Datenbank-Ausfall versucht der
  // Adapter alle 1-3 s eine Neuverbindung; ohne Grenze hinge ein einzelner
  // Versuch gegen einen nicht erreichbaren Host minutenlang im TCP-Timeout.
  connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '5000', 10),
});
// Nur fuer LEERLAUFENDE Pool-Verbindungen. Die dauerhaft ausgecheckte
// LISTEN-Verbindung des Adapters hoert hier NICHT mit -- dafuer die Huelle.
socketAdapterPool.on('error', (err) => {
  console.error('Socket.IO-Adapter-Pool Fehler:', err.message);
});
// Huelle: Der Adapter bindet an seinen
// LISTEN-Client kein 'error'. Riss die Datenbankverbindung ab (Neustart,
// OOM-Kill, Failover), warf Node uncaughtException, und gracefulShutdown unten
// beendete JEDE Replica im selben Moment -- Totalausfall bis Docker neu
// startete. Die Huelle loggt den Abbruch, laesst den Adapter neu verbinden und
// gibt den toten Client an den Pool zurueck (utils/socketAdapterVerbindung.js).
const adapterVerbindung = mitVerbindungsschutz(socketAdapterPool);
io.adapter(createPgAdapter(adapterVerbindung, {
  errorHandler: (err) => console.error('Socket.IO-Postgres-Adapter Fehler:', err.message),
}));

// Engine-Level Events
const engineFehler = new Sammelzeile('Socket.io Engine connection_error');
io.engine.on('connection_error', (err) => {
  engineFehler.zaehle(`${err.code} ${err.message}`);
});

// Socket.io JWT Authentication Middleware -- Pruefung gegen die Datenbank,
// aktive Gemeinde und Anzeigename; steht in utils/socketAnmeldung.js, damit
// Tests dieselbe Anmeldung einhaengen koennen.
io.use(socketAnmeldung(db, JWT_SECRET));

// Socket.io Connection Handler
io.on('connection', (socket) => {
  const userRoom = `user_${socket.user.type}_${socket.user.id}`;
  socket.join(userRoom);

  // joinRoom, leaveRoom, typing, stopTyping: dieselbe Raum-Regel wie die
  // REST-Routen (utils/chatRoomAccess.js).
  socketRaumEreignisse(socket, db);

  socket.on('disconnect', (reason) => {
    if (reason === 'server namespace disconnect') {
      console.log(`Socket disconnected for user ${socket.user.id}: forced (role change)`);
    }
  });
});

// liveUpdate mit io initialisieren (DI statt globaler Variable)
const liveUpdate = require('./utils/liveUpdate');
liveUpdate.init(io, db);

// ====================================================================
// SMTP CONFIGURATION
// ====================================================================

const { smtpKonfiguration } = require('./utils/smtpKonfiguration');

const SMTP_CONFIG = smtpKonfiguration();
const smtpKonfiguriert = Boolean(SMTP_CONFIG.host && SMTP_CONFIG.auth.user && SMTP_CONFIG.auth.pass);

const transporter = nodemailer.createTransport(SMTP_CONFIG);

// Nur pruefen, wenn es etwas zu pruefen gibt: Ohne Host liefe der Versuch
// gegen localhost und meldete einen irrefuehrenden Verbindungsfehler statt
// der Warnung von oben.
if (smtpKonfiguriert) {
  transporter.verify(function(error, success) {
    if (error) {
      console.error('SMTP connection failed:', error);
    }
  });
}

// ====================================================================
// RATE LIMITING
// ====================================================================

const { ipKeyGenerator } = require('express-rate-limit');

const { clientIp } = require('./utils/clientIp');
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
  message: { error: 'Zu viele Anfragen. Bitte versuche es später erneut.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  store: geteilterZaehler('auth'),
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
// zu eng. Erfolgreiche Registrierungen zählen nicht mit, damit nur echte
// Missbrauchs-Schleifen (Fehlversuche) gebremst werden.
const registerLimiter = rateLimit({
  store: geteilterZaehler('register'),
  windowMs: 60 * 60 * 1000,
  max: 200,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)), // echte Client-IP (X-Real-IP)
  message: { error: 'Zu viele Registrierungen. Bitte warte eine Stunde.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// Doku-Anmeldung (/api/docs-auth/anmelden): EIN gemeinsames Passwort ohne
// Benutzernamen — der globale Limiter (2000/15min) ist als einzige Bremse
// viel zu weit, damit liesse sich das Passwort schlicht durchprobieren
// Erfolgreiche Anmeldungen zählen nicht,
// 20 Fehlversuche pro Viertelstunde reichen für Vertipper locker.
const docsLoginLimiter = rateLimit({
  store: geteilterZaehler('docs'),
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)), // echte Client-IP (X-Real-IP)
  message: { error: 'Zu viele Anmeldeversuche. Bitte warte 15 Minuten.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

const chatMessageLimiter = rateLimit({
  store: geteilterZaehler('chat'),
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: userOrIpKey,
  message: { error: 'Zu viele Nachrichten. Bitte warte einen Moment.' },
  standardHeaders: true,
  legacyHeaders: false
});

const eventBookingLimiter = rateLimit({
  store: geteilterZaehler('buchung'),
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: userOrIpKey,
  message: { error: 'Zu viele Buchungsanfragen. Bitte versuche es später erneut.' },
  standardHeaders: true,
  legacyHeaders: false
});

const uploadLimiter = rateLimit({
  store: geteilterZaehler('upload'),
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: userOrIpKey,
  message: { error: 'Zu viele Uploads. Bitte versuche es später erneut.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Team-Chat leeren: entfernt ALLE Nachrichten eines Raums samt Dateianhaengen
// (Schleife ueber unlink). Der generalLimiter mit 2000/15min ist fuer eine so
// teure Operation viel zu weit gefasst; CodeQL hat die Route deshalb als
// "Missing rate limiting" gemeldet. Zehn Leerungen pro Viertel-
// stunde reichen fuer jeden echten Bedarf der Leitung.
const chatClearLimiter = rateLimit({
  store: geteilterZaehler('chat-leeren'),
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: userOrIpKey,
  message: { error: 'Zu viele Leerungen des Team-Chats. Bitte versuche es später erneut.' },
  standardHeaders: true,
  legacyHeaders: false
});

const orgLimiter = rateLimit({
  store: geteilterZaehler('org'),
  // Deckt ALLE /api/organizations-Routen ab. GET (Lesen: Liste, Detail, Admins)
  // wird per skip ausgenommen und fällt auf den generalLimiter. Nur Schreib-Ops
  // (POST/PUT/PATCH/DELETE) zählen hier, pro User (nicht pro IP).
  windowMs: 15 * 60 * 1000,
  max: 500,
  keyGenerator: userOrIpKey,
  skip: (req) => req.method === 'GET',
  message: { error: 'Zu viele Anfragen an die Gemeinde-Verwaltung. Bitte versuche es später erneut.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ====================================================================
// EXPRESS APP (via createApp Factory)
// ====================================================================

const { createApp } = require('./createApp');

// Cron-Leader-Wahl (siehe unten); die Referenz steht vor createApp, damit
// /api/status den Zustand DIESER Replica melden kann.
let cronLeader = null;

const app = createApp(db, {
  istCronLeader: () => (cronLeader ? cronLeader.istLeader() : false),
  // Dieselbe Liste wie Socket.IO oben. Wirkt nur, wenn CORS_ORIGINS gesetzt
  // ist — in Produktion liegen Oberflaeche und API auf derselben Domain.
  corsOrigins: process.env.CORS_ORIGINS ? ALLOWED_ORIGINS : null,
  transporter,
  smtpConfig: SMTP_CONFIG,
  io,
  rateLimiters: {
    general: generalLimiter,
    authLimiter,
    registerLimiter,
    docsLoginLimiter,
    chatMessageLimiter,
    chatClearLimiter,
    eventBookingLimiter,
    uploadLimiter,
    orgLimiter,
  },
});

// HTTP-Requests an die Express-App weiterleiten — ABER nur die, die
// Socket.IO nicht schon selbst beantwortet hat.
//
// Gemessen: 20 Abstuerze in 45 Minuten normaler Nutzung, beide Replikas
// betroffen (RestartCount 9 bzw. 11). Eine einzige URL genuegte, um das
// Backend reproduzierbar umzuwerfen.
//
// Der Fix behaelt die Reihenfolge bei (Socket.IO zuerst, siehe oben) und
// prueft nur, ob die Antwort schon steht.
// Waehrend des Herunterfahrens (siehe gracefulShutdown) meldet der
// Gesundheitspfad 503, damit Traefik diese Replica aus dem Pool nimmt,
// BEVOR der Server keine Verbindungen mehr annimmt. Alle anderen Anfragen
// werden in dieser Zeit noch normal beantwortet. Zwei Felder wie im
// gesunden Fall (createApp.js), nur mit anderem Status.
let wirdBeendet = false;

server.on('request', (req, res) => {
  // Engine.IO hat bereits geantwortet (Handshake abgelehnt) -> nichts tun.
  if (res.headersSent || res.writableEnded) return;
  if (wirdBeendet && req.url === '/api/health') {
    res.writeHead(503, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify({ status: 'STOPPING', message: 'Konfi Points API wird beendet' }));
    return;
  }
  app(req, res);
});

// ====================================================================
// CHAT SYSTEM INITIALIZATION
// ====================================================================
//
// Der Aufruf ist ersatzlos entfallen, statt ihn scharf zu schalten: Die Anlage
// der Jahrgangs-Chats erledigt `syncJahrgangChat` (utils/jahrgangChat.js) —
// beim Anlegen eines Jahrgangs, beim Zuweisen von Konfis und Teamer:innen und
// beim Laden der Raeume (GET /chat/rooms). Diese Fassung ist idempotent, nimmt
// geloeschte und inaktive Konten aus, setzt Admins und Teamer:innen nach der
// Zuweisungsregel und traegt den anlegenden Nutzer als created_by ein.
//
// Die alte Fassung konnte das nicht: Sie fuegte Teilnehmer ohne
// ON CONFLICT ein, kannte weder deleted_at noch is_active, trug ausser Konfis
// niemanden ein und fiel fuer created_by auf die feste Nutzer-ID 1 zurueck —
// die je nach Organisation einem fremden Konto gehoert. Ein Scharfschalten
// haette diese Fehler nach 14 Monaten erstmals wirksam gemacht.

// ====================================================================
// BACKGROUND SERVICES INITIALIZATION
// ====================================================================

// Hintergrund-Jobs (Cron: Auto-Deletion, Reminder, APM-Snapshots, Token-Cleanup,
// Wrapped) duerfen bei MEHREREN Backend-Replicas (Zero-Downtime-Setup) nur EINMAL
// laufen, sonst gibt es Doppel-Pushes/-Loeschungen/-Snapshots.
//
// Jetzt WAEHLEN die Replicas den Leader per Advisory-Lock (utils/cronLeader.js):
// Jede Replica, die Jobs fahren DARF, versucht den Lock im Takt; wer ihn
// haelt, startet die Jobs; stirbt sie, uebernimmt die naechste beim
// naechsten Takt. RUN_BACKGROUND_JOBS='false' heisst weiterhin: NIE
// (backend-test teilt sich die Datenbank mit Live und darf keine Jobs fahren).
// Alles andere heisst: an der Wahl teilnehmen. Sichtbar in /api/status als
// `cron_leader` (diese Replica) und `checks.cron_leader` (irgendjemand).
const BackgroundService = require('./services/backgroundService');
const hintergrundJobsErlaubt = process.env.RUN_BACKGROUND_JOBS !== 'false';
if (hintergrundJobsErlaubt) {
  const { starteCronLeaderWahl } = require('./utils/cronLeader');
  cronLeader = starteCronLeaderWahl({
    beiUebernahme: () => {
      BackgroundService.startAllServices(db, { wrappedRouter: app.wrappedRouter });
      console.warn('Hintergrund-Jobs gestartet (diese Replica ist der Cron-Leader).');
    },
    beiVerlust: () => {
      BackgroundService.stopAllServices();
    },
  });
  console.warn('Cron-Leader-Wahl gestartet -- diese Replica bewirbt sich um die Hintergrund-Jobs.');
} else {
  console.warn('Hintergrund-Jobs DEAKTIVIERT (RUN_BACKGROUND_JOBS=false) — diese Replica nimmt nicht an der Leader-Wahl teil.');
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
const smtpStatus = smtpKonfiguriert ? 'Konfiguriert' : 'Nicht konfiguriert';

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
  console.log(hintergrundJobsErlaubt
    ? '  - Background: Leader-Wahl (Jobs laufen auf dem Cron-Leader)'
    : '  - Background: Deaktiviert (RUN_BACKGROUND_JOBS=false)');
  console.log('========================================');
});

// ====================================================================
// GRACEFUL SHUTDOWN
// ====================================================================

// exitCode: 0 bei einem regulaeren Signal, 1 nach einem Absturz. Sonst meldet
// der Container "sauber beendet", obwohl eine unbehandelte Exception ihn
// heruntergefahren hat — in der Neustart-Statistik nicht mehr unterscheidbar.
//
// REIHENFOLGE. Bis dahin stand hier
// server.close() -> db.end() -> socketAdapterPool.end(), und JEDER Stopp
// endete nach exakt 10 s mit Exit 1: Der Socket.IO-Postgres-Adapter haelt
// fuer LISTEN dauerhaft einen Client aus socketAdapterPool ausgecheckt und
// gibt ihn nur ueber io.close() zurueck. pool.end() wartet auf die Rueckgabe
// aller Clients -- also ewig --, waehrend der 30-s-Aufraeumtimer des Adapters
// weiter DELETE auf den geschlossenen Pool absetzte ("Cannot use a pool
// after calling end on the pool"). Nach 10 s griff der Notausstieg mit
// Exit 1. Gemessen: Exit 1 nach 10 014 ms, bei jedem Deploy, je Replica.
//
// Jetzt: (1) Gesundheitspfad auf 503 und optional SHUTDOWN_DRAIN_MS warten,
// damit Traefik (Pruefintervall 5 s) die Replica aus dem Pool nimmt, solange
// sie noch antwortet; (2) Hintergrund-Jobs anhalten; (3) io.close() -- trennt
// die Sockets, schliesst den Adapter (LISTEN-Client zurueck, Timer aus) und
// den HTTP-Server; leerlaufende Keep-Alive-Verbindungen werden sofort
// geschlossen, laufende Anfragen bekommen SHUTDOWN_REQUEST_GRACE_MS;
// (4) erst dann die Pools. Der Notausstieg bleibt als letztes Netz.
const SHUTDOWN_DRAIN_MS = parseInt(process.env.SHUTDOWN_DRAIN_MS || '0', 10);
const SHUTDOWN_REQUEST_GRACE_MS = parseInt(process.env.SHUTDOWN_REQUEST_GRACE_MS || '5000', 10);
const SHUTDOWN_TIMEOUT_MS = 10000;
const schlafen = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let shutdownLaeuft = false;
const gracefulShutdown = async (signal, exitCode = 0) => {
  if (shutdownLaeuft) return; // zweites Signal waehrend des Herunterfahrens
  shutdownLaeuft = true;
  const begonnen = Date.now();
  console.warn(`${signal} empfangen - Graceful Shutdown...`);

  const notausstieg = setTimeout(() => {
    console.error('Shutdown-Timeout erreicht - erzwinge Beendigung');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  notausstieg.unref();

  // (1) Aus dem Traefik-Pool nehmen lassen, solange noch geantwortet wird.
  wirdBeendet = true;
  if (SHUTDOWN_DRAIN_MS > 0) {
    await schlafen(SHUTDOWN_DRAIN_MS);
  }

  // (2) Keine neuen Job-Laeufe mehr anstossen; den Leader-Lock abgeben, damit
  // die andere Replica beim naechsten Takt uebernimmt, statt erst nach dem
  // Verbindungsende dieses Prozesses.
  try {
    if (cronLeader) await cronLeader.stopp();
    BackgroundService.stopAllServices();
  } catch (err) {
    console.error('Fehler beim Anhalten der Hintergrund-Jobs:', err.message);
  }

  // (3) Sockets, Adapter, HTTP-Server.
  try {
    const ioZu = io.close();
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    const abbruch = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }, SHUTDOWN_REQUEST_GRACE_MS);
    abbruch.unref();
    await ioZu;
    clearTimeout(abbruch);
    console.warn('HTTP-Server und Socket.IO geschlossen.');
  } catch (err) {
    console.error('Fehler beim Schliessen von HTTP-Server/Socket.IO:', err.message);
  }

  // (4) Pools -- jetzt haelt niemand mehr einen Client.
  try {
    await db.end();
    console.warn('Datenbankverbindung geschlossen.');
  } catch (err) {
    console.error('Fehler beim Schliessen der Datenbankverbindung:', err.message);
  }
  try {
    // Faellt der Stopp in den Verbindungsaufbau des Adapters, gibt io.close()
    // dessen LISTEN-Client nicht zurueck und end() wartete bis zum
    // Notausstieg (utils/socketAdapterVerbindung.js, drittes Problem).
    adapterVerbindung.schliessen();
    await socketAdapterPool.end();
    console.warn('Socket.IO-Adapter-Pool geschlossen.');
  } catch (err) {
    console.error('Fehler beim Schliessen des Adapter-Pools:', err.message);
  }

  sammelzeilenAusgeben();
  console.warn(`Shutdown abgeschlossen nach ${Date.now() - begonnen} ms (Exit ${exitCode}).`);
  process.exit(exitCode);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ====================================================================
// LETZTES NETZ: UNBEHANDELTE FEHLER
// ====================================================================

// Eine unbehandelte Promise-Ablehnung beendet den Prozess (Node-Standard seit 15).
// Genau das ist hier falsch: Ein einzelner fehlgeschlagener Hintergrund-Job (etwa
// ein Erstlauf, dessen Tabelle beim Boot noch nicht migriert ist) wuerde mit
// `restart: unless-stopped` eine Neustartschleife ausloesen. Und weil nur die
// Cron-Leader-Replica die Hintergrund-Jobs startet, antwortet die zweite Replica
// dabei weiter — der Ausfall bliebe von aussen unsichtbar, waehrend Erinnerungen,
// Token-Cleanup, Auto-Loeschung und APM stillstehen.
// Deshalb: NUR LOGGEN, nicht beenden. Der Prozesszustand ist nach einer
// abgelehnten Promise unveraendert; der Aufrufer gehoert repariert, nicht der
// Server neu gestartet.
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unbehandelte Promise-Ablehnung (Prozess laeuft weiter):', reason, promise);
});

// Bei einer unbehandelten Exception ist der Prozesszustand dagegen unklar
// (halb ausgefuehrte Handler, offene Transaktionen). Hier ist der geordnete
// Shutdown richtig — der Orchestrator startet danach sauber neu.
process.on('uncaughtException', (err) => {
  console.error('Unbehandelte Exception - geordneter Shutdown:', err);
  gracefulShutdown('uncaughtException', 1);
});
