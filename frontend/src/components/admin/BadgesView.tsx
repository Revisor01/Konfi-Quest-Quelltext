import React, { useState, useEffect } from 'react';
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
  ICON_ABZEICHEN,
  ICON_ABZEICHEN_GEFUELLT,
  ICON_FILTER,
  ICON_HAKEN_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_POKAL_GEFUELLT,
  ICON_SCHLIESSEN_GEFUELLT,
  ICON_SICHTBAR_GEFUELLT,
  ICON_SUCHE_GEFUELLT,
  ICON_VERBORGEN_GEFUELLT,
} from '../shared/icons';
import api from '../../services/api';
import { filterBySearchTerm } from '../../utils/helpers';
import { SectionHeader, ListSection } from '../shared';

import { closeOpenSlidingItems } from '../../utils/slidingItems';
import { getIconFromString } from '../../utils/badgeIcons';
import { getCriteriaIcon as getCriteriaTypeIcon } from '../../utils/badgeCriteria';
import type { BadgeKriteriumExtra } from '../../utils/badgeCriteria';
import { punkteText } from '../../utils/punkteText';



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
  onSelectBadge: (badge: Badge) => void;
  onDeleteBadge: (badge: Badge) => void;
  targetRole?: 'konfi' | 'teamer';
  onRoleChange?: (role: 'konfi' | 'teamer') => void;
}

