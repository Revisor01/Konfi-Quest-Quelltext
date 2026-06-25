import React, { useEffect, useRef, useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonRefresher,
  IonRefresherContent,
  IonCard,
  IonCardContent,
  IonIcon,
  IonList,
  IonListHeader,
  IonLabel,
  useIonModal,
  useIonPopover
} from '@ionic/react';
import {
  trophy,
  flashOutline,
  schoolOutline,
  starOutline,
  checkmark,
  checkmarkCircle,
  arrowBack
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import PointsHistoryModal from '../../konfi/modals/PointsHistoryModal';
import WrappedModal from '../../wrapped/WrappedModal';
import type { WrappedHistoryEntry } from '../../../types/wrapped';
import LoadingSpinner from '../../common/LoadingSpinner';
import { SectionHeader } from '../../shared';

interface KonfiBadge {
  badge_id: number;
  name: string;
  description?: string;
  icon: string;
  color: string;
  awarded_date: string;
  criteria_type?: string;
  criteria_value?: number;
}

interface KonfiData {
  gottesdienst_points: number;
  gemeinde_points: number;
  jahrgang_name: string;
  badges: KonfiBadge[];
}

import {
  medal,
  ribbon,
  star,
  diamond,
  shield,
  flame,
  flash,
  rocket,
  sparkles,
  thumbsUp,
  heart,
  people,
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
  calendar,
  calendarOutline,
  today,
  time,
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
  timeOutline
} from 'ionicons/icons';
import { triggerPullHaptic } from '../../../utils/haptics';

const BADGE_ICONS: Record<string, string> = {
  trophy, medal, ribbon, star, checkmarkCircle, diamond, shield,
  flame, flash, rocket, sparkles, thumbsUp, heart, people,
  personAdd, chatbubbles, gift, book, school, construct, brush,
  colorPalette, sunny, moon, leaf, rose, calendar, today, time,
  timer, stopwatch, restaurant, fitness, bicycle, car, airplane,
  boat, camera, image, musicalNote, balloon, home, business,
  location, navigate, compass, pin, flag, informationCircle,
  helpCircle, alertCircle, hammer
};

const getIconFromString = (iconName: string): string => {
  return BADGE_ICONS[iconName] || trophy;
};

// Popover Content für Badge-Details
const KonfiBadgePopoverContent: React.FC<{
  badgeRef: React.RefObject<{ badge: KonfiBadge | null } | null>;
}> = ({ badgeRef }) => {
  const data = badgeRef.current;
  if (!data || !data.badge) return null;
  const badge = data.badge;
  const bColor = badge.color || '#f59e0b';

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
          background: `linear-gradient(145deg, ${bColor} 0%, ${bColor}cc 100%)`,
          boxShadow: `0 2px 8px ${bColor}40`
        }}>
          <IonIcon
            icon={getIconFromString(badge.icon)}
            style={{ fontSize: '1.4rem', color: 'white' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: '700', color: '#333', whiteSpace: 'nowrap' }}>
            {badge.name}
          </h3>
          <p style={{ margin: '0', fontSize: '0.8rem', color: '#666', lineHeight: '1.3' }}>
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
        {badge.awarded_date && (
          <span style={{ fontSize: '0.7rem', color: '#888' }}>
            {new Date(badge.awarded_date).toLocaleDateString('de-DE', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            })}
          </span>
        )}
      </div>
    </div>
  );
};

