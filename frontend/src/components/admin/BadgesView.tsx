import React, { useState } from 'react';
import {
  IonCard,
  IonCardContent,
  IonIcon,
  IonItem,
  IonItemGroup,
  IonLabel,
  IonInput,
  IonSegment,
  IonSegmentButton,
  IonList,
  IonListHeader,
  IonItemSliding,
  IonItemOptions,
  IonItemOption
} from '@ionic/react';
import {
  trash,
  ribbon,
  ribbonOutline,
  trophy,
  checkmark,
  close,
  eye,
  eyeOff,
  medal,
  flame,
  heart,
  thumbsUp,
  flash,
  diamond,
  rocket,
  shield,
  sparkles,
  sunny,
  moon,
  leaf,
  rose,
  gift,
  balloon,
  musicalNote,
  book,
  school,
  restaurant,
  fitness,
  bicycle,
  car,
  airplane,
  boat,
  home,
  business,
  construct,
  hammer,
  brush,
  colorPalette,
  camera,
  image,
  chatbubbles,
  people,
  personAdd,
  checkmarkCircle,
  alertCircle,
  informationCircle,
  helpCircle,
  flag,
  pin,
  navigate,
  location,
  compass,
  timer,
  stopwatch,
  calendar,
  today,
  time,
  filterOutline,
  search,
  statsChart,
  grid,
  listOutline,
  pricetag
} from 'ionicons/icons';
import { filterBySearchTerm } from '../../utils/helpers';
import { SectionHeader, ListSection } from '../shared';

import { star } from 'ionicons/icons';

// Badge Icon Mapping (shared with BadgeManagementModal)
const BADGE_ICONS: Record<string, any> = {
  trophy, medal, ribbon, star, checkmarkCircle, diamond, shield,
  flame, flash, rocket, sparkles, thumbsUp,
  heart, people, personAdd, chatbubbles, gift,
  book, school, construct, brush, colorPalette,
  sunny, moon, leaf, rose,
  calendar, today, time, timer, stopwatch,
  restaurant, fitness, bicycle, car, airplane, boat, camera, image, musicalNote, balloon,
  home, business, location, navigate, compass, pin, flag,
  informationCircle, helpCircle, alertCircle, hammer
};

// Helper function to get icon from string
const getIconFromString = (iconName: string) => {
  return BADGE_ICONS[iconName] || ribbon;
};

interface Badge {
  id: number;
  name: string;
  icon: string;
  description?: string;
  criteria_type: string;
  criteria_value: number;
  criteria_extra?: string;
  is_active: boolean;
  is_hidden: boolean;
  earned_count: number;
  created_at: string;
  color?: string;
}

interface BadgesViewProps {
  badges: Badge[];
  onUpdate: () => void;
  onAddBadgeClick: () => void;
  onSelectBadge: (badge: Badge) => void;
  onDeleteBadge: (badge: Badge) => void;
  targetRole?: 'konfi' | 'teamer';
  onRoleChange?: (role: 'konfi' | 'teamer') => void;
}