const BadgesView: React.FC<BadgesViewProps> = ({
  badges,
  onSelectBadge,
  onDeleteBadge,
  targetRole = 'konfi',
  onRoleChange
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('alle');

  const [activityNames, setActivityNames] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    api.get(`/admin/activities?target_role=${targetRole}`)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res.data) ? res.data : [];
        const map: Record<number, string> = {};
        list.forEach((a: { id: number; name: string }) => { map[a.id] = a.name; });
        setActivityNames(map);
      })
      .catch(() => { if (!cancelled) setActivityNames({}); });
    return () => { cancelled = true; };
  }, [targetRole]);

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
    
    // Sort by criteria_type first, then by name.
    // NULL-SICHER: custom_badges.criteria_type und .name duerfen laut Schema
    // NULL sein. Aktuell gibt es keinen solchen Datensatz, aber genau dieses
    // Muster hat bei den Aktivitäten zum Rauswurf geführt (11.08.):
    // null.localeCompare() wirft, der Render bricht ab, die ErrorBoundary
    // leert Auth + Cache.
    result = result.sort((a, b) => {
      const typeCompare = (a.criteria_type || '').localeCompare(b.criteria_type || '');
      if (typeCompare !== 0) return typeCompare;
      return (a.name || '').localeCompare(b.name || '');
    });
    
    return result;
  })();

  const getActiveBadges = () => {
    return badges.filter(badge => badge.is_active && !badge.is_hidden);
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
      case 'category_combination': return 'Kategorie-Kombination';
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

  const getCriteriaDetail = (badge: Badge): string | null => {
    let extra: BadgeKriteriumExtra = {};
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
        return punkteText(badge.criteria_value);
      case 'both_categories':
        return `${punkteText(badge.criteria_value)} pro Kategorie`;
      case 'specific_activity': {
        if (extra.required_activity_name) {
          return `${badge.criteria_value}x ${extra.required_activity_name}`;
        }
        if (!extra.activity_id) return `${badge.criteria_value}x`;
        const name = activityNames[extra.activity_id];
        return name
          ? `${badge.criteria_value}x ${name}`
          : `${badge.criteria_value}x Aktivität #${extra.activity_id}`;
      }
      case 'activity_combination': {
        // Wie oben: neu gespeichert stehen hier Namen (required_activities).
        if (extra.required_activities?.length) {
          const n = extra.required_activities;
          return n.length <= 2
            ? `${n.join(' + ')}, min. ${badge.criteria_value}x`
            : `${n.length} Aktivitäten, min. ${badge.criteria_value}x`;
        }
        if (!extra.activity_ids?.length) return null;
        // Bis zu zwei Namen ausschreiben, danach zählen — sonst sprengt die
        // Zeile die Listenbreite.
        const names = extra.activity_ids
          .map((id: number) => activityNames[id])
          .filter(Boolean);
        if (names.length === extra.activity_ids.length && names.length <= 2) {
          return `${names.join(' + ')}, min. ${badge.criteria_value}x`;
        }
        return `${extra.activity_ids.length} Aktivitäten, min. ${badge.criteria_value}x`;
      }
      case 'category_activities':
        return extra.required_category ? `${badge.criteria_value}x in "${extra.required_category}"` : `${badge.criteria_value}x`;
      case 'category_combination': {
        // Wie bei activity_combination: bis zu zwei Namen ausschreiben, danach
        // zaehlen, sonst sprengt die Zeile die Listenbreite.
        const k = extra.required_categories ?? [];
        if (!k.length) return `${badge.criteria_value} Kategorien`;
        return k.length <= 2
          ? `${k.join(' + ')}, min. ${badge.criteria_value}`
          : `${badge.criteria_value} aus ${k.length} Kategorien`;
      }
      case 'time_based': {
        const weeks = extra.days ? Math.round(extra.days / 7) : (extra.weeks || '?');
        return `${badge.criteria_value} in ${weeks} Wochen`;
      }
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



  return (
    <>
      <SectionHeader
        title="Badges"
        subtitle="Auszeichnungen und Erfolge"
        icon={ICON_ABZEICHEN_GEFUELLT}
        preset="badges"
        stats={[
          { value: badges.length, label: 'GESAMT', onClick: () => setSelectedFilter('alle'), active: selectedFilter === 'alle' },
          { value: getActiveBadges().length, label: 'AKTIV', onClick: () => setSelectedFilter('aktiv'), active: selectedFilter === 'aktiv' },
          // "Verliehen" ist eine Summe über alle Abzeichen, kein Filterzustand
          // -> bleibt bewusst reine Anzeige.
          { value: getTotalEarnedCount(), label: 'VERLIEHEN' }
        ]}
      />

      {/* Konfis / Teamer:innen Segment */}
      {onRoleChange && (
        <IonSegment
          value={targetRole}
          onIonChange={(e) => onRoleChange(e.detail.value as 'konfi' | 'teamer')}
          style={{ margin: '0 var(--app-abstand-basis) var(--app-abstand-eng)', maxWidth: 'calc(100% - 32px)' }}
        >
          <IonSegmentButton value="konfi">
            <IonLabel>Konfis</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="teamer">
            <IonLabel>Team</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      )}

      {/* Suche */}
      <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
        <IonListHeader>
          <div className="app-section-icon app-section-icon--badges">
            <IonIcon icon={ICON_FILTER} />
          </div>
          <IonLabel>Suche & Filter</IonLabel>
        </IonListHeader>
        <IonItemGroup>
          <IonItem>
            <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
            <IonInput aria-label="Badges durchsuchen"
              value={searchTerm}
              onIonInput={(e) => setSearchTerm(e.detail.value!)}
              placeholder="Badges durchsuchen..."
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
          icon={ICON_ABZEICHEN}
          title="Badges"
          count={0}
          iconColorClass="badges"
          emptyIcon={ICON_ABZEICHEN}
          emptyTitle="Keine Badges gefunden"
          emptyMessage="Erstelle deinen ersten Badge!"
          emptyIconColor="var(--app-color-badges)"
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
            <IonList key={criteriaType} inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--badges">
                  <IonIcon icon={getCriteriaTypeIcon(criteriaType)} />
                </div>
                <IonLabel>{getCriteriaTypeText(criteriaType)} ({typeBadges.length})</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {typeBadges.map((badge, index) => {
                      const badgeColor = badge.color || 'var(--app-color-users)';
                      const isInactive = !badge.is_active;

                      // Status-Farbe und Text (Aktiv/Inaktiv)
                      const activeColor = badge.is_active ? 'var(--app-color-success)' : 'var(--app-color-danger)';
                      const activeText = badge.is_active ? 'Aktiv' : 'Inaktiv';

                      // Sichtbarkeits-Farbe und Text (Sichtbar/Geheim)
                      const visibilityColor = badge.is_hidden ? 'var(--app-color-bonus)' : 'var(--app-color-info)';
                      const visibilityText = badge.is_hidden ? 'Geheim' : 'Sichtbar';

                      return (
                        <IonItemSliding key={badge.id} style={{ marginBottom: index < typeBadges.length - 1 ? 'var(--app-abstand-eng)' : '0' }}>
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
                                  style={{ backgroundColor: visibilityColor, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
                                  title={visibilityText}
                                  role="img"
                                  aria-label={visibilityText}
                                >
                                  <IonIcon icon={badge.is_hidden ? ICON_VERBORGEN_GEFUELLT : ICON_SICHTBAR_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                                </div>
                                <div className="app-corner-badges__separator" />
                                {/* Aktiv/Inaktiv-Badge */}
                                <div
                                  className="app-corner-badge"
                                  style={{ backgroundColor: activeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--app-abstand-mini) var(--app-abstand-eng)' }}
                                  title={activeText}
                                  role="img"
                                  aria-label={activeText}
                                >
                                  <IonIcon icon={badge.is_active ? ICON_HAKEN_GEFUELLT : ICON_SCHLIESSEN_GEFUELLT} style={{ color: 'white', fontSize: 'var(--app-text-sekundaer)' }} />
                                </div>
                              </div>
                              <div className="app-list-item__row">
                                <div className="app-list-item__main">
                                  {/* Badge Icon - mit Badge-eigener Farbe */}
                                  <div
                                    className="app-icon-circle app-icon-circle--lg"
                                    style={{ backgroundColor: isInactive ? 'var(--app-text-muted)' : badgeColor }}
                                  >
                                    <IonIcon icon={getIconFromString(badge.icon)} />
                                  </div>

                                  {/* Content */}
                                  <div className="app-list-item__content">
                                    {/* Zeile 1: Titel */}
                                    <div
                                      className="app-list-item__title"
                                      style={{
                                        color: isInactive ? 'var(--app-text-muted)' : undefined,
                                        paddingRight: 'var(--app-freiraum-aktion-xxxl)'
                                      }}
                                    >
                                      {badge.name}
                                    </div>

                                    {/* Zeile 2: Beschreibung */}
                                    {badge.description && (
                                      <div className="app-list-item__subtitle" style={{
                                        color: isInactive ? 'var(--app-text-muted)' : 'var(--app-text-secondary)',
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
                                          <IonIcon icon={getCriteriaTypeIcon(badge.criteria_type)} style={{ color: isInactive ? 'var(--app-text-muted)' : badgeColor }} />
                                          {getCriteriaDetail(badge)}
                                        </span>
                                      )}
                                      <span className="app-list-item__meta-item">
                                        <IonIcon icon={ICON_POKAL_GEFUELLT} style={{ color: isInactive ? 'var(--app-text-muted)' : 'var(--app-color-warning)' }} />
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
                              onClick={() => { closeOpenSlidingItems(); onDeleteBadge(badge); }}
                              aria-label="Badge löschen"
                              className="app-swipe-action"
                            >
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                                <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
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