// Was in die Server-Protokolle darf.
//
// Die Regel: Personen erscheinen nur mit ihrer Konto-Kennung (users.id),
// E-Mail-Adressen nur mit der Domain, Freitext vom Client gar nicht. Was die
// App zur Diagnose schickt, geht nur durch, wenn es wie ein Kennwort
// aussieht (Buchstaben, Ziffern, Bindestrich), sonst steht dort ein
// Platzhalter.

function adresseFuersProtokoll(adresse) {
  if (typeof adresse !== 'string' || adresse.trim() === '') return '(keine)';
  const at = adresse.lastIndexOf('@');
  if (at < 0) return '***';
  const domain = adresse.slice(at + 1).trim().toLowerCase();
  return /^[a-z0-9.-]{1,253}$/.test(domain) ? `***@${domain}` : '***';
}

/**
 * Ein Wert aus der Anfrage, der nur dann ins Protokoll darf, wenn er das
 * erwartete Muster hat. Alles andere wird durch den Platzhalter ersetzt --
 * nicht gekuerzt, denn ein gekuerzter Name ist immer noch ein Name.
 */
function kennwortFuersProtokoll(wert, muster, platzhalter = '?') {
  if (typeof wert !== 'string' && typeof wert !== 'number') return platzhalter;
  const text = String(wert);
  return muster.test(text) ? text : platzhalter;
}

/**
 * Abgewiesene Datei: Endung und angegebener Typ, nicht der Dateiname
 * ("Anna_Mueller_Taufspruch.exe" nennt ein Kind). Beide kommen vom Client
 * und gehen deshalb durch ein Muster.
 */
function dateiFuersProtokoll(file) {
  const name = file && typeof file.originalname === 'string' ? file.originalname : '';
  const punkt = name.lastIndexOf('.');
  const endung = punkt >= 0 ? name.slice(punkt).toLowerCase() : '';
  return `Endung ${kennwortFuersProtokoll(endung, /^\.[a-z0-9]{1,10}$/, '(keine)')}, `
    + `Typ ${kennwortFuersProtokoll(file && file.mimetype, /^[a-z0-9.+-]{1,60}\/[a-z0-9.+-]{1,80}$/i)}`;
}

function diagnoseHinweisFuersProtokoll(hinweis) {
  if (hinweis == null || hinweis === '') return '';
  const text = String(hinweis);
  const teile = [];
  const versuche = text.match(/versuche=(\d{1,3})/);
  if (versuche) teile.push(`versuche=${versuche[1]}`);
  const codes = (text.match(/\b[A-Z][A-Z0-9_]{2,40}\b/g) || []).slice(0, 3);
  teile.push(...codes);
  if (/leere Antwort/.test(text)) teile.push('leere-antwort');
  return `hinweis=[${teile.join(' ')}] (${text.length} Zeichen)`;
}

module.exports = {
  adresseFuersProtokoll,
  kennwortFuersProtokoll,
  dateiFuersProtokoll,
  diagnoseHinweisFuersProtokoll,
};
