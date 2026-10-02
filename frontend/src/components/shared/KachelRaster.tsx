import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_HAKEN_GEFUELLT, ICON_SPERRE_GEFUELLT } from './icons';
import { useKachelName } from './useKachelName';
import { tastaturKlick } from '../../utils/tastatur';

/**
 * Vorher lag dasselbe Raster acht Mal als Inline-Style im Baum und war
 * auseinandergelaufen: drei Spalten im Profil, VIER in der Detailansicht der
 * Leitung, und unter Challenges gar kein Raster, sondern eine seitlich
 * scrollende Reihe. Wer eine Stelle anfasste, vergass die anderen sieben.
 *
 * Das Aussehen steht vollstaendig in variables.css (.app-kachelraster /
 * .app-kachel). Hier liegt nur die Struktur, damit auch sie nicht wieder
 * auseinanderlaeuft.
 *
 * Die INHALTLICHEN Unterschiede bleiben erhalten: Abzeichen kennen einen
 * gesperrten Zustand, einen Fortschritt und ein Popover, Stempel gibt es nur
 * verdient — ein Stempel belegt, dass jemand dabei war, er ist keine
 * Sammelmenge.
 */
export interface KachelEintrag {
  /** Eindeutig innerhalb des Rasters. */
  schluessel: React.Key;
  /** Symbol der Kachel (bereits aufgeloest, z.B. ueber getIconFromString). */
  icon: string;
  /** Angezeigter Name unter dem Symbol. */
  name: string;
  /**
   * Grundfarbe der Kachel. Abzeichen tragen ihre eigene, Stempel die
   * Challenge-Farbe. Erlaubt ist eine Hex-Farbe (#rrggbb) oder ein
   * fertiges Farb-Trio (siehe `flaeche`/`rahmen`/`verlauf`).
   */
  farbe: string;
  /**
   * Verdient? Nur Abzeichen setzen hier `false`. Stempel lassen es weg —
   * sie existieren erst, wenn sie verdient sind.
   */
  verdient?: boolean;
  /** Fortschritt in Prozent (nur Abzeichen, nur wenn nicht verdient). */
  fortschritt?: number;
  /** Titel-Attribut (Tooltip), z.B. der volle Challenge-Titel am Stempel. */
  titel?: string;
  /** Zusatzinhalt in der Kachel, z.B. das Eselsohr fuer geheime Abzeichen. */
  zusatz?: React.ReactNode;
  /**
   * Zusatzinhalt IM Symbolkreis, z.B. der Fortschrittsring der Abzeichen-
   * Uebersicht. Liegt bewusst getrennt von `zusatz`, weil der Ring am
   * Symbol haengt und nicht an der Kachel.
   */
  symbolZusatz?: React.ReactNode;
  /**
   * Eckzeichen am Symbol anzeigen (Haken/Schloss). Abzeichen ja, Stempel
   * nein — dort waere ein Haken tautologisch.
   */
  zeichen?: boolean;
}

interface KachelRasterProps {
  eintraege: KachelEintrag[];
  /** Klick auf eine Kachel (Abzeichen oeffnen damit ihr Popover). */
  onKachelClick?: (schluessel: React.Key, e: React.MouseEvent) => void;
}

/**
 * Baut aus einer Grundfarbe die drei Flaechenwerte, die die CSS-Klasse
 * erwartet. Bewusst hier und nicht per color-mix() im CSS: die App laeuft ab
 * Android minSdk 24, wo eine alte System-WebView color-mix ersatzlos fallen
 * laesst — die Kachel waere dann durchsichtig statt getoent.
 *
 * Die Suffixe entsprechen dem, was die Ansichten vorher schon inline
 * zusammengesetzt haben (`${farbe}10`, `${farbe}40`).
 */
const flaechenFarben = (farbe: string) => {
  // Nur echte Hex-Farben lassen sich mit Alpha-Suffix verlaengern. Alles
  // andere (z.B. eine CSS-Variable) wird unveraendert durchgereicht.
  const istHex = /^#[0-9a-fA-F]{6}$/.test(farbe);
  return {
    '--kachel-farbe': farbe,
    '--kachel-flaeche': istHex ? `${farbe}14` : `rgba(var(--app-color-challenges-rgb), 0.08)`,
    '--kachel-rahmen': istHex ? `${farbe}40` : `rgba(var(--app-color-challenges-rgb), 0.25)`,
    '--kachel-verlauf': istHex
      ? `linear-gradient(145deg, ${farbe} 0%, ${farbe}cc 100%)`
      : `linear-gradient(135deg, var(--app-color-challenges) 0%, var(--app-color-challenges-dunkel) 100%)`,
    '--kachel-schatten': istHex
      ? `0 4px 12px ${farbe}40`
      : 'var(--app-schatten-glow-challenges)',
  } as React.CSSProperties;
};

/**
 * Die Beschriftung einer Kachel. EIGENE Komponente, weil sie einen Hook
 * braucht (gemessene Kuerzung) und Hooks nicht in einer Schleife stehen
 * duerfen.
 *
 * Der volle Name bleibt ueber das title-Attribut erreichbar; bei Abzeichen
 * steht er zusaetzlich im Popover.
 */
const KachelName: React.FC<{ name: string }> = ({ name }) => {
  const [ref, anzeige] = useKachelName(name);
  return (
    <div className="app-kachel__name" ref={ref} title={name || undefined}>
      {anzeige}
    </div>
  );
};

const KachelRaster: React.FC<KachelRasterProps> = ({ eintraege, onKachelClick }) => {
  if (!eintraege || eintraege.length === 0) return null;

  return (
    <div className="app-kachelraster">
      {eintraege.map((e) => {
        // Ohne ausdrueckliche Angabe gilt eine Kachel als verdient — das ist
        // der Normalfall (Stempel, erreichte Abzeichen der Detailansicht).
        const verdient = e.verdient !== false;
        const hatFortschritt = !verdient && (e.fortschritt ?? 0) > 0;

        return (
          <div role={onKachelClick ? 'button' : undefined} tabIndex={onKachelClick ? 0 : undefined} onKeyDown={onKachelClick ? tastaturKlick : undefined}
            key={e.schluessel}
            title={e.titel}
            onClick={onKachelClick ? (ev) => onKachelClick(e.schluessel, ev) : undefined}
            className={[
              'app-kachel',
              verdient ? '' : 'app-kachel--gesperrt',
              onKachelClick ? 'app-kachel--klickbar' : '',
            ].filter(Boolean).join(' ')}
            style={flaechenFarben(e.farbe)}
          >
            <div className="app-kachel__symbol">
              {e.symbolZusatz}
              <IonIcon icon={e.icon} />
              {e.zeichen && (
                <div className={`app-kachel__zeichen${verdient ? '' : ' app-kachel__zeichen--gesperrt'}`}>
                  <IonIcon icon={verdient ? ICON_HAKEN_GEFUELLT : ICON_SPERRE_GEFUELLT} />
                </div>
              )}
            </div>
            <KachelName name={e.name || ''} />
            {hatFortschritt && (
              <div className="app-kachel__fortschritt">{Math.round(e.fortschritt || 0)}%</div>
            )}
            {e.zusatz}
          </div>
        );
      })}
    </div>
  );
};

export default KachelRaster;
