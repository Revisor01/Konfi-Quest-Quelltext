// Erlaubnisliste und Metadaten fuer Musik-Links in Challenge-Beitraegen.
//
// Entscheid: Link-Beitraege nehmen nicht mehr jede http(s)-Adresse
// an, sondern NUR Links der hier gelisteten Musikdienste. Der Server holt beim
// Einreichen einmalig Titel und Interpret und speichert sie (link_title /
// link_author, Migration 125). BEWUSST kein Cover und keine Bild-URL: Beim
// Betrachten der Beitraege soll kein Musikdienst kontaktiert werden — nur der
// Server fragt beim Einreichen ein einziges Mal an (Datenschutzentscheid).
//
// ACHTUNG Doppelpflege: frontend/src/utils/musikLinks.ts traegt dieselbe
// Liste fuer die Anzeige und die Vorab-Pruefung im Formular. Ein Test
// (tests/utils/musikLinks.test.js) vergleicht beide Listen — wer hier etwas
// aendert, aendert es dort mit, sonst wird die Suite rot.

const MUSIK_DIENSTE = [
  {
    id: 'spotify',
    name: 'Spotify',
    // open.spotify.com traegt die Sprache im PFAD (/intl-de/track/...), der
    // Host bleibt gleich. spotify.link sind die Kurzlinks aus dem
    // Teilen-Dialog der App.
    hosts: ['open.spotify.com', 'spotify.link']
  },
  {
    id: 'apple_music',
    name: 'Apple Music',
    // music.apple.com traegt den Laender-Storefront im Pfad (/de/album/...).
    // geo.music.apple.com ist die laenderneutrale Variante aus manchen
    // Teilen-Dialogen. Bewusst NICHT dabei: apple.co (allgemeiner
    // Apple-Kurzlink, fuehrt auch zu App Store und Marketing) und
    // itunes.apple.com (Altlast, hostet auch Apps und Podcasts).
    hosts: ['music.apple.com', 'geo.music.apple.com']
  },
  {
    id: 'youtube_music',
    name: 'YouTube Music',
    // NUR music.youtube.com. www.youtube.com und youtu.be wuerden das Tor
    // fuer beliebige Videos oeffnen — genau das soll die Liste verhindern.
    hosts: ['music.youtube.com']
  },
  {
    id: 'deezer',
    name: 'Deezer',
    // deezer.com traegt die Sprache im Pfad (/de/track/...), die www-Variante
    // kommt aus dem Browser. link.deezer.com sind die aktuellen Kurzlinks aus
    // der App; dzr.page.link und deezer.page.link die aelteren
    // (Firebase Dynamic Links) — solche Links kursieren weiterhin.
    hosts: ['deezer.com', 'www.deezer.com', 'link.deezer.com', 'dzr.page.link', 'deezer.page.link']
  }
];

// Fuer Fehlermeldungen und Formular-Hinweise — an EINER Stelle formuliert.
const ERLAUBTE_DIENSTE_TEXT = 'Spotify, Apple Music, YouTube Music und Deezer';

/**
 * Prueft eine eingereichte Adresse gegen die Erlaubnisliste.
 * @returns {{ok: true, dienst: {id, name, hosts}} | {ok: false}}
 */
function pruefeMusikLink(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return { ok: false };
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false };
  }
  // http zusaetzlich zu https zulassen: die Dienste leiten selbst auf https
  // um. Alles andere (javascript:, data:, ftp:) faellt durch.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false };
  // url.hostname ist bereits kleingeschrieben; ein angehaengter Punkt
  // ("open.spotify.com.") wuerde den exakten Vergleich sonst umgehen.
  const host = url.hostname.replace(/\.$/, '');
  const dienst = MUSIK_DIENSTE.find(d => d.hosts.includes(host));
  return dienst ? { ok: true, dienst } : { ok: false };
}

// Metadaten-Text entschaerfen: Steuerzeichen raus, Laenge deckeln. Der Text
// kommt von einem fremden Server und landet in DB und UI.
function sauber(wert) {
  if (typeof wert !== 'string') return null;
  const s = wert
    // Steuerzeichen sind hier genau das Ziel; die Regel greift absichtlich.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 300)
    .trim();
  return s || null;
}

