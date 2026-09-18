import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_CHALLENGE_GEFUELLT, ICON_SPERRE_GEFUELLT, ICON_ZUSAGE_GEFUELLT } from './icons';
import { getIconFromString } from '../../utils/badgeIcons';
import type { ChallengeMark, OffenerStempel } from '../../types/challenges';

/**
 * Aufbau, Maße und Bedienung sind bewusst die des Abzeichen-Popovers
 * (BadgePopoverContent): Symbolkreis links, Name und Text rechts, darunter
 * eine Zeile mit Zustands-Chip und Datum. Wer beides in derselben Ansicht
 * antippt, soll nicht zweierlei Gestaltung sehen.
 *
 * KEIN gemeinsamer Popover mit den Abzeichen: Ein Abzeichen kennt
 * Fortschritt, Punkteschwellen, Geheimhaltung und eine eigene Farbe. Ein
 * Stempel kennt davon nichts — er belegt, dass jemand dabei war. Die beiden
 * Datentypen zu verschmelzen hieße, in BadgePopoverContent überall zu prüfen,
 * welcher der beiden gerade gemeint ist.
 */

export interface StempelPopoverData {
  /** Der angetippte Stempel — erhalten oder offen. */
  stempel: ChallengeMark | OffenerStempel | null;
  /** Hat die Person diesen Stempel? Bestimmt Farbe, Chip und Fußzeile. */
  erhalten: boolean;
}

const chipStil = (hintergrund: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--app-abstand-mini)',
  background: hintergrund,
  color: 'white',
  padding: 'var(--app-abstand-mini) var(--app-abstand-eng)',
  borderRadius: 'var(--app-radius-klein)',
  fontSize: 'var(--app-text-meta)',
  fontWeight: 'var(--app-schrift-halbfett)',
});

/**
 * Was jemand liest, der einen grauen Stempel antippt. Aus Nutzersicht: Was
 * muss ich tun, oder warum geht es nicht mehr?
 *
 * Bewusst ohne Vorwurf und ohne "verpasst" — eine abgelaufene Challenge ist
 * keine Verfehlung.
 */
export const offenerHinweis = (stempel: OffenerStempel): string => {
  if (stempel.status === 'ended') {
    return 'Diese Challenge ist vorbei. Den Stempel gibt es dafür nicht mehr.';
  }
  return 'Mach bei dieser Challenge mit, dann gehört dir der Stempel.';
};

const StempelPopoverContent: React.FC<{
  dataRef: React.RefObject<StempelPopoverData | null>;
}> = ({ dataRef }) => {
  const daten = dataRef.current;
  if (!daten || !daten.stempel) return null;

  const stempel = daten.stempel;
  const erhalten = daten.erhalten;

  // Stempel tragen immer die Challenge-Farbe, nie eine eigene — genau wie im
  // Kachelraster. Ein Stempel gehört zu den Challenges, nicht zu einer
  // Kategorie.
  const verlauf = 'linear-gradient(135deg, var(--app-color-challenges) 0%, var(--app-color-challenges-dunkel) 100%)';

  const datum = erhalten ? (stempel as ChallengeMark).earned_at : null;
  const hinweis = erhalten ? null : offenerHinweis(stempel as OffenerStempel);

  return (
    <div style={{ padding: 'var(--app-abstand-mittel)', background: 'white', maxWidth: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: 'var(--app-radius-kreis)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: erhalten ? verlauf : 'var(--app-gradient-badge-gesperrt)',
          boxShadow: erhalten
            ? 'var(--app-schatten-glow-challenges)'
            : '0 1px 4px rgba(0,0,0,0.1)',
        }}>
          <IonIcon
            icon={getIconFromString(stempel.badge_icon, ICON_CHALLENGE_GEFUELLT)}
            style={{ fontSize: 'var(--app-text-titel-gross)', color: erhalten ? 'white' : 'var(--app-text-muted)' }}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{
            margin: '0 0 var(--app-abstand-mini) 0',
            fontSize: 'var(--app-text-betont)',
            fontWeight: 'var(--app-schrift-fett)',
            color: 'var(--app-text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {stempel.badge_name}
          </h3>
          {/* Der Challenge-Titel: "welche Challenge" war die ausdrueckliche
              Frage. Der Stempelname allein beantwortet sie nicht — er heisst
              oft ganz anders als die Challenge. */}
          <p style={{
            margin: 0,
            fontSize: 'var(--app-text-hinweis)',
            color: 'var(--app-text-secondary)',
            lineHeight: '1.3',
          }}>
            {stempel.title}
          </p>
        </div>
      </div>

      {stempel.description && (
        <p style={{
          margin: 'var(--app-abstand-eng) 0 0 0',
          fontSize: 'var(--app-text-meta)',
          color: 'var(--app-text-tertiary)',
          lineHeight: '1.35',
        }}>
          {stempel.description}
        </p>
      )}

      <div style={{
        marginTop: 'var(--app-abstand-schmal)',
        paddingTop: 'var(--app-abstand-schmal)',
        borderTop: '1px solid var(--app-border-soft)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--app-abstand-eng)',
      }}>
        {erhalten ? (
          <>
            <div style={chipStil('var(--app-color-success)')}>
              <IonIcon icon={ICON_ZUSAGE_GEFUELLT} style={{ fontSize: 'var(--app-text-klein)' }} />
              Erhalten
            </div>
            {datum && (
              <span style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-tertiary)' }}>
                {new Date(datum).toLocaleDateString('de-DE', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </span>
            )}
          </>
        ) : (
          <div style={chipStil('var(--app-text-system)')}>
            <IonIcon icon={ICON_SPERRE_GEFUELLT} style={{ fontSize: 'var(--app-text-meta)' }} />
            Noch nicht erhalten
          </div>
        )}
      </div>

      {hinweis && (
        <p style={{
          margin: 'var(--app-abstand-eng) 0 0 0',
          fontSize: 'var(--app-text-meta)',
          color: 'var(--app-text-tertiary)',
          lineHeight: '1.35',
        }}>
          {hinweis}
        </p>
      )}
    </div>
  );
};

export default StempelPopoverContent;
