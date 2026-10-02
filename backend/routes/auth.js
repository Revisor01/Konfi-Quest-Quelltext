const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
// Wie lange ein Einladungscode gilt
const {
  leseTage: leseEinladungsTage,
  ablaufBeimAnlegen: einladungAblaufBeimAnlegen,
  ablaufBeimVerlaengern: einladungAblaufBeimVerlaengern,
  HOECHSTENS_TAGE: EINLADUNG_HOECHSTENS_TAGE
} = require('../utils/einladungsGueltigkeit');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { clientIp } = require('../utils/clientIp');
const { PostgresRateLimitStore } = require('../utils/rateLimitStore');
const { body, param } = require('express-validator');
const validator = require('validator');
const { handleValidationErrors, commonValidations } = require('../middleware/validation');
const { validatePassword } = require('../utils/passwordUtils');
const { kontoDatenLoeschen, kontoDateienLoeschen, meldeNachKontoLoeschung } = require('../utils/kontoLoeschen');
const { checkKonfiLimit } = require('../utils/konfiLimit');
const PushService = require('../services/pushService');
const { ladeLeitungZumJahrgang } = require('../utils/jahrgangLeitungSicht');
const liveUpdate = require('../utils/liveUpdate');
const { invalidateUserCache } = require('../middleware/rbac');
const { nachAntwort } = require('../utils/nachAntwort');
const { meldePasswortGeaendert } = require('../utils/passwortGeaendertMail');
const { erzeugeKontoSperre, kontoSperreAufheben } = require('../utils/kontoSperre');
const { benutzernameSperrenUndPruefen } = require('../utils/benutzernameSperre');
const { refreshTokensBegrenzen } = require('../utils/refreshTokenGrenze');
const router = express.Router();

const erzeugeResetLimiter = (db) => ({
// Eigener Rate-Limiter für Passwort-Reset (getrennt vom Login-Limiter).
//
// SCHLUESSEL WIE ALLE ANDEREN IP-LIMITER:
// Dieser Limiter zaehlte auf req.ip -- und req.ip ist hinter
// dem Proxy für ALLE Anfragen dieselbe Adresse (Produktionsbefund, siehe
// server.js bei clientIp). Ergebnis: fünf Passwort-Reset-Anfragen je
// Viertelstunde für die gesamte Plattform. Bei 10.000 bis 25.000
// Nutzer:innen ist die Funktion damit praktisch nicht verfügbar, und ein
// Dritter sperrt sie mit fünf Anfragen für alle. Die uebrigen Limiter waren
// laengst auf clientIp() umgestellt, nur dieser hier nicht.
  passwordResetLimiter: rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 5, // Max 5 Reset-Anfragen pro 15 Minuten je Absender
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)), // echte Client-IP (X-Real-IP vom Proxy)
  message: { error: 'Zu viele Passwort-Reset-Anfragen. Bitte warte 15 Minuten.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresRateLimitStore(db, { prefix: 'reset-ip' })
  }),

// Zweite Grenze JE ZIEL-ADRESSE: Sobald der Limiter oben je Absender zaehlt,
// laesst sich ein einzelnes Konto von vielen Adressen aus mit Reset-Mails
// bombardieren. Drei Anfragen je Stunde für dieselbe E-Mail reichen für
// jeden echten Bedarf (Mail nicht angekommen, Spam-Ordner, noch einmal).
//
// Gezaehlt wird UNABHAENGIG davon, ob es ein Konto zu der Adresse gibt --
// sonst wuerde ein 429 verraten, welche Adressen ein Konto haben, und die
// neutrale Antwort der Route waere umsonst. Gross-/Kleinschreibung und
// Leerraum zaehlen nicht als andere Adresse. Ohne E-Mail im Body greift die
// Validierung dahinter (400); der Limiter laesst solche Anfragen durch.
  passwordResetEmailLimiter: rateLimit({
  windowMs: 60 * 60 * 1000, // 1 Stunde
  max: 3,
  keyGenerator: (req) => `email:${String(req.body.email).trim().toLowerCase()}`,
  skip: (req) => !req.body || typeof req.body.email !== 'string' || !req.body.email.trim(),
  message: { error: 'Zu viele Passwort-Reset-Anfragen für diese E-Mail-Adresse. Bitte warte eine Stunde.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresRateLimitStore(db, { prefix: 'reset-email' })
  })
});


// Grenze fuer die oeffentliche Namenspruefung GET /check-username/:username
// 
// Die Route verraet, ob es einen Benutzernamen gibt -- bei Konfis meist
// vorname.nachname. Bis dahin bremste sie allein der allgemeine Flutschutz
// (2000 je Viertelstunde und IP): Eine Namensliste eines Ortes liess sich in
// Minuten abgleichen.
//
// GEZAEHLT WERDEN NUR TREFFER ("vergeben"): Beim Registrieren prueft die App
// bei jedem Tastendruck (300 ms Pause), und eine Konfi-Gruppe registriert
// sich gemeinsam aus einem Gemeinde-WLAN -- dieselbe IP, Hunderte Pruefungen
// in einer Viertelstunde, fast alle "frei". Die sollen nicht zaehlen. Wer
// dagegen eine Namensliste abgleicht, sammelt Treffer; nach 30 je
// Viertelstunde und IP ist Schluss, dann antwortet die Route fuer diese IP
// 15 Minuten lang 429. Die App (auch 2.2.x) faengt den Fehler ab und zeigt
// dann nur keinen Hinweis "frei"/"vergeben" -- registrieren geht weiter,
// POST /register-konfi prueft den Namen selbst.
//
// Zaehler im gemeinsamen Store (rate_limit_zaehler), also ueber beide
// Replicas; Schluessel ist die Client-IP wie bei allen IP-Grenzen.
const NAMENSPRUEFUNG_TREFFER = 30;
const erzeugeNamensLimiter = (db) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max: NAMENSPRUEFUNG_TREFFER,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  skipSuccessfulRequests: true,
  // "Erfolgreich" = nicht gezaehlt: alles ausser einem Treffer.
  requestWasSuccessful: (req, res) => res.locals.benutzernameVergeben !== true,
  message: { error: 'Zu viele Namensprüfungen. Bitte versuche es in 15 Minuten erneut.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresRateLimitStore(db, { prefix: 'namenspruefung' })
});

// DAS MUSTER wie bei der Namenspruefung oben: Schluessel ist die
// Client-Adresse (clientIp, Header nur aus dem Docker-Netz), Zaehler im
// gemeinsamen Store (beide Replicas), und GEZAEHLT WIRD NUR DER FALL, DER
// AUF RATEN HINDEUTET. Echte Nutzung erzeugt ihn selten, und was sie
// staendig tut -- gueltige Codes pruefen, Tokens erneuern --, zaehlt nicht.
//
// 1. EINLADUNGSCODE (GET /validate-invite/:code): gezaehlt wird nur 404
//    "existiert nicht". Ein Code hat 8 Hex-Zeichen (32 Bit, POST
//    /invite-code), und ein Treffer nennt Gemeinde und Jahrgang -- mit ihm
//    registriert man sich dort als Konfi, samt Jahrgangs-Chat. Die App ruft
//    die Route einmal je Deep-Link (/register?code=...) oder je Druck auf
//    "Code pruefen" (KonfiRegisterPage.validateCode, ab 6 Zeichen), nicht
//    beim Tippen. Eine Konfi-Gruppe im Gemeinde-WLAN teilt sich eine
//    Adresse: 30 Personen mit je zwei Vertippern sind 60. Gueltige (200) und
//    abgelaufene Codes (410, ohne Namen) zaehlen nicht -- sonst sperrte ein
//    abgelaufener Code an der Tafel die ganze Gruppe, auch fuer den neuen.
//    Vorher: bis 2000 Versuche je Viertelstunde und Adresse (je Replica).
//
// 2. RESET-TOKEN (POST /reset-password): gezaehlt wird nur "Ungueltiger oder
//    abgelaufener Reset-Token". Das Token hat 32 Zufallsbytes, raten ist
//    aussichtslos; die Grenze haelt Skripte fern. Echte Nutzung: ein Klick
//    auf den Link aus der Mail, bei einem alten Link einer oder zwei
//    Versuche. Ein zu schwaches neues Passwort (400 der Pruefung) zaehlt
//    nicht -- die Seite laesst so oft probieren, wie es dauert.
//
// 3. REFRESH (POST /refresh): gezaehlt wird nur 401 (unbekanntes,
//    abgelaufenes, widerrufenes oder geraetefremdes Token). Refresh-Tokens
//    haben 64 Zufallsbytes, raten ist aussichtslos; die Grenze bremst nur
//    Fluten. SIE MUSS WEIT SEIN: Die App meldet sich bei JEDER abgelehnten
//    Erneuerung ab, auch bei 429 (services/api.ts, fehlerBehandeln:
//    "Refresh vom Server abgelehnt -> Re-Login", in 2.2.x und 2.3.0).
//    Erfolgreiche Erneuerungen -- alle 15 Minuten je aktivem Geraet, dazu
//    bei jedem Start -- zaehlen nicht, 403 (Sperre von Konto oder Gemeinde)
//    und 400/500 auch nicht. Ein Geraet erzeugt hoechstens zwei 401: Nach
//    dem ersten verwirft die App den Token (ensureFreshToken behaelt den
//    alten Zugangs-Token, die naechste Anfrage laeuft in 401, der zweite
//    Refresh scheitert, die App meldet ab). 300 je Viertelstunde und
//    Adresse -- dieselbe Zahl wie die Fehlversuche beim Anmelden
//    (authLimiter) -- heisst also: 150 Geraete hinter einer Adresse werden
//    binnen 15 Minuten abgemeldet. Das kommt nicht vor, auch nicht hinter
//    Carrier-NAT (IPv6 zaehlt je /56).
const EINLADUNGSCODE_FEHLVERSUCHE = 60;
const RESET_TOKEN_FEHLVERSUCHE = 20;
const REFRESH_FEHLVERSUCHE = 300;
const erzeugeOeffentlicheGrenzen = (db) => {
  const grenze = ({ prefix, max, gezaehlt, error }) => rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
    skipSuccessfulRequests: true,
    // "Erfolgreich" = nicht gezaehlt: alles ausser dem Ratefall.
    requestWasSuccessful: (req, res) => !gezaehlt(req, res),
    message: { error },
    standardHeaders: true,
    legacyHeaders: false,
    store: new PostgresRateLimitStore(db, { prefix })
  });
  return {
    einladungscodeLimiter: grenze({
      prefix: 'einladungscode',
      max: EINLADUNGSCODE_FEHLVERSUCHE,
      gezaehlt: (req, res) => res.statusCode === 404,
      error: 'Zu viele unbekannte Einladungscodes. Bitte prüfe den Code und versuche es in 15 Minuten erneut.'
    }),
    resetTokenLimiter: grenze({
      prefix: 'reset-token',
      max: RESET_TOKEN_FEHLVERSUCHE,
      gezaehlt: (req, res) => res.locals.resetTokenUngueltig === true,
      error: 'Zu viele ungültige Links zum Zurücksetzen. Bitte fordere einen neuen Link an und versuche es in 15 Minuten erneut.'
    }),
    refreshLimiter: grenze({
      prefix: 'refresh',
      max: REFRESH_FEHLVERSUCHE,
      gezaehlt: (req, res) => res.statusCode === 401,
      error: 'Zu viele abgelaufene Anmeldungen von dieser Verbindung. Bitte melde dich in 15 Minuten neu an.'
    }),
  };
};