// JSON mit hartem Timeout holen. Wirft nie — jede Stoerung ergibt null.
async function jsonMitTimeout(doFetch, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Die Embed-Seite traegt ihn im eingebetteten JSON ("artists":[{"name":...}]).
// Bewusst als ERGAENZUNG, nicht als Ersatz: Der Titel kommt weiterhin aus dem
// offiziellen oEmbed. Faellt dieser Weg weg (Spotify aendert die Seite), bleibt
// alles wie bisher — nur ohne Interpret, kein Fehler.
async function spotifyInterpret(doFetch, trackUrl, timeoutMs) {
  const treffer = trackUrl.pathname.match(/\/(track|album|episode)\/([A-Za-z0-9]+)/);
  if (!treffer) return null;
  const [, art, id] = treffer;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(`https://open.spotify.com/embed/${art}/${id}`, {
      signal: controller.signal,
      headers: { Accept: 'text/html' }
    });
    if (!res || !res.ok) return null;
    const html = await res.text();
    const m = html.match(/"artists":\s*\[\s*\{\s*"name"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      || html.match(/"subtitle"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!m || !m[1]) return null;
    // JSON-Escapes aufloesen (\u00e9 usw.), damit "Beyonc\u00e9" richtig ankommt.
    try { return sauber(JSON.parse(`"${m[1]}"`)); } catch { return sauber(m[1]); }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Apple Music hat kein oeffentliches oEmbed. Der offene iTunes-Lookup
// (itunes.apple.com/lookup) liefert Titel/Interpret ueber die numerische ID
// aus der URL:
//   /de/album/<slug>/<albumId>?i=<trackId>  -> trackId
//   /de/song/<slug>/<trackId>               -> trackId
//   /de/album/<slug>/<albumId>              -> albumId (Album-Titel)
// Playlists (IDs wie pl.u-...) kann der Lookup nicht aufloesen -> null.
function appleLookupUrl(url) {
  const erstesSegment = (url.pathname.split('/')[1] || '').toLowerCase();
  const land = /^[a-z]{2}$/.test(erstesSegment) ? erstesSegment : 'de';
  const trackId = url.searchParams.get('i');
  if (trackId && /^\d+$/.test(trackId)) {
    return `https://itunes.apple.com/lookup?id=${trackId}&country=${land}`;
  }
  const m = url.pathname.match(/\/(\d+)\/?$/);
  if (m) {
    return `https://itunes.apple.com/lookup?id=${m[1]}&country=${land}`;
  }
  return null;
}

// YouTube-Kanalnamen tragen Zusaetze, die niemand lesen will:
// "Coldplay - Topic" (Auto-Kanaele) und "ColdplayVEVO".
function kanalBereinigen(name) {
  if (!name) return null;
  const ohne = name
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim();
  return ohne || name;
}

// "Interpret - Titel" aufteilen, wie es YouTube-Musikvideos fast immer
// schreiben. Bewusst streng: nur bei GENAU EINEM Trenner und wenn beide
// Seiten plausibel gefuellt sind — sonst zerlegen wir Titel, die selbst einen
// Bindestrich tragen ("Sing-Sing", "Ich - Du - Wir").
function titelAufteilen(titel) {
  if (!titel) return null;
  const teile = titel.split(/\s+[-–—]\s+/);
  if (teile.length !== 2) return null;
  const [links, rechts] = teile.map((t) => t.trim());
  if (!links || !rechts) return null;
  if (links.length > 60 || rechts.length > 90) return null;
  return { author: links, title: rechts };
}

/**
 * Holt Titel und Interpret zu einem erlaubten Musik-Link — einmalig, beim
 * Einreichen. Wirft NIE und blockiert maximal timeoutMs: Schlaegt der Abruf
 * fehl, wird der Beitrag ohne Metadaten gespeichert; das Einreichen darf
 * nicht an einem fremden Server scheitern.
 *
 * @returns {Promise<{title: string|null, author: string|null, album: string|null} | null>}
 */
async function holeLinkMetadaten(rawUrl, { timeoutMs = 4000, fetchImpl } = {}) {
  const pruefung = pruefeMusikLink(rawUrl);
  if (!pruefung.ok) return null;
  const doFetch = fetchImpl || fetch;
  const url = new URL(rawUrl.trim());
  const host = url.hostname.replace(/\.$/, '');

  let daten = null;
  try {
    switch (pruefung.dienst.id) {
      case 'spotify': {
        if (host !== 'open.spotify.com') return null; // Kurzlink
        const json = await jsonMitTimeout(
          doFetch,
          `https://open.spotify.com/oembed?url=${encodeURIComponent(url.toString())}`,
          timeoutMs
        );
        if (json) {
          let autor = sauber(json.author_name);
          // Fehlt der Interpret (Regelfall seit 2026), aus der Embed-Seite
          // nachholen.
          if (!autor) autor = await spotifyInterpret(doFetch, url, timeoutMs);
          daten = { title: sauber(json.title), author: autor, album: null };
        }
        break;
      }
      case 'deezer': {
        if (host !== 'deezer.com' && host !== 'www.deezer.com') return null; // Kurzlink
        const json = await jsonMitTimeout(
          doFetch,
          `https://api.deezer.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`,
          timeoutMs
        );
        if (json) daten = { title: sauber(json.title), author: sauber(json.author_name), album: null };
        break;
      }
      case 'youtube_music': {
        const abfrage = new URL(url.toString());
        abfrage.hostname = 'www.youtube.com';
        const json = await jsonMitTimeout(
          doFetch,
          `https://www.youtube.com/oembed?url=${encodeURIComponent(abfrage.toString())}&format=json`,
          timeoutMs
        );
        if (json) {
          // YouTube liefert als author_name den KANAL ("Coldplay - Topic",
          // "ColdplayVEVO"), nicht den Interpreten. Der steckt meist im Titel
          // ("Coldplay - Yellow"). Wenn sich der Titel so aufteilen laesst,
          // nehmen wir das; sonst bleibt der bereinigte Kanalname.
          const rohTitel = sauber(json.title);
          const kanal = kanalBereinigen(sauber(json.author_name));
          const geteilt = titelAufteilen(rohTitel);
          daten = geteilt
            ? { title: geteilt.title, author: geteilt.author, album: null }
            : { title: rohTitel, author: kanal, album: null };
        }
        break;
      }
      case 'apple_music': {
        const lookupUrl = appleLookupUrl(url);
        if (!lookupUrl) return null;
        const json = await jsonMitTimeout(doFetch, lookupUrl, timeoutMs);
        const treffer = json && Array.isArray(json.results) ? json.results[0] : null;
        if (treffer) {
          // trackName = einzelner Song, collectionName = Album. Bei einem
          // Album-Link gibt es keinen trackName — dann IST das Album der Titel
          // und darf nicht zusaetzlich als Album danebenstehen.
          const track = sauber(treffer.trackName);
          const album = sauber(treffer.collectionName);
          daten = {
            title: track || album,
            author: sauber(treffer.artistName),
            album: track && album && track !== album ? album : null
          };
        }
        break;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }

  if (!daten || (!daten.title && !daten.author)) return null;
  return daten;
}

module.exports = { MUSIK_DIENSTE, ERLAUBTE_DIENSTE_TEXT, pruefeMusikLink, holeLinkMetadaten };
