/**
 * E-Mail Service für Konfi Quest
 * Verwendet Nodemailer für den Versand von E-Mails
 */

const nodemailer = require('nodemailer');

// Gecachter Transporter (wird einmalig erstellt und wiederverwendet)
let cachedTransporter = null;

// SMTP-Credentials prüfen
const validateSmtpConfig = () => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('SMTP-Credentials nicht konfiguriert (SMTP_USER, SMTP_PASS)');
    return false;
  }
  return true;
};

// SMTP Transporter erstellen oder aus Cache holen
const getTransporter = () => {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  if (!validateSmtpConfig()) {
    throw new Error('SMTP-Credentials nicht konfiguriert. SMTP_USER und SMTP_PASS müssen als Umgebungsvariablen gesetzt sein.');
  }

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE !== 'false', // Default: true (Port 465 mit TLS)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  return cachedTransporter;
};

/**
 * Sendet eine E-Mail
 * @param {Object} options - E-Mail-Optionen
 * @param {string} options.to - Empfänger
 * @param {string} options.subject - Betreff
 * @param {string} options.text - Klartext-Inhalt
 * @param {string} options.html - HTML-Inhalt (optional)
 */
const sendEmail = async ({ to, subject, text, html }) => {
  const transporter = getTransporter();

  const smtpFrom = process.env.SMTP_FROM || `Konfi Quest <${process.env.SMTP_USER || 'noreply@konfi-quest.de'}>`;

  const mailOptions = {
    from: smtpFrom,
    to,
    subject,
    text,
    html: html || text
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`Fehler beim Senden der E-Mail an ${to}:`, error);
    // Transporter-Cache invalidieren bei Verbindungsfehler
    if (error.code === 'ECONNECTION' || error.code === 'EAUTH' || error.code === 'ESOCKET') {
      cachedTransporter = null;
    }
    throw error;
  }
};

// ====================================================================
// GEMEINSAMES MAIL-LAYOUT (Header + Footer) — eine Quelle für alle Templates
// ====================================================================

const WEBSITE_URL = 'https://konfi-quest.de';
const DATENSCHUTZ_URL = 'https://konfi-quest.de/datenschutz.html';
const LOGO_URL = 'https://konfi-quest.de/assets/icon/icon-192x192.png';
const SLOGAN = 'Die App für eine moderne Konfi-Zeit';

const BASE_STYLES = `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
    .header img { width: 56px; height: 56px; border-radius: 12px; margin-bottom: 10px; }
    .header h1 { margin: 0; font-size: 24px; }
    .header .slogan { margin: 6px 0 0; font-size: 14px; opacity: 0.9; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
    .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
    .button:hover { opacity: 0.9; }
    .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin-top: 20px; font-size: 14px; }
    .success { background: #d1fae5; border: 1px solid #10b981; border-radius: 8px; padding: 16px; text-align: center; }
    .success-icon { font-size: 48px; }
    .date { font-size: 20px; font-weight: 700; color: #667eea; text-align: center; margin: 16px 0; }
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 24px; line-height: 1.8; }
    .footer a { color: #667eea; text-decoration: none; }
`;

// headerGradient: optionaler eigener Verlauf (z.B. gruen für Bestaetigungen)
const renderHeader = (headerGradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)') => `
    <div class="header" style="background: ${headerGradient};">
      <img src="${LOGO_URL}" alt="Konfi Quest" />
      <h1>Konfi Quest</h1>
      <p class="slogan">${SLOGAN}</p>
    </div>
`;

const renderFooter = () => `
    <div class="footer">
      <p>Konfi Quest - ${SLOGAN}</p>
      <p>
        <a href="${WEBSITE_URL}">konfi-quest.de</a>
        &nbsp;&middot;&nbsp;
        <a href="${DATENSCHUTZ_URL}">Datenschutz</a>
      </p>
    </div>
