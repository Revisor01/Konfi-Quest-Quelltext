import { CRITERIA_COLORS } from '../../../utils/badgeCriteria';
import { FARBEN } from '../../../theme/colors';
import {
  ICON_BONUS_GEFUELLT,
  ICON_FLAMME_GEFUELLT,
  ICON_GRUPPE_GEFUELLT,
  ICON_HAND_GEFUELLT,
  ICON_JAHRGANG,
  ICON_POKAL_GEFUELLT,
  ICON_PRISMA,
  ICON_RASTER,
  ICON_SONNE,
  ICON_STUFEN,
  ICON_TERMIN,
  ICON_TERMIN_GEFUELLT,
  ICON_UHRZEIT,
  ICON_UHRZEIT_GEFUELLT,
  ICON_WUERFEL,
  ICON_ZURUECK,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
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
  // Leer, wenn der Jahrgang der Konfizeit geloescht wurde. Die Ueberschrift
  // faengt das ab ("Konfi-Zeit" statt "Jahrgang …"); der Typ sagt es jetzt auch.
  jahrgang_name?: string;
  badges: KonfiBadge[];
}

import { triggerPullHaptic } from '../../../utils/haptics';
import { getIconFromString } from '../../../utils/badgeIcons';
import KachelRaster from '../../shared/KachelRaster';
import BadgePopoverContent, { BadgePopoverData } from '../../shared/BadgePopoverContent';



// Der Abzeichen-Popover liegt jetzt gemeinsam in shared/BadgePopoverContent
// Diese Ansicht laedt nur ERREICHTE Abzeichen — die
// gemeinsame Fassung faellt ohne Statusangabe auf 'erreicht' zurueck, das
// hier vorher hart kodiert war.

