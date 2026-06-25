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
import {
  add,
  ribbon,
  ribbonOutline,
  checkmarkOutline,
  closeOutline,
  arrowBack,
  trash,
  createOutline,
  trophy,
  medal,
  star,
  checkmarkCircle,
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
  chevronDownOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
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

const CERT_ICONS: Record<string, { icon: any; name: string; category: string }> = {
  ribbon: { icon: ribbon, name: 'Band', category: 'Erfolg' },
  trophy: { icon: trophy, name: 'Pokal', category: 'Erfolg' },
  medal: { icon: medal, name: 'Medaille', category: 'Erfolg' },
  star: { icon: star, name: 'Stern', category: 'Erfolg' },
  checkmarkCircle: { icon: checkmarkCircle, name: 'Bestanden', category: 'Erfolg' },
  diamond: { icon: diamond, name: 'Diamant', category: 'Erfolg' },
  shield: { icon: shield, name: 'Schild', category: 'Erfolg' },
  flame: { icon: flame, name: 'Flamme', category: 'Engagement' },
  flash: { icon: flash, name: 'Blitz', category: 'Engagement' },
  rocket: { icon: rocket, name: 'Rakete', category: 'Engagement' },
  sparkles: { icon: sparkles, name: 'Funken', category: 'Engagement' },
  thumbsUp: { icon: thumbsUp, name: 'Daumen hoch', category: 'Engagement' },
  heart: { icon: heart, name: 'Herz', category: 'Gemeinschaft' },
  people: { icon: people, name: 'Gruppe', category: 'Gemeinschaft' },
  personAdd: { icon: personAdd, name: 'Neue Person', category: 'Gemeinschaft' },
  chatbubbles: { icon: chatbubbles, name: 'Chat', category: 'Gemeinschaft' },
  gift: { icon: gift, name: 'Geschenk', category: 'Gemeinschaft' },
  book: { icon: book, name: 'Buch', category: 'Lernen' },
  school: { icon: school, name: 'Schule', category: 'Lernen' },
  construct: { icon: construct, name: 'Werkzeug', category: 'Lernen' },
  brush: { icon: brush, name: 'Pinsel', category: 'Lernen' },
  colorPalette: { icon: colorPalette, name: 'Farbpalette', category: 'Lernen' },
  sunny: { icon: sunny, name: 'Sonne', category: 'Natur' },
  moon: { icon: moon, name: 'Mond', category: 'Natur' },
  leaf: { icon: leaf, name: 'Blatt', category: 'Natur' },
  rose: { icon: rose, name: 'Rose', category: 'Natur' },
  calendar: { icon: calendar, name: 'Kalender', category: 'Zeit' },
  today: { icon: today, name: 'Heute', category: 'Zeit' },
  time: { icon: time, name: 'Uhr', category: 'Zeit' },
  timer: { icon: timer, name: 'Timer', category: 'Zeit' },
  stopwatch: { icon: stopwatch, name: 'Stoppuhr', category: 'Zeit' },
  restaurant: { icon: restaurant, name: 'Restaurant', category: 'Aktivitäten' },
  fitness: { icon: fitness, name: 'Fitness', category: 'Aktivitäten' },
  bicycle: { icon: bicycle, name: 'Fahrrad', category: 'Aktivitäten' },
  car: { icon: car, name: 'Auto', category: 'Aktivitäten' },
  airplane: { icon: airplane, name: 'Flugzeug', category: 'Aktivitäten' },
  boat: { icon: boat, name: 'Boot', category: 'Aktivitäten' },
  camera: { icon: camera, name: 'Kamera', category: 'Aktivitäten' },
  image: { icon: image, name: 'Bild', category: 'Aktivitäten' },
  musicalNote: { icon: musicalNote, name: 'Musik', category: 'Aktivitäten' },
  balloon: { icon: balloon, name: 'Ballon', category: 'Aktivitäten' },
  home: { icon: home, name: 'Zuhause', category: 'Orte' },
  business: { icon: business, name: 'Gebäude', category: 'Orte' },
  location: { icon: location, name: 'Standort', category: 'Orte' },
  navigate: { icon: navigate, name: 'Navigation', category: 'Orte' },
  compass: { icon: compass, name: 'Kompass', category: 'Orte' },
  pin: { icon: pin, name: 'Pin', category: 'Orte' },
  flag: { icon: flag, name: 'Flagge', category: 'Orte' },
  informationCircle: { icon: informationCircle, name: 'Info', category: 'Sonstiges' },
  helpCircle: { icon: helpCircle, name: 'Hilfe', category: 'Sonstiges' },
  alertCircle: { icon: alertCircle, name: 'Warnung', category: 'Sonstiges' },
  hammer: { icon: hammer, name: 'Hammer', category: 'Sonstiges' }
};

const getIconFromString = (iconName: string) => {
  return CERT_ICONS[iconName]?.icon || ribbon;
};

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
      } catch (error: any) {
        setError(error.response?.data?.error || 'Fehler beim Speichern');
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
            <IonButton onClick={handleClose} disabled={loading}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonTitle>
            {certificateType ? 'Zertifikat bearbeiten' : 'Neues Zertifikat'}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton
              onClick={handleSubmit}
              disabled={!name.trim() || loading}
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
        <IonList inset={true} style={{ margin: '16px' }}>
          <IonListHeader>
            <div className="app-section-icon app-section-icon--teamer">
              <IonIcon icon={ribbon} />
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
                  <div style={{ width: '100%', padding: '8px 0' }}>
                    <IonAccordionGroup>
                      <IonAccordion value="icon-picker" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                        <IonItem slot="header" lines="none">
                          <IonLabel>
                            <h3 style={{ fontSize: '0.9rem', fontWeight: '500', color: '#666', margin: '0 0 4px 0' }}>
                              Icon
                            </h3>
                            {icon && CERT_ICONS[icon] && (
                              <p style={{ fontSize: '0.85rem', color: '#333', margin: '0', fontWeight: '500' }}>
                                {CERT_ICONS[icon].name} ({CERT_ICONS[icon].category})
                              </p>
                            )}
                          </IonLabel>
                        </IonItem>
                        <div slot="content" style={{ padding: '16px' }}>
                          {Object.entries(CERT_ICONS).reduce((acc, [key, data]) => {
                            const categoryIndex = acc.findIndex((group: any) => group.category === data.category);
                            if (categoryIndex === -1) {
                              acc.push({ category: data.category, icons: [{ key, data }] });
                            } else {
                              acc[categoryIndex].icons.push({ key, data });
                            }
                            return acc;
                          }, [] as any[]).map((group: any) => (
                            <div key={group.category} style={{ marginBottom: '16px' }}>
                              <IonText style={{ fontSize: '0.85rem', fontWeight: '600', color: '#666', marginBottom: '8px', display: 'block' }}>
                                {group.category}
                              </IonText>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: '8px' }}>
                                {group.icons.map(({ key, data }: any) => (
                                  <div
                                    key={key}
                                    onClick={() => setIcon(key)}
                                    style={{
                                      width: '100%',
                                      aspectRatio: '1',
                                      backgroundColor: icon === key ? 'var(--app-color-teamer)' : '#f8f9fa',
                                      borderRadius: '12px',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                      border: '1px solid #e0e0e0',
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                      transition: 'all 0.2s'
                                    }}
                                  >
                                    <IonIcon
                                      icon={data.icon}
                                      style={{
                                        fontSize: '1.5rem',
                                        color: icon === key ? 'white' : '#666'
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
  const slidingRefs = useRef<Map<number, HTMLIonItemSlidingElement>>(new Map());

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
    if (!isOnline) return;
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
            } catch (error: any) {
              if (slidingElement) {
                await slidingElement.close();
              }
              setError(error.response?.data?.error || 'Fehler beim Löschen');
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
            <IonButton onClick={() => window.history.back()}>
              <IonIcon icon={arrowBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>Zertifikate</IonTitle>
          {isAdmin && (
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
            <IonTitle size="large">Zertifikate</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={handleRefresh} onIonPull={triggerPullHaptic}>
          <IonRefresherContent refreshingSpinner="crescent" />
        </IonRefresher>

        <SectionHeader
          title="Zertifikate"
          subtitle="Teamer:innen-Zertifikate"
          icon={ribbon}
          colors={{ primary: 'var(--app-color-teamer)', secondary: '#9d174d' }}
          stats={[
            { value: (certificateTypes || []).length, label: 'Gesamt' }
          ]}
        />

        <ListSection
          icon={ribbonOutline}
          title="Zertifikate"
          count={(certificateTypes || []).length}
          iconColorClass="teamer"
          emptyIcon={ribbon}
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
              style={{ marginBottom: index < (certificateTypes || []).length - 1 ? '8px' : '0' }}
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
                        <IonIcon icon={getIconFromString(certType.icon)} />
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
                    onClick={() => handleDelete(certType)}
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
      </IonContent>
    </IonPage>
  );
};

export default AdminCertificatesPage;
