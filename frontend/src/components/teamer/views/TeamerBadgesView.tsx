import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  IonCard,
  IonCardContent,
  IonIcon,
  IonLabel,
  IonList,
  IonListHeader,
  IonSegment,
  IonSegmentButton,
  useIonPopover
} from '@ionic/react';
import {
  trophy,
  trophyOutline,
  checkmarkCircle,
  lockClosed,
  checkmark,
  flame,
  flash,
  sparkles,
  calendar,
  time,
  people,
  ribbon,
  star,
  medal,
  diamond,
  shield,
  rocket,
  thumbsUp,
  heart,
  personAdd,
  chatbubbles,
  gift,
  book,
  school,
  construct,
  brush,
  colorPalette,
  sunny,
  moon,
  leaf,
  rose,
  today,
  timer,
  stopwatch,
  restaurant,
  fitness,
  bicycle,
  car,
  airplane,
  boat,
  camera,
  image,
  musicalNote,
  balloon,
  home,
  business,
  location,
  navigate,
  compass,
  pin,
  flag,
  informationCircle,
  helpCircle,
  alertCircle,
  hammer,
  layersOutline,
  gridOutline,
  prismOutline,
  cubeOutline,
  handLeft,
  eyeOff
} from 'ionicons/icons';
import { SectionHeader, EmptyState } from '../../shared';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';

// Badge Icon Mapping
const BADGE_ICONS: Record<string, string> = {
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

const getIconFromString = (iconName: string): string => {
  return BADGE_ICONS[iconName] || trophy;
};

interface TeamerBadge {
  id: number;
  name: string;
  description?: string;
  icon: string;
  criteria_type: string;
  criteria_value: number;
  criteria_extra?: string;
  is_hidden: boolean;
  is_active: boolean;
  color?: string;
  is_earned: boolean;
  earned_at?: string;
  is_new?: boolean;
  progress_percentage?: number;
  progress_points?: number;
}

// Popover für Badge-Details
// Zeitfenster-Hinweis fuer zeitbasierte Badges (time_based) und Serien (streak).
const getTimeWindowHint = (badge: TeamerBadge): string | null => {
  const fmt = (d: Date) => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  if (badge.criteria_type === 'time_based') {
    let days: number | null = null;
    try {
      const extra = typeof badge.criteria_extra === 'string'
        ? JSON.parse(badge.criteria_extra || '{}') : (badge.criteria_extra || {});
      days = extra.days || (extra.weeks ? extra.weeks * 7 : null);
    } catch { /* ignore */ }
    if (!days) return null;
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return `Zählt die letzten ${days} Tage (seit ${fmt(start)}). Ältere Aktivitäten fallen wieder heraus.`;
  }
  if (badge.criteria_type === 'streak') {
    return 'Zählt aufeinanderfolgende Wochen mit mindestens einer Aktivität. Eine Woche ohne Aktivität setzt die Serie zurück.';
  }
  return null;
};

const BadgePopoverContent: React.FC<{
  badgeRef: React.RefObject<{ badge: TeamerBadge | null; getBadgeColor: (badge: TeamerBadge) => string }>;
}> = ({ badgeRef }) => {
  const data = badgeRef.current;
  if (!data || !data.badge) return null;
  const badge = data.badge;
  const badgeColor = data.getBadgeColor(badge);
  const timeWindowHint = getTimeWindowHint(badge);

  return (
    <div style={{ padding: '12px', background: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: badge.is_earned
            ? `linear-gradient(145deg, ${badgeColor} 0%, ${badgeColor}cc 100%)`
            : 'linear-gradient(145deg, #d0d0d0 0%, #b8b8b8 100%)',
          boxShadow: badge.is_earned
            ? `0 2px 8px ${badgeColor}40`
            : '0 1px 4px rgba(0,0,0,0.1)'
        }}>
          <IonIcon
            icon={getIconFromString(badge.icon)}
            style={{
              fontSize: '1.4rem',
              color: badge.is_earned ? 'white' : '#999'
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: '700', color: '#333', whiteSpace: 'nowrap' }}>
            {badge.name}
          </h3>
          <p style={{
            margin: '0',
            fontSize: '0.8rem',
            color: '#666',
            lineHeight: '1.3'
          }}>
            {badge.description || 'Keine Beschreibung'}
          </p>
        </div>
      </div>
      <div style={{
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid #eee',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        {badge.is_earned ? (
          <>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              background: '#22c55e',
              color: 'white',
              padding: '3px 8px',
              borderRadius: '8px',
              fontSize: '0.7rem',
              fontWeight: '600'
            }}>
              <IonIcon icon={checkmarkCircle} style={{ fontSize: '0.75rem' }} />
              Erreicht
            </div>
            {badge.earned_at && (
              <span style={{ fontSize: '0.7rem', color: '#888' }}>
                {new Date(badge.earned_at).toLocaleDateString('de-DE', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                })}
              </span>
            )}
          </>
        ) : (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            background: '#8e8e93',
            color: 'white',
            padding: '3px 8px',
            borderRadius: '8px',
            fontSize: '0.7rem',
            fontWeight: '600'
          }}>
            <IonIcon icon={lockClosed} style={{ fontSize: '0.7rem' }} />
            Noch nicht erreicht
          </div>
        )}
      </div>
      {timeWindowHint && (
        <div style={{
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid #eee',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '6px',
          fontSize: '0.72rem',
          color: '#888',
          lineHeight: '1.35'
        }}>
          <IonIcon icon={time} style={{ fontSize: '0.85rem', marginTop: '1px', flexShrink: 0 }} />
          <span>{timeWindowHint}</span>
        </div>
      )}
    </div>
  );
};

