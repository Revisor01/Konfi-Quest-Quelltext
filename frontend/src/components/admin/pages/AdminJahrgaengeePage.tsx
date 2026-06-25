import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonButtons,
  IonButton,
  IonIcon,
  useIonModal,
  useIonAlert,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonInput,
  IonSpinner,
  IonToggle,
  IonRange
} from '@ionic/react';
import {
  add,
  school,
  checkmarkOutline,
  closeOutline,
  arrowBack,
  trash,
  schoolOutline,
  settingsOutline,
  sparklesOutline,
  checkmarkCircle,
  closeCircle,
  trophy,
  home,
  people
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import LoadingSpinner from '../../common/LoadingSpinner';
import { SectionHeader, ListSection } from '../../shared';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';

interface Jahrgang {
  id: number;
  name: string;
  created_at: string;
  gottesdienst_enabled?: boolean;
  gemeinde_enabled?: boolean;
  target_gottesdienst?: number;
  target_gemeinde?: number;
  konfspruch_enabled?: boolean;
  wrapped_released_at?: string | null;
  konfi_count?: number;
  gottesdienst_points_total?: number;
  gemeinde_points_total?: number;
}

interface JahrgangModalProps {
  jahrgang?: Jahrgang | null;
  onClose: () => void;
  onSuccess: () => void;
  onRefresh?: () => void;
  dismiss?: () => void;
}

const JahrgangModal: React.FC<JahrgangModalProps> = ({
  jahrgang,
  onClose,
  onSuccess,
  onRefresh,
  dismiss
}) => {
  const handleClose = () => {
    if (dismiss) {
      dismiss();
    } else {
      onClose();
    }
  };
  const { setSuccess, setError } = useApp();
  const [loading, setLoading] = useState(false);
  const [wrappedLoading, setWrappedLoading] = useState(false);
  const [presentAlert] = useIonAlert();
  // Lokaler Zustand des Wrapped-Releases, damit der Toggle nach generate/delete
  // sofort den neuen Stand zeigt (das Modal bleibt offen).
  const [wrappedReleasedAt, setWrappedReleasedAt] = useState<string | null>(
    jahrgang?.wrapped_released_at ?? null
  );

  const [formData, setFormData] = useState({
    name: '',
    gottesdienst_enabled: true,
    gemeinde_enabled: true,
    target_gottesdienst: 10,
    target_gemeinde: 10,
    konfspruch_enabled: true
  });

  useEffect(() => {
    if (jahrgang) {
      setFormData({
        name: jahrgang.name,
        gottesdienst_enabled: jahrgang.gottesdienst_enabled ?? true,
        gemeinde_enabled: jahrgang.gemeinde_enabled ?? true,
        target_gottesdienst: jahrgang.target_gottesdienst ?? 10,
        target_gemeinde: jahrgang.target_gemeinde ?? 10,
        konfspruch_enabled: jahrgang.konfspruch_enabled ?? true
      });
      setWrappedReleasedAt(jahrgang.wrapped_released_at ?? null);
    } else {
      setFormData({
        name: '',
        gottesdienst_enabled: true,
        gemeinde_enabled: true,
        target_gottesdienst: 10,
        target_gemeinde: 10,
        konfspruch_enabled: true
      });
      setWrappedReleasedAt(null);
    }
  }, [jahrgang]);

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setError('Name ist erforderlich');
      return;
    }

    const payload = {
      name: formData.name.trim(),
      gottesdienst_enabled: formData.gottesdienst_enabled,
      gemeinde_enabled: formData.gemeinde_enabled,
      target_gottesdienst: formData.target_gottesdienst,
      target_gemeinde: formData.target_gemeinde,
      konfspruch_enabled: formData.konfspruch_enabled
    };

    if (networkMonitor.isOnline) {
      setLoading(true);
      try {
        if (jahrgang) {
          await api.put(`/admin/jahrgaenge/${jahrgang.id}`, payload);
        } else {
          await api.post('/admin/jahrgaenge', payload);
        }

        onSuccess();
        handleClose();
      } catch (error: any) {
        if (error.response?.data?.error) {
          setError(error.response.data.error);
        } else {
          setError('Fehler beim Speichern des Jahrgangs');
        }
      } finally {
        setLoading(false);
      }
    } else {
      await writeQueue.enqueue({
        method: jahrgang ? 'PUT' : 'POST',
        url: jahrgang ? `/admin/jahrgaenge/${jahrgang.id}` : '/admin/jahrgaenge',
        body: payload,
        maxRetries: 5,
        hasFileUpload: false,
        metadata: {
          type: 'admin',
          clientId: safeUUID(),
          label: jahrgang ? 'Jahrgang bearbeiten' : 'Jahrgang erstellen'
        }
      });
      setSuccess('Wird gespeichert sobald du wieder online bist');
      onSuccess();
      handleClose();
    }
  };

  const generateWrapped = async () => {
    if (!jahrgang) return;
    setWrappedLoading(true);
    try {
      await api.post(`/wrapped/generate/${jahrgang.id}`);
      setWrappedReleasedAt(new Date().toISOString());
      setSuccess('Wrapped wurde freigegeben und die Konfis wurden benachrichtigt');
      onRefresh?.();
    } catch (error: any) {
      setError(error.response?.data?.error || 'Fehler beim Freigeben von Wrapped');
    } finally {
      setWrappedLoading(false);
    }
  };

  const deleteWrapped = async () => {
    if (!jahrgang) return;
    setWrappedLoading(true);
    try {
      await api.delete(`/wrapped/${jahrgang.id}`);
      setWrappedReleasedAt(null);
      onRefresh?.();
    } catch (error: any) {
      setError(error.response?.data?.error || 'Fehler beim Löschen von Wrapped');
    } finally {
      setWrappedLoading(false);
    }
  };

  const handleWrappedToggle = (checked: boolean) => {
    if (!jahrgang) return;
    // Nur reagieren, wenn sich der Zustand tatsächlich ändert.
    const isReleased = !!wrappedReleasedAt;
    if (checked === isReleased) return;

    if (checked) {
      presentAlert({
        header: 'Wrapped freigeben',
        message: 'Wrapped wird für alle Konfis dieses Jahrgangs generiert und sie erhalten eine Push-Benachrichtigung. Fortfahren?',
        buttons: [
          { text: 'Abbrechen', role: 'cancel' },
          { text: 'Freigeben', handler: () => generateWrapped() }
        ]
      });
    } else {
      presentAlert({
        header: 'Wrapped löschen',
        message: 'Wrapped-Rückblick für diesen Jahrgang löschen? Die Konfis sehen den Rückblick dann nicht mehr.',
        buttons: [
          { text: 'Abbrechen', role: 'cancel' },
          { text: 'Löschen', role: 'destructive', handler: () => deleteWrapped() }
        ]
      });
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            {jahrgang ? 'Jahrgang bearbeiten' : 'Neuer Jahrgang'}
          </IonTitle>
          <IonButtons slot="start">
            <IonButton onClick={handleClose} disabled={loading}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton
              onClick={handleSubmit}
              disabled={!formData.name.trim() || loading}
            >
              {loading ? (
                <IonSpinner name="crescent" />
              ) : (
                <IonIcon icon={checkmarkOutline} />
              )}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Jahrgang Details - iOS26 Pattern */}
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--jahrgang">
              <IonIcon icon={school} />
            </div>
            <IonLabel>Jahrgang Details</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel position="stacked">Name *</IonLabel>
                  <IonInput
                    value={formData.name}
                    onIonInput={(e) => setFormData({ ...formData, name: e.detail.value! })}
                    placeholder="z.B. Jahrgang 2024/2025"
                    disabled={loading}
                    clearInput={true}
                  />
                </IonItem>
              </IonList>
              <p style={{ fontSize: '0.8rem', color: 'var(--app-text-sub-color, #8e8e93)', margin: '8px 4px 0', lineHeight: 1.4 }}>
                Hier steuerst du diesen Jahrgang zentral: Punkteziele, die Freischaltung der Konfispruch-Auswahl und die Freigabe des Wrapped-Rückblicks.
              </p>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Punkte-Konfiguration */}
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--jahrgang">
              <IonIcon icon={settingsOutline} />
            </div>
            <IonLabel>Punkte-Konfiguration</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel>Gottesdienst-Punkte aktiviert</IonLabel>
                  <IonToggle
                    slot="end"
                    className="app-toggle--jahrgang"
                    checked={formData.gottesdienst_enabled}
                    onIonChange={(e) => setFormData({ ...formData, gottesdienst_enabled: e.detail.checked })}
                    disabled={loading || (!formData.gemeinde_enabled)}
                  />
                </IonItem>
                {!formData.gemeinde_enabled && formData.gottesdienst_enabled && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--app-color-badges)', marginTop: '4px', paddingLeft: '16px' }}>
                    Mindestens ein Punkt-Typ muss aktiv bleiben.{jahrgang?.konfi_count ? ` ${jahrgang.konfi_count} Konfis haben bereits Gottesdienst-Punkte.` : ''}
                  </div>
                )}
                {formData.gottesdienst_enabled && (
                  <IonItem lines="full" style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Ziel Gottesdienst</IonLabel>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                      <span style={{ fontSize: '0.75rem', color: '#8e8e93', minWidth: '24px', textAlign: 'center' }}>1</span>
                      <IonRange
                        min={1} max={20} step={1}
                        pin={true} pinFormatter={(value: number) => `${value}`}
                        value={formData.target_gottesdienst}
                        onIonChange={(e) => setFormData({ ...formData, target_gottesdienst: e.detail.value as number })}
                        disabled={loading}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ion-color-primary)', minWidth: '28px', textAlign: 'center' }}>{formData.target_gottesdienst}</span>
                    </div>
                  </IonItem>
                )}
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonLabel>Gemeinde-Punkte aktiviert</IonLabel>
                  <IonToggle
                    slot="end"
                    className="app-toggle--jahrgang"
                    checked={formData.gemeinde_enabled}
                    onIonChange={(e) => setFormData({ ...formData, gemeinde_enabled: e.detail.checked })}
                    disabled={loading || (!formData.gottesdienst_enabled)}
                  />
                </IonItem>
                {!formData.gottesdienst_enabled && formData.gemeinde_enabled && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--app-color-badges)', marginTop: '4px', paddingLeft: '16px' }}>
                    Mindestens ein Punkt-Typ muss aktiv bleiben.{jahrgang?.konfi_count ? ` ${jahrgang.konfi_count} Konfis haben bereits Gemeinde-Punkte.` : ''}
                  </div>
                )}
                {formData.gemeinde_enabled && (
                  <IonItem lines="none" style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Ziel Gemeinde</IonLabel>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                      <span style={{ fontSize: '0.75rem', color: '#8e8e93', minWidth: '24px', textAlign: 'center' }}>1</span>
                      <IonRange
                        min={1} max={20} step={1}
                        pin={true} pinFormatter={(value: number) => `${value}`}
                        value={formData.target_gemeinde}
                        onIonChange={(e) => setFormData({ ...formData, target_gemeinde: e.detail.value as number })}
                        disabled={loading}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--ion-color-primary)', minWidth: '28px', textAlign: 'center' }}>{formData.target_gemeinde}</span>
                    </div>
                  </IonItem>
                )}
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Konfispruch & Wrapped */}
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--jahrgang">
              <IonIcon icon={sparklesOutline} />
            </div>
            <IonLabel>Konfispruch & Wrapped</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines={jahrgang ? 'full' : 'none'} style={{ '--background': 'transparent' }}>
                  <IonLabel>
                    <h3 style={{ margin: 0 }}>Konfispruch-Auswahl</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--app-text-sub-color, #8e8e93)', whiteSpace: 'normal' }}>
                      Konfis dieses Jahrgangs können ihren Konfispruch wählen.
                    </p>
                  </IonLabel>
                  <IonToggle
                    slot="end"
                    className="app-toggle--jahrgang"
                    checked={formData.konfspruch_enabled}
                    onIonChange={(e) => setFormData({ ...formData, konfspruch_enabled: e.detail.checked })}
                    disabled={loading}
                  />
                </IonItem>
                {jahrgang && (
                  <IonItem lines="none" style={{ '--background': 'transparent' }}>
                    <IonLabel>
                      <h3 style={{ margin: 0 }}>Wrapped freigeben</h3>
                      <p style={{ fontSize: '0.8rem', color: 'var(--app-text-sub-color, #8e8e93)', whiteSpace: 'normal' }}>
                        {wrappedReleasedAt
                          ? `Freigegeben am ${new Date(wrappedReleasedAt).toLocaleDateString('de-DE')}`
                          : 'Generiert den Rückblick und benachrichtigt die Konfis.'}
                      </p>
                    </IonLabel>
                    {wrappedLoading ? (
                      <IonSpinner slot="end" name="crescent" />
                    ) : (
                      <IonToggle
                        slot="end"
                        className="app-toggle--jahrgang"
                        checked={!!wrappedReleasedAt}
                        onIonChange={(e) => handleWrappedToggle(e.detail.checked)}
                        disabled={loading}
                      />
                    )}
                  </IonItem>
                )}
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