const JWT_SECRET = process.env.JWT_SECRET;

const SPERR_MELDUNGEN = {
  user_inactive: 'Dein Zugang wurde deaktiviert. Bitte wende dich an deine Gemeinde.',
  org_trial_expired: 'Die Testphase dieser Gemeinde ist abgelaufen. Bitte wende dich an die Leitung deiner Gemeinde, um einen Tarif zu buchen.',
  org_inactive: 'Diese Gemeinde ist derzeit gesperrt. Bitte wende dich an die Leitung deiner Gemeinde.',
};
const sperrAntwort = (res, errorCode) =>
  res.status(403).json({ error: SPERR_MELDUNGEN[errorCode], error_code: errorCode });
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// VERTRAG GEPRUEFT: Die ausgelieferten Apps (1.5.3, 2.0.0, 2.1.1, 2.2.0,
// 2.3.0) dekodieren das Token an genau einer Stelle, services/api.ts
// getTokenExp, und lesen dort nur `exp`. Name und E-Mail kommen aus der
// Antwort der Anmeldung (`user`) und aus GET /auth/me. Im Backend liest
// niemand die beiden Claims: rbac.js, die Socket-Anmeldung und die
// Datei-Routen laden die Person je Anfrage aus der Datenbank und lesen aus
// dem Token nur id, iat und active_organization_id.