`;

// Komplettes HTML-Geruest um einen Inhalts-Block (content-Bereich)
const wrapHtml = (contentHtml, { headerGradient } = {}) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="container">
    ${renderHeader(headerGradient)}
    <div class="content">
      ${contentHtml}
    </div>
    ${renderFooter()}
  </div>
</body>
</html>
`.trim();

/**
 * Sendet eine Passwort-Reset E-Mail
 * @param {string} email - E-Mail-Adresse des Empfängers
 * @param {string} name - Name des Benutzers
 * @param {string} resetToken - Reset-Token
 * @param {string} resetUrl - Vollständige Reset-URL
 */
const sendPasswordResetEmail = async (email, name, resetToken, resetUrl) => {
  const subject = 'Passwort zurücksetzen - Konfi Quest';

  const text = `
Hallo ${name},

du hast angefordert, dein Passwort für Konfi Quest zurückzusetzen.

Klicke auf folgenden Link, um ein neues Passwort zu setzen:
${resetUrl}

Dieser Link ist 1 Stunde gültig.

Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.

Viele Grüße,
Dein Konfi Quest Team
  `.trim();

  const html = wrapHtml(`
      <h2>Hallo ${name}!</h2>
      <p>Du hast angefordert, dein Passwort für Konfi Quest zurückzusetzen.</p>
      <p>Klicke auf den Button unten, um ein neues Passwort zu setzen:</p>
      <p style="text-align: center;">
        <a href="${resetUrl}" class="button">Neues Passwort setzen</a>
      </p>
      <div class="warning">
        <strong>Hinweis:</strong> Dieser Link ist nur 1 Stunde gültig. Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.
      </div>
  `);

  return sendEmail({ to: email, subject, text, html });
};

/**
 * Sendet eine Bestätigung nach erfolgreicher Passwortänderung
 * @param {string} email - E-Mail-Adresse des Empfängers
 * @param {string} name - Name des Benutzers
 */
