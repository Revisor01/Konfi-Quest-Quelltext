// Darstellung eingereichter Links (Challenge-Beitraege).
//
// Die volle URL als Beschriftung sprengt auf dem Telefon mehrere Zeilen —
// eine YouTube- oder Spotify-Adresse mit Parametern ist schnell 80 Zeichen lang
// und wurde bisher per word-break mitten im Wort umgebrochen. Stattdessen wird
// die Domain gezeigt; die vollstaendige Adresse bleibt im href und im title.

import { dienstNameAus } from './musikLinks';

/** Hostname als lesbare Beschriftung, ohne fuehrendes "www.". */
export const hostAus = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/**
 * Nur http/https durchlassen. Die URL stammt aus einer fremden Einreichung —
 * ein praepariertes javascript:-Schema darf nie in ein href geraten.
 * Bewusst NICHT auf die Musikdienst-Erlaubnisliste verengt: Alt-Beitraege
 * aus der Zeit vor der Liste waren regelkonform und sollen anklickbar bleiben.
 */
export const istWebLink = (url?: string | null): boolean =>
  !!url && /^https?:\/\//i.test(url);

/**
 * Neue Antworten tragen das Array `links` (Tabelle material_links); ein
 * gecachter Eintrag von vorher hat nur das Alt-Feld `link_url`, das der
 * Server als Spiegel des ersten Links weiter befuellt -- dann faellt die
 * Anzeige auf diesen einen Link zurueck. Gefiltert wird ueber istWebLink,
 * damit nie etwas anderes als http/https in ein href geraet.
 */
export const materialLinks = (material: {
  links?: { url: string }[];
  link_url?: string | null;
}): string[] => {
  const roh = material.links && material.links.length > 0
    ? material.links.map((l) => l.url)
    : material.link_url
      ? [material.link_url]
      : [];
  return roh.filter((url) => istWebLink(url));
};

/**
 * Beschriftung fuer einen Link-Beitrag: mit gespeicherten Metadaten
 * "Titel · Interpret · Dienst", ohne (Alt-Beitraege, fehlgeschlagener
 * Abruf) wie bisher die Domain. Cover werden bewusst nie geladen.
 */
export const linkBeschriftung = (link: {
  link_url?: string | null;
  link_title?: string | null;
  link_author?: string | null;
  link_album?: string | null;
}): string => {
  const teile = [link.link_title, link.link_author, link.link_album].filter(
    (t): t is string => !!t && !!t.trim()
  );
  if (teile.length > 0) {
    const dienst = dienstNameAus(link.link_url);
    if (dienst) teile.push(dienst);
    return teile.join(' · ');
  }
  return link.link_url ? hostAus(link.link_url) : '';
};

export interface LinkTeile {
  /** Songtitel, oder als Rueckfall die Domain. */
  titel: string;
  /** Interpret, wenn bekannt. */
  interpret: string | null;
  /** Album, wenn bekannt (heute nur bei Apple Music). */
  album: string | null;
  /** Anzeigename des Musikdienstes, wenn erkannt. */
  dienst: string | null;
  /** true, wenn ueberhaupt Metadaten vorliegen (sonst nur die Domain). */
  hatMetadaten: boolean;
}

/**
 * Zerlegt einen Link-Beitrag in seine Bestandteile, damit die Anzeige sie
 * getrennt setzen kann — Titel gross, Interpret und Album darunter.
 */
export const linkTeile = (link: {
  link_url?: string | null;
  link_title?: string | null;
  link_author?: string | null;
  link_album?: string | null;
}): LinkTeile => {
  const sauber = (t?: string | null) => (t && t.trim() ? t.trim() : null);
  const titel = sauber(link.link_title);
  const interpret = sauber(link.link_author);
  const album = sauber(link.link_album);
  return {
    titel: titel || (link.link_url ? hostAus(link.link_url) : ''),
    interpret,
    album,
    dienst: dienstNameAus(link.link_url),
    hatMetadaten: !!(titel || interpret)
  };
};
