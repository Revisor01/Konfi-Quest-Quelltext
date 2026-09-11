import React, { useState, useRef } from 'react';
import { CRITERIA_COLORS } from '../../../utils/badgeCriteria';
import {
  IonCard,
  IonCardContent,
  IonIcon,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonList,
  IonListHeader,
  IonItemGroup,
  IonItem,
  IonInput,
  useIonPopover
} from '@ionic/react';
import { SectionHeader, EmptyState } from '../../shared';
import {
  ICON_ABZEICHEN_GEFUELLT,
  ICON_BONUS_GEFUELLT,
  ICON_FILTER,
  ICON_FLAMME_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_HAKEN_GEFUELLT,
  ICON_HAND_GEFUELLT,
  ICON_POKAL,
  ICON_POKAL_GEFUELLT,
  ICON_PRISMA,
  ICON_RASTER,
  ICON_SCHILD_GEFUELLT,
  ICON_SONNE,
  ICON_SPERRE_GEFUELLT,
  ICON_STUFEN,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_VERBORGEN_GEFUELLT,
  ICON_WUERFEL,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { getIconFromString } from '../../../utils/badgeIcons';
import BadgePopoverContent, { BadgePopoverData } from '../../shared/BadgePopoverContent';
import { FARBEN } from '../../../theme/colors';



import type { AnzeigeBadge as Badge } from '../../../types/dashboard';

interface BadgesViewProps {
  badges: Badge[];
  badgeStats: {
    totalVisible: number;
    totalSecret: number;
  };
  selectedFilter: string;
  onFilterChange: (filter: string) => void;
}

const BadgesView: React.FC<BadgesViewProps> = ({
  badges,
  badgeStats,
  selectedFilter,
  onFilterChange
}) => {
  const badgePopoverRef = useRef<BadgePopoverData | null>({ badge: null, showProgress: true });
  const [searchText, setSearchText] = useState('');

  // Badges nach Kategorien gruppieren
  const getBadgeCategories = () => {
    let filtered: Badge[];
    switch (selectedFilter) {
      case 'nicht_erhalten':
        filtered = badges.filter(badge => !badge.is_earned);
        break;
      case 'in_arbeit':
        filtered = badges.filter(badge => !badge.is_earned && badge.progress_percentage && badge.progress_percentage > 0);
        break;
      default:
        filtered = badges;
    }

    // Suchtext-Filter
    if (searchText.trim()) {
      const query = searchText.trim().toLowerCase();
      filtered = filtered.filter(badge =>
        badge.name.toLowerCase().includes(query) ||
        (badge.description && badge.description.toLowerCase().includes(query))
      );
    }

    const categories: { key: string; title: string; icon: string; color: string; badges: Badge[] }[] = [
      { key: 'total_points', title: 'Punkte-Sammler', icon: ICON_POKAL_GEFUELLT, color: CRITERIA_COLORS.total_points, badges: filtered.filter(b => b.criteria_type === 'total_points').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'gottesdienst_points', title: 'Gottesdienst-Held', icon: ICON_SONNE, color: CRITERIA_COLORS.gottesdienst_points, badges: filtered.filter(b => b.criteria_type === 'gottesdienst_points').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'gemeinde_points', title: 'Gemeinde-Star', icon: ICON_GRUPPE_GEFUELLT, color: CRITERIA_COLORS.gemeinde_points, badges: filtered.filter(b => b.criteria_type === 'gemeinde_points').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'bonus_points', title: 'Bonus-Jäger', icon: ICON_BONUS_GEFUELLT, color: CRITERIA_COLORS.bonus_points, badges: filtered.filter(b => b.criteria_type === 'bonus_points').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'both_categories', title: 'Allrounder', icon: ICON_STUFEN, color: CRITERIA_COLORS.both_categories, badges: filtered.filter(b => b.criteria_type === 'both_categories').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'activity_count', title: 'Aktiv dabei', icon: ICON_ZUSAGE_GEFUELLT, color: CRITERIA_COLORS.activity_count, badges: filtered.filter(b => b.criteria_type === 'activity_count').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'unique_activities', title: 'Vielseitig', icon: ICON_RASTER, color: CRITERIA_COLORS.unique_activities, badges: filtered.filter(b => b.criteria_type === 'unique_activities').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'activity_combination', title: 'Kombinier-Profi', icon: ICON_PRISMA, color: CRITERIA_COLORS.activity_combination, badges: filtered.filter(b => b.criteria_type === 'activity_combination').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'category_activities', title: 'Kategorie-Meister', icon: ICON_WUERFEL, color: CRITERIA_COLORS.category_activities, badges: filtered.filter(b => b.criteria_type === 'category_activities').sort((a, b) => a.criteria_value - b.criteria_value) },
      // Ohne eigene Gruppe taucht ein Abzeichen dieses Typs in der Liste NIE
      // auf, obwohl es vergeben wird.
      { key: 'category_combination', title: 'Kategorie-Kombinierer', icon: ICON_PRISMA, color: CRITERIA_COLORS.category_combination, badges: filtered.filter(b => b.criteria_type === 'category_combination').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'specific_activity', title: 'Spezialist', icon: ICON_HAND_GEFUELLT, color: CRITERIA_COLORS.specific_activity, badges: filtered.filter(b => b.criteria_type === 'specific_activity').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'streak', title: 'Serien-Champion', icon: ICON_FLAMME_GEFUELLT, color: CRITERIA_COLORS.streak, badges: filtered.filter(b => b.criteria_type === 'streak').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'time_based', title: 'Zeitreisender', icon: ICON_UHRZEIT_GEFUELLT, color: CRITERIA_COLORS.time_based, badges: filtered.filter(b => b.criteria_type === 'time_based').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'event_count', title: 'Event-Champion', icon: ICON_TERMIN_GEFUELLT, color: CRITERIA_COLORS.event_count, badges: filtered.filter(b => b.criteria_type === 'event_count').sort((a, b) => a.criteria_value - b.criteria_value) },
      // Fehlte hier, obwohl der Typ ueberall sonst gepflegt ist: Das Abzeichen
      // wurde vergeben und die Meldung kam, aber in der Liste tauchte es nie
      // auf, weil ohne passende Kategorie nichts angezeigt wird
      // 
      { key: 'mandatory_event_count', title: 'Immer dabei', icon: ICON_SCHILD_GEFUELLT, color: CRITERIA_COLORS.mandatory_event_count, badges: filtered.filter(b => b.criteria_type === 'mandatory_event_count').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'teamer_year', title: 'Erfahrung', icon: ICON_ABZEICHEN_GEFUELLT, color: CRITERIA_COLORS.teamer_year, badges: filtered.filter(b => b.criteria_type === 'teamer_year').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'collection', title: 'Sammler', icon: ICON_POKAL_GEFUELLT, color: FARBEN.gold, badges: filtered.filter(b => b.criteria_type === 'collection').sort((a, b) => a.criteria_value - b.criteria_value) },
      { key: 'yearly', title: 'Jahres-Badges', icon: ICON_TERMIN, color: FARBEN.textSystem, badges: filtered.filter(b => b.criteria_type === 'yearly').sort((a, b) => a.criteria_value - b.criteria_value) }
    ];

    return categories.filter(cat => cat.badges.length > 0);
  };

  const badgeCategories = getBadgeCategories();
  const earnedSecretCount = badges.filter(b => b.is_earned && b.is_hidden).length;

  const getBadgeColor = (badge: Badge) => {
    if (badge.color) return badge.color;
    if (badge.criteria_type === 'total_points') {
      if (badge.criteria_value <= 5) return FARBEN.bronze;
      if (badge.criteria_value <= 15) return FARBEN.silber;
      return FARBEN.gold;
    }
    return FARBEN.abzeichenFallback;
  };

  const [presentBadgePopover] = useIonPopover(BadgePopoverContent, {
    dataRef: badgePopoverRef
  });

  const handleBadgeClick = (badge: Badge, e: React.MouseEvent) => {
    // showProgress: nur hier liegen progress_points/-percentage und
    // criteria_extra vor — die uebrigen Ansichten laden sie gar nicht.
    badgePopoverRef.current = { badge, showProgress: true };
    presentBadgePopover({
      event: e.nativeEvent,
      side: 'bottom',
      alignment: 'center',
      cssClass: 'badge-detail-popover badge-popover-auto-width'
    });
  };

  return (
    <div>
      <SectionHeader
        title="Deine Badges"
        subtitle="Sammle alle Erfolge!"
        // Band wie im Tab und im Onboarding: Die Sache
        // trug vier Zeichen -- Stern im Tab, Pokal hier, Band bei Teamer und
        // Leitung. Ein Konfi sah fuer dasselbe Stern UND Pokal.
        icon={ICON_ABZEICHEN_GEFUELLT}
        preset="badges"
        stats={[
          { value: badges.filter(b => b.is_earned && !b.is_hidden).length, label: 'ERREICHT' },
          ...(badgeStats.totalSecret > 0 ? [{ value: earnedSecretCount, label: 'GEHEIM' }] : []),
          { value: (badgeStats.totalVisible + badgeStats.totalSecret) === 0 ? 0 : Math.round((badges.filter(b => b.is_earned).length / (badgeStats.totalVisible + badgeStats.totalSecret)) * 100), label: 'PROZENT' }
        ]}
      />

      {/* Suche & Filter — wie Events-Pattern: Section-Header, Suchleiste, dann Tab-Leiste */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--warning">
            <IonIcon icon={ICON_FILTER} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          <IonItem>
            <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
            <IonInput
              value={searchText}
              onIonInput={(e) => setSearchText(e.detail.value || '')}
              placeholder="Badges durchsuchen..."
            />
          </IonItem>
        </IonItemGroup>
      </IonList>

      <div className="app-segment-wrapper">
        <IonSegment value={selectedFilter} onIonChange={(e) => onFilterChange(e.detail.value as string)}>
          <IonSegmentButton value="alle"><IonLabel>Alle</IonLabel></IonSegmentButton>
          <IonSegmentButton value="nicht_erhalten"><IonLabel>Offen</IonLabel></IonSegmentButton>
          <IonSegmentButton value="in_arbeit"><IonLabel>In Arbeit</IonLabel></IonSegmentButton>
        </IonSegment>
      </div>

      {/* Badges Grid */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--warning">
            <IonIcon icon={ICON_ABZEICHEN_GEFUELLT} />
          </div>
          <IonLabel>Erreichte Badges ({badges.filter(b => b.is_earned).length})</IonLabel>
        </IonListHeader>
        {badgeCategories.length === 0 ? (
          <IonCard className="app-card">
            <IonCardContent>
              {selectedFilter === 'nicht_erhalten' ? (
                <EmptyState
                  icon={ICON_ZUSAGE_GEFUELLT}
                  title="Alle Badges erreicht!"
                  message="Du hast alle sichtbaren Badges eingesammelt."
                  iconColor="var(--app-color-badges)"
                />
              ) : selectedFilter === 'in_arbeit' ? (
                <EmptyState
                  icon={ICON_POKAL}
                  title="Keine Badges in Arbeit"
                  message="Sammle Punkte, um den Fortschritt bei Badges zu starten!"
                  iconColor="var(--app-color-badges)"
                />
              ) : (
                <EmptyState
                  icon={ICON_POKAL}
                  title="Keine Badges gefunden"
                  message="Sammle Punkte für deine ersten Badges!"
                  iconColor="var(--app-color-badges)"
                />
              )}
            </IonCardContent>
          </IonCard>
        ) : (
          badgeCategories.map((category, index) => {
            const earnedCount = category.badges.filter(b => b.is_earned).length;
            const totalCount = category.badges.length;
            const progressPercent = Math.round((earnedCount / totalCount) * 100);
            const categorySecretCount = category.badges.filter(b => b.is_hidden).length;
            const categoryEarnedSecretCount = category.badges.filter(b => b.is_hidden && b.is_earned).length;
            const categoryHasUndiscoveredSecrets = categorySecretCount > categoryEarnedSecretCount;

            return (
              <IonCard key={category.key} className="app-card" style={{ marginTop: index > 0 ? 'var(--app-abstand-eng)' : '0' }}>
                <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
                  {/* Category Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--app-abstand-basis)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)' }}>
                      <div style={{
                        width: '42px', height: '42px', borderRadius: 'var(--app-radius-karte)',
                        background: `linear-gradient(135deg, ${category.color} 0%, ${category.color}cc 100%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: `0 4px 12px ${category.color}40`
                      }}>
                        <IonIcon icon={category.icon} style={{ fontSize: 'var(--app-text-titel)', color: 'white' }} />
                      </div>
                      <div>
                        <h3 style={{ margin: '0', fontSize: 'var(--app-text-gross)', fontWeight: 'var(--app-schrift-fett)', color: 'var(--app-text-primary)' }}>{category.title}</h3>
                        <span style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-tertiary)' }}>{earnedCount} von {totalCount}</span>
                      </div>
                    </div>

                    {/* Progress Circle */}
                    <div style={{ width: '48px', height: '48px', position: 'relative' }}>
                      <svg width="48" height="48" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="24" cy="24" r="20" fill="none" stroke={FARBEN.silberHell} strokeWidth="4" />
                        <circle cx="24" cy="24" r="20" fill="none" stroke={category.color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${progressPercent * 1.257} 125.7`} />
                      </svg>
                      <span style={{
                        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        fontSize: progressPercent === 100 && categoryHasUndiscoveredSecrets ? 'var(--app-text-winzig)' : 'var(--app-text-meta)',
                        fontWeight: 'var(--app-schrift-fett)', color: category.color
                      }}>
                        {progressPercent === 100 && categoryHasUndiscoveredSecrets ? '100%?' : `${progressPercent}%`}
                      </span>
                    </div>
                  </div>

                  {/* 3-Column Badge Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 'var(--app-abstand-mittel)'
                  }}>
                    {category.badges.map((badge) => {
                      const badgeColor = getBadgeColor(badge);
                      const isEarned = badge.is_earned;
                      const hasProgress = !isEarned && (badge.progress_percentage ?? 0) > 0;

                      return (
                        <div
                          key={badge.id}
                          onClick={(e) => handleBadgeClick(badge, e)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            padding: 'var(--app-abstand-mittel) var(--app-abstand-eng)',
                            borderRadius: 'var(--app-radius-gross)',
                            background: isEarned ? `${badgeColor}10` : 'var(--app-surface-muted)',
                            border: isEarned ? `2px solid ${badgeColor}40` : '2px solid transparent',
                            cursor: 'pointer',
                            transition: 'transform 0.2s',
                            position: 'relative',
                            minHeight: '110px',
                            justifyContent: 'flex-start',
                            minWidth: 0,
                            overflow: 'hidden'
                          }}
                        >
                          {/* Badge Icon */}
                          <div style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: 'var(--app-radius-kreis)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: isEarned
                              ? `linear-gradient(145deg, ${badgeColor} 0%, ${badgeColor}cc 100%)`
                              : 'var(--app-gradient-badge-gesperrt)',
                            boxShadow: isEarned ? `0 4px 12px ${badgeColor}40` : '0 2px 8px rgba(0,0,0,0.1)',
                            position: 'relative',
                            marginBottom: 'var(--app-abstand-eng)'
                          }}>
                            {/* Progress Ring */}
                            {hasProgress && (
                              <svg style={{ position: 'absolute', top: '-4px', left: '-4px', width: '64px', height: '64px', transform: 'rotate(-90deg)' }}>
                                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth="3" />
                                <circle cx="32" cy="32" r="28" fill="none" stroke={FARBEN.abzeichenFallback} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(badge.progress_percentage || 0) * 1.76} 176`} />
                              </svg>
                            )}

                            <IonIcon
                              icon={getIconFromString(badge.icon)}
                              style={{
                                fontSize: 'var(--app-anzeige-basis)',
                                color: isEarned ? 'white' : 'var(--app-text-muted)'
                              }}
                            />

                            {/* Earned Checkmark */}
                            {isEarned && (
                              <div style={{
                                position: 'absolute',
                                bottom: '-2px',
                                right: '-2px',
                                width: '20px',
                                height: '20px',
                                borderRadius: 'var(--app-radius-kreis)',
                                background: 'var(--app-color-success)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid white'
                              }}>
                                <IonIcon icon={ICON_HAKEN_GEFUELLT} style={{ fontSize: 'var(--app-text-meta)', color: 'white' }} />
                              </div>
                            )}

                            {/* Lock for not earned */}
                            {!isEarned && !hasProgress && (
                              <div style={{
                                position: 'absolute',
                                bottom: '-2px',
                                right: '-2px',
                                width: '20px',
                                height: '20px',
                                borderRadius: 'var(--app-radius-kreis)',
                                background: 'var(--app-text-system)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid white'
                              }}>
                                <IonIcon icon={ICON_SPERRE_GEFUELLT} style={{ fontSize: 'var(--app-text-winzig)', color: 'white' }} />
                              </div>
                            )}
                          </div>

                          {/* Badge Name */}
                          <span style={{
                            fontSize: 'var(--app-text-klein)',
                            fontWeight: 'var(--app-schrift-halbfett)',
                            color: isEarned ? 'var(--app-text-primary)' : 'var(--app-text-muted)',
                            textAlign: 'center',
                            lineHeight: '1.2',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: 'vertical'
                          }}>
                            {badge.name || ''}
                          </span>

                          {/* Progress percentage for in-progress badges */}
                          {hasProgress && (
                            <span style={{
                              fontSize: 'var(--app-text-mini)',
                              fontWeight: 'var(--app-schrift-fett)',
                              color: 'var(--app-color-users)',
                              marginTop: 'var(--app-abstand-winzig)'
                            }}>
                              {Math.round(badge.progress_percentage || 0)}%
                            </span>
                          )}

                          {/* Secret Badge Eselsohr */}
                          {badge.is_hidden && badge.is_earned && (
                            <div className="app-corner-badges">
                              <div
                                className="app-corner-badge"
                                style={{
                                  background: 'var(--app-gradient-rakete)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: 'var(--app-abstand-mini) var(--app-abstand-eng)'
                                }}
                                title="Geheimes Badge"
                              >
                                <IonIcon icon={ICON_VERBORGEN_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </IonCardContent>
              </IonCard>
            );
          })
        )}
      </IonList>

    </div>
  );
};

export default BadgesView;
