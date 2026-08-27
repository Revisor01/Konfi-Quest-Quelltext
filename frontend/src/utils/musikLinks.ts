// Erlaubnisliste fuer Musik-Links in Challenge-Beitraegen (Frontend-Seite).
//
// ACHTUNG Doppelpflege: backend/utils/musikLinks.js traegt dieselbe Liste
// als verbindliche Pruefung. Ein Backend-Test
// (backend/tests/utils/musikLinks.test.js) vergleicht beide Listen — wer hier
// etwas aendert, aendert es dort mit, sonst wird die Suite rot.
// (Ein gemeinsames Modul scheitert an den getrennten Docker-Build-Kontexten
// von backend/ und frontend/ — beide kopieren nur ihr eigenes Verzeichnis.)

export interface MusikDienst {
  id: string;
  name: string;
  hosts: string[];
}

export const MUSIK_DIENSTE: MusikDienst[] = [
  {
    id: 'spotify',
    name: 'Spotify',
    hosts: ['open.spotify.com', 'spotify.link']
  },
  {
    id: 'apple_music',
    name: 'Apple Music',
    hosts: ['music.apple.com', 'geo.music.apple.com']
  },
  {
    id: 'youtube_music',
    name: 'YouTube Music',
    hosts: ['music.youtube.com']
  },
  {
    id: 'deezer',
    name: 'Deezer',
    hosts: ['deezer.com', 'www.deezer.com', 'link.deezer.com', 'dzr.page.link', 'deezer.page.link']
  }
];

// Fuer Formular-Hinweis und Fehlermeldungen — identisch zum Backend-Text.
export const ERLAUBTE_DIENSTE_TEXT = 'Spotify, Apple Music, YouTube Music und Deezer';

export type MusikLinkPruefung = { ok: true; dienst: MusikDienst } | { ok: false };

/**
 * Prueft eine Adresse gegen die Erlaubnisliste — auf HOSTNAME-Basis via
 * new URL(), nie per String-Suche (sonst rutscht
 * `https://boese.de/?x=open.spotify.com` durch).
 */
export const pruefeMusikLink = (rawUrl?: string | null): MusikLinkPruefung => {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return { ok: false };
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false };
  const host = url.hostname.replace(/\.$/, '');
  const dienst = MUSIK_DIENSTE.find((d) => d.hosts.includes(host));
  return dienst ? { ok: true, dienst } : { ok: false };
};

/** Anzeigename des Dienstes zu einer URL, sonst null. */
export const dienstNameAus = (url?: string | null): string | null => {
  const pruefung = pruefeMusikLink(url);
  return pruefung.ok ? pruefung.dienst.name : null;
};