// Unified auth routes - combines all login functionality
module.exports = (db, verifyToken, transporter, SMTP_CONFIG, rateLimiters = {}, rbacVerifier) => {
  const { passwordResetLimiter, passwordResetEmailLimiter } = erzeugeResetLimiter(db);
  const namensLimiter = erzeugeNamensLimiter(db);
  const { einladungscodeLimiter, resetTokenLimiter, refreshLimiter } = erzeugeOeffentlicheGrenzen(db);
  const { authLimiter, registerLimiter } = rateLimiters;
  const emailService = require('../services/emailService');

  // Generate password reset token
  const generateResetToken = () => {
    return crypto.randomBytes(32).toString('hex');
  };

  // Refresh-Token generieren (64 Bytes = 128 Hex-Zeichen)
  const generateRefreshToken = () => crypto.randomBytes(64).toString('hex');

  // SHA-256 Hash für DB-Speicherung (konsistent mit Phase 66)
  const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

  // Geraete-Kennung aus dem Anfragekoerper.
  // Die App schickt sie bei Anmeldung, Registrierung
  // und Refresh als `device_id` mit -- dieselbe Kennung wie bei den
  // Push-Tokens. Nur ein nicht-leerer Text bis 255 Zeichen zaehlt; alles
  // andere gilt als "keine Kennung". Ausgelieferte Apps (2.2.x, 2.3.0) senden
  // an diesen Routen nie eine.
  const geraeteKennung = (req) => {
    const roh = req.body?.device_id;
    if (typeof roh !== 'string') return null;
    const kennung = roh.trim();
    return kennung.length > 0 && kennung.length <= 255 ? kennung : null;
  };

  const grenzeDurchsetzen = async (dbConn, userId, neuId, geraet) => {
    try {
      await refreshTokensBegrenzen(dbConn, userId, { neuId, geraet });
    } catch (err) {
      console.error(`Refresh-Token-Grenze fuer User ${userId} nicht durchgesetzt:`, err.message);
    }
  };

  // Frisches Token-Paar für einen User erzeugen. Wird nach dem Passwortwechsel
  // gebraucht: dort werden alle Sitzungen invalidiert, und ohne neues Paar
  // wuerde der eigene Client sofort mitfliegen.
  // Bewusst OHNE Geraetebindung (Migration 171): Auch ausgelieferte Apps
  // schicken beim Passwortwechsel schon eine device_id mit, beim Refresh aber
  // nie -- ein gebundenes Token sperrte sie nach 15 Minuten aus. Die
  // aktualisierte App bindet das Token beim ersten Refresh.
  // Gibt null zurück, wenn der User nicht (mehr) ladbar ist — der Aufrufer
  // antwortet dann ohne Token, der Wechsel selbst bleibt gueltig.
  const erstelleTokenPaarFuerUser = async (dbConn, userId) => {
    try {
      const { rows: [u] } = await dbConn.query(
        `SELECT u.id, u.display_name, u.email, u.organization_id, u.is_super_admin,
                r.name AS role_name
         FROM users u JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1`,
        [userId]
      );
      if (!u) return null;

      const userType = u.role_name === 'konfi' ? 'konfi'
        : u.role_name === 'teamer' ? 'teamer' : 'admin';

      // iat bewusst eine Sekunde in die Zukunft: Die Soft-Revoke-Prüfung in
      // rbac.js arbeitet auf Sekunden (iat < token_invalidated_at). Ein in
      // derselben Sekunde wie die Invalidierung ausgestelltes Token laege sonst
      // auf der Kippe und könnte sich selbst aussperren.
      const iatVordatiert = Math.floor(Date.now() / 1000) + 1;

      // Ohne Name und E-Mail, siehe TOKEN_INHALT oben.
      const accessToken = jwt.sign({
        id: u.id,
        type: userType,
        organization_id: u.organization_id,
        role_name: u.role_name,
        is_super_admin: u.is_super_admin || false,
        iat: iatVordatiert
      }, JWT_SECRET, { expiresIn: '15m' });

      const refreshToken = generateRefreshToken();
      const { rows: [neu] } = await dbConn.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id',
        [u.id, hashToken(refreshToken), new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)]
      );
      await grenzeDurchsetzen(dbConn, u.id, neu.id, null);

      return { token: accessToken, refresh_token: refreshToken };
    } catch (err) {
      console.error('Token-Neuausstellung nach Passwortwechsel fehlgeschlagen:', err);
      return null;
    }
  };

  // ===== UNIFIED LOGIN ENDPOINTS =====

  // Rate Limiter Middleware für Login (falls vorhanden)
  const loginMiddleware = authLimiter ? [authLimiter] : [];
  // Sperre JE KONTO nach 10 falschen Passwoertern in einer Stunde:
  // Die IP-Grenze oben laesst 1 200 Versuche
  // je Stunde und Adresse zu -- die Einmalpasswoerter (30 772 Bibelstellen)
  // waren damit in einem Tag durchprobiert. Immer aktiv, auch ohne die
  // Limiter aus server.js; Begruendung und Zahlen in utils/kontoSperre.js.
  const kontoSperre = erzeugeKontoSperre(db);
  // Rate Limiter Middleware für Selbst-Registrierung (falls vorhanden)
  const registerMiddleware = registerLimiter ? [registerLimiter] : [];

  // Validierungsregeln
  const validateLogin = [
    body('username').trim().notEmpty().withMessage('Benutzername ist erforderlich'),
    body('password').notEmpty().withMessage('Passwort ist erforderlich'),
    handleValidationErrors
  ];

  const validateChangePassword = [
    body('currentPassword').notEmpty().withMessage('Aktuelles Passwort ist erforderlich'),
    body('newPassword').isLength({ min: 8 }).withMessage('Neues Passwort muss mindestens 8 Zeichen lang sein'),
    handleValidationErrors
  ];

  const validateUpdateEmail = [
    body('email').optional({ values: 'null' }).trim().isEmail().withMessage('Ungültige E-Mail-Adresse'),
    handleValidationErrors
  ];

  const validateRequestPasswordReset = [
    body('email').trim().isEmail().withMessage('Gültige E-Mail-Adresse erforderlich'),
    handleValidationErrors
  ];

  const validateInviteCode = [
    body('jahrgang_id').isInt({ min: 1 }).withMessage('Ungültige Jahrgangs-ID'),
    handleValidationErrors
  ];

  const validateRegisterKonfi = [
    body('invite_code').trim().notEmpty().withMessage('Einladungscode ist erforderlich'),
    body('display_name').trim().notEmpty().withMessage('Anzeigename ist erforderlich'),
    commonValidations.username,
    commonValidations.password,
    handleValidationErrors
  ];

  const validateResetPassword = [
    body('token').notEmpty().withMessage('Token ist erforderlich'),
    body('newPassword').isLength({ min: 8 }).withMessage('Neues Passwort muss mindestens 8 Zeichen lang sein'),
    handleValidationErrors
  ];

  // Unified RBAC login - works for both admins and konfis
  // Reihenfolge: IP-Grenze, Eingabepruefung (trimmt den Namen), Kontosperre.
  router.post('/login', ...loginMiddleware, validateLogin, kontoSperre, async (req, res) => {
    // Usernames werden beim Anlegen klein gespeichert (name.toLowerCase()...).
    // Eingabe daher case-insensitiv machen: trim + lowercase, sonst scheitert
    // der Login wenn jemand z.B. "Anna.Schmidt" statt "anna.schmidt" tippt
    // (iOS schreibt das erste Zeichen automatisch gross). Der Username wird NICHT
    // mehr verändert gespeichert -> Login case-insensitiv per LOWER-Vergleich.
    const username = (req.body.username || '').trim();
    const { password } = req.body;
    // Kein Benutzername im Protokoll:
    // Er ist bei Konfis meist vorname.nachname eines Kindes. Erfolgreiche
    // Anmeldungen schreiben keine Zeile; Fehlversuche schon,
    // mit der Konto-Kennung oder, wenn es den Namen nicht gibt,
    // ohne jede Angabe zur Person. Gezaehlt werden sie in der Kontosperre
    // (utils/kontoSperre.js).
    try {
      const userQuery = `
        SELECT u.id, u.username, u.display_name, u.password_hash, u.organization_id, u.email, u.role_id,
               u.is_super_admin, u.is_active as user_active, u.deleted_at,
               o.name as organization_name, o.slug as organization_slug,
               COALESCE(o.is_active, true) as organization_active, o.trial_ends_at, o.is_trial,
               r.name as role_name, r.display_name as role_display_name,
               kp.jahrgang_id, j.name as jahrgang_name,
               kp.gottesdienst_points, kp.gemeinde_points
        FROM users u
        LEFT JOIN organizations o ON u.organization_id = o.id
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN konfi_profiles kp ON u.id = kp.user_id
        LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
        WHERE LOWER(u.username) = LOWER($1)
      `;

      const { rows: [user] } = await db.query(userQuery, [username]);

      if (!user) {
        console.warn('Login fehlgeschlagen: unbekannter Benutzername');
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
      }

      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        console.warn(`Login fehlgeschlagen: falsches Passwort fuer Konto ${user.id}`);
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
      }

      // Zugriffs-Sperren — super_admin (ohne Org) ist ausgenommen.
      const isSuperAdmin = user.is_super_admin === true || user.role_name === 'super_admin';

      // Soft-geloescht (deleted_at; der Auto-Loeschlauf setzt es 60 Tage
      // nach der Konfirmation, hart geloescht wird ab Tag 120). Die Person
      // ist fuer die Leitung laengst unsichtbar -- jede Liste filtert
      // deleted_at IS NULL --, konnte sich aber weiter anmelden und im Chat
      // schreiben. Antwort exakt wie
      // beim deaktivierten Konto, damit der Fehler nicht verraet, dass es das
      // Konto noch gibt. Gilt fuer jede Rolle: Loeschung kennt keine Ausnahme.
      if (user.deleted_at) {
        console.warn(`Login blockiert: Konto ${user.id} ist geloescht (Soft-Delete)`);
        return sperrAntwort(res, 'user_inactive');
      }

      if (!isSuperAdmin) {
        // User deaktiviert
        if (user.user_active === false) {
          console.warn(`Login blockiert: Konto ${user.id} ist deaktiviert`);
          return sperrAntwort(res, 'user_inactive');
        }
        // Trial abgelaufen (auch falls der Cron die Org noch nicht auf inaktiv gesetzt hat)
        const trialExpired = user.trial_ends_at && new Date(user.trial_ends_at) < new Date();
        // Organisation gesperrt (inaktiv oder Trial abgelaufen)
        if (user.organization_active === false || trialExpired) {
          console.warn(`Login blockiert: Gemeinde ${user.organization_id} von Konto ${user.id} ist gesperrt (active=${user.organization_active}, trialExpired=${trialExpired})`);
          return sperrAntwort(res, trialExpired ? 'org_trial_expired' : 'org_inactive');
        }
      }

      // Erfolgreich angemeldet: Die Fehlversuche dieses Kontos verfallen --
      // ein Kind, das sich neunmal vertippt und dann trifft, faengt wieder bei
      // null an. (Ueber der Grenze kommt niemand bis hierher.)
      if (req.kontoSperre) await kontoSperre.resetKey(req.kontoSperre.key);

      // last_login_at nur beim echten Login aktualisieren (nicht in Middleware)
      await db.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);

      const userType = user.role_name === 'konfi' ? 'konfi' : user.role_name === 'teamer' ? 'teamer' : 'admin';

      // JWT Token - Rollen-basiert (keine Permissions mehr)
      // Ohne Name und E-Mail, siehe TOKEN_INHALT oben.
      const token = jwt.sign({
        id: user.id,
        type: userType,
        organization_id: user.organization_id,
        role_name: user.role_name,
        is_super_admin: user.is_super_admin || false
      }, JWT_SECRET, { expiresIn: '15m' });

      // Refresh-Token erstellen und in DB speichern
      const refreshToken = generateRefreshToken();
      const refreshTokenHash = hashToken(refreshToken);
      const refreshExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 Tage
      // An das Geraet gebunden, wenn die App ihre Kennung mitschickt.
      const loginGeraet = geraeteKennung(req);
      const { rows: [neuesToken] } = await db.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [user.id, refreshTokenHash, refreshExpiresAt, loginGeraet]
      );
      await grenzeDurchsetzen(db, user.id, neuesToken.id, loginGeraet);

      const responseUser = {
        id: user.id,
        display_name: user.display_name,
        username: user.username,
        email: user.email,
        organization: user.organization_name,
        role_name: user.role_name,
        type: userType,
        is_super_admin: user.is_super_admin || false,
        trial_ends_at: user.trial_ends_at || null,
        is_trial: user.is_trial === true
      };
    
      if (userType === 'konfi') {
        responseUser.jahrgang = user.jahrgang_name;
        responseUser.gottesdienst_points = user.gottesdienst_points || 0;
        responseUser.gemeinde_points = user.gemeinde_points || 0;
      }

      // Bewusst nur hier und in GET /auth/me: `org_admin` und `super_admin`
      // sehen ohnehin alle Jahrgaenge, `konfi` und `teamer` brauchen es nicht.
      // Die Login-Route laeuft ohne rbacVerifier, deshalb die eigene Abfrage —
      // in /auth/me wird stattdessen durchgereicht, was rbacVerifier ohnehin
      // geladen hat.
      if (user.role_name === 'admin') {
        const { rows: zuweisungen } = await db.query(
          `SELECT j.id, j.name, uja.can_view, uja.can_edit
           FROM user_jahrgang_assignments uja
           JOIN jahrgaenge j ON uja.jahrgang_id = j.id
           WHERE uja.user_id = $1 AND j.organization_id = $2`,
          [user.id, user.organization_id]
        );
        responseUser.assigned_jahrgaenge = zuweisungen;
      }

      res.json({ token, refresh_token: refreshToken, user: responseUser });

    } catch (err) {
 console.error('Database error in POST /api/auth/login:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ===== PASSWORD MANAGEMENT =====

  // Change password (for authenticated users)
  router.post('/change-password', rbacVerifier, validateChangePassword, async (req, res) => {
    // device_id + platform (optional): Geraet der AKTUELLEN Sitzung. Neue
    // App-Versionen schicken es mit, damit unten nur die Push-Tokens der
    // ANDEREN Geraete fallen. Alte Versionen kennen die Felder nicht.
    const { currentPassword, newPassword, device_id, platform } = req.body;
    const userId = req.user.id;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Aktuelles und neues Passwort sind erforderlich' });
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }
    
    try {
      const { rows: [user] } = await db.query(`SELECT id, password_hash FROM users WHERE id = $1`, [userId]);
      if (!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }
      
      const passwordMatch = await bcrypt.compare(currentPassword, user.password_hash);
      if (!passwordMatch) {
        return res.status(400).json({ error: 'Aktuelles Passwort ist falsch' });
      }
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Alle anderen Sitzungen beenden. Vorher
      // blieben bestehende Access- und Refresh-Tokens nach einem Passwort-
      // wechsel weiter gueltig — bis zu 90 Tage. Wer sein Passwort ändert,
      // weil jemand Zugriff hat, sperrte den Fremdzugriff damit NICHT aus.
      //
      // Die Prüfung in rbac.js vergleicht token_invalidated_at gegen den
      // JWT-Claim iat, der nur SEKUNDEN-Aufloesung hat (iat < invalidatedAt).
      // Deshalb wird hier exakt auf NOW() invalidiert und das neue Token unten
      // um eine Sekunde VORdatiert. Zurueckdatieren wäre falsch herum: dann
      // ueberleben Tokens aus derselben und der vorherigen Sekunde.
      await db.query(
        `UPDATE users SET password_hash = $1, token_invalidated_at = NOW() WHERE id = $2`,
        [hashedPassword, userId]
      );
      // Neues Passwort: eine Sperre nach Fehlversuchen endet damit.
      await kontoSperreAufheben(db, userId);
      await db.query(
        'UPDATE refresh_tokens SET revoked_at = NOW(), expires_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId]
      );

      // Push-Tokens der beendeten Sitzungen mitloeschen: Der Versand haengt
      // im pushService nur an user_id, NICHT an einer gueltigen Sitzung.
      // Ohne diese Loeschung bekaeme ein gerade ausgesperrtes Geraet weiter
      // Push-Nachrichten (inkl. Chat-Inhalten) — und zwar unbegrenzt, weil
      // jede Zustellung updated_at auffrischt und die 30-Tage-Bereinigung
      // dadurch nie greift. Genau der Fall "Passwort geaendert, weil jemand
      // Zugriff hat".
      //
      // Das Geraet der aktuellen Sitzung bleibt verschont, wenn der Client
      // es mitgeschickt hat. Alte App-Versionen schicken nichts — dann fallen
      // ALLE Tokens des Users (sicherer Default); das eigene Geraet
      // registriert sich beim naechsten App-Start selbst neu.
      if (device_id && platform) {
        await db.query(
          'DELETE FROM push_tokens WHERE user_id = $1 AND NOT (device_id = $2 AND platform = $3)',
          [userId, device_id, platform]
        );
      } else {
        await db.query('DELETE FROM push_tokens WHERE user_id = $1', [userId]);
      }
      invalidateUserCache(userId);

      // Frisches Token-Paar für die AKTUELLE Sitzung: Ohne das wuerde der
      // eigene Client beim nächsten Request am gerade gesetzten
      // token_invalidated_at scheitern und der Passwortwechsel wuerde sich
      // wie ein unerwarteter Rauswurf anfuehlen.
      const neuesPaar = await erstelleTokenPaarFuerUser(db, userId);

      res.json({
        message: 'Passwort erfolgreich geändert',
        ...(neuesPaar || {})
      });

      // Bestaetigung an die hinterlegte Adresse
      // -- nach der Antwort, ein Versandfehler kippt nichts.
      nachAntwort(req, () => meldePasswortGeaendert(db, userId), 'POST /auth/change-password (Mail)');

    } catch (err) {
 console.error('Database error in POST /api/auth/change-password:', err);
      res.status(500).json({ error: 'Fehler beim Ändern des Passworts' });
    }
  });

  router.post('/delete-account', rbacVerifier, async (req, res) => {
    const { password } = req.body;
    const userId = req.user.id;

    if (!password) {
      return res.status(400).json({ error: 'Passwort ist erforderlich' });
    }

    try {
      const { rows: [user] } = await db.query(
        `SELECT id, password_hash, organization_id FROM users WHERE id = $1`,
        [userId]
      );
      if (!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        return res.status(400).json({ error: 'Aktuelles Passwort ist falsch' });
      }

      // Der letzte Org-Admin darf sich nicht selbst entfernen — sonst bleibt
      // die Organisation ohne jede Verwaltung zurueck und laesst sich nur noch
      // per Datenbankeingriff retten. DELETE /users/:id kannte diesen Schutz
      // laengst (users.js), die Selbstloeschung nicht.
      const { rows: [eigeneRolle] } = await db.query(
        `SELECT r.name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
        [userId]
      );
      if (eigeneRolle?.name === 'org_admin') {
        const { rows: [andere] } = await db.query(
          `SELECT COUNT(*)::int AS anzahl
             FROM users u JOIN roles r ON u.role_id = r.id
            WHERE r.name = 'org_admin' AND u.organization_id = $1
              AND u.id != $2 AND u.deleted_at IS NULL`,
          [user.organization_id, userId]
        );
        if ((andere?.anzahl ?? 0) === 0) {
          return res.status(409).json({
            error: 'Du bist die letzte Person mit Verwaltungsrechten in dieser Gemeinde. '
                 + 'Bitte gib die Rechte zuerst an jemanden weiter, dann kannst du dein Konto löschen.'
          });
        }
      }

      const client = await db.getClient();
      let ergebnis = null;
      try {
        await client.query('BEGIN');
        ergebnis = await kontoDatenLoeschen(client, userId);
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // Dateien erst nach dem COMMIT -- ein ROLLBACK darf keine kosten.
      await kontoDateienLoeschen(ergebnis?.dateien);

      res.json({ message: 'Account erfolgreich gelöscht' });

      // Rechte-Cache leeren: Das eigene
      // Token gaelte sonst noch bis zu 30 Sekunden weiter (TTL in rbac.js).
      invalidateUserCache(userId);

      const organizationId = req.user.organization_id;
      nachAntwort(req, async () => {
        await meldeNachKontoLoeschung(db, ergebnis);

        // Admin-Liste aktualisieren und den Socket des geloeschten Kontos trennen —
        // sonst empfing er weiter Org-Updates und die Liste blieb stehen
        // 
        liveUpdate.sendToOrgAdmins(organizationId, 'konfis', 'delete', { userId });
        liveUpdate.disconnectUserSockets(userId);
      }, 'POST /auth/delete-account (Meldungen nach Kontoloeschung)');

    } catch (err) {
 console.error('Database error in POST /api/auth/delete-account:', err);
      res.status(500).json({ error: 'Fehler beim Löschen des Accounts' });
    }
  });

  // Update email address (for authenticated users)
  router.post('/update-email', rbacVerifier, validateUpdateEmail, async (req, res) => {
    const { email } = req.body;
    const userId = req.user.id;

    // E-Mail ist optional - wenn angegeben, muss sie gültig sein
    const trimmedEmail = email?.trim() || null;

    if (trimmedEmail) {
      if (!validator.isEmail(trimmedEmail)) {
        return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
      }
    }

    try {
      await db.query(`UPDATE users SET email = $1 WHERE id = $2`, [trimmedEmail, userId]);

      res.json({ message: 'E-Mail-Adresse erfolgreich aktualisiert', email: trimmedEmail });

    } catch (err) {
        if (err.code === '23505') { // unique_violation for email
            return res.status(409).json({ error: 'Diese E-Mail-Adresse wird bereits verwendet.' });
        }
 console.error('Database error in POST /api/auth/update-email:', err);
        res.status(500).json({ error: 'Fehler beim Aktualisieren der E-Mail-Adresse' });
    }
  });

  // Update role title / Funktionsbeschreibung (for authenticated users - only admins/teamers)
  router.post('/update-role-title', rbacVerifier, async (req, res) => {
    const { role_title } = req.body;
    const userId = req.user.id;

    // Nur Admins und Teamer können ihren Titel ändern (keine Konfis)
    if (req.user.role_name === 'konfi') {
      return res.status(403).json({ error: 'Konfis können keine Funktionsbeschreibung setzen' });
    }

    try {
      // Leerer String oder null wird als NULL gespeichert
      const titleValue = role_title?.trim() || null;

      await db.query(`UPDATE users SET role_title = $1 WHERE id = $2`, [titleValue, userId]);
      invalidateUserCache(userId);

      res.json({
        message: 'Funktionsbeschreibung erfolgreich aktualisiert',
        role_title: titleValue
      });

    } catch (err) {
 console.error('Database error in POST /api/auth/update-role-title:', err);
      res.status(500).json({ error: 'Fehler beim Aktualisieren der Funktionsbeschreibung' });
    }
  });

  // Get current user profile (for authenticated users)
  router.get('/me', rbacVerifier, async (req, res) => {
    const userId = req.user.id;

    try {
      const { rows: [user] } = await db.query(`
        SELECT u.id, u.username, u.display_name, u.email, u.role_title,
               r.name as role_name, r.display_name as role_display_name,
               (r.name = 'super_admin' OR u.is_super_admin = true) as is_super_admin,
               o.trial_ends_at, o.is_trial
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN organizations o ON u.organization_id = o.id
        WHERE u.id = $1
      `, [userId]);

      if (!user) {
        return res.status(404).json({ error: 'Benutzer nicht gefunden' });
      }

      // Eigene Jahrgangs-Zuweisungen mitliefern. KEINE zusaetzliche Abfrage:
      // rbacVerifier laedt sie ohnehin bei jedem Request (rbac.js:183-193),
      // hier werden sie nur durchgereicht.
      //
      // Die Abfrage oben liest u.role_id -- das ist die Rolle der
      // STAMM-Gemeinde. Wer ueber user_organizations in einer zweiten
      // Gemeinde eine andere Rolle hat (in A Leitung, in B Teamer:in), bekam
      // hier trotzdem die Rolle vom Konto gemeldet: rbacVerifier hatte sie
      // fuer die aktive Gemeinde laengst aufgeloest (rbac.js, Migration 101),
      // diese Route ignorierte das Ergebnis und fragte neu.
      //
      // Das war ein ANZEIGEFEHLER, keine Rechteausweitung: Die Rechte haengen
      // an req.user.role_name (requireRole/requireAdmin/requireOrgAdmin lesen
      // genau das), und der Wert war dort korrekt. Die App richtet ihre
      // Oberflaeche aber nach dieser Antwort -- sie haette der Person in der
      // Zweitgemeinde eine Leitungsansicht gezeigt, deren Knoepfe der Server
      // dann mit 403 abweist.
      //
      // Antwortform unveraendert (ausgelieferte Apps lesen sie): dieselben
      // Felder, dieselben Typen -- nur die Werte stimmen jetzt.
      res.json({
        ...user,
        role_name: req.user.role_name ?? user.role_name,
        role_display_name: req.user.role_display_name ?? user.role_display_name,
        assigned_jahrgaenge: req.user.assigned_jahrgaenge || []
      });

    } catch (err) {
 console.error('Database error in GET /api/auth/me:', err);
      res.status(500).json({ error: 'Fehler beim Laden des Profils' });
    }
  });

  // ===== MULTI-ORG SWITCHER =====

  // GET /api/auth/my-organizations — alle Organisationen, in denen der User
  // Mitglied ist (inkl. Primaer-Org), mit der jeweiligen Rolle. Frontend zeigt
  // den Org-Switcher nur, wenn hier mehr als ein Eintrag zurueckkommt.
  router.get('/my-organizations', rbacVerifier, async (req, res) => {
    try {
      const userId = req.user.id;
      // BEIDE Quellen vereinen: die PRIMAER-Org (users.organization_id, die oft
      // KEINEN user_organizations-Eintrag hat) UND alle Multi-Org-Mappings.
      // Sonst fehlt beim ersten Login die aktive Primaer-Org in der Switcher-Liste
      // -> der Button findet currentOrg nicht und zeigt keinen Namen. Pro Org EIN
      // Eintrag (DISTINCT ON); bei Doppelung gewinnt die Rolle aus dem Mapping
      // nicht zwingend — für die Primaer-Org ist die users.role_id maßgeblich,
      // daher Primaer-Zeile zuerst (is_primary DESC).
      const { rows } = await db.query(`
        SELECT DISTINCT ON (m.id)
               m.id, m.name, m.slug, m.display_name,
               m.role_name, m.role_display_name, m.is_active
        FROM (
          SELECT o.id, o.name, o.slug, o.display_name,
                 r.name as role_name, r.display_name as role_display_name,
                 COALESCE(o.is_active, true) as is_active,
                 true as is_primary
          FROM users u
          JOIN organizations o ON u.organization_id = o.id
          JOIN roles r ON u.role_id = r.id
          WHERE u.id = $1 AND COALESCE(o.is_active, true) = true
          UNION ALL
          SELECT o.id, o.name, o.slug, o.display_name,
                 r.name as role_name, r.display_name as role_display_name,
                 COALESCE(o.is_active, true) as is_active,
                 false as is_primary
          FROM user_organizations uo
          JOIN organizations o ON uo.organization_id = o.id
          JOIN roles r ON uo.role_id = r.id
          WHERE uo.user_id = $1 AND COALESCE(o.is_active, true) = true
        ) m
        ORDER BY m.id, m.is_primary DESC
      `, [userId]);
      // Sekundaer nach Anzeigename sortieren (DISTINCT ON erzwingt Sortierung nach m.id)
      rows.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'de'));
      res.json(rows);
    } catch (err) {
      console.error('Database error in GET /api/auth/my-organizations:', err);
      res.status(500).json({ error: 'Fehler beim Laden der Gemeinden' });
    }
  });

  // POST /api/auth/switch-org — wechselt die aktive Organisation. Prueft die
  // Mitgliedschaft und stellt ein neues Access-Token mit active_organization_id
  // als Claim aus (damit der Kontext den 15min-Refresh ueberlebt). Das Refresh-
  // Token bleibt gueltig; der Client sendet ab jetzt X-Active-Organization mit.
  router.post('/switch-org', rbacVerifier, async (req, res) => {
    const targetOrgId = parseInt(req.body.organization_id);
    if (!Number.isInteger(targetOrgId)) {
      return res.status(400).json({ error: 'organization_id ist erforderlich' });
    }
    try {
      const userId = req.user.id;
      const { rows: [membership] } = await db.query(`
        SELECT o.id, o.name, o.slug, r.name as role_name,
               COALESCE(o.is_active, true) as is_active,
               u.display_name, u.email, u.organization_id as primary_org_id, u.is_super_admin
        FROM users u
        JOIN organizations o ON o.id = $2
        LEFT JOIN user_organizations uo ON uo.user_id = u.id AND uo.organization_id = o.id
        JOIN roles r ON r.id = CASE WHEN u.organization_id = o.id THEN u.role_id ELSE uo.role_id END
        WHERE u.id = $1
          AND (u.organization_id = o.id OR uo.user_id IS NOT NULL)
      `, [userId, targetOrgId]);

      if (!membership) {
        return res.status(403).json({ error: 'Du bist kein Mitglied dieser Gemeinde' });
      }
      if (membership.is_active === false) {
        return res.status(403).json({ error: 'Diese Gemeinde ist derzeit gesperrt' });
      }

      const userType = membership.role_name === 'konfi' ? 'konfi'
        : membership.role_name === 'teamer' ? 'teamer' : 'admin';

      // Bei Wechsel zur Primaer-Org KEINEN active-Claim setzen (Default-Verhalten).
      const isPrimary = targetOrgId === membership.primary_org_id;

      // Ohne Name und E-Mail, siehe TOKEN_INHALT oben.
      const token = jwt.sign({
        id: userId,
        type: userType,
        organization_id: membership.primary_org_id,
        role_name: membership.role_name,
        is_super_admin: membership.is_super_admin || false,
        ...(isPrimary ? {} : { active_organization_id: targetOrgId })
      }, JWT_SECRET, { expiresIn: '15m' });

      res.json({
        token,
        active_organization_id: targetOrgId,
        is_primary: isPrimary,
        organization: { id: membership.id, name: membership.name, slug: membership.slug },
        role_name: membership.role_name,
        type: userType
      });
    } catch (err) {
      console.error('Database error in POST /api/auth/switch-org:', err);
      res.status(500).json({ error: 'Fehler beim Wechsel der Gemeinde' });
    }
  });

  // Request password reset (mit eigenem Rate-Limiter, getrennt vom Login-Limiter)
  router.post('/request-password-reset', passwordResetLimiter, passwordResetEmailLimiter, validateRequestPasswordReset, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-Mail-Adresse ist erforderlich' });
    
    try {
      // Jetzt: nur Konten, mit denen man sich anmelden kann (nicht geloescht,
      // nicht gesperrt -- is_active NULL gilt wie beim Login als aktiv), und
      // JEDES davon bekommt seinen eigenen Link.
      //
      // EINE MAIL JE KONTO, nicht eine Mail mit mehreren Links: Die Vorlage
      // (emailService.sendPasswordResetEmail) traegt genau einen Knopf und
      // spricht die Person mit dem Namen DIESES Kontos an. Je Konto eine Mail
      // laesst Knopf und Anrede, wie sie sind, und kann nicht verwechselt
      // werden -- dazu stehen Gemeinde und Benutzername im Text, die Gemeinde
      // auch im Betreff. Eine Sammelmail braeuchte eine Liste in Text und
      // HTML und liesse offen, welcher Knopf zu welchem Konto gehoert.
      const query = `
        SELECT u.id, u.email, u.username, u.display_name as name, r.name as role_name,
               COALESCE(o.display_name, o.name) AS gemeinde
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN organizations o ON o.id = u.organization_id
        WHERE u.email = $1
          AND u.deleted_at IS NULL
          AND COALESCE(u.is_active, true) = true
        ORDER BY u.id
      `;
      const { rows: konten } = await db.query(query, [email]);

      const mails = [];
      for (const user of konten) {
        const userType = user.role_name === 'konfi' ? 'konfi' : user.role_name === 'teamer' ? 'teamer' : 'admin';
        const token = generateResetToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        // Nur den HASH speichern. Der Klartext-Token lag
        // bisher in der DB — wer sie lesen kann (Backup, Dump, SQL-Injection),
        // konnte damit fremde Passwoerter zuruecksetzen. Refresh-Tokens werden
        // hier laengst gehasht abgelegt; Reset-Tokens ziehen nach.
        await db.query('INSERT INTO password_resets (user_id, user_type, token, expires_at) VALUES ($1, $2, $3, $4)',
          [user.id, userType, hashToken(token), expiresAt]);

        mails.push({
          name: user.name,
          token,
          resetUrl: `https://konfi-quest.de/reset-password?token=${token}`,
          // Gemeinde und Benutzername nur, wenn es etwas zu unterscheiden
          // gibt: Bei einem einzigen Konto bleibt die Mail, wie sie war.
          konto: konten.length > 1 ? { gemeinde: user.gemeinde, benutzername: user.username } : {}
        });
      }

      // Always return a success message to not reveal if an email exists or not
      // -- und nicht, WIE VIELE Konten es gibt: Die Antwort ist fuer null,
      // eins und mehrere Konten Zeichen fuer Zeichen dieselbe.
      res.json({ message: 'Falls ein Konto mit dieser E-Mail-Adresse existiert, wurde eine Reset-E-Mail gesendet' });

      if (mails.length > 0) {
        nachAntwort(req, async () => {
          for (const m of mails) {
            try {
              await emailService.sendPasswordResetEmail(email, m.name, m.token, m.resetUrl, m.konto);
            } catch (emailError) {
              console.error('E-Mail-Versand fehlgeschlagen:', emailError);
            }
          }
        }, 'POST /auth/request-password-reset (Mail)');
      }

    } catch (err) {
 console.error('Database error in POST /api/auth/request-password-reset:', err);
      res.status(500).json({ error: 'Datenbankfehler' });
    }
  });

  // ===== INVITE CODE SYSTEM =====

  // Generate invite code for Konfi registration (org_admin only)
  router.post('/invite-code', rbacVerifier, validateInviteCode, async (req, res) => {
    const { jahrgang_id } = req.body;
    const userId = req.user.id;
    const organizationId = req.user.organization_id;

    // Only org_admin can generate invite codes
    if (req.user.role_name !== 'org_admin' && !req.user.is_super_admin) {
      return res.status(403).json({ error: 'Nur die Gemeindeleitung kann Einladungscodes erstellen' });
    }

    if (!jahrgang_id) {
      return res.status(400).json({ error: 'Jahrgang ist erforderlich' });
    }

    const gueltigkeit = leseEinladungsTage(req.body.gueltig_tage);
    if (!gueltigkeit.ok) {
      return res.status(400).json({ error: 'Ein Einladungscode gilt 7, 14, 30, 60 oder 90 Tage.' });
    }

    try {
      // Verify jahrgang belongs to same organization
      const { rows: [jahrgang] } = await db.query(
        'SELECT id, name FROM jahrgaenge WHERE id = $1 AND organization_id = $2',
        [jahrgang_id, organizationId]
      );

      if (!jahrgang) {
        return res.status(404).json({ error: 'Jahrgang nicht gefunden' });
      }

      // Generate unique invite code (8 characters, uppercase alphanumeric)
      const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      const expiresAt = einladungAblaufBeimAnlegen(gueltigkeit.tage);

      // Store invite code
      await db.query(`
        INSERT INTO invite_codes (code, organization_id, jahrgang_id, created_by, expires_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [inviteCode, organizationId, jahrgang_id, userId, expiresAt]);

      res.json({
        invite_code: inviteCode,
        jahrgang_name: jahrgang.name,
        expires_at: expiresAt,
        gueltig_tage: gueltigkeit.tage
      });

    } catch (err) {
 console.error('Database error in POST /api/auth/invite-code:', err);
      res.status(500).json({ error: 'Fehler beim Erstellen des Einladungscodes' });
    }
  });

  // Get all invite codes for organization (org_admin only)
  router.get('/invite-codes', rbacVerifier, async (req, res) => {
    const organizationId = req.user.organization_id;

    if (req.user.role_name !== 'org_admin') {
      return res.status(403).json({ error: 'Nur die Gemeindeleitung kann Einladungscodes einsehen' });
    }

    try {
      const { rows } = await db.query(`
        SELECT ic.id, ic.code as invite_code, ic.jahrgang_id, j.name as jahrgang_name,
               ic.expires_at, ic.created_at,
               (SELECT COUNT(*) FROM users u
                JOIN konfi_profiles kp ON u.id = kp.user_id
                WHERE kp.invite_code_id = ic.id) as used_count
        FROM invite_codes ic
        JOIN jahrgaenge j ON ic.jahrgang_id = j.id
        WHERE ic.organization_id = $1 AND ic.expires_at > NOW()
        ORDER BY ic.created_at DESC
      `, [organizationId]);

      res.json(rows);

    } catch (err) {
 console.error('Database error in GET /api/auth/invite-codes:', err);
      res.status(500).json({ error: 'Fehler beim Laden der Einladungscodes' });
    }
  });

  // Extend invite code (org_admin only)
  //
  // UM WAEHLBARE TAGE, HOECHSTENS 90 IM VORAUS:
  // tage 7, 14, 30, 60 oder 90, optional -- ohne das Feld wie bisher
  // um 7 Tage (Apps im Store schicken keinen Body). Das neue Ablaufdatum
  // liegt nie mehr als 90 Tage in der Zukunft; was darueber hinausginge,
  // wird gekuerzt (begrenzt: true). Steht der Code schon an der Grenze: 400.
  // Abgelaufene Codes bleiben abgelaufen (400 wie bisher). Antwort additiv
  // um begrenzt erweitert.
  router.post('/invite-codes/:id/extend', rbacVerifier, async (req, res) => {
    const { id } = req.params;
    const organizationId = req.user.organization_id;

    if (req.user.role_name !== 'org_admin') {
      return res.status(403).json({ error: 'Nur die Gemeindeleitung kann Einladungscodes verlängern' });
    }

    const verlaengerung = leseEinladungsTage(req.body ? req.body.tage : undefined);
    if (!verlaengerung.ok) {
      return res.status(400).json({ error: 'Ein Einladungscode lässt sich um 7, 14, 30, 60 oder 90 Tage verlängern.' });
    }

    try {
      const { rows: [invite] } = await db.query(`
        SELECT id, code, jahrgang_id, organization_id, expires_at, created_at FROM invite_codes WHERE id = $1 AND organization_id = $2
      `, [id, organizationId]);

      if (!invite) {
        return res.status(404).json({ error: 'Einladungscode nicht gefunden' });
      }

      // Prüfen ob Code bereits abgelaufen ist
      if (new Date(invite.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Abgelaufene Codes können nicht verlängert werden' });
      }

      const { ablauf: newExpiry, begrenzt, verlaengert } =
        einladungAblaufBeimVerlaengern(new Date(invite.expires_at), verlaengerung.tage);
      if (!verlaengert) {
        return res.status(400).json({
          error: `Der Code gilt schon ${EINLADUNG_HOECHSTENS_TAGE} Tage im Voraus — länger lässt er sich nicht verlängern.`
        });
      }

      await db.query(`
        UPDATE invite_codes SET expires_at = $1 WHERE id = $2 AND organization_id = $3
      `, [newExpiry, id, organizationId]);

      res.json({ message: 'Einladungscode verlängert', expires_at: newExpiry, begrenzt });

    } catch (err) {
 console.error('Database error in POST /api/auth/invite-codes/:id/extend:', err);
      res.status(500).json({ error: 'Fehler beim Verlängern des Einladungscodes' });
    }
  });

  // Delete invite code (org_admin only)
  router.delete('/invite-codes/:id', rbacVerifier, async (req, res) => {
    const organizationId = req.user.organization_id;
    if (req.user.role_name !== 'org_admin') {
      return res.status(403).json({ error: 'Nur die Gemeindeleitung kann Einladungscodes löschen' });
    }
    try {
      const { rowCount } = await db.query(
        'DELETE FROM invite_codes WHERE id = $1 AND organization_id = $2',
        [req.params.id, organizationId]
      );
      if (rowCount === 0) return res.status(404).json({ error: 'Code nicht gefunden' });
      res.json({ message: 'Einladungscode gelöscht' });
    } catch (err) {
      console.error('Error deleting invite code:', err);
      res.status(500).json({ error: 'Fehler beim Löschen des Einladungscodes' });
    }
  });

  // Check username availability (public endpoint). Grenze: namensLimiter
  // oben.
  router.get('/check-username/:username', namensLimiter, async (req, res) => {
    const { username } = req.params;
    const trimmed = username.trim();

    // Validation: mindestens 3 Zeichen, nur Buchstaben/Zahlen/Punkt/Bindestrich.
    if (trimmed.length < 3) {
      return res.status(400).json({ available: false, message: 'Benutzername muss mindestens 3 Zeichen lang sein' });
    }
    if (!/^[a-zA-Z0-9.-]+$/.test(trimmed)) {
      return res.status(400).json({ available: false, message: 'Benutzername darf nur Buchstaben, Zahlen, Punkt (.) und Bindestrich (-) enthalten' });
    }

    try {
      // case-insensitiv prüfen (LOWER), damit "Anna"/"anna" nicht doppelt geht.
      const { rows } = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [trimmed]);

      if (rows.length > 0) {
        // Nur dieser Fall zaehlt fuer den namensLimiter.
        res.locals.benutzernameVergeben = true;
        return res.json({ available: false, message: 'Benutzername bereits vergeben' });
      }

      res.json({ available: true, message: 'Benutzername verfügbar' });

    } catch (err) {
      console.error('Database error in GET /api/auth/check-username:', err);
      res.status(500).json({ error: 'Fehler bei der Prüfung' });
    }
  });

  // Validate invite code (public endpoint)
  router.get('/validate-invite/:code', einladungscodeLimiter, async (req, res) => {
    const { code } = req.params;

    try {
      // Zuerst Code suchen (ohne expires_at/used_at Filter)
      const { rows: [invite] } = await db.query(`
        SELECT ic.*, j.name as jahrgang_name, COALESCE(o.display_name, o.name) as organization_name
        FROM invite_codes ic
        JOIN jahrgaenge j ON ic.jahrgang_id = j.id
        JOIN organizations o ON ic.organization_id = o.id
        WHERE ic.code = $1
      `, [code.toUpperCase()]);

      if (!invite) {
        return res.status(404).json({ error: 'Dieser Einladungscode existiert nicht', error_code: 'not_found' });
      }

      // Prüfen ob abgelaufen
      if (new Date(invite.expires_at) <= new Date()) {
        return res.status(410).json({ error: 'Dieser Einladungscode ist abgelaufen. Bitte frage deinen Konfi-Leiter nach einem neuen Code.', error_code: 'expired' });
      }

      res.json({
        valid: true,
        jahrgang_name: invite.jahrgang_name,
        organization_name: invite.organization_name
      });

    } catch (err) {
      console.error('Database error in GET /api/auth/validate-invite:', err);
      res.status(500).json({ error: 'Fehler bei der Validierung' });
    }
  });

  // Register new Konfi with invite code (public endpoint, rate-limited gegen Brute-Force/Spam)
  router.post('/register-konfi', ...registerMiddleware, validateRegisterKonfi, async (req, res) => {
    const { invite_code, display_name, username, password, email } = req.body;

    if (!invite_code || !display_name || !username || !password) {
      return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Benutzername muss mindestens 3 Zeichen lang sein' });
    }

    // Optional: E-Mail validieren wenn angegeben
    if (email && email.trim()) {
      if (!validator.isEmail(email.trim())) {
        return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
      }
    }

    try {
      // Validate invite code - zuerst Code suchen (ohne expires_at Filter)
      const { rows: [invite] } = await db.query(`
        SELECT ic.*, j.name as jahrgang_name
        FROM invite_codes ic
        JOIN jahrgaenge j ON ic.jahrgang_id = j.id
        WHERE ic.code = $1
      `, [invite_code.toUpperCase()]);

      if (!invite) {
        return res.status(404).json({ error: 'Dieser Einladungscode existiert nicht', error_code: 'not_found' });
      }

      // Prüfen ob abgelaufen
      if (new Date(invite.expires_at) <= new Date()) {
        return res.status(410).json({ error: 'Dieser Einladungscode ist abgelaufen. Bitte frage deinen Konfi-Leiter nach einem neuen Code.', error_code: 'expired' });
      }

      // Check if username already exists (case-insensitiv, damit nicht "Anna" und
      // "anna" parallel existieren können).
      const { rows: existingUsers } = await db.query(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
        [username]
      );

      if (existingUsers.length > 0) {
        return res.status(409).json({ error: 'Benutzername bereits vergeben' });
      }

      // Get konfi role id — org-gescopt: Rollen sind pro Organisation, sonst
      // bekäme ein Konfi die konfi-Rolle einer FREMDEN Organisation zugewiesen.
      const { rows: [konfiRole] } = await db.query(
        "SELECT id FROM roles WHERE name = 'konfi' AND organization_id = $1",
        [invite.organization_id]
      );
      if (!konfiRole) {
        return res.status(500).json({ error: 'Konfi-Rolle nicht gefunden' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user in transaction
      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        if (await benutzernameSperrenUndPruefen(client, username)) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Benutzername bereits vergeben' });
        }

        // Konfi-Limit-Prüfung (Weg 2, D-08b): NUR Hard-Block ablehnen. Grace und
        // under_limit laufen unverändert durch — der sich selbst anmeldende Konfi
        // kann keinen "Trotzdem anlegen"-Dialog der Leitung bestaetigen (kein 409,
        // kein confirm). max_konfis NULL -> under_limit -> kein Block.
        const { stufe } = await checkKonfiLimit(client, invite.organization_id);
        if (stufe === 'hard_block') {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Die Anzahl der Konfis ist erreicht. Bitte wende dich an deine Leitung — ein Tarif-Upgrade ist nötig.',
            error_code: 'limit_exceeded'
          });
        }

        // Create user (mit optionaler E-Mail)
        const { rows: [newUser] } = await client.query(`
          INSERT INTO users (username, display_name, password_hash, role_id, organization_id, email)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [username, display_name, passwordHash, konfiRole.id, invite.organization_id, email?.trim() || null]);

        // Create konfi profile mit invite_code_id und organization_id
        await client.query(`
          INSERT INTO konfi_profiles (user_id, jahrgang_id, gottesdienst_points, gemeinde_points, invite_code_id, organization_id)
          VALUES ($1, $2, 0, 0, $3, $4)
        `, [newUser.id, invite.jahrgang_id, invite.id, invite.organization_id]);

        // Ein vorher durchprobierter Name startet frei (utils/kontoSperre.js).
        await kontoSperreAufheben(client, newUser.id);

        await client.query('COMMIT');

        try {
          const empfaenger = await ladeLeitungZumJahrgang(db, invite.organization_id, invite.jahrgang_id);
          await PushService.sendNewKonfiRegistrationToLeadership(
            db,
            invite.organization_id,
            empfaenger,
            invite.jahrgang_id,
            display_name,
            invite.jahrgang_name,
            newUser.id
          );
        } catch (pushErr) {
          console.error('Push for new registration failed:', pushErr);
        }

        // Auto-Enrollment für zukünftige Pflicht-Events
        try {
          const enrollFutureEventsQuery = `
            INSERT INTO event_bookings (event_id, user_id, status, booking_date, organization_id)
            SELECT e.id, $1, 'confirmed', NOW(), $2
            FROM events e
            JOIN event_jahrgang_assignments eja ON e.id = eja.event_id
            WHERE eja.jahrgang_id = $3
              AND e.mandatory = true
              AND e.event_date > NOW()
              AND e.organization_id = $2
              AND e.cancelled IS NOT TRUE
            ON CONFLICT (user_id, event_id) DO NOTHING
          `;
          await db.query(enrollFutureEventsQuery, [newUser.id, invite.organization_id, invite.jahrgang_id]);
        } catch (enrollErr) {
          console.error('Auto-enrollment für Pflicht-Events fehlgeschlagen:', enrollErr);
        }

        // Auto-Login: JWT Token generieren
        // Ohne Name und E-Mail, siehe TOKEN_INHALT oben.
        const token = jwt.sign({
          id: newUser.id,
          type: 'konfi',
          organization_id: invite.organization_id,
          role_name: 'konfi',
          is_super_admin: false
        }, JWT_SECRET, { expiresIn: '15m' });

        // Refresh-Token erstellen und in DB speichern
        const refreshToken = generateRefreshToken();
        const refreshTokenHash = hashToken(refreshToken);
        const refreshExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 Tage
        // An das Geraet gebunden, wenn die App ihre Kennung mitschickt.
        const registrierGeraet = geraeteKennung(req);
        const { rows: [neuesToken] } = await db.query(
          'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device_id) VALUES ($1, $2, $3, $4) RETURNING id',
          [newUser.id, refreshTokenHash, refreshExpiresAt, registrierGeraet]
        );
        await grenzeDurchsetzen(db, newUser.id, neuesToken.id, registrierGeraet);

        res.json({
          message: 'Registrierung erfolgreich',
          token,
          refresh_token: refreshToken,
          user: {
            id: newUser.id,
            display_name: display_name,
            username: username,
            type: 'konfi',
            jahrgang: invite.jahrgang_name,
            role_name: 'konfi'
          }
        });

        // Live-Update NACH der Response: selbstregistrierter Konfi taucht in der
        // Admin-Konfi-Liste auf. Die Org-ID stammt hier aus dem Invite-Code
        // (kein req.user — dieser Endpunkt ist unauthentifiziert).
        liveUpdate.sendToOrgAdmins(invite.organization_id, 'konfis', 'create', { konfiId: newUser.id });

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

    } catch (err) {
      if (err.code === '23505') { // unique constraint
        return res.status(409).json({ error: 'Benutzername bereits vergeben' });
      }
      console.error('Database error in POST /api/auth/register-konfi:', err);
      res.status(500).json({ error: 'Fehler bei der Registrierung' });
    }
  });

  // Reset password with token
  router.post('/reset-password', resetTokenLimiter, validateResetPassword, async (req, res) => {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) return res.status(400).json({ error: 'Token und neues Passwort sind erforderlich' });
    const newPasswordError = validatePassword(newPassword);
    if (newPasswordError) return res.status(400).json({ error: newPasswordError });
    
    try {
      // Ausschliesslich gegen den HASH vergleichen. Ein zusaetzlicher
      // Klartext-Zweig (token IN (hash, klartext)) wäre naheliegend für die
      // Uebergangszeit, hebt den Schutz aber auf: Der gespeicherte Hash ist
      // selbst ein gueltiger Klartext-Wert und wuerde damit als Token
      // funktionieren — wer die DB lesen kann, könnte ihn direkt einsetzen.
      // Genau das hat der Test aufgedeckt. Alt-Eintraege aus der Zeit vor der
      // Umstellung werden stattdessen bei der Migration gehasht.
      const { rows: [resetRecord] } = await db.query(
        `SELECT id, user_id, token, expires_at, used_at, created_at
         FROM password_resets
         WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [hashToken(token)]
      );

      if (!resetRecord) {
        // Nur dieser Fall zaehlt fuer den resetTokenLimiter.
        res.locals.resetTokenUngueltig = true;
        return res.status(400).json({ error: 'Ungültiger oder abgelaufener Reset-Token' });
      }
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Wie bei change-password alle bestehenden Sitzungen beenden (LÜCKE N2).
      // Hier wiegt es schwerer: Ein Reset erfolgt typischerweise, WEIL der
      // Zugang nicht mehr sicher ist. Hier wird KEIN neues Token ausgestellt —
      // nach einem Reset meldet man sich regulaer neu an.
      await db.query(
        `UPDATE users SET password_hash = $1, token_invalidated_at = NOW() WHERE id = $2`,
        [hashedPassword, resetRecord.user_id]
      );
      // Neues Passwort: eine Sperre nach Fehlversuchen endet damit.
      await kontoSperreAufheben(db, resetRecord.user_id);
      await db.query(
        'UPDATE refresh_tokens SET revoked_at = NOW(), expires_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [resetRecord.user_id]
      );
      // Beim Reset ueberlebt KEINE Sitzung — also darf auch kein Geraet mehr
      // Push-Nachrichten bekommen. Alle Push-Tokens des Users fallen (der
      // Versand haengt nur an user_id, nicht an einer gueltigen Sitzung);
      // jedes Geraet registriert sich beim naechsten Login neu.
      await db.query('DELETE FROM push_tokens WHERE user_id = $1', [resetRecord.user_id]);
      await db.query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [resetRecord.id]);
      invalidateUserCache(resetRecord.user_id);

      res.json({ message: 'Passwort erfolgreich zurückgesetzt' });

      // Bestaetigung an die hinterlegte Adresse, wie beim
      // Selbst-Aendern.
      nachAntwort(req, () => meldePasswortGeaendert(db, resetRecord.user_id), 'POST /auth/reset-password (Mail)');

    } catch (err) {
 console.error('Database error in POST /api/auth/reset-password:', err);
      res.status(500).json({ error: 'Fehler beim Zurücksetzen des Passworts' });
    }
  });

  // ===== TOKEN REFRESH =====

  // Refresh Access-Token mit Rotation (altes Refresh-Token wird ungültig)
  router.post('/refresh', refreshLimiter, async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh-Token ist erforderlich' });
    }

    // Aktive Multi-Org aus Header durchreichen, damit der Org-Kontext erhalten bleibt.
    const headerOrg = parseInt(req.headers['x-active-organization']);
    const activeOrgId = Number.isInteger(headerOrg) ? headerOrg : null;

    const tokenHash = hashToken(refresh_token);

    // GERAETEBINDUNG.
    // Traegt das Token eine Kennung, gilt es nur zusammen mit
    // DERSELBEN Kennung. Eine andere -- oder gar keine -- heisst: Das Token
    // wird woanders eingeloest als dort, wo es ausgestellt wurde. Antwort 401
    // wie bei jedem ungueltigen Token, und DIESES Token wird widerrufen und
    // sofort ablaufen gelassen (sonst fiele es in die Gnadenfrist und liesse
    // sich mit einer geratenen Kennung noch einmal versuchen).
    //
    // Bewusst NUR dieses Token, nicht die ganze Familie wie bei der dritten
    // Verwendung in der Gnadenfrist: Dort haben zwei Parteien nachweislich
    // ein GUELTIGES Token benutzt. Hier ist der Versuch gescheitert; und eine
    // Kennung, die sich auf dem echten Geraet aendert (etwa wenn das Geraet
    // die Kennung beim ersten Start nicht liefern konnte), soll die Person
    // nicht auf allen anderen Geraeten mit abmelden.
    //
    // "Keine Kennung" zaehlt wie "andere": Sonst liesse sich die Bindung durch
    // Weglassen umgehen. Ausgelieferte Apps (2.2.x, 2.3.0) sperrt das nicht
    // aus -- sie senden bei Anmeldung, Registrierung und Refresh nie eine
    // Kennung und halten deshalb nur ungebundene Tokens. Der Passwortwechsel
    // bindet nicht (erstelleTokenPaarFuerUser), obwohl dort auch alte Apps eine
    // device_id schicken.
    //
    // Ungebundene Tokens gelten wie bisher. Schickt die Anfrage eine Kennung
    // mit (die App nach dem Update), ist das NEUE Token an sie gebunden -- so
    // sind auch Sitzungen von vor dem Update nach dem ersten Refresh geschuetzt.
    const kennung = geraeteKennung(req);
    const fremdesGeraet = (gebundenAn) => Boolean(gebundenAn) && gebundenAn !== kennung;
    const ablehnenUndWiderrufen = async (tokenId, userId) => {
      await db.query(
        `UPDATE refresh_tokens
            SET revoked_at = COALESCE(revoked_at, NOW()), expires_at = NOW()
          WHERE id = $1`,
        [tokenId]
      );
      console.warn(`Refresh-Token von User ${userId} mit ${kennung ? 'fremder' : 'fehlender'} Geraete-Kennung vorgelegt: Token widerrufen`);
      return res.status(401).json({ error: 'Ungültiger oder abgelaufener Refresh-Token' });
    };

    try {
      // Altes Token suchen (nicht revoked, nicht abgelaufen)
      const { rows: [existing] } = await db.query(
        'SELECT id, user_id, expires_at, device_id FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()',
        [tokenHash]
      );

      if (!existing) {
        // GRACE-WINDOW gegen Rotation-Race: Bei vielen parallelen Requests (Dashboard
        // laedt viele Endpoints) + langsamem Netz kann ein zweiter Request mit dem
        // GERADE rotierten Token ankommen. Statt den User rauszuwerfen, akzeptieren
        // wir ein Token, das kuerzlich revoked wurde (es war nachweislich gueltig)
        // und stellen ein frisches Paar aus.
        // 5 MINUTEN (vorher 30s): Der kritische Fall ist NICHT der parallele Burst,
        // sondern der Client, der rotiert, den neuen Refresh-Token aber wegen eines
        // Android-Process-Kills nicht mehr persistieren konnte und erst beim NAECHSTEN
        // App-Oeffnen wieder mit dem alten Token ankommt. 30s deckten das nicht ab
        // (Ursache des Android-Session-/Push-/Chat-Totalausfalls ab 1.5.0). Aelter
        // als 5 Min -> echtes 401.
        //
        // GENAU EINMAL: "einmalig" stand hier
        // schon immer im Kommentar, der Code liess das alte Token aber fuenf Minuten
        // lang beliebig oft gelten -- dreimal derselbe Token: 200, 200, 200 und drei
        // offene 90-Tage-Tokens. Damit fehlte, was Rotation leisten soll: die
        // Erkennung einer Wiederverwendung (Diebstahl) und der Widerruf. Jetzt:
        //  1. Die Gnadenfrist gilt einmal (gnade_genutzt_at). Dabei wird der
        //     Nachfolger aus der ersten Rotation (ersetzt_durch) widerrufen UND
        //     sofort ablaufen gelassen, damit er nicht selbst in die Gnadenfrist
        //     faellt -- je Geraet bleibt genau EIN Token offen. Der Client, der den
        //     Nachfolger verloren hat, arbeitet mit dem neuen weiter; der, der ihn
        //     noch haette, waere der Angreifer.
        //  2. Kommt das Token ein drittes Mal, hat es zwei Parteien benutzt: 401,
        //     und ALLE Refresh-Tokens des Kontos werden widerrufen. Die Person
        //     meldet sich neu an, der Angreifer nicht.
        //  3. Nach Ablauf des Fensters bleibt es ein schlichtes 401 ohne Widerruf:
        //     Ein Geraet, das nach einem Prozess-Kill erst Stunden spaeter mit dem
        //     alten Token kommt, ist genau der Fall von oben -- es darf die uebrigen
        //     Geraete nicht aussperren.
        // Ein Token, das per Logout widerrufen wurde, traegt expires_at = NOW() und
        // faellt weder in die Gnadenfrist noch unter das Diebstahl-Signal.
        //
        // Der parallele Burst (mehrere Anfragen mit demselben Token in derselben
        // Sekunde) lesen gnade_genutzt_at moeglicherweise alle als NULL und gehen
        // alle den Gnadenpfad -- dann bleiben kurz mehrere Tokens offen, aber
        // niemand wird ausgesperrt. Bewusst so: Die App verhindert parallele
        // Refreshes ohnehin (isRefreshing in services/api.ts); ein falscher Alarm
        // waere hier teurer als ein zweites Token fuer fuenf Minuten.
        const { rows: [alt] } = await db.query(
          `SELECT id, user_id, ersetzt_durch, gnade_genutzt_at, device_id,
                  (revoked_at > NOW() - INTERVAL '5 minutes' AND expires_at > NOW()) AS im_fenster
             FROM refresh_tokens
            WHERE token_hash = $1 AND revoked_at IS NOT NULL`,
          [tokenHash]
        );
        if (!alt) {
          return res.status(401).json({ error: 'Ungültiger oder abgelaufener Refresh-Token' });
        }
        // Geraetebindung VOR der Gnadenfrist: Ein Versuch von fremder Stelle
        // verbraucht weder die Gnade noch loest er den Widerruf der Familie
        // aus -- er beendet nur die Gnadenfrist dieses Tokens. Der Nachfolger
        // des echten Geraets bleibt gueltig.
        if (fremdesGeraet(alt.device_id)) {
          return await ablehnenUndWiderrufen(alt.id, alt.user_id);
        }
        if (alt.gnade_genutzt_at) {
          await db.query(
            `UPDATE refresh_tokens
                SET revoked_at = COALESCE(revoked_at, NOW()), expires_at = NOW()
              WHERE user_id = $1 AND expires_at > NOW()`,
            [alt.user_id]
          );
          console.warn(`Refresh-Token-Wiederverwendung erkannt: alle Refresh-Tokens von User ${alt.user_id} widerrufen`);
          return res.status(401).json({ error: 'Ungültiger oder abgelaufener Refresh-Token' });
        }
        if (!alt.im_fenster) {
          return res.status(401).json({ error: 'Ungültiger oder abgelaufener Refresh-Token' });
        }
        await db.query('UPDATE refresh_tokens SET gnade_genutzt_at = NOW() WHERE id = $1', [alt.id]);
        if (alt.ersetzt_durch) {
          await db.query(
            `UPDATE refresh_tokens
                SET revoked_at = COALESCE(revoked_at, NOW()), expires_at = NOW()
              WHERE id = $1`,
            [alt.ersetzt_durch]
          );
        }
        return await issueRefreshedTokens(db, res, alt.user_id, activeOrgId, alt.id, alt.device_id || kennung);
      }

      if (fremdesGeraet(existing.device_id)) {
        return await ablehnenUndWiderrufen(existing.id, existing.user_id);
      }

      // Altes Token sofort revoken (Rotation)
      await db.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [existing.id]);

      // Die Rotation uebernimmt die Bindung; ein ungebundenes Token wird an
      // die mitgeschickte Kennung gebunden (siehe oben).
      return await issueRefreshedTokens(db, res, existing.user_id, activeOrgId, existing.id, existing.device_id || kennung);
    } catch (err) {
      console.error('Database error in POST /api/auth/refresh:', err);
      res.status(500).json({ error: 'Fehler beim Token-Refresh' });
    }
  });

  // Helper: laedt User (inkl. Org-Status), prüft die Zugriffs-Sperre und stellt
  // ein neues Token-Paar aus. Genutzt vom normalen Refresh UND vom Grace-Window.
  // activeOrgId (optional): aktive Multi-Org, kommt beim Refresh aus dem Header
  // X-Active-Organization. Sie wird (nach Mitgliedschafts-Prüfung) als Claim ins
  // neue Access-Token geschrieben, damit der Org-Kontext den Refresh ueberlebt.
  // vorgaengerId (optional): das Refresh-Token, an dessen Stelle das neue tritt.
  // Es bekommt ersetzt_durch gesetzt, damit die Gnadenfrist den Nachfolger
  // widerrufen kann (Migration 166).
  // geraet (optional): Geraete-Kennung, an die das neue Token gebunden wird
  // (Migration 171) -- die des Vorgaengers oder, war der ungebunden, die
  // mitgeschickte.
  async function issueRefreshedTokens(db, res, userId, activeOrgId = null, vorgaengerId = null, geraet = null) {
    const { rows: [user] } = await db.query(`
      SELECT u.id, u.username, u.display_name, u.organization_id, u.email, u.role_id,
             u.is_super_admin, u.is_active as user_active, u.deleted_at,
             COALESCE(o.is_active, true) as organization_active, o.trial_ends_at,
             r.name as role_name,
             kp.jahrgang_id, j.name as jahrgang_name,
             kp.gottesdienst_points, kp.gemeinde_points
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN konfi_profiles kp ON u.id = kp.user_id
      LEFT JOIN jahrgaenge j ON kp.jahrgang_id = j.id
      WHERE u.id = $1
    `, [userId]);

    if (!user) {
      return res.status(401).json({ error: 'Benutzer nicht gefunden' });
    }

    // Zugriffs-Sperre beim Refresh — super_admin ausgenommen.
    //
    // Soft-geloeschte Konten (deleted_at) zaehlen hier wie deaktivierte und
    // bekommen dieselbe Antwort -- der
    // Refresh war neben Login und rbac.js die dritte Stelle, die deleted_at
    // nicht kannte und einem ausgeblendeten Konto 90 Tage lang frische
    // Access-Tokens ausstellte. Die Loeschung gilt fuer jede Rolle.
    const isSuperAdmin = user.is_super_admin === true || user.role_name === 'super_admin';
    const kontoGesperrt = Boolean(user.deleted_at) || (!isSuperAdmin && user.user_active === false);
    const trialExpired = !isSuperAdmin && user.trial_ends_at && new Date(user.trial_ends_at) < new Date();
    const orgGesperrt = !isSuperAdmin && (user.organization_active === false || trialExpired);
    // Reihenfolge wie bei der Anmeldung: erst das Konto, dann die Gemeinde.
    if (kontoGesperrt) {
      return sperrAntwort(res, 'user_inactive');
    }
    if (orgGesperrt) {
      return sperrAntwort(res, trialExpired ? 'org_trial_expired' : 'org_inactive');
    }

    // Aktive Org nur uebernehmen, wenn sie von der Primaer-Org abweicht UND der
    // User dort Mitglied ist. Sonst (auch bei ungueltiger Org) Primaer-Org.
    let activeOrgClaim = null;
    if (activeOrgId && Number.isInteger(activeOrgId) && activeOrgId !== user.organization_id) {
      const { rows: [m] } = await db.query(
        'SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id = $2',
        [userId, activeOrgId]
      );
      if (m) activeOrgClaim = activeOrgId;
    }

    const userType = user.role_name === 'konfi' ? 'konfi' : user.role_name === 'teamer' ? 'teamer' : 'admin';

    // Ohne Name und E-Mail, siehe TOKEN_INHALT oben.
    const newAccessToken = jwt.sign({
      id: user.id,
      type: userType,
      organization_id: user.organization_id,
      role_name: user.role_name,
      is_super_admin: user.is_super_admin || false,
      ...(activeOrgClaim ? { active_organization_id: activeOrgClaim } : {})
    }, JWT_SECRET, { expiresIn: '15m' });

    const newRefreshToken = generateRefreshToken();
    const newRefreshHash = hashToken(newRefreshToken);
    const newRefreshExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const { rows: [neu] } = await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [user.id, newRefreshHash, newRefreshExpiry, geraet]
    );
    if (vorgaengerId) {
      await db.query('UPDATE refresh_tokens SET ersetzt_durch = $1 WHERE id = $2', [neu.id, vorgaengerId]);
    }
    // Das rotierte Token ist schon widerrufen und zaehlt nicht mit; die
    // Gnadenfrist (oben) bleibt davon unberuehrt.
    await grenzeDurchsetzen(db, user.id, neu.id, geraet);

    return res.json({ token: newAccessToken, refresh_token: newRefreshToken });
  }

  // POST /api/auth/logout — Revokiert das aktive Refresh Token und entfernt
  // den Push-Token dieses Geraets.
  router.post('/logout', rbacVerifier, async (req, res) => {
    const { refresh_token, device_id, platform } = req.body;

    // Push-Token dieses Geraets löschen.
    //
    // Der Client ruft dafuer zwar schon DELETE /notifications/device-token,
    // aber best-effort: mit 4s-Timeout, nur wenn networkMonitor online meldet
    // und nur wenn die Geraete-ID ermittelbar war. Schlaegt einer dieser
    // Punkte fehl, bleibt der Token registriert und das Geraet bekommt
    // weiter Push-Nachrichten für das abgemeldete Konto — bis zum nächsten
    // Login auf demselben Geraet, der ihn umhaengt. Genau das wurde von einer
    // Teamer:in auf iOS berichtet.
    //
    // Hier läuft es in DERSELBEN Anfrage, die ohnehin gesendet wird. Kein
    // Zusatz-Roundtrip, und ein Fehler darf den Logout nie aufhalten.
    if (device_id && platform) {
      try {
        await db.query(
          'DELETE FROM push_tokens WHERE user_id = $1 AND device_id = $2 AND platform = $3',
          [req.user.id, device_id, platform]
        );
      } catch (err) {
        console.error('Push-Token-Cleanup beim Logout fehlgeschlagen:', err.message);
      }
    }

    // Best-effort: Logout geht immer durch, auch ohne Token
    if (!refresh_token) {
      return res.json({ message: 'Logout erfolgreich' });
    }

    try {
      const hash = hashToken(refresh_token);
      // Beim Logout zusaetzlich expires_at auf jetzt setzen, damit das Token NICHT
      // ins Refresh-Grace-Window fällt (das verlangt expires_at > NOW()). Sonst
      // könnte ein gerade ausgeloggter User binnen 30s noch ein Token bekommen.
      await db.query(
        'UPDATE refresh_tokens SET revoked_at = NOW(), expires_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
        [hash]
      );
      res.json({ message: 'Logout erfolgreich' });
    } catch (err) {
      console.error('Fehler beim Revoke des Refresh Tokens:', err);
      // Best-effort: Fehler nicht an Client weitergeben, Logout trotzdem bestätigen
      res.json({ message: 'Logout erfolgreich' });
    }
  });


  return router;
};