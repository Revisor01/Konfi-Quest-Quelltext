import React, { useEffect, useRef, useState } from 'react';
import {
  IonCard,
  IonCardContent,
  IonIcon,
  IonLabel,
  IonList,
  IonListHeader,
  useIonPopover
} from '@ionic/react';
import {
  trophy,
  trophyOutline,
  checkmark
} from 'ionicons/icons';
import api from '../../../services/api';
import { EmptyState } from '../../shared';
import { getIconFromString } from '../../../utils/badgeIcons';
import BadgePopoverContent, { BadgePopoverData } from '../../shared/BadgePopoverContent';



interface Badge {
  id: number;
  name: string;
  description?: string;
  icon: string;
  criteria_type: string;
  criteria_value: number;
  criteria_extra?: string;
  is_hidden: boolean;
  color?: string;
  earned?: boolean;
  earned_at?: string;
}

const getBadgeColor = (badge: Badge): string => {
  if (badge.color) return badge.color;
  if (badge.criteria_type === 'total_points') {
    if (badge.criteria_value <= 5) return '#cd7f32';
    if (badge.criteria_value <= 15) return '#c0c0c0';
    return '#ffd700';
  }
  return '#667eea';
};

// Der Abzeichen-Popover liegt jetzt gemeinsam in shared/BadgePopoverContent
// Diese Ansicht laedt nur ERREICHTE Abzeichen — die
// gemeinsame Fassung faellt ohne Statusangabe auf 'erreicht' zurueck, das
// hier vorher hart kodiert war.

interface KonfiBadgesSectionProps {
  konfiId: number;
  /**
   * Rolle der angezeigten Person. Teamer:innen haben ein EIGENES Badge-System
   * (target_role='teamer', eigene Kriterien ohne Punkte) und einen eigenen
   * Endpunkt — der Konfi-Endpunkt antwortet für sie mit 404. Darstellung und
   * Popover sind identisch, deshalb dieselbe Komponente (User-Wunsch 11.08.).
   */
  role?: 'konfi' | 'teamer';
}

// Zeigt die erreichten Badges als klickbare Kreis-Symbole an — analog zur
// jeweiligen eigenen BadgesView, aber kompakt für die Admin-Detailseite.
// Klick auf ein Badge oeffnet ein Detail-Popover.
const KonfiBadgesSection: React.FC<KonfiBadgesSectionProps> = ({ konfiId, role = 'konfi' }) => {
  const [earnedBadges, setEarnedBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const badgePopoverRef = useRef<BadgePopoverData | null>({ badge: null });

  const [presentBadgePopover] = useIonPopover(BadgePopoverContent, {
    dataRef: badgePopoverRef
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = role === 'teamer'
      ? `/teamer/${konfiId}/badges`
      : `/admin/konfis/${konfiId}/badges`;
    api.get(url)
      .then((res) => {
        if (cancelled) return;
        setEarnedBadges(res.data?.earned || []);
      })
      .catch(() => {
        if (!cancelled) setEarnedBadges([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [konfiId, role]);

  const handleBadgeClick = (badge: Badge, e: React.MouseEvent) => {
    badgePopoverRef.current = { badge };
    presentBadgePopover({
      event: e.nativeEvent,
      side: 'bottom',
      alignment: 'center',
      cssClass: 'badge-detail-popover badge-popover-auto-width'
    });
  };

  // Waehrend des Ladens nichts anzeigen (kein Platzhalter-Flackern in der Detailseite).
  if (loading) return null;

  return (
    <IonList className="app-section-inset" inset={true}>
      <IonListHeader>
        <div className="app-section-icon app-section-icon--badges">
          <IonIcon icon={trophy} />
        </div>
        <IonLabel>Badges ({earnedBadges.length})</IonLabel>
      </IonListHeader>
      <IonCard className="app-card">
        <IonCardContent style={{ padding: earnedBadges.length === 0 ? '16px' : '12px' }}>
          {earnedBadges.length === 0 ? (
            <EmptyState
              icon={trophyOutline}
              title="Keine Badges"
              message="Noch keine Badges erreicht"
              iconColor="#f59e0b"
            />
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '12px'
            }}>
              {earnedBadges.map((badge) => {
                const badgeColor = getBadgeColor(badge);
                return (
                  <div
                    key={badge.id}
                    onClick={(e) => handleBadgeClick(badge, e)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '10px 4px',
                      borderRadius: '16px',
                      background: `${badgeColor}10`,
                      border: `2px solid ${badgeColor}40`,
                      cursor: 'pointer',
                      minWidth: 0,
                      overflow: 'hidden'
                    }}
                  >
                    <div style={{
                      width: '52px',
                      height: '52px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `linear-gradient(145deg, ${badgeColor} 0%, ${badgeColor}cc 100%)`,
                      boxShadow: `0 4px 12px ${badgeColor}40`,
                      position: 'relative',
                      marginBottom: '6px'
                    }}>
                      <IonIcon
                        icon={getIconFromString(badge.icon)}
                        style={{ fontSize: '1.7rem', color: 'white' }}
                      />
                      <div style={{
                        position: 'absolute',
                        bottom: '-2px',
                        right: '-2px',
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        background: '#22c55e',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '2px solid white'
                      }}>
                        <IonIcon icon={checkmark} style={{ fontSize: '0.65rem', color: 'white' }} />
                      </div>
                    </div>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: '600',
                      color: '#333',
                      textAlign: 'center',
                      lineHeight: '1.2',
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical'
                    }}>
                      {badge.name || ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </IonCardContent>
      </IonCard>
    </IonList>
  );
};

export default KonfiBadgesSection;