const TeamerKonfiStatsPage: React.FC = () => {
  const { pageRef, presentingElement } = useModalPage('teamer-konfi-stats');
  const { user } = useApp();

  const badgePopoverRef = useRef<BadgePopoverData | null>({ badge: null });

  const [presentBadgePopover] = useIonPopover(BadgePopoverContent, {
    dataRef: badgePopoverRef
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
  const { data: profileData, loading, refresh, refreshLive } = useOfflineQuery<{ konfi_data: KonfiData }>(
    'teamer:profile:' + user?.id,
    async () => { const res = await api.get('/teamer/profile'); return res.data; },
    { ttl: CACHE_TTL.PROFILE }
  );

  // Punkte, Abzeichen und Antraege aendern die angezeigte Statistik.
  useLiveRefresh(['points', 'badges', 'requests', 'konfis'], useCallback(() => { refreshLive(); }, [refreshLive]));
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
              <IonButton onClick={() => window.history.back()} aria-label="Zurück">
                <IonIcon icon={ICON_ZURUECK} slot="icon-only" />
              </IonButton>
            </IonButtons>
            <IonTitle>Konfi-Historie</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <div style={{ textAlign: 'center', marginTop: 'var(--app-freiraum-kopf-m)' }}>
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
            <IonButton onClick={() => window.history.back()} aria-label="Zurück">
              <IonIcon icon={ICON_ZURUECK} slot="icon-only" />
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
            icon={ICON_JAHRGANG}
            colors={{ primary: 'var(--app-color-konfis)', secondary: 'var(--app-color-konfis-dunkel)' }}
            stats={[
              { value: totalPoints, label: 'Gesamt' },
              { value: konfiData.gottesdienst_points || 0, label: 'GD' },
              { value: konfiData.gemeinde_points || 0, label: 'Gemeinde' }
            ]}
          />
        </div>

        {/* Konfi-Wrapped Card */}
        {konfiWrapped && (
          <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
            <IonCard className="app-card">
              <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                <div
                  className="app-list-item"
                  style={{ width: '100%', cursor: 'pointer', borderLeftColor: 'var(--app-color-konfis)' }}
                  onClick={() => {
                    setWrappedModalData(konfiWrapped);
                  }}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-konfis)' }}>
                        <IonIcon icon={ICON_UHRZEIT} />
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
            { key: 'total_points', title: 'Punkte-Sammler', icon: ICON_POKAL_GEFUELLT, color: CRITERIA_COLORS.total_points },
            { key: 'gottesdienst_points', title: 'Gottesdienst-Held', icon: ICON_SONNE, color: CRITERIA_COLORS.gottesdienst_points },
            { key: 'gemeinde_points', title: 'Gemeinde-Star', icon: ICON_GRUPPE_GEFUELLT, color: CRITERIA_COLORS.gemeinde_points },
            { key: 'bonus_points', title: 'Bonus-Jäger', icon: ICON_BONUS_GEFUELLT, color: CRITERIA_COLORS.bonus_points },
            { key: 'both_categories', title: 'Allrounder', icon: ICON_STUFEN, color: CRITERIA_COLORS.both_categories },
            { key: 'activity_count', title: 'Aktiv dabei', icon: ICON_ZUSAGE_GEFUELLT, color: CRITERIA_COLORS.activity_count },
            { key: 'unique_activities', title: 'Vielseitig', icon: ICON_RASTER, color: CRITERIA_COLORS.unique_activities },
            { key: 'activity_combination', title: 'Kombinier-Profi', icon: ICON_PRISMA, color: CRITERIA_COLORS.activity_combination },
            { key: 'category_activities', title: 'Kategorie-Meister', icon: ICON_WUERFEL, color: CRITERIA_COLORS.category_activities },
            { key: 'category_combination', title: 'Kategorie-Kombinierer', icon: ICON_PRISMA, color: CRITERIA_COLORS.category_combination },
            { key: 'specific_activity', title: 'Spezialist', icon: ICON_HAND_GEFUELLT, color: CRITERIA_COLORS.specific_activity },
            { key: 'streak', title: 'Serien-Champion', icon: ICON_FLAMME_GEFUELLT, color: CRITERIA_COLORS.streak },
            { key: 'time_based', title: 'Zeitreisender', icon: ICON_UHRZEIT_GEFUELLT, color: FARBEN.textSystem },
            { key: 'event_count', title: 'Event-Champion', icon: ICON_TERMIN_GEFUELLT, color: CRITERIA_COLORS.event_count },
            { key: 'collection', title: 'Sammler', icon: ICON_POKAL_GEFUELLT, color: FARBEN.gold },
            { key: 'yearly', title: 'Jahres-Badges', icon: ICON_TERMIN, color: FARBEN.textSystem }
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
                icon: ICON_POKAL_GEFUELLT,
                color: 'var(--app-color-badges)',
                badges: badges.sort((a, b) => (a.criteria_value || 0) - (b.criteria_value || 0))
              });
            });
          }

          return (
            <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
              <IonListHeader>
                <div className="app-section-icon" style={{ backgroundColor: 'var(--app-color-badges)' }}>
                  <IonIcon icon={ICON_POKAL_GEFUELLT} />
                </div>
                <IonLabel>Konfi-Badges ({konfiData.badges.length})</IonLabel>
              </IonListHeader>

              {badgesByCategory.map((category, index) => (
                <IonCard key={category.key} className="app-card" style={{ marginTop: index > 0 ? 'var(--app-abstand-eng)' : '0' }}>
                  <IonCardContent style={{ padding: 'var(--app-abstand-basis)' }}>
                    {/* Category Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)', marginBottom: 'var(--app-abstand-basis)' }}>
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
                        <span style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-tertiary)' }}>{category.badges.length} Badge{category.badges.length !== 1 ? 's' : ''}</span>
                      </div>
                    </div>

                    {/* Dasselbe Kachelraster wie ueberall sonst
                        (shared/KachelRaster). Das Verleihdatum bleibt als
                        Zusatz erhalten -- es gibt es nur hier. */}
                    <KachelRaster
                      eintraege={category.badges.map((badge) => ({
                        schluessel: badge.badge_id,
                        icon: getIconFromString(badge.icon),
                        name: badge.name,
                        // Echte Hexfarbe noetig: das Raster rechnet per
                        // Alpha-Suffix weiter.
                        farbe: badge.color || FARBEN.badges,
                        zeichen: true,
                        zusatz: (
                          <span style={{
                            fontSize: 'var(--app-text-winzig)',
                            color: 'var(--app-text-tertiary)'
                          }}>
                            {new Date(badge.awarded_date).toLocaleDateString('de-DE', {
                              day: 'numeric',
                              month: 'short'
                            })}
                          </span>
                        )
                      }))}
                      onKachelClick={(schluessel, e) => {
                        const badge = category.badges.find((b) => b.badge_id === schluessel);
                        if (badge) handleBadgeClick(badge, e);
                      }}
                    />
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