const AdminJahrgaengeePage: React.FC = () => {
  const { pageRef, presentingElement, cleanupModals } = useModalPage('admin-jahrgaenge');
  const { user, setError, isOnline } = useApp();

  // Offline-Query: Jahrgaenge
  const { data: jahrgaenge, loading, refresh: refreshJahrgaenge } = useOfflineQuery<Jahrgang[]>(
    'admin:jahrgaenge-detail:' + user?.organization_id,
    async () => { const res = await api.get('/admin/jahrgaenge'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  const [editJahrgang, setEditJahrgang] = useState<Jahrgang | null>(null);
  const slidingRefs = useRef<Map<number, HTMLIonItemSlidingElement>>(new Map());

  // Alert Hook für Bestätigungsdialoge
  const [presentAlert] = useIonAlert();

  // Modal mit useIonModal Hook
  const [presentJahrgangModalHook, dismissJahrgangModalHook] = useIonModal(JahrgangModal, {
    jahrgang: editJahrgang,
    onClose: () => dismissJahrgangModalHook(),
    onSuccess: () => {
      dismissJahrgangModalHook();
      refreshJahrgaenge();
    },
    // Wrapped-Toggle aktualisiert die Liste, ohne das Modal zu schliessen.
    onRefresh: () => refreshJahrgaenge()
  });

  // Subscribe to live updates for jahrgaenge
  useLiveRefresh('jahrgaenge', refreshJahrgaenge);

  const handleRefresh = async (event: CustomEvent) => {
    await refreshJahrgaenge();
    (event.target as HTMLIonRefresherElement).complete();
  };

  const handleDeleteWithSlideClose = async (jahrgang: Jahrgang, forceDelete = false) => {
    if (!isOnline) return;
    const performDelete = async () => {
      const slidingElement = slidingRefs.current.get(jahrgang.id);
      try {
        const url = forceDelete ? `/admin/jahrgaenge/${jahrgang.id}?force=true` : `/admin/jahrgaenge/${jahrgang.id}`;
        await api.delete(url);
        refreshJahrgaenge();
      } catch (error: any) {
        if (slidingElement) {
          await slidingElement.close();
        }

        if (error.response?.data?.canForceDelete) {
          // Org Admin kann trotzdem löschen
          presentAlert({
            header: 'Chat-Nachrichten vorhanden',
            message: `${error.response.data.error}\n\nAls Organisation-Admin können Sie dennoch löschen. Dadurch werden ALLE Chat-Nachrichten unwiderruflich gelöscht!`,
            buttons: [
              { text: 'Abbrechen', role: 'cancel' },
              {
                text: 'Dennoch löschen',
                role: 'destructive',
                handler: () => handleDeleteWithSlideClose(jahrgang, true)
              }
            ]
          });
        } else {
          const errorMessage = error.response?.data?.error || 'Fehler beim Löschen des Jahrgangs';
          setError(errorMessage);
        }
      }
    };

    if (forceDelete) {
      await performDelete();
    } else {
      presentAlert({
        header: 'Jahrgang löschen',
        message: `Jahrgang "${jahrgang.name}" wirklich löschen?\n\nDer Jahrgang und sein Chatverlauf werden unwiderruflich entfernt. Solange dem Jahrgang noch aktive Konfis zugeordnet sind, ist das Löschen nicht möglich. Zu Teamer:innen beförderte Konfis bleiben mit ihren Punkten und Abzeichen erhalten.`,
        buttons: [
          { text: 'Abbrechen', role: 'cancel' },
          {
            text: 'Löschen',
            role: 'destructive',
            handler: performDelete
          }
        ]
      });
    }
  };

  const openCreateModal = () => {
    setEditJahrgang(null);
    presentJahrgangModalHook({ presentingElement });
  };

  const openEditModal = (jahrgang: Jahrgang) => {
    setEditJahrgang(jahrgang);
    presentJahrgangModalHook({ presentingElement });
  };

  // Rollen-basierte Berechtigungen (org_admin und admin dürfen alles)
  const isAdmin = ['org_admin', 'admin'].includes(user?.role_name || '');
  const canCreate = isAdmin;
  const canEdit = isAdmin;
  const canDelete = isAdmin;


  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => window.history.back()}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>Jahrgänge</IonTitle>
          {canCreate && (
            <IonButtons slot="end">
              <IonButton onClick={openCreateModal}>
                <IonIcon icon={add} />
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Jahrgänge</IonTitle>
          </IonToolbar>
        </IonHeader>
        
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
          <IonRefresherContent refreshingSpinner="crescent" />
        </IonRefresher>

        {loading ? (
          <LoadingSpinner message="Jahrgänge werden geladen..." />
        ) : (
          <>
            <SectionHeader
              title="Jahrgänge"
              subtitle="Konfirmand:innen verwalten"
              icon={school}
              preset="jahrgang"
              stats={[
                { value: (jahrgaenge || []).length, label: 'GESAMT' }
              ]}
            />

        {/* Jahrgaenge List */}
        <ListSection
          icon={schoolOutline}
          title="Jahrgänge"
          count={(jahrgaenge || []).length}
          iconColorClass="jahrgang"
          emptyIcon={school}
          emptyTitle="Keine Jahrgänge gefunden"
          emptyMessage="Noch keine Jahrgänge angelegt"
          emptyIconColor="#007aff"
        >
                  {(jahrgaenge || []).map((jahrgang, index) => (
                    <IonItemSliding
                      key={jahrgang.id}
                      ref={(el) => {
                        if (el) {
                          slidingRefs.current.set(jahrgang.id, el);
                        } else {
                          slidingRefs.current.delete(jahrgang.id);
                        }
                      }}
                      style={{ marginBottom: index < (jahrgaenge || []).length - 1 ? '8px' : '0' }}
                    >
                      <IonItem
                        button={canEdit}
                        onClick={canEdit ? () => openEditModal(jahrgang) : undefined}
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
                          className="app-list-item app-list-item--jahrgang"
                          style={{ width: '100%' }}
                        >
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle app-icon-circle--lg app-icon-circle--jahrgang">
                                <IonIcon icon={school} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">
                                  {jahrgang.name}
                                </div>
                                <div className="app-list-item__meta">
                                  {jahrgang.gottesdienst_enabled !== false && (
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={home} className="app-icon-color--gottesdienst" />
                                      {`GD-Ziel ${jahrgang.target_gottesdienst ?? 10}`}
                                    </span>
                                  )}
                                  {jahrgang.gemeinde_enabled !== false && (
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={people} className="app-icon-color--gemeinde" />
                                      {`Gem-Ziel ${jahrgang.target_gemeinde ?? 10}`}
                                    </span>
                                  )}
                                  <span className="app-list-item__meta-item">
                                    <IonIcon
                                      icon={jahrgang.konfspruch_enabled !== false ? checkmarkCircle : closeCircle}
                                      style={{ color: jahrgang.konfspruch_enabled !== false ? '#34c759' : '#8e8e93' }}
                                    />
                                    {jahrgang.konfspruch_enabled !== false ? 'Spruch frei' : 'Spruch gesperrt'}
                                  </span>
                                  <span className="app-list-item__meta-item">
                                    <IonIcon
                                      icon={trophy}
                                      style={{ color: jahrgang.wrapped_released_at ? '#ff9500' : '#8e8e93' }}
                                    />
                                    {jahrgang.wrapped_released_at
                                      ? `Wrapped gestartet am ${new Date(jahrgang.wrapped_released_at).toLocaleDateString('de-DE')}`
                                      : 'Wrapped nicht freigegeben'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </IonItem>

                      {canDelete && (
                        <IonItemOptions side="end" className="app-swipe-actions">
                          <IonItemOption
                            onClick={() => handleDeleteWithSlideClose(jahrgang)}
                            className="app-swipe-action"
                          >
                            <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                              <IonIcon icon={trash} />
                            </div>
                          </IonItemOption>
                        </IonItemOptions>
                      )}
                    </IonItemSliding>
                  ))}
        </ListSection>
          </>
        )}

      </IonContent>
    </IonPage>
  );
};

export default AdminJahrgaengeePage;