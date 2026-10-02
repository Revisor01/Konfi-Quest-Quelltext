// SMTP-Konfiguration fuer den Mailversand -- eine Quelle fuer beide
// Transporte (server.js und services/emailService.js).
//
// KEIN EINGEBAUTER HOST, KEIN EINGEBAUTER NUTZER:
// An beiden Stellen stand ein Fallback-Hostname
// samt Absenderadresse im Code -- Betriebsdaten im oeffentlichen Repo, und
// ein Versand, der bei fehlender Konfiguration still an eine eingebaute
// Adresse ging. Host und Nutzer kommen jetzt ausschliesslich aus der
// Umgebung (SMTP_HOST, SMTP_USER). Fehlen sie, gibt es keinen stillen Ersatz:
// smtpKonfiguration() warnt beim Aufbau, und emailService.js weist den
// Versand mit einer klaren Meldung ab.
//
// ZERTIFIKAT WIRD GEPRUEFT: An beiden
// Stellen stand `tls: { rejectUnauthorized: false }` -- der Versand nahm
// jedes Zertifikat an. Ueber diesen Kanal gehen Passwort-Reset-Links,
// Gemeinde-Einladungen und die Anwesenheits- und Konfispruch-Listen ganzer
// Jahrgaenge (Namen Minderjaehriger). Wer sich zwischen Backend und
// Mailserver setzen kann, las mit und setzte fremde Passwoerter.
//
// STANDARD IST STRENG: Das Zertifikat des Mailservers muss zur Kette und zum
// Hostnamen passen (SMTP_HOST). Passt es beim Anbieter nicht -- etwa weil der
// Server unter einem anderen Namen zertifiziert ist als dem, den wir
// ansprechen --, wuerde nach dem Deploy keine Mail mehr rausgehen. Deshalb
// gibt es einen Notnagel: SMTP_TLS_REJECT_UNAUTHORIZED=false schaltet die
// Pruefung ab, aber nicht still -- bei jedem Aufbau eines Transports steht
// eine Warnzeile im Log. Sie soll stoeren, bis das Zertifikat stimmt.
//
// Vor dem Deploy pruefen (Hostname und Port aus dem Stack einsetzen):
//   openssl s_client -connect <SMTP_HOST>:465 -servername <SMTP_HOST> </dev/null
//   (bei STARTTLS auf 587: openssl s_client -starttls smtp -connect <SMTP_HOST>:587)
// "Verify return code: 0 (ok)" -> alles gut; sonst den Notnagel setzen und
// beim Anbieter ein passendes Zertifikat einfordern.
//
// Das env-Objekt ist ein Parameter, damit sich beide Funktionen ohne Eingriff
// in process.env pruefen lassen.
const smtpTlsOptionen = (env = process.env) => {
  const wert = String(env.SMTP_TLS_REJECT_UNAUTHORIZED ?? '').trim().toLowerCase();
  const abgeschaltet = wert === 'false';
  if (abgeschaltet) {
    console.warn(
      'WARNUNG: SMTP_TLS_REJECT_UNAUTHORIZED=false -- der Mailversand prueft das ' +
      'Zertifikat des Mailservers NICHT. Reset-Links und Listen mit Namen gehen ' +
      'ungeschuetzt gegen Mitlesen raus. Nur als Notnagel, bis das Zertifikat passt.'
    );
  }
  return { rejectUnauthorized: !abgeschaltet };
};

const smtpKonfiguration = (env = process.env) => {
  if (!env.SMTP_HOST || !env.SMTP_USER) {
    console.warn(
      'WARNUNG: SMTP_HOST oder SMTP_USER nicht gesetzt -- der Mailversand ist nicht ' +
      'konfiguriert, einen eingebauten Ersatz gibt es nicht. Reset-Links, Einladungen ' +
      'und Listen gehen so nicht raus. Beide Werte als Stack-Variablen setzen.'
    );
  }
  return {
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT || '465', 10),
    secure: env.SMTP_SECURE !== 'false', // Default: true (Port 465 mit TLS)
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    },
    tls: smtpTlsOptionen(env)
  };
};

// Deshalb fuer diese Laeufe ein eigener Transport: EINE gepoolte
// Verbindung (bis zu 100 Mails je Verbindung) und hoechstens
// SMTP_MASSEN_JE_MINUTE Mails je Minute (Standard 20, also 1.200 je Stunde).
// Einzelmails (Passwort, Einladung, Bestaetigung, Listen fuer die Leitung)
// laufen weiter ueber den normalen Transport -- sie sollen nicht hinter
// einem Massenlauf in der Warteschlange stehen.
const MASSEN_STANDARD_JE_MINUTE = 20;

const smtpMassenKonfiguration = (env = process.env, { zeitfensterMs = 60 * 1000 } = {}) => {
  const jeMinute = parseInt(env.SMTP_MASSEN_JE_MINUTE, 10);
  return {
    ...smtpKonfiguration(env),
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    rateDelta: zeitfensterMs,
    rateLimit: Number.isInteger(jeMinute) && jeMinute > 0 ? jeMinute : MASSEN_STANDARD_JE_MINUTE,
  };
};

module.exports = { smtpTlsOptionen, smtpKonfiguration, smtpMassenKonfiguration, MASSEN_STANDARD_JE_MINUTE };
