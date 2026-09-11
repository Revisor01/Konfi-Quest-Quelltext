import {
  ICON_ABZEICHEN,
  ICON_ABZEICHEN_GEFUELLT,
  ICON_AUFKLAPPEN,
  ICON_HAKEN,
  ICON_HINZUFUEGEN_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_SCHLIESSEN,
  ICON_ZURUECK,
} from '../../shared/icons';
import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useRef } from 'react';
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
  IonAccordionGroup,
  IonAccordion,
  IonText,
  useIonAlert,
  useIonModal
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import { useModalPage } from '../../../contexts/ModalContext';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import LoadingSpinner from '../../common/LoadingSpinner';
import { SectionHeader, ListSection } from '../../shared';
import { triggerPullHaptic } from '../../../utils/haptics';
import { safeUUID } from '../../../utils/uuid';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import { ICON_CHOICES, getIconFromString, type IconChoice } from '../../../utils/badgeIcons';

// Ionic 9 gibt bei ref an IonItemSliding die React-Komponente zurueck, nicht
// mehr das DOM-Element. Gebraucht wird hier nur close() — das haben beide.
type SlidingRef = { close: () => Promise<void> };



/** Die Icons der Auswahl, nach Kategorie gebuendelt (nur fuer die Anzeige). */
type IconEintrag = { key: string; data: IconChoice };
type IconGruppe = { category: string; icons: IconEintrag[] };

interface CertificateType {
  id: number;
  name: string;
  icon: string;
  is_active: boolean;
  created_at: string;
}

interface CertificateModalProps {
  certificateType?: CertificateType | null;
  onClose: () => void;
  onSuccess: () => void;
  dismiss?: () => void;
}

