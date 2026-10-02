// Der Systemname einer Gemeinde (organizations.name und .slug), gebildet aus
// dem Anzeigenamen.

const UMLAUTE: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue', ẞ: 'ss'
};

/** ä->ae, ö->oe, ü->ue, ß->ss (auch grosse), sonst unveraendert. */
export function umlauteUmschreiben(text: string): string {
  return String(text).replace(/[äöüßÄÖÜẞ]/g, (z) => UMLAUTE[z]);
}

/** Systemname aus dem Anzeigenamen -- wie der Server beim Anlegen. */
export function systemnameAusAnzeigename(anzeigename: string): string {
  return umlauteUmschreiben(anzeigename)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface GeladeneGemeinde {
  name: string;
  slug: string;
  display_name: string;
}

/**
 * name und slug fuer POST (neu) oder PUT (bearbeiten).
 * @param anzeigename  der Anzeigename im Formular
 * @param geladen      die gespeicherte Gemeinde beim Bearbeiten, sonst null
 */
export function systemnameZumSpeichern(
  anzeigename: string,
  geladen?: GeladeneGemeinde | null
): { name: string; slug: string } {
  if (geladen && geladen.name && geladen.slug
      && anzeigename.trim() === (geladen.display_name || '').trim()) {
    return { name: geladen.name, slug: geladen.slug };
  }
  const systemname = systemnameAusAnzeigename(anzeigename);
  return { name: systemname, slug: systemname };
}
