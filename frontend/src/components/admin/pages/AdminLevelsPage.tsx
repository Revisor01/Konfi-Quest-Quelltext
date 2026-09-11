import { ICON_HINZUFUEGEN_GEFUELLT, ICON_LOESCHEN_GEFUELLT, ICON_POKAL_GEFUELLT, ICON_ZURUECK } from '../../shared/icons';
import { fehlerText } from '../../../utils/fehler';
import React, { useState, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonItem,
  IonButton,
  IonButtons,
  IonIcon,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  useIonModal,
  useIonAlert,
  IonRefresher,
  IonRefresherContent
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import LevelManagementModal from '../modals/LevelManagementModal';
import LoadingSpinner from '../../common/LoadingSpinner';
import { SectionHeader, ListSection } from '../../shared';
import { triggerPullHaptic } from '../../../utils/haptics';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import { getIconFromString } from '../../../utils/badgeIcons';

// Ionic 9 gibt bei ref an IonItemSliding die React-Komponente zurueck, nicht
// mehr das DOM-Element. Gebraucht wird hier nur close() — das haben beide.
type SlidingRef = { close: () => Promise<void> };



interface Level {
  id: number;
  name: string;
  title: string;
  description?: string;
  points_required: number;
  icon?: string;
  color?: string;
  reward_type?: string;
  reward_value?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const AdminLevelsPage: React.FC = () => {
  const { pageRef, presentingElement } = useModalPage('admin-levels');
  const { user, setError, isOnline } = useApp();
  const [presentAlert] = useIonAlert();
  const slidingRefs = useRef<Map<number, SlidingRef>>(new Map());
  const [editLevel, setEditLevel] = useState<Level | undefined>(undefined);

  // Offline-Query: Levels
  const { data: levels, loading, refresh: refreshLevels, refreshLive: refreshLevelsLive } = useOfflineQuery<Level[]>(
    'admin:levels:' + user?.organization_id,
    async () => { const res = await api.get('/levels'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  const [presentLevelModal, dismissLevelModal] = useIonModal(LevelManagementModal, {
    level: editLevel,
    onClose: () => dismissLevelModal(),
    onSuccess: () => {
      dismissLevelModal();
      refreshLevels();
    }
  });

  // Live-Updates für Level abonnieren: der Server sendet nach Anlegen/Ändern/
  // Löschen ein 'levels'-Event (levels.js). Ohne dieses Abo blieb die Liste auf
  // anderen Geraeten/Sitzungen bis zum manuellen Refresh veraltet (toter Sender).
  useLiveRefresh('levels', refreshLevelsLive);

  const handleAdd = () => {
    setEditLevel(undefined);
    presentLevelModal({ presentingElement });
  };

  const handleEdit = (level: Level) => {
    setEditLevel(level);
    presentLevelModal({ presentingElement });
  };

  const handleDelete = (level: Level) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Level löschen',
      message: `Level "${level.title}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            const slidingElement = slidingRefs.current.get(level.id);
            try {
              await api.delete(`/levels/${level.id}`);
              await refreshLevels();
            } catch (error) {
              if (slidingElement) {
                await slidingElement.close();
              }
              setError(fehlerText(error, 'Fehler beim Löschen des Levels'));
            }
          }
        }
      ]
    });
  };

  const handleRefresh = async (event: CustomEvent) => {
    await refreshLevels();
    event.detail.complete();
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton aria-label="Zurück" onClick={() => window.history.back()}>
              <IonIcon icon={ICON_ZURUECK} />
            </IonButton>
          </IonButtons>
          <IonTitle>Level</IonTitle>
          <IonButtons slot="end">
            <IonButton aria-label="Neues Level anlegen" onClick={handleAdd}>
              <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Level</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
          <IonRefresherContent refreshingSpinner="crescent" />
        </IonRefresher>

        {loading ? (
          <LoadingSpinner message="Level werden geladen..." />
        ) : (
          <>
            <SectionHeader
              title="Level-System"
              subtitle="Punkte-Level und Belohnungen"
              icon={ICON_POKAL_GEFUELLT}
              preset="level"
              stats={[
                { value: (levels || []).length, label: 'GESAMT' }
              ]}
            />

            {/* Level List */}
            <ListSection
              icon={ICON_POKAL_GEFUELLT}
              title="Level"
              count={(levels || []).length}
              iconColorClass="level"
              emptyIcon={ICON_POKAL_GEFUELLT}
              emptyTitle="Keine Level gefunden"
              emptyMessage="Noch keine Level angelegt"
              emptyIconColor="var(--app-color-konfis)"
            >
                      {(levels || []).map((level, index) => (
                        <IonItemSliding
                          key={level.id}
                          ref={(el) => {
                            if (el) {
                              slidingRefs.current.set(level.id, el);
                            } else {
                              slidingRefs.current.delete(level.id);
                            }
                          }}
                          style={{ marginBottom: index < (levels || []).length - 1 ? 'var(--app-abstand-eng)' : '0' }}
                        >
                          <IonItem
                            button
                            onClick={() => handleEdit(level)}
                            detail={false}
                            lines="none"
                            className="app-item-transparent"
                          >
                            <div
                              className="app-list-item app-list-item--level"
                              style={{ borderLeftColor: level.color || 'var(--app-color-level)' }}
                            >
                              {/* Corner Badge für Punkte */}
                              <div className="app-corner-badges">
                                <div
                                  className="app-corner-badge"
                                  style={{ backgroundColor: level.color || 'var(--app-color-level)' }}
                                >
                                  {level.points_required}P
                                </div>
                              </div>
                              <div className="app-list-item__row">
                                <div className="app-list-item__main">
                                  <div
                                    className="app-icon-circle app-icon-circle--lg"
                                    style={{ backgroundColor: level.color || 'var(--app-color-level)' }}
                                  >
                                    <IonIcon icon={getIconFromString(level.icon || 'trophy')} />
                                  </div>
                                  <div className="app-list-item__content">
                                    <div className="app-list-item__title app-list-item__title--with-badge">
                                      {level.title}
                                    </div>
                                    {level.description && (
                                      <div className="app-list-item__meta">
                                        <span className="app-list-item__meta-item">
                                          {level.description}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </IonItem>

                          <IonItemOptions side="end" className="app-swipe-actions">
                            <IonItemOption
                              onClick={() => { closeOpenSlidingItems(); handleDelete(level); }}
                              aria-label="Level löschen"
                              className="app-swipe-action"
                            >
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                                <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                              </div>
                            </IonItemOption>
                          </IonItemOptions>
                        </IonItemSliding>
                      ))}
            </ListSection>
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminLevelsPage;