const CertificateModal: React.FC<CertificateModalProps> = ({
  certificateType,
  onClose,
  onSuccess,
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

  const [name, setName] = useState(certificateType?.name || '');
  const [icon, setIcon] = useState(certificateType?.icon || 'ribbon');
  useEffect(() => {
    if (certificateType) {
      setName(certificateType.name);
      setIcon(certificateType.icon || 'ribbon');
    } else {
      setName('');
      setIcon('ribbon');
    }
  }, [certificateType]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Name ist erforderlich');
      return;
    }

    const payload = { name: name.trim(), icon };

    if (networkMonitor.isOnline) {
      setLoading(true);
      try {
        if (certificateType) {
          await api.put(`/teamer/certificate-types/${certificateType.id}`, payload);
        } else {
          await api.post('/teamer/certificate-types', payload);
        }

        onSuccess();
        handleClose();
      } catch (error) {
        setError(fehlerText(error, 'Fehler beim Speichern'));
      } finally {
        setLoading(false);
      }
    } else {
      await writeQueue.enqueue({
        method: certificateType ? 'PUT' : 'POST',
        url: certificateType ? `/teamer/certificate-types/${certificateType.id}` : '/teamer/certificate-types',
        body: payload,
        maxRetries: 5,
        hasFileUpload: false,
        metadata: {
          type: 'admin',
          clientId: safeUUID(),
          label: certificateType ? 'Zertifikat bearbeiten' : 'Zertifikat erstellen'
        }
      });
      setSuccess('Wird gespeichert sobald du wieder online bist');
      onSuccess();
      handleClose();
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" onClick={handleClose} disabled={loading}>
              <IonIcon icon={ICON_SCHLIESSEN} />
            </IonButton>
          </IonButtons>
          <IonTitle>
            {certificateType ? 'Zertifikat bearbeiten' : 'Neues Zertifikat'}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton aria-label="Zertifikat speichern"
              onClick={handleSubmit}
              disabled={!name.trim() || loading}
            >
              {loading ? (
                <IonSpinner name="crescent" />
              ) : (
                <IonIcon icon={ICON_HAKEN} />
              )}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--teamer">
              <IonIcon icon={ICON_ABZEICHEN_GEFUELLT} />
            </div>
            <IonLabel>Zertifikat Details</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonList style={{ background: 'transparent', padding: '0' }}>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <IonInput
                    label="Name"
                    labelPlacement="stacked"
                    value={name}
                    onIonInput={(e) => setName(e.detail.value || '')}
                    placeholder="z.B. JuLeiCa, Teamer-Card"
                    disabled={loading}
                  />
                </IonItem>
                <IonItem lines="full" style={{ '--background': 'transparent' }}>
                  <div style={{ width: '100%', padding: 'var(--app-abstand-eng) 0' }}>
                    <IonAccordionGroup>
                      <IonAccordion value="icon-picker" toggleIcon={ICON_AUFKLAPPEN} toggleIconSlot="end">
                        <IonItem slot="header" lines="none">
                          <IonLabel>
                            <h3 style={{ fontSize: 'var(--app-text-basis)', fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)', margin: '0 0 var(--app-abstand-mini) 0' }}>
                              Icon
                            </h3>
                            {icon && ICON_CHOICES[icon] && (
                              <p style={{ fontSize: 'var(--app-text-sekundaer)', color: 'var(--app-text-primary)', margin: '0', fontWeight: 'var(--app-schrift-mittel)' }}>
                                {ICON_CHOICES[icon].name} ({ICON_CHOICES[icon].category})
                              </p>
                            )}
                          </IonLabel>
                        </IonItem>
                        <div slot="content" style={{ padding: 'var(--app-abstand-basis)' }}>
                          {Object.entries(ICON_CHOICES).reduce((acc: IconGruppe[], [key, data]) => {
                            const categoryIndex = acc.findIndex((group) => group.category === data.category);
                            if (categoryIndex === -1) {
                              acc.push({ category: data.category, icons: [{ key, data }] });
                            } else {
                              acc[categoryIndex].icons.push({ key, data });
                            }
                            return acc;
                          }, []).map((group) => (
                            <div key={group.category} style={{ marginBottom: 'var(--app-abstand-basis)' }}>
                              <IonText style={{ fontSize: 'var(--app-text-sekundaer)', fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-secondary)', marginBottom: 'var(--app-abstand-eng)', display: 'block' }}>
                                {group.category}
                              </IonText>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: 'var(--app-abstand-eng)' }}>
                                {group.icons.map(({ key, data }) => (
                                  <div
                                    key={key}
                                    onClick={() => setIcon(key)}
                                    style={{
                                      width: '100%',
                                      aspectRatio: '1',
                                      backgroundColor: icon === key ? 'var(--app-color-teamer)' : 'var(--app-surface-soft)',
                                      borderRadius: 'var(--app-radius-karte)',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                      border: '1px solid var(--app-border)',
                                      boxShadow: 'var(--app-schatten-flach)',
                                      transition: 'all 0.2s'
                                    }}
                                  >
                                    <IonIcon
                                      icon={data.icon}
                                      style={{
                                        fontSize: 'var(--app-text-ueberschrift)',
                                        color: icon === key ? 'white' : 'var(--app-text-secondary)'
                                      }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </IonAccordion>
                    </IonAccordionGroup>
                  </div>
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>
        </IonList>
      </IonContent>
    </IonPage>
  );
};

const AdminCertificatesPage: React.FC = () => {
  const { pageRef, presentingElement } = useModalPage('admin-certificates');
  const { user, setError, isOnline } = useApp();

  // Offline-Query: Certificate Types
  const { data: certificateTypes, loading, refresh: refreshCertificateTypes } = useOfflineQuery<CertificateType[]>(
    'admin:certificates:' + user?.organization_id,
    async () => { const res = await api.get('/teamer/certificate-types'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  const [editCert, setEditCert] = useState<CertificateType | null>(null);
  const slidingRefs = useRef<Map<number, SlidingRef>>(new Map());

  const [presentAlert] = useIonAlert();

  const [presentCertModal, dismissCertModal] = useIonModal(CertificateModal, {
    certificateType: editCert,
    onClose: () => dismissCertModal(),
    onSuccess: () => {
      dismissCertModal();
      refreshCertificateTypes();
    }
  });

  const handleRefresh = async (event: CustomEvent) => {
    await refreshCertificateTypes();
    (event.target as HTMLIonRefresherElement).complete();
  };

  const handleDelete = async (certType: CertificateType) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Zertifikat löschen',
      message: `"${certType.name}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            const slidingElement = slidingRefs.current.get(certType.id);
            try {
              await api.delete(`/teamer/certificate-types/${certType.id}`);
              refreshCertificateTypes();
            } catch (error) {
              if (slidingElement) {
                await slidingElement.close();
              }
              setError(fehlerText(error, 'Fehler beim Löschen'));
            }
          }
        }
      ]
    });
  };

  const openCreateModal = () => {
    setEditCert(null);
    presentCertModal({ presentingElement });
  };

  const openEditModal = (certType: CertificateType) => {
    setEditCert(certType);
    presentCertModal({ presentingElement });
  };

  const isAdmin = ['org_admin', 'admin'].includes(user?.role_name || '');

  if (loading) {
    return (
      <IonPage ref={pageRef}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Zertifikate</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <LoadingSpinner fullScreen message="Zertifikate werden geladen..." />
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton aria-label="Zurück" onClick={() => window.history.back()}>
              <IonIcon icon={ICON_ZURUECK} />
            </IonButton>
          </IonButtons>
          <IonTitle>Zertifikate</IonTitle>
          {isAdmin && (
            <IonButtons slot="end">
              <IonButton aria-label="Neues Zertifikat anlegen" onClick={openCreateModal}>
                <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Zertifikate</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
          <IonRefresherContent refreshingSpinner="crescent" />
        </IonRefresher>

        <SectionHeader
          title="Zertifikate"
          subtitle="Zertifikate fürs Team"
          icon={ICON_ABZEICHEN_GEFUELLT}
          colors={{ primary: 'var(--app-color-teamer)', secondary: 'var(--app-color-teamer-mittel)' }}
          stats={[
            { value: (certificateTypes || []).length, label: 'Gesamt' }
          ]}
        />

        <ListSection
          icon={ICON_ABZEICHEN}
          title="Zertifikate"
          count={(certificateTypes || []).length}
          iconColorClass="teamer"
          emptyIcon={ICON_ABZEICHEN_GEFUELLT}
          emptyTitle="Keine Zertifikate"
          emptyMessage="Noch keine Zertifikate angelegt"
          emptyIconColor="var(--app-color-teamer)"
        >
          {(certificateTypes || []).map((certType, index) => (
            <IonItemSliding
              key={certType.id}
              ref={(el) => {
                if (el) {
                  slidingRefs.current.set(certType.id, el);
                } else {
                  slidingRefs.current.delete(certType.id);
                }
              }}
              style={{ marginBottom: index < (certificateTypes || []).length - 1 ? 'var(--app-abstand-eng)' : '0' }}
            >
              <IonItem
                button={isAdmin}
                onClick={isAdmin ? () => openEditModal(certType) : undefined}
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
                  className="app-list-item"
                  style={{
                    width: '100%',
                    borderLeftColor: 'var(--app-color-teamer)'
                  }}
                >
                  <div className="app-list-item__row">
                    <div className="app-list-item__main">
                      <div className="app-icon-circle app-icon-circle--lg" style={{ backgroundColor: 'var(--app-color-teamer)' }}>
                        <IonIcon icon={getIconFromString(certType.icon, ICON_ABZEICHEN_GEFUELLT)} />
                      </div>
                      <div className="app-list-item__content">
                        <div className="app-list-item__title">
                          {certType.name}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </IonItem>

              {isAdmin && (
                <IonItemOptions side="end" className="app-swipe-actions">
                  <IonItemOption
                    onClick={() => { closeOpenSlidingItems(); handleDelete(certType); }}
                    aria-label="Zertifikat löschen"
                    className="app-swipe-action"
                  >
                    <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                      <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                    </div>
                  </IonItemOption>
                </IonItemOptions>
              )}
            </IonItemSliding>
          ))}
        </ListSection>
      </IonContent>
    </IonPage>
  );
};

export default AdminCertificatesPage;