const sendPasswordChangedEmail = async (email, name) => {
  const subject = 'Passwort geändert - Konfi Quest';

  const text = `
Hallo ${name},

dein Passwort für Konfi Quest wurde erfolgreich geändert.

Falls du diese Änderung nicht vorgenommen hast, kontaktiere bitte sofort deinen Administrator.

Viele Grüße,
Dein Konfi Quest Team
  `.trim();

  const html = wrapHtml(`
      <div class="success">
        <div class="success-icon">&#10003;</div>
        <h2>Passwort geändert!</h2>
      </div>
      <p style="margin-top: 20px;">Hallo ${name},</p>
      <p>dein Passwort für Konfi Quest wurde erfolgreich geändert.</p>
      <p style="color: #666; font-size: 14px;">Falls du diese Änderung nicht vorgenommen hast, kontaktiere bitte sofort deinen Administrator.</p>
  `, { headerGradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' });

  return sendEmail({ to: email, subject, text, html });
};

/**
 * Erinnert eine Org-Admin:in daran, dass die Lizenz (kein Trial) bald ablaeuft.
 * @param {string} email - E-Mail der Admin:in
 * @param {string} name - Anzeigename der Admin:in
 * @param {string} orgName - Anzeigename der Organisation
 * @param {Date}   endDate - Ablaufdatum (trial_ends_at)
 * @param {number} daysLeft - verbleibende Tage
 */
const sendLicenseExpiryReminderEmail = async (email, name, orgName, endDate, daysLeft) => {
  const dateStr = new Date(endDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const subject = `Lizenz läuft in ${daysLeft} Tagen ab - Konfi Quest`;

  const text = `
Hallo ${name},

die Lizenz für eure Organisation "${orgName}" bei Konfi Quest läuft am ${dateStr} ab (noch ${daysLeft} Tag${daysLeft === 1 ? '' : 'e'}).

Nach Ablauf wird der Zugang für eure Organisation automatisch gesperrt, bis die Lizenz verlängert wird.

Bitte wende dich rechtzeitig an uns, um die Lizenz zu verlängern.

Viele Grüße,
Dein Konfi Quest Team
  `.trim();

  const html = wrapHtml(`
      <h2>Hallo ${name}!</h2>
      <p>die Lizenz für eure Organisation <strong>${orgName}</strong> läuft bald ab:</p>
      <div class="date">${dateStr} &middot; noch ${daysLeft} Tag${daysLeft === 1 ? '' : 'e'}</div>
      <div class="warning">
        <strong>Hinweis:</strong> Nach Ablauf wird der Zugang für eure Organisation automatisch gesperrt, bis die Lizenz verlängert wird. Bitte wende dich rechtzeitig an uns, um die Lizenz zu verlängern.
      </div>
  `);

  return sendEmail({ to: email, subject, text, html });
};

/**
 * "Letzte Chance"-Warnung an Admins, bevor ein Jahrgang automatisch gelöscht
 * wird. Bewusst "gelöscht" (NICHT "archiviert") -- das interne Backup/Archiv
 * wird nach aussen nicht kommuniziert. Mit Hinweis aufs Befoerdern.
 */
const sendJahrgangDeletionWarningEmail = async (email, name, orgName, jahrgangName, daysLeft) => {
  const subject = `Jahrgang "${jahrgangName}" wird in ${daysLeft} Tagen gelöscht - Konfi Quest`;

  const text = `
Hallo ${name},

der Jahrgang "${jahrgangName}" in eurer Organisation "${orgName}" wird in ${daysLeft} Tag${daysLeft === 1 ? '' : 'en'} automatisch gelöscht.

Das ist die letzte Gelegenheit, Konfis dieses Jahrgangs noch zu Teamer:innen zu befördern. Beförderte Teamer:innen behalten ihre Punkte und Abzeichen und bleiben euch erhalten - alle anderen Konfis dieses Jahrgangs werden mit der Löschung entfernt.

Wenn ihr nichts unternehmt, geschieht die Löschung automatisch.

Viele Grüße,
Dein Konfi Quest Team
  `.trim();

  const html = wrapHtml(`
      <h2>Hallo ${name}!</h2>
      <p>der Jahrgang <strong>${jahrgangName}</strong> in eurer Organisation <strong>${orgName}</strong> wird bald gelöscht:</p>
      <div class="date">Löschung in ${daysLeft} Tag${daysLeft === 1 ? '' : 'en'}</div>
      <div class="warning">
        <strong>Letzte Chance:</strong> Befördert jetzt noch Konfis dieses Jahrgangs zu Teamer:innen, wenn sie euch erhalten bleiben sollen. Beförderte Teamer:innen behalten ihre Punkte und Abzeichen. Alle anderen Konfis dieses Jahrgangs werden mit der Löschung entfernt. Geschieht nichts, wird der Jahrgang automatisch gelöscht.
      </div>
  `);

  return sendEmail({ to: email, subject, text, html });
};

// HTML-Escaping für Nutzereingaben (Konfi-Namen, Freitext-Sprueche) im Mail-HTML.
const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Formatiert ein Datum (oder null) als deutsches Datum bzw. einen Platzhalter.
const formatKonfirmationDate = (value) => {
  if (!value) return 'noch kein Termin';
  // Datum UND Uhrzeit (falls zwei Konfirmationen am selben Tag -> Uhrzeit unterscheidet sie).
  const d = new Date(value);
  const datum = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const zeit = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  return `${datum}, ${zeit} Uhr`;
};

// Baut die Textdarstellung eines gewaehlten Konfispruchs (oder Platzhalter).
const formatSpruchText = (konfspruch) => {
  if (!konfspruch) return 'noch keiner';
  if (konfspruch.source === 'liste') {
    const text = konfspruch.text && konfspruch.text.trim().length > 0 ? konfspruch.text : '';
    return text ? `${konfspruch.reference} - ${text}` : konfspruch.reference;
  }
  // Freitext: Text + Referenz
  return konfspruch.reference ? `${konfspruch.text} (${konfspruch.reference})` : konfspruch.text;
};

const sendKonfiMatrixEmail = async (email, adminName, jahrgangName, type, rows = []) => {
  const isSprueche = type === 'sprueche';
  const titel = isSprueche ? 'Konfisprüche' : 'Anwesenheit';
  // CR/LF aus dem Subject entfernen (Header-Injection-Schutz): jahrgangName ist
  // admin-kontrolliert, darf den SMTP-Header aber nicht aufbrechen können.
  const safeJahrgangName = String(jahrgangName).replace(/[\r\n]+/g, ' ').trim();
  const subject = `${titel} - Jahrgang ${safeJahrgangName} - Konfi Quest`;

  let textBody;
  let tableHtml;

  if (isSprueche) {
    // Liste: Name + Konfirmationstermin + Spruch
    const textLines = rows.map(r => {
      const termin = formatKonfirmationDate(r.konfirmation_date);
      const spruch = formatSpruchText(r.konfspruch);
      return `${r.display_name} | Konfirmation: ${termin} | Spruch: ${spruch}`;
    });
    textBody = textLines.length > 0 ? textLines.join('\n') : 'Keine Konfis in diesem Jahrgang.';

    const rowsHtml = rows.length > 0
      ? rows.map(r => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.display_name)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(formatKonfirmationDate(r.konfirmation_date))}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(formatSpruchText(r.konfspruch))}</td>
        </tr>`).join('')
      : `<tr><td colspan="3" style="padding:8px;">Keine Konfis in diesem Jahrgang.</td></tr>`;

    tableHtml = `
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #667eea;">Konfi</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #667eea;">Konfirmation</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #667eea;">Konfispruch</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  } else {
    // Anwesenheit: Name + besuchte/gesamte Pflicht-Events
    const textLines = rows.map(r => `${r.display_name} | Anwesenheit: ${r.present_count} von ${r.total_count} Pflicht-Terminen`);
    textBody = textLines.length > 0 ? textLines.join('\n') : 'Keine Konfis in diesem Jahrgang.';

    const rowsHtml = rows.length > 0
      ? rows.map(r => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.display_name)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(`${r.present_count} von ${r.total_count}`)}</td>
        </tr>`).join('')
      : `<tr><td colspan="2" style="padding:8px;">Keine Konfis in diesem Jahrgang.</td></tr>`;

    tableHtml = `
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #667eea;">Konfi</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #667eea;">Anwesenheit (Pflicht-Termine)</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  const text = `
Hallo ${adminName},

hier ist die ${titel}-Übersicht für den Jahrgang "${jahrgangName}":

${textBody}

Diese E-Mail hast du dir selbst aus der App geschickt.

Viele Grüße,
Dein Konfi Quest Team
  `.trim();

  const html = wrapHtml(`
      <h2>Hallo ${escapeHtml(adminName)}!</h2>
      <p>hier ist die <strong>${escapeHtml(titel)}</strong>-Übersicht für den Jahrgang <strong>${escapeHtml(jahrgangName)}</strong>:</p>
      ${tableHtml}
      <p style="color:#666;font-size:14px;margin-top:20px;">Diese E-Mail hast du dir selbst aus der App geschickt.</p>
  `);

  return sendEmail({ to: email, subject, text, html });
};

/**
 * Testet die E-Mail-Konfiguration
 */
const testEmailConnection = async () => {
  if (!validateSmtpConfig()) {
    return false;
  }

  try {
    const transporter = getTransporter();
    await transporter.verify();
    return true;
  } catch (error) {
    console.error('SMTP-Verbindungsfehler:', error);
    cachedTransporter = null;
    return false;
  }
};

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendLicenseExpiryReminderEmail,
  sendJahrgangDeletionWarningEmail,
  sendKonfiMatrixEmail,
  testEmailConnection
};
