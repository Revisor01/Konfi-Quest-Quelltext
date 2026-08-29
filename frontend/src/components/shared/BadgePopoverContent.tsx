import React from 'react';
import { IonIcon } from '@ionic/react';
import { checkmarkCircle, lockClosed, time } from 'ionicons/icons';
import { getIconFromString } from '../../utils/badgeIcons';

/**
 * Gemeinsamer Abzeichen-Popover fuer alle fuenf Stellen, an denen er vorkommt:
 * Konfi-Abzeichen, Konfi-Startseite, Teamer-Startseite, Teamer-Konfi-Statistik
 * und die Konfi-Detailseite der Leitung.
 *
 * Zwei Entscheidungen dabei:
 *
 * 1. Nicht erreichte Abzeichen zeigen ihren Namen. Das Teamer-Dashboard
 *    maskierte sie bisher als "???", die Konfi-Startseite nicht — jetzt gilt
 *    ueberall die Konfi-Variante: Man soll sehen, was es zu holen gibt.
 *    ECHTE Geheim-Abzeichen (`is_hidden`) sind davon nicht betroffen, siehe
 *    unten.
 * 2. Das Teamer-Dashboard uebernimmt das Layout der uebrigen vier.
 */

export interface BadgePopoverBadge {
  id?: number;
  /** Die Teamer-Konfi-Statistik fuehrt die Kennung als `badge_id`. */
  badge_id?: number;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  criteria_type?: string;
  criteria_value?: number;
  criteria_extra?: string | Record<string, unknown>;
  is_hidden?: boolean;
  /** Konfi-Abzeichen fuehren den Status am Abzeichen selbst … */
  is_earned?: boolean;
  /** … das Teamer-Dashboard unter anderem Namen. */
  earned?: boolean;
  /** Zwei Namen fuer dasselbe Datum, je nach Endpunkt. */
  earned_at?: string;
  awarded_date?: string;
  progress_points?: number;
  progress_percentage?: number;
}

export interface BadgePopoverData {
  badge: BadgePopoverBadge | null;
  /**
   * Ueberschreibt die Ableitung aus `is_earned`/`earned` — fuer Aufrufer,
   * deren Abzeichen-Typ den Status nicht selbst traegt (die Startseiten
   * vergleichen gegen eine Liste erreichter Kennungen).
   */
  isEarned?: boolean;
  /**
   * Fortschritts-Anzeige und Zeitfenster-Hinweis rendern, wenn die Daten da
   * sind. Bewusst opt-in: Nur die Abzeichen-Seite berechnet `progress_*`,
   * die uebrigen Endpunkte liefern die Felder gar nicht — dort stuende
   * sonst "0 / undefined".
   */
  showProgress?: boolean;
}

/**
 * Farbe eines Abzeichens: eigene Farbe, sonst Bronze/Silber/Gold nach
 * Punkteschwelle, sonst der Standardton.
 *
 * Lag vorher viermal fast gleich im Code — dreimal mit `#667eea` als
 * Standard, einmal mit `#f59e0b`. Die Mehrheit gewinnt.
 */
export const getBadgeColor = (badge: BadgePopoverBadge): string => {
  if (badge.color) return badge.color;
  if (badge.criteria_type === 'total_points') {
    const wert = badge.criteria_value || 0;
    if (wert <= 5) return '#cd7f32';
    if (wert <= 15) return '#c0c0c0';
    return '#ffd700';
  }
  return '#667eea';
};

/**
 * Erklaert bei zeitbasierten Abzeichen und Serien, in welchem Zeitraum der
 * Fortschritt zaehlt — sonst wirkt es willkuerlich, dass er wieder sinkt.
 */
const getTimeWindowHint = (badge: BadgePopoverBadge): string | null => {
  const fmt = (d: Date) => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });

  if (badge.criteria_type === 'time_based') {
    let days: number | null = null;
    try {
      const extra = typeof badge.criteria_extra === 'string'
        ? JSON.parse(badge.criteria_extra || '{}')
        : (badge.criteria_extra || {});
      days = (extra.days as number) || ((extra.weeks as number) ? (extra.weeks as number) * 7 : null);
    } catch { /* unlesbares JSON: dann eben kein Hinweis */ }
    if (!days) return null;
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return `Zählt die letzten ${days} Tage (seit ${fmt(start)}). Ältere Aktivitäten fallen wieder heraus.`;
  }

  if (badge.criteria_type === 'streak') {
    return 'Zählt aufeinanderfolgende Wochen mit mindestens einer Aktivität. Eine Woche ohne Aktivität setzt die Serie zurück.';
  }

  return null;
};