const TeamerBadgesView: React.FC = () => {
  const [badges, setBadges] = useState<TeamerBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState('alle');
  const badgePopoverRef = useRef<{ badge: TeamerBadge | null; getBadgeColor: (badge: TeamerBadge) => string }>({ badge: null, getBadgeColor: () => '#5b21b6' });

  const loadBadges = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/teamer/badges');
      setBadges(response.data || []);

      // Ungesehene Badges als gesehen markieren
      const unseenBadges = (response.data || []).filter((b: TeamerBadge) => b.is_new && b.is_earned);
      if (unseenBadges.length > 0) {
        if (!networkMonitor.isOnline) {
          writeQueue.enqueue({
            method: 'PUT',
            url: '/teamer/badges/mark-seen',
            maxRetries: 3,
            hasFileUpload: false,
            metadata: { type: 'fire-and-forget', clientId: safeUUID(), label: 'Teamer-Badges gesehen' },
          });
        } else {
          try {
            await api.put('/teamer/badges/mark-seen');
          } catch {
            // Ignorieren
          }
        }
      }
    } catch (err) {
      console.error('Error loading teamer badges:', err);
      setBadges([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBadges();
  }, [loadBadges]);

  const getBadgeColor = (badge: TeamerBadge) => {
    if (badge.color) return badge.color;
    return '#5b21b6'; // Lila Default für Teamer
  };

  const [presentBadgePopover] = useIonPopover(BadgePopoverContent, {
    badgeRef: badgePopoverRef
  });

  const handleBadgeClick = (badge: TeamerBadge, e: React.MouseEvent) => {
    badgePopoverRef.current = { badge, getBadgeColor };
    presentBadgePopover({
      event: e.nativeEvent,
      side: 'top',
      alignment: 'center',
      cssClass: 'badge-detail-popover'
    });
  };

  // Badges filtern
  const getFilteredBadges = () => {
    let filtered = badges;
    switch (selectedFilter) {
      case 'nicht_erhalten':
        filtered = badges.filter(badge => !badge.is_earned);
        break;
      case 'erhalten':
        filtered = badges.filter(badge => badge.is_earned);
        break;
      default:
        filtered = badges;
    }
    return filtered;
  };

  // Badges nach Kriterientyp gruppieren
  const getCriteriaLabel = (type: string) => {
    switch (type) {
      case 'activity_count': return 'Aktiv dabei';
      case 'unique_activities': return 'Vielseitig';
      case 'event_count': return 'Event-Champion';
      case 'streak': return 'Serien-Champion';
      case 'teamer_year': return 'Erfahrung';
      case 'specific_activity': return 'Spezialist';
      case 'activity_combination': return 'Kombinier-Profi';
      case 'category_activities': return 'Kategorie-Meister';
      case 'time_based': return 'Zeitreisender';
      default: return type;
    }
  };

  const getCriteriaIcon = (type: string) => {
    switch (type) {
      case 'activity_count': return checkmarkCircle;
      case 'unique_activities': return gridOutline;
      case 'event_count': return calendar;
      case 'streak': return flame;
      case 'teamer_year': return ribbon;
      case 'specific_activity': return handLeft;
      case 'activity_combination': return prismOutline;
      case 'category_activities': return cubeOutline;
      case 'time_based': return time;
      default: return flash;
    }
  };

  const getCriteriaColor = (type: string) => {
    switch (type) {
      case 'activity_count': return '#3880ff';
      case 'unique_activities': return '#10dc60';
      case 'event_count': return '#e63946';
      case 'streak': return '#eb445a';
      case 'teamer_year': return '#5b21b6';
      case 'specific_activity': return '#ffce00';
      case 'activity_combination': return '#7044ff';
      case 'category_activities': return '#0cd1e8';
      case 'time_based': return '#8e8e93';
      default: return '#5b21b6';
    }
  };

  const filteredBadges = getFilteredBadges();
  const earnedCount = badges.filter(b => b.is_earned).length;

  // Gruppieren nach criteria_type
  const groupedBadges = filteredBadges.reduce((acc, badge) => {
    const type = badge.criteria_type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(badge);
    return acc;
  }, {} as Record<string, TeamerBadge[]>);

  const sortedGroups = Object.entries(groupedBadges).sort((a, b) =>
    getCriteriaLabel(a[0]).localeCompare(getCriteriaLabel(b[0]))
  );

  if (loading) {
    return null;
  }

  return (
    <div>
      {/* Stats Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '24px',
        padding: '12px 16px',
        fontSize: '0.85rem',
        color: '#666'
      }}>
        <span><strong style={{ color: '#5b21b6' }}>{earnedCount}</strong> erreicht</span>
        <span><strong style={{ color: '#999' }}>{badges.length - earnedCount}</strong> offen</span>
      </div>

      {/* Filter */}
      <div style={{ margin: '0 16px 16px' }}>
        <IonSegment value={selectedFilter} onIonChange={(e) => setSelectedFilter(e.detail.value as string)}>
          <IonSegmentButton value="alle"><IonLabel>Alle</IonLabel></IonSegmentButton>
          <IonSegmentButton value="erhalten"><IonLabel>Erreicht</IonLabel></IonSegmentButton>
          <IonSegmentButton value="nicht_erhalten"><IonLabel>Offen</IonLabel></IonSegmentButton>
        </IonSegment>
      </div>

      {/* Badge Grid nach Kategorien */}
      <IonList inset={true} style={{ margin: '16px' }}>
        <IonListHeader>
          <div className="app-section-icon" style={{ backgroundColor: '#5b21b6' }}>
            <IonIcon icon={trophy} />
          </div>
          <IonLabel>Teamer-Badges ({earnedCount}/{badges.length})</IonLabel>
        </IonListHeader>

        {filteredBadges.length === 0 ? (
          <IonCard className="app-card">
            <IonCardContent>
              {selectedFilter === 'erhalten' ? (
                <EmptyState
                  icon={trophyOutline}
                  title="Noch keine Badges erreicht"
                  message="Engagiere dich als Teamer:in, um Badges zu sammeln!"
                  iconColor="#5b21b6"
                />
              ) : selectedFilter === 'nicht_erhalten' ? (
                <EmptyState
                  icon={checkmarkCircle}
                  title="Alle Badges erreicht!"
                  message="Du hast alle verfügbaren Teamer-Badges eingesammelt."
                  iconColor="#22c55e"
                />
              ) : (
                <EmptyState
                  icon={trophyOutline}
                  title="Keine Teamer-Badges"
                  message="Es wurden noch keine Teamer-Badges erstellt."
                  iconColor="#5b21b6"
                />
              )}
            </IonCardContent>
          </IonCard>
        ) : (
          sortedGroups.map(([criteriaType, typeBadges], groupIndex) => {
            const groupEarnedCount = typeBadges.filter(b => b.is_earned).length;
            const groupTotal = typeBadges.length;
            const progressPercent = Math.round((groupEarnedCount / groupTotal) * 100);
            const color = getCriteriaColor(criteriaType);

            return (
              <IonCard key={criteriaType} className="app-card" style={{ marginTop: groupIndex > 0 ? '8px' : '0' }}>
                <IonCardContent style={{ padding: '16px' }}>
                  {/* Category Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '42px', height: '42px', borderRadius: '12px',
                        background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: `0 4px 12px ${color}40`
                      }}>
                        <IonIcon icon={getCriteriaIcon(criteriaType)} style={{ fontSize: '1.3rem', color: 'white' }} />
                      </div>
                      <div>
                        <h3 style={{ margin: '0', fontSize: '1.1rem', fontWeight: '700', color: '#333' }}>{getCriteriaLabel(criteriaType)}</h3>
                        <span style={{ fontSize: '0.85rem', color: '#888' }}>{groupEarnedCount} von {groupTotal}</span>
                      </div>
                    </div>
                    {/* Progress Circle */}
                    <div style={{ width: '48px', height: '48px', position: 'relative' }}>
                      <svg width="48" height="48" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="24" cy="24" r="20" fill="none" stroke="#e8e8e8" strokeWidth="4" />
                        <circle cx="24" cy="24" r="20" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${progressPercent * 1.257} 125.7`} />
                      </svg>
                      <span style={{
                        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        fontSize: '0.7rem', fontWeight: '700', color
                      }}>
                        {progressPercent}%
                      </span>
                    </div>
                  </div>

                  {/* 3-Column Badge Grid */}
                  <div className="app-badge-grid">
                    {typeBadges.map((badge) => {
                      const badgeColor = getBadgeColor(badge);
                      const isEarned = badge.is_earned;
                      const isNew = badge.is_new && isEarned;
                      const isSecret = badge.is_hidden && !isEarned;

                      return (
                        <div
                          key={badge.id}
                          className="app-badge-grid__item"
                          onClick={(e) => !isSecret && handleBadgeClick(badge, e)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            padding: '12px 8px',
                            borderRadius: '16px',
                            background: isSecret ? '#e8e8e8' : isEarned ? `${badgeColor}10` : '#f5f5f5',
                            border: isEarned ? `2px solid ${badgeColor}40` : '2px solid transparent',
                            cursor: isSecret ? 'default' : 'pointer',
                            transition: 'transform 0.2s',
                            position: 'relative'
                          }}
                        >
                          {/* Neu Badge */}
                          {isNew && (
                            <div className="app-corner-badges">
                              <div
                                className="app-corner-badge"
                                style={{
                                  background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)',
                                  fontSize: '0.5rem',
                                  padding: '3px 8px'
                                }}
                              >
                                NEU
                              </div>
                            </div>
                          )}

                          {/* GEHEIM Corner-Badge für verdiente geheime Badges */}
                          {badge.is_hidden && isEarned && (
                            <div className="app-corner-badges">
                              <div
                                className="app-corner-badge"
                                style={{
                                  background: 'linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '4px 8px'
                                }}
                                title="Geheimes Badge"
                              >
                                <IonIcon icon={eyeOff} style={{ color: '#fff', fontSize: '0.85rem' }} />
                              </div>
                            </div>
                          )}

                          {/* Badge Icon */}
                          <div style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: isSecret
                              ? 'linear-gradient(145deg, #c0c0c0 0%, #a0a0a0 100%)'
                              : isEarned
                                ? `linear-gradient(145deg, ${badgeColor} 0%, ${badgeColor}cc 100%)`
                                : 'linear-gradient(145deg, #d0d0d0 0%, #b8b8b8 100%)',
                            boxShadow: isEarned ? `0 4px 12px ${badgeColor}40` : '0 2px 8px rgba(0,0,0,0.1)',
                            position: 'relative',
                            marginBottom: '8px'
                          }}>
                            <IonIcon
                              icon={isSecret ? helpCircle : getIconFromString(badge.icon)}
                              style={{
                                fontSize: isSecret ? '1.5rem' : '1.8rem',
                                color: isEarned ? 'white' : '#999'
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
                                borderRadius: '50%',
                                background: '#22c55e',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid white'
                              }}>
                                <IonIcon icon={checkmark} style={{ fontSize: '0.7rem', color: 'white' }} />
                              </div>
                            )}

                            {/* Lock for not earned (non-hidden) */}
                            {!isEarned && !isSecret && (
                              <div style={{
                                position: 'absolute',
                                bottom: '-2px',
                                right: '-2px',
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                background: '#8e8e93',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid white'
                              }}>
                                <IonIcon icon={lockClosed} style={{ fontSize: '0.6rem', color: 'white' }} />
                              </div>
                            )}
                          </div>

                          {/* Badge Name */}
                          <span className="app-badge-grid__name" style={{
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            color: isEarned ? '#333' : '#999',
                            textAlign: 'center',
                            lineHeight: '1.2',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical'
                          }}>
                            {isSecret ? '???' : badge.name}
                          </span>
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

export default TeamerBadgesView;