const TeamerKonfiStatsPage: React.FC = () => {
  const { pageRef, presentingElement } = useModalPage('teamer-konfi-stats');
  const { user, setError } = useApp();

  const badgePopoverRef = useRef<{ badge: KonfiBadge | null }>({ badge: null });

  const [presentBadgePopover] = useIonPopover(KonfiBadgePopoverContent, {
    badgeRef: badgePopoverRef
  });

  const handleBadgeClick = (badge: KonfiBadge, e: React.MouseEvent) => {
    badgePopoverRef.current = { badge };
    presentBadgePopover({
      event: e.nativeEvent,
      side: 'top',
      alignment: 'center',
      cssClass: 'badge-detail-popover'
    });
  };

  // Teamer-Konfi-Daten sind eingefroren — beide Typen immer sichtbar
  const [presentPointsModal, dismissPointsModal] = useIonModal(PointsHistoryModal, {
    onClose: () => dismissPointsModal(),
    pointConfig: { gottesdienst_enabled: true, gemeinde_enabled: true },
    apiEndpoint: '/teamer/konfi-history'
  });

  // Offline-Query: Teamer-Profil (gleicher Cache-Key wie TeamerProfilePage — SWR-Deduplizierung)
  const { data: profileData, loading, refresh } = useOfflineQuery<{ konfi_data: KonfiData }>(
    'teamer:profile:' + user?.id,
    async () => { const res = await api.get('/teamer/profile'); return res.data; },
    { ttl: CACHE_TTL.PROFILE }
  );
  const konfiData = profileData?.konfi_data || null;

  // Konfi-Wrapped laden
  const [konfiWrapped, setKonfiWrapped] = useState<WrappedHistoryEntry | null>(null);

  React.useEffect(() => {
    if (!user?.id) return;
    api.get(`/wrapped/history/${user.id}`)
      .then(res => {
        const entries: WrappedHistoryEntry[] = res.data || [];
        const konfiEntry = entries.find(e => e.wrapped_type === 'konfi');
        if (konfiEntry) setKonfiWrapped(konfiEntry);
      })
      .catch(() => {});
  }, [user?.id]);

  const [wrappedModalData, setWrappedModalData] = useState<WrappedHistoryEntry | null>(null);
  const [presentWrappedModal, dismissWrappedModal] = useIonModal(WrappedModal, {
    onClose: () => dismissWrappedModal(),
    displayName: user?.display_name || '',
    wrappedType: 'konfi' as const,
    initialData: wrappedModalData?.data,
    initialYear: wrappedModalData?.year
  });

  useEffect(() => {
    if (wrappedModalData) {
      presentWrappedModal({ cssClass: 'wrapped-modal-fullscreen' });
    }
  }, [wrappedModalData]);

  if (loading) {
    return <LoadingSpinner message="Konfi-Historie wird geladen..." />;
  }

  if (!konfiData) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={() => window.history.back()}>
                <IonIcon icon={arrowBack} slot="icon-only" />
              </IonButton>
            </IonButtons>
            <IonTitle>Konfi-Historie</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <div style={{ textAlign: 'center', marginTop: '80px' }}>
            <p>Keine Konfi-Daten vorhanden</p>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  const totalPoints = (konfiData.gottesdienst_points || 0) + (konfiData.gemeinde_points || 0);

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => window.history.back()}>
              <IonIcon icon={arrowBack} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>Konfi-Historie</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Konfi-Historie</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await refresh();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        {/* Punkte-Header */}
        <div onClick={() => presentPointsModal({ presentingElement: presentingElement || undefined })}>
          <SectionHeader
            title={konfiData.jahrgang_name ? `Jahrgang ${konfiData.jahrgang_name}` : 'Konfi-Zeit'}
            subtitle="Konfi-Punkte-Historie"
            icon={schoolOutline}
            colors={{ primary: '#5b21b6', secondary: '#4c1d95' }}
            stats={[
              { value: totalPoints, label: 'Gesamt' },
              { value: konfiData.gottesdienst_points || 0, label: 'Gottesdienst' },
              { value: konfiData.gemeinde_points || 0, label: 'Gemeinde' }
            ]}
          />
        </div>

        {/* Konfi-Wrapped Card */}
        {konfiWrapped && (
          <IonList inset={true} style={{ margin: '16px' }}>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: '16px' }}>
                <div
                  className="app-list-item"
                  style={{ width: '100%', cursor: 'pointer', borderLeftColor: '#5b21b6' }}
                  onClick={() => {
                    setWrappedModalData(konfiWrapped);
                  }}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle" style={{ backgroundColor: '#5b21b6' }}>
                        <IonIcon icon={timeOutline} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">
                          Dein Konfi-Wrapped {konfiWrapped.year}
                        </div>
                        <div className="app-list-item__meta">
                          <span className="app-list-item__meta-item">
                            Dein persönlicher Rückblick aus der Konfi-Zeit
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Konfi-Badges */}
        {konfiData.badges.length > 0 && (() => {
          // Kategorien wie in BadgesView
          const KONFI_BADGE_CATEGORIES: { key: string; title: string; icon: string; color: string }[] = [
            { key: 'total_points', title: 'Punkte-Sammler', icon: trophy, color: '#ffd700' },
            { key: 'gottesdienst_points', title: 'Gottesdienst-Held', icon: sunny, color: '#ff9500' },
            { key: 'gemeinde_points', title: 'Gemeinde-Star', icon: people, color: '#059669' },
            { key: 'bonus_points', title: 'Bonus-Jäger', icon: gift, color: '#ff6b9d' },
            { key: 'both_categories', title: 'Allrounder', icon: layersOutline, color: '#5856d6' },
            { key: 'activity_count', title: 'Aktiv dabei', icon: checkmarkCircle, color: '#3880ff' },
            { key: 'unique_activities', title: 'Vielseitig', icon: gridOutline, color: '#10dc60' },
            { key: 'activity_combination', title: 'Kombinier-Profi', icon: prismOutline, color: '#7044ff' },
            { key: 'category_activities', title: 'Kategorie-Meister', icon: cubeOutline, color: '#0cd1e8' },
            { key: 'specific_activity', title: 'Spezialist', icon: handLeft, color: '#ffce00' },
            { key: 'streak', title: 'Serien-Champion', icon: flame, color: '#eb445a' },
            { key: 'time_based', title: 'Zeitreisender', icon: time, color: '#8e8e93' },
            { key: 'event_count', title: 'Event-Champion', icon: calendar, color: '#e63946' },
            { key: 'collection', title: 'Sammler', icon: trophy, color: '#ffd700' },
            { key: 'yearly', title: 'Jahres-Badges', icon: calendarOutline, color: '#8e8e93' }
          ];

          const badgesByCategory = KONFI_BADGE_CATEGORIES
            .map(cat => ({
              ...cat,
              badges: konfiData.badges
                .filter(b => b.criteria_type === cat.key)
                .sort((a, b) => (a.criteria_value || 0) - (b.criteria_value || 0))
            }))
            .filter(cat => cat.badges.length > 0);

          // Badges ohne bekannte Kategorie direkt nach criteria_type gruppieren
          const knownKeys = new Set(KONFI_BADGE_CATEGORIES.map(c => c.key));
          const unknownBadges = konfiData.badges.filter(b => !b.criteria_type || !knownKeys.has(b.criteria_type));
          if (unknownBadges.length > 0) {
            // Nach criteria_type gruppieren, falls vorhanden
            const unknownGroups = new Map<string, KonfiBadge[]>();
            unknownBadges.forEach(b => {
              const key = b.criteria_type || 'badges';
              if (!unknownGroups.has(key)) unknownGroups.set(key, []);
              unknownGroups.get(key)!.push(b);
            });
            unknownGroups.forEach((badges, key) => {
              badgesByCategory.push({
                key,
                title: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
                icon: trophy,
                color: '#f59e0b',
                badges: badges.sort((a, b) => (a.criteria_value || 0) - (b.criteria_value || 0))
              });
            });
          }

          return (
            <IonList inset={true} style={{ margin: '16px' }}>
              <IonListHeader>
                <div className="app-section-icon" style={{ backgroundColor: '#f59e0b' }}>
                  <IonIcon icon={trophy} />
                </div>
                <IonLabel>Konfi-Badges ({konfiData.badges.length})</IonLabel>
              </IonListHeader>

              {badgesByCategory.map((category, index) => (
                <IonCard key={category.key} className="app-card" style={{ marginTop: index > 0 ? '8px' : '0' }}>
                  <IonCardContent style={{ padding: '16px' }}>
                    {/* Category Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                      <div style={{
                        width: '42px', height: '42px', borderRadius: '12px',
                        background: `linear-gradient(135deg, ${category.color} 0%, ${category.color}cc 100%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: `0 4px 12px ${category.color}40`
                      }}>
                        <IonIcon icon={category.icon} style={{ fontSize: '1.3rem', color: 'white' }} />
                      </div>
                      <div>
                        <h3 style={{ margin: '0', fontSize: '1.1rem', fontWeight: '700', color: '#333' }}>{category.title}</h3>
                        <span style={{ fontSize: '0.85rem', color: '#888' }}>{category.badges.length} Badge{category.badges.length !== 1 ? 's' : ''}</span>
                      </div>
                    </div>

                    {/* 3-Column Badge Grid */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '12px'
                    }}>
                      {category.badges.map((badge) => {
                        const bColor = badge.color || '#f59e0b';
                        return (
                          <div
                            key={badge.badge_id}
                            onClick={(e) => handleBadgeClick(badge, e)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              padding: '12px 8px',
                              borderRadius: '16px',
                              background: `${bColor}10`,
                              border: `2px solid ${bColor}40`,
                              position: 'relative',
                              cursor: 'pointer'
                            }}
                          >
                            {/* Badge Icon */}
                            <div style={{
                              width: '56px',
                              height: '56px',
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: `linear-gradient(145deg, ${bColor} 0%, ${bColor}cc 100%)`,
                              boxShadow: `0 4px 12px ${bColor}40`,
                              position: 'relative',
                              marginBottom: '8px'
                            }}>
                              <IonIcon
                                icon={getIconFromString(badge.icon)}
                                style={{ fontSize: '1.8rem', color: 'white' }}
                              />
                              {/* Earned Checkmark */}
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
                            </div>

                            {/* Badge Name */}
                            <span style={{
                              fontSize: '0.75rem',
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
                              {badge.name}
                            </span>

                            {/* Award Date */}
                            <span style={{
                              fontSize: '0.6rem',
                              color: '#888',
                              marginTop: '2px'
                            }}>
                              {new Date(badge.awarded_date).toLocaleDateString('de-DE', {
                                day: 'numeric',
                                month: 'short'
                              })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </IonCardContent>
                </IonCard>
              ))}
            </IonList>
          );
        })()}

        <div style={{ height: '32px' }} />
      </IonContent>
    </IonPage>
  );
};

export default TeamerKonfiStatsPage;