const chipStil = (hintergrund: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  background: hintergrund,
  color: 'white',
  padding: '3px 8px',
  borderRadius: '8px',
  fontSize: '0.7rem',
  fontWeight: 600,
});

const BadgePopoverContent: React.FC<{
  dataRef: React.RefObject<BadgePopoverData | null>;
}> = ({ dataRef }) => {
  const daten = dataRef.current;
  if (!daten || !daten.badge) return null;

  const badge = daten.badge;

  // Tolerant gegenueber den drei Herkuenften: ausdruecklich gesetzt, am
  // Abzeichen unter einem der beiden Namen, sonst erreicht. Der letzte Fall
  // gilt fuer die Ansichten, deren Endpunkt ausschliesslich erreichte
  // Abzeichen liefert (Teamer-Konfi-Statistik, Leitungs-Konfidetail) — die
  // haben das bisher hart kodiert.
  const erreicht = daten.isEarned ?? badge.is_earned ?? badge.earned ?? true;

  // Echte Geheim-Abzeichen bleiben unkenntlich, solange sie nicht erreicht
  // sind — unabhaengig davon, was der Aufrufer moechte. Die Startseiten
  // filtern sie zwar schon vorher heraus, aber diese Absicherung lag bisher
  // ausschliesslich beim Aufrufer: Eine neue Fundstelle ohne Vorfilterung
  // haette den Namen preisgegeben.
  const maskiert = Boolean(badge.is_hidden) && !erreicht;

  const farbe = getBadgeColor(badge);
  const datum = badge.earned_at || badge.awarded_date;
  const fortschritt = daten.showProgress ? (badge.progress_percentage || 0) : 0;
  const zeitfenster = daten.showProgress ? getTimeWindowHint(badge) : null;

  return (
    <div style={{ padding: '12px', background: 'white', maxWidth: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: erreicht
            ? `linear-gradient(145deg, ${farbe} 0%, ${farbe}cc 100%)`
            : 'linear-gradient(145deg, #d0d0d0 0%, #b8b8b8 100%)',
          boxShadow: erreicht
            ? `0 2px 8px ${farbe}40`
            : '0 1px 4px rgba(0,0,0,0.1)',
        }}>
          <IonIcon
            icon={maskiert ? lockClosed : getIconFromString(badge.icon)}
            style={{ fontSize: '1.4rem', color: erreicht ? 'white' : '#999' }}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{
            margin: '0 0 4px 0',
            fontSize: '0.95rem',
            fontWeight: 700,
            color: '#333',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {maskiert ? '???' : badge.name}
          </h3>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#666', lineHeight: '1.3' }}>
            {maskiert ? 'Bleibt geheim, bis du es hast' : (badge.description || 'Keine Beschreibung')}
          </p>
        </div>
      </div>

      <div style={{
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid #eee',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {erreicht ? (
          <>
            <div style={chipStil('#22c55e')}>
              <IonIcon icon={checkmarkCircle} style={{ fontSize: '0.75rem' }} />
              Erreicht
            </div>
            {datum && (
              <span style={{ fontSize: '0.7rem', color: '#888' }}>
                {new Date(datum).toLocaleDateString('de-DE', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </span>
            )}
          </>
        ) : fortschritt > 0 ? (
          <>
            <div style={chipStil('#667eea')}>
              {Math.round(fortschritt)}% - In Arbeit
            </div>
            <span style={{ fontSize: '0.7rem', color: '#888' }}>
              {badge.progress_points || 0} / {badge.criteria_value}
            </span>
          </>
        ) : (
          <div style={chipStil('#8e8e93')}>
            <IonIcon icon={lockClosed} style={{ fontSize: '0.7rem' }} />
            Noch nicht erreicht
          </div>
        )}
      </div>

      {zeitfenster && (
        <div style={{
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid #eee',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '6px',
          fontSize: '0.72rem',
          color: '#888',
          lineHeight: '1.35',
        }}>
          <IonIcon icon={time} style={{ fontSize: '0.85rem', marginTop: '1px', flexShrink: 0 }} />
          <span>{zeitfenster}</span>
        </div>
      )}
    </div>
  );
};

export default BadgePopoverContent;