const BadgesView: React.FC<BadgesViewProps> = ({
  badges,
  onUpdate,
  onAddBadgeClick,
  onSelectBadge,
  onDeleteBadge,
  targetRole = 'konfi',
  onRoleChange
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('alle');

  const filteredAndSortedBadges = (() => {
    let result = filterBySearchTerm(badges, searchTerm, ['name', 'description']);
    
    // Filter by status
    if (selectedFilter === 'aktiv') {
      result = result.filter(badge => badge.is_active && !badge.is_hidden);
    } else if (selectedFilter === 'versteckt') {
      result = result.filter(badge => badge.is_hidden);
    } else if (selectedFilter === 'inaktiv') {
      result = result.filter(badge => !badge.is_active);
    }
    
    // Sort by criteria_type first, then by name
    result = result.sort((a, b) => {
      const typeCompare = a.criteria_type.localeCompare(b.criteria_type);
      if (typeCompare !== 0) return typeCompare;
      return a.name.localeCompare(b.name);
    });
    
    return result;
  })();

  const getActiveBadges = () => {
    return badges.filter(badge => badge.is_active && !badge.is_hidden);
  };

  const getHiddenBadges = () => {
    return badges.filter(badge => badge.is_hidden);
  };

  const getInactiveBadges = () => {
    return badges.filter(badge => !badge.is_active);
  };

  const getTotalEarnedCount = () => {
    return badges.reduce((sum, badge) => sum + (badge.earned_count || 0), 0);
  };

  const getCriteriaTypeText = (type: string) => {
    switch (type) {
      case 'total_points': return 'Gesamtpunkte';
      case 'gottesdienst_points': return 'Gottesdienst';
      case 'gemeinde_points': return 'Gemeinde';
      case 'specific_activity': return 'Spezielle Aktivität';
      case 'both_categories': return 'Beide Kategorien';
      case 'activity_combination': return 'Aktivitätskombination';
      case 'category_activities': return 'Kategorie-Aktivitäten';
      case 'time_based': return 'Zeitbasiert';
      case 'activity_count': return 'Aktivitätsanzahl';
      case 'event_count': return 'Event-Teilnahmen';
      case 'mandatory_event_count': return 'Pflicht-Anwesenheit';
      case 'bonus_points': return 'Bonuspunkte';
      case 'streak': return 'Serie';
      case 'unique_activities': return 'Einzigartige Aktivitäten';
      case 'teamer_year': return 'Teamer-Jahre';
      default: return type;
    }
  };

  const getCriteriaTypeIcon = (type: string) => {
    switch (type) {
      case 'total_points': return statsChart;
      case 'gottesdienst_points': return home;
      case 'gemeinde_points': return people;
      case 'specific_activity': return flash;
      case 'both_categories': return grid;
      case 'activity_combination': return listOutline;
      case 'category_activities': return pricetag;
      case 'time_based': return time;
      case 'activity_count': return checkmarkCircle;
      case 'event_count': return calendar;
      case 'mandatory_event_count': return shield;
      case 'bonus_points': return star;
      case 'streak': return flame;
      case 'unique_activities': return sparkles;
      case 'teamer_year': return calendar;
      default: return flash;
    }
  };

  const getCriteriaDetail = (badge: Badge): string | null => {
    let extra: any = {};
    try {
      if (badge.criteria_extra) {
        let parsed = typeof badge.criteria_extra === 'string'
          ? JSON.parse(badge.criteria_extra)
          : badge.criteria_extra;
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        extra = parsed || {};
      }
    } catch { /* ignore */ }

    switch (badge.criteria_type) {
      case 'total_points':
      case 'gottesdienst_points':
      case 'gemeinde_points':
      case 'bonus_points':
        return `${badge.criteria_value} Punkte`;
      case 'both_categories':
        return `${badge.criteria_value} Punkte pro Kategorie`;
      case 'specific_activity':
        return extra.activity_id ? `${badge.criteria_value}x Aktivität #${extra.activity_id}` : `${badge.criteria_value}x`;
      case 'activity_combination':
        return extra.activity_ids?.length ? `${extra.activity_ids.length} Aktivitäten, min. ${badge.criteria_value}x` : null;
      case 'category_activities':
        return extra.required_category ? `${badge.criteria_value}x in "${extra.required_category}"` : `${badge.criteria_value}x`;
      case 'time_based':
        const weeks = extra.days ? Math.round(extra.days / 7) : (extra.weeks || '?');
        return `${badge.criteria_value} in ${weeks} Wochen`;
      case 'activity_count':
        return `${badge.criteria_value} Aktivitäten`;
      case 'event_count':
        return `${badge.criteria_value} Events`;
      case 'streak':
        return `${badge.criteria_value} Wochen am Stück`;
      case 'unique_activities':
        return `${badge.criteria_value} verschiedene`;
      case 'teamer_year':
        return `${badge.criteria_value} Jahr${badge.criteria_value !== 1 ? 'e' : ''} als Teamer:in`;
      default:
        return `Wert: ${badge.criteria_value}`;
    }
  };

  const getBadgeStatusColor = (badge: Badge) => {
    if (!badge.is_active) return 'danger';
    if (badge.is_hidden) return 'warning';
    return 'success';
  };

  const getBadgeStatusText = (badge: Badge) => {
    if (!badge.is_active) return 'Inaktiv';
    if (badge.is_hidden) return 'Versteckt';
    return 'Aktiv';
  };

  return (
    <>
      <SectionHeader
        title="Badges"
        subtitle="Auszeichnungen und Erfolge"
        icon={ribbon}
        preset="badges"
        stats={[
          { value: badges.length, label: 'GESAMT' },
          { value: getActiveBadges().length, label: 'AKTIV' },
          { value: getTotalEarnedCount(), label: 'VERLIEHEN' }
        ]}
      />

      {/* Konfis / Teamer:innen Segment */}
      {onRoleChange && (
        <IonSegment
          value={targetRole}
          onIonChange={(e) => onRoleChange(e.detail.value as 'konfi' | 'teamer')}
          style={{ margin: '0 16px 8px', maxWidth: 'calc(100% - 32px)' }}
        >
          <IonSegmentButton value="konfi">
            <IonLabel>Konfis</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="teamer">
            <IonLabel>Teamer:innen</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      )}

      {/* Suche */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--badges">
            <IonIcon icon={filterOutline} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          <IonItem>
            <IonIcon icon={search} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
            <IonInput
              value={searchTerm}
              onIonInput={(e) => setSearchTerm(e.detail.value!)}
              placeholder="Badge suchen..."
            />
          </IonItem>
        </IonItemGroup>
      </IonList>

      {/* Status-Filter */}
      <div className="app-segment-wrapper">
        <IonSegment
          value={selectedFilter}
          onIonChange={(e) => setSelectedFilter(e.detail.value as string)}
        >
          <IonSegmentButton value="alle">
            <IonLabel>Alle</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="aktiv">
            <IonLabel>Aktiv</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="versteckt">
            <IonLabel>Geheim</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="inaktiv">
            <IonLabel>Inaktiv</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </div>

      {/* Badges Liste - Gruppiert nach Typ */}
      {filteredAndSortedBadges.length === 0 ? (
        <ListSection
          icon={ribbonOutline}
          title="Badges"
          count={0}
          iconColorClass="badges"
          emptyIcon={ribbonOutline}
          emptyTitle="Keine Badges gefunden"
          emptyMessage="Erstelle deinen ersten Badge!"
          emptyIconColor="#f59e0b"
        >
          <></>
        </ListSection>
      ) : (
        (() => {
          // Gruppiere Badges nach criteria_type
          const groupedBadges = filteredAndSortedBadges.reduce((acc, badge) => {
            const type = badge.criteria_type;
            if (!acc[type]) acc[type] = [];
            acc[type].push(badge);
            return acc;
          }, {} as Record<string, Badge[]>);

          // Sortiere die Gruppen alphabetisch nach deutschem Namen
          const sortedGroups = Object.entries(groupedBadges).sort((a, b) =>
            getCriteriaTypeText(a[0]).localeCompare(getCriteriaTypeText(b[0]))
          );

          return sortedGroups.map(([criteriaType, typeBadges]) => (
            <IonList key={criteriaType} inset={true} style={{ margin: '16px' }}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--badges">
                  <IonIcon icon={getCriteriaTypeIcon(criteriaType)} />
                </div>
                <IonLabel>{getCriteriaTypeText(criteriaType)} ({typeBadges.length})</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent style={{ padding: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {typeBadges.map((badge, index) => {
                      const badgeColor = badge.color || '#667eea';
                      const isInactive = !badge.is_active;

                      // Status-Farbe und Text (Aktiv/Inaktiv)
                      const activeColor = badge.is_active ? '#34c759' : '#dc3545';
                      const activeText = badge.is_active ? 'Aktiv' : 'Inaktiv';

                      // Sichtbarkeits-Farbe und Text (Sichtbar/Geheim)
                      const visibilityColor = badge.is_hidden ? '#fd7e14' : '#007aff';
                      const visibilityText = badge.is_hidden ? 'Geheim' : 'Sichtbar';

                      return (
                        <IonItemSliding key={badge.id} style={{ marginBottom: index < typeBadges.length - 1 ? '8px' : '0' }}>
                          <IonItem
                            button
                            onClick={() => onSelectBadge(badge)}
                            detail={false}
                            lines="none"
                            style={{
                              '--background': 'transparent',
                              '--padding-start': '0',
                              '--padding-end': '0',
                              '--inner-padding-end': '0',
                              '--inner-border-width': '0',
                              '--border-style': 'none',
                              '--min-height': 'auto'
                            }}
                          >
                            <div
                              className="app-list-item app-list-item--warning"
                              style={{
                                width: '100%',
                                borderLeftColor: badgeColor,
                                opacity: isInactive ? 0.6 : 1,
                                position: 'relative',
                                overflow: 'hidden'
                              }}
                            >
                              {/* Dual Corner Badges - Sichtbarkeit + Aktivitaet als Icons */}
                              <div className="app-corner-badges">
                                {/* Sichtbarkeits-Badge */}
                                <div
                                  className="app-corner-badge"
                                  style={{ backgroundColor: visibilityColor, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                                  title={visibilityText}
                                >
                                  <IonIcon icon={badge.is_hidden ? eyeOff : eye} style={{ color: '#fff', fontSize: '0.85rem' }} />
                                </div>
                                <div className="app-corner-badges__separator" />
                                {/* Aktiv/Inaktiv-Badge */}
                                <div
                                  className="app-corner-badge"
                                  style={{ backgroundColor: activeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                                  title={activeText}
                                >
                                  <IonIcon icon={badge.is_active ? checkmark : close} style={{ color: '#fff', fontSize: '0.85rem' }} />
                                </div>
                              </div>
                              <div className="app-list-item__row">
                                <div className="app-list-item__main">
                                  {/* Badge Icon - mit Badge-eigener Farbe */}
                                  <div
                                    className="app-icon-circle app-icon-circle--lg"
                                    style={{ backgroundColor: isInactive ? '#999' : badgeColor }}
                                  >
                                    <IonIcon icon={getIconFromString(badge.icon)} />
                                  </div>

                                  {/* Content */}
                                  <div className="app-list-item__content">
                                    {/* Zeile 1: Titel */}
                                    <div
                                      className="app-list-item__title"
                                      style={{
                                        color: isInactive ? '#999' : undefined,
                                        paddingRight: '120px'
                                      }}
                                    >
                                      {badge.name}
                                    </div>

                                    {/* Zeile 2: Beschreibung */}
                                    {badge.description && (
                                      <div className="app-list-item__subtitle" style={{
                                        color: isInactive ? '#999' : '#666',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                      }}>
                                        {badge.description}
                                      </div>
                                    )}

                                    {/* Zeile 3: Kriterien-Details + Verliehen-Count */}
                                    <div className="app-list-item__meta">
                                      {getCriteriaDetail(badge) && (
                                        <span className="app-list-item__meta-item">
                                          <IonIcon icon={getCriteriaTypeIcon(badge.criteria_type)} style={{ color: isInactive ? '#999' : badgeColor }} />
                                          {getCriteriaDetail(badge)}
                                        </span>
                                      )}
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={trophy} style={{ color: isInactive ? '#999' : '#ff9500' }} />
                                        {badge.earned_count || 0}x verliehen
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </IonItem>

                          <IonItemOptions side="end" className="app-swipe-actions">
                            <IonItemOption
                              onClick={() => onDeleteBadge(badge)}
                              className="app-swipe-action"
                            >
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                                <IonIcon icon={trash} />
                              </div>
                            </IonItemOption>
                          </IonItemOptions>
                        </IonItemSliding>
                      );
                    })}
                  </div>
                </IonCardContent>
              </IonCard>
            </IonList>
          ));
        })()
      )}
    </>
  );
};

export default BadgesView;