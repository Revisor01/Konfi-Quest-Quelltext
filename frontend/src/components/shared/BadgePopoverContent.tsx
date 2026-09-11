import React from 'react';
import { IonIcon } from '@ionic/react';
import { ICON_SPERRE_GEFUELLT, ICON_UHRZEIT_GEFUELLT, ICON_ZUSAGE_GEFUELLT } from './icons';
import { getIconFromString } from '../../utils/badgeIcons';
import { FARBEN } from '../../theme/colors';

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
  /** In der Datenbank nullbar (custom_badges.criteria_extra). */
  criteria_extra?: string | Record<string, unknown> | null;
  is_hidden?: boolean;
  /** Konfi-Abzeichen fuehren den Status am Abzeichen selbst … */
  is_earned?: boolean;
  /** … das Teamer-Dashboard unter anderem Namen. */
  earned?: boolean;
  /**
   * Zwei Namen fuer dasselbe Datum, je nach Endpunkt. Null bei einem noch
   * nicht erreichten Abzeichen (LEFT JOIN auf user_badges).
   */
  earned_at?: string | null;
  awarded_date?: string | null;
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
    if (wert <= 5) return FARBEN.bronze;
    if (wert <= 15) return FARBEN.silber;
    return FARBEN.gold;
  }
  return FARBEN.abzeichenFallback;
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
  gap: 'var(--app-abstand-mini)',
  background: hintergrund,
  color: 'white',
  padding: 'var(--app-abstand-mini) var(--app-abstand-eng)',
  borderRadius: 'var(--app-radius-klein)',
  fontSize: 'var(--app-text-meta)',
  fontWeight: 'var(--app-schrift-halbfett)',
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
          background: erreicht
            ? `linear-gradient(145deg, ${farbe} 0%, ${farbe}cc 100%)`
            : 'var(--app-gradient-badge-gesperrt)',
          boxShadow: erreicht
            ? `0 2px 8px ${farbe}40`
            : '0 1px 4px rgba(0,0,0,0.1)',
        }}>
          <IonIcon
            icon={maskiert ? ICON_SPERRE_GEFUELLT : getIconFromString(badge.icon)}
            style={{ fontSize: 'var(--app-text-titel-gross)', color: erreicht ? 'white' : 'var(--app-text-muted)' }}
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
            {maskiert ? '???' : badge.name}
          </h3>
          <p style={{ margin: 0, fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-secondary)', lineHeight: '1.3' }}>
            {maskiert ? 'Bleibt geheim, bis du es hast' : (badge.description || 'Keine Beschreibung')}
          </p>
        </div>
      </div>

      <div style={{
        marginTop: 'var(--app-abstand-schmal)',
        paddingTop: 'var(--app-abstand-schmal)',
        borderTop: '1px solid var(--app-border-soft)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {erreicht ? (
          <>
            <div style={chipStil('var(--app-color-success)')}>
              <IonIcon icon={ICON_ZUSAGE_GEFUELLT} style={{ fontSize: 'var(--app-text-klein)' }} />
              Erreicht
            </div>
            {datum && (
              <span style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-tertiary)' }}>
                {new Date(datum).toLocaleDateString('de-DE', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </span>
            )}
          </>
        ) : fortschritt > 0 ? (
          <>
            <div style={chipStil('var(--app-color-users)')}>
              {Math.round(fortschritt)}% - In Arbeit
            </div>
            <span style={{ fontSize: 'var(--app-text-meta)', color: 'var(--app-text-tertiary)' }}>
              {badge.progress_points || 0} / {badge.criteria_value}
            </span>
          </>
        ) : (
          <div style={chipStil('var(--app-text-system)')}>
            <IonIcon icon={ICON_SPERRE_GEFUELLT} style={{ fontSize: 'var(--app-text-meta)' }} />
            Noch nicht erreicht
          </div>
        )}
      </div>

      {zeitfenster && (
        <div style={{
          marginTop: 'var(--app-abstand-eng)',
          paddingTop: 'var(--app-abstand-eng)',
          borderTop: '1px solid var(--app-border-soft)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--app-abstand-kompakt)',
          fontSize: 'var(--app-text-meta)',
          color: 'var(--app-text-tertiary)',
          lineHeight: '1.35',
        }}>
          <IonIcon icon={ICON_UHRZEIT_GEFUELLT} style={{ fontSize: 'var(--app-text-sekundaer)', marginTop: 'var(--app-abstand-haar)', flexShrink: 0 }} />
          <span>{zeitfenster}</span>
        </div>
      )}
    </div>
  );
};

export default BadgePopoverContent;
