// Der Systemname einer neuen Gemeinde (organizations.name und .slug)
// 
//
// DESHALB DIESE REGEL fuer POST /organizations: Ist der geschickte Name genau
// der, den die App aus dem Anzeigenamen gebildet haette, bildet der Server
// ihn neu -- mit ä->ae, ö->oe, ü->ue, ß->ss, sonst Schritt fuer Schritt wie
// die App. Ein eigener Name (etwa ueber die Schnittstelle, `ks-sued` fuer
// „Kirchspiel Süd") bleibt, nur Umlaute darin werden ebenso umgeschrieben.
// Namen ohne Umlaute aendern sich nicht.
//
// BESTEHENDE GEMEINDEN WERDEN NICHT UMBENANNT: Die Regel gilt nur beim
// Anlegen. PUT /organizations/:id speichert weiter, was geschickt wird.

const UMLAUTE = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue', ẞ: 'ss' };

/** ä->ae, ö->oe, ü->ue, ß->ss (auch grosse), sonst unveraendert. */
function umlauteUmschreiben(text) {
  return String(text).replace(/[äöüßÄÖÜẞ]/g, (z) => UMLAUTE[z]);
}

/** Wie die App den Systemnamen bildet (verliert Umlaute). */
function systemnameWieDieApp(anzeigename) {
  return String(anzeigename)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Derselbe Weg, aber Umlaute vorher umgeschrieben. */
function systemnameAusAnzeigename(anzeigename) {
  return systemnameWieDieApp(umlauteUmschreiben(anzeigename));
}

/**
 * Der Systemname, den eine neue Gemeinde bekommt.
 * @param {string} geschickt - name oder slug aus der Anfrage (getrimmt)
 * @param {string} anzeigename - display_name aus der Anfrage
 * @returns {string}
 */
function systemnameFuerNeueGemeinde(geschickt, anzeigename) {
  if (geschickt === systemnameWieDieApp(anzeigename)) {
    return systemnameAusAnzeigename(anzeigename);
  }
  return umlauteUmschreiben(geschickt);
}

module.exports = {
  umlauteUmschreiben,
  systemnameWieDieApp,
  systemnameAusAnzeigename,
  systemnameFuerNeueGemeinde,
};
