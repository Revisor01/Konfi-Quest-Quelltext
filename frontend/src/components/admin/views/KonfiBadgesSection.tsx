import React, { useEffect, useRef, useState } from 'react';
import { FARBEN } from '../../../theme/colors';
import { useIonPopover } from '@ionic/react';
import { ICON_POKAL, ICON_POKAL_GEFUELLT } from '../../shared/icons';
import api from '../../../services/api';
import { ListSection } from '../../shared';
import { getIconFromString } from '../../../utils/badgeIcons';
import KachelRaster from '../../shared/KachelRaster';
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
    if (badge.criteria_value <= 5) return FARBEN.bronze;
    if (badge.criteria_value <= 15) return FARBEN.silber;
    return FARBEN.gold;
  }
  return FARBEN.abzeichenFallback;
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
    <ListSection
      icon={ICON_POKAL_GEFUELLT}
      title="Badges"
      count={earnedBadges.length}
      iconColorClass="badges"
      emptyIcon={ICON_POKAL}
      emptyTitle="Keine Badges"
      emptyMessage="Noch keine Badges erreicht"
      emptyIconColor="var(--app-color-badges)"
    >
      <KachelRaster
        eintraege={earnedBadges.map((badge) => ({
          schluessel: badge.id,
          icon: getIconFromString(badge.icon),
          name: badge.name || '',
          farbe: getBadgeColor(badge),
          // Diese Ansicht laedt ausschliesslich ERREICHTE Abzeichen,
          // der Haken ist deshalb immer richtig.
          zeichen: true
        }))}
        onKachelClick={(schluessel, e) => {
          const badge = earnedBadges.find((b) => b.id === schluessel);
          if (badge) handleBadgeClick(badge, e);
        }}
      />
    </ListSection>
  );
};

export default KonfiBadgesSection;
