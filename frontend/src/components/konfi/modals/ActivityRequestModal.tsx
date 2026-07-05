import React, { useState, useEffect, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonTextarea,
  IonDatetime,
  IonDatetimeButton,
  IonModal,
  IonProgressBar,
  IonList,
  IonListHeader,
  IonAccordion,
  IonAccordionGroup,
  useIonAlert
} from '@ionic/react';
import {
  close,
  checkmark,
  camera,
  trash,
  checkmarkCircle,
  calendarOutline,
  textOutline,
  starOutline,
  homeOutline,
  peopleOutline,
  imageOutline,
  pricetag,
  chevronDownOutline
} from 'ionicons/icons';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';
import { compressForUpload } from '../../../services/mediaCompression';

interface Activity {
  id: number;
  name: string;
  description?: string;
  points: number;
  type: 'gottesdienst' | 'gemeinde';
  category_names?: string;
}

interface ActivityRequestModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const ActivityRequestModal: React.FC<ActivityRequestModalProps> = ({
  onClose,
  onSuccess
}) => {
  const { setSuccess, setError, isOnline } = useApp();
  const [presentAlert] = useIonAlert();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const { isSubmitting, guard } = useActionGuard();
  const [uploadProgress, setUploadProgress] = useState(0);

  const [formData, setFormData] = useState({
    activity_id: '',
    description: '',
    requested_date: new Date().toISOString().split('T')[0],
    photo_file: null as File | null
  });
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const accordionGroupRef = useRef<HTMLIonAccordionGroupElement>(null);

  useEffect(() => {
    loadActivities();
  }, []);

  const loadActivities = async () => {
    setLoading(true);
    try {
      const response = await api.get('/konfi/activities');
      setActivities(response.data);
    } catch (err) {
      setError('Fehler beim Laden der Aktivitäten');
 console.error('Error loading activities:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoSelect = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = false;
    input.onchange = (e: Event) => handleFileSelect(e);
    input.click();
  };

  const handleFileSelect = async (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    try {
      // Erst komprimieren (1920px/JPEG wie im Chat), DANN Groessen-Check:
      // Live-Kamerafotos sind oft 8-16 MB und wuerden einen vorgezogenen
      // 5MB-Check immer reissen; nach Kompression passen sie locker.
      const prepared = await compressForUpload(file);
      setFormData(prev => ({ ...prev, photo_file: prepared }));

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(prepared);
    } catch (err: any) {
      setError(err?.message || 'Foto konnte nicht verarbeitet werden');
    }
  };

  const uploadPhoto = async (): Promise<string | null> => {
    if (!formData.photo_file) return null;

    const uploadFormData = new FormData();
    uploadFormData.append('photo', formData.photo_file);

    try {
      const response = await api.post('/konfi/upload-photo', uploadFormData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        // Foto-Upload auf Mobilfunk kann laenger dauern als die globalen 20s
        timeout: 60000,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percentCompleted);
          }
        }
      });

      return response.data.filename;
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Fehler beim Hochladen des Fotos');
    }
  };

  const handleSubmit = async () => {
    if (!formData.activity_id) {
      setError('Bitte wähle eine Aktivität aus');
      return;
    }

    if (!formData.photo_file) {
      presentAlert({
        header: 'Kein Foto',
        message: 'Anträge benötigen normalerweise ein Foto als Nachweis. Möchtest du trotzdem fortfahren?',
        buttons: [
          { text: 'Abbrechen', role: 'cancel' },
          { text: 'Ohne Foto fortfahren', handler: () => submitRequest() }
        ]
      });
      return;
    }

    submitRequest();
  };

  const submitRequest = async () => {
    await guard(async () => {
      setUploadProgress(0);

      const clientId = safeUUID();

      if (networkMonitor.isOnline) {
        // Online-Pfad: direkt senden
        try {
          let photoFilename: string | null = null;

          if (formData.photo_file) {
            photoFilename = await uploadPhoto();
          }

          const requestData: any = {
            activity_id: parseInt(formData.activity_id),
            description: formData.description.trim(),
            requested_date: formData.requested_date,
            photo_filename: photoFilename,
            client_id: clientId,
          };

          await api.post('/konfi/requests', requestData);

          setSuccess('Antrag erfolgreich eingereicht!');
          onSuccess();
        } catch (error: any) {
          setError(error.response?.data?.error || error.message || 'Fehler beim Einreichen des Antrags');
        } finally {
          setUploadProgress(0);
        }
      } else {
        // Offline-Pfad: Queue-Fallback
        let hasFileUpload = false;
        const queueBody: any = {
          activity_id: parseInt(formData.activity_id),
          description: formData.description.trim(),
          requested_date: formData.requested_date,
          client_id: clientId,
        };

        if (formData.photo_file) {
          // Foto lokal speichern
          hasFileUpload = true;
          try {
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(formData.photo_file!);
            });
            const fileName = `queue_${clientId}_photo.jpg`;
            await Filesystem.writeFile({
              path: `queue-uploads/${fileName}`,
              data: base64,
              directory: Directory.Data,
            });
            queueBody._localPhotoPath = `queue-uploads/${fileName}`;
            queueBody._photoFileName = formData.photo_file.name;
          } catch (err) {
            setError('Foto konnte nicht lokal gespeichert werden');
            return;
          }
        }

        await writeQueue.enqueue({
          method: 'POST',
          url: '/konfi/requests',
          body: queueBody,
          maxRetries: 5,
          hasFileUpload,
          metadata: {
            type: 'request',
            clientId,
            label: 'Aktivitäts-Antrag',
          },
        });

        setSuccess('Antrag wird gesendet sobald du wieder online bist');
        onSuccess();
      }
    });
  };

  const removePhoto = () => {
    setFormData(prev => ({ ...prev, photo_file: null }));
    setPhotoPreview(null);
  };

  const filteredActivities = activities;

  const selectedActivity = activities.find(a => a.id.toString() === formData.activity_id);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Neuer Antrag</IonTitle>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={onClose} disabled={isSubmitting}>
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton className="app-modal-submit-btn app-modal-submit-btn--konfi" onClick={handleSubmit} disabled={isSubmitting || loading}>
              <IonIcon icon={checkmark} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
        {isSubmitting && uploadProgress > 0 && (
          <IonProgressBar value={uploadProgress / 100} />
        )}
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Aktivität Sektion - iOS26 Pattern mit Akkordeon */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--requests">
              <IonIcon icon={starOutline} />
            </div>
            <IonLabel>Aktivität wählen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '0' }}>
              <IonAccordionGroup ref={accordionGroupRef}>
                <IonAccordion value="activity-picker" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                  <IonItem slot="header" lines="none" style={{ '--padding-start': '16px', '--inner-padding-end': '12px' }}>
                    {selectedActivity ? (
                      // Gewaehlt: schlichte Header-Zeile (Icon + Name + Kategorie,
                      // Punkte dezent als Chip) — KEINE Card-im-Header-Optik, die
                      // sah gequetscht aus (Eselsohr kollidierte mit dem Chevron).
                      (() => {
                        const isGodi = selectedActivity.type === 'gottesdienst';
                        const accent = isGodi ? 'var(--app-color-gottesdienst)' : 'var(--app-color-gemeinde)';
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', pointerEvents: 'none' }}>
                            <div
                              className={`app-icon-circle app-icon-circle--${isGodi ? 'info' : 'activities'}`}
                              style={{ flexShrink: 0 }}
                            >
                              <IonIcon icon={isGodi ? homeOutline : peopleOutline} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {selectedActivity.name}
                              </div>
                              {selectedActivity.category_names && (
                                <div style={{ fontSize: '0.78rem', color: '#8e8e93', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {selectedActivity.category_names}
                                </div>
                              )}
                            </div>
                            <span style={{
                              flexShrink: 0, fontSize: '0.8rem', fontWeight: 700, color: accent,
                              background: isGodi ? 'rgba(59,130,246,0.12)' : 'rgba(4,120,87,0.12)',
                              padding: '3px 10px', borderRadius: '10px', whiteSpace: 'nowrap'
                            }}>
                              +{selectedActivity.points}P
                            </span>
                          </div>
                        );
                      })()
                    ) : (
                      <IonLabel>
                        <h3 className="app-settings-item__subtitle" style={{ margin: '0' }}>
                          Aktivität auswählen
                        </h3>
                      </IonLabel>
                    )}
                  </IonItem>
                  <div slot="content" style={{ padding: '0 12px 12px' }}>
                    {/* Aktivitäten Liste */}
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                      {filteredActivities.length === 0 ? (
                        <div className="app-info-box app-info-box--neutral" style={{ textAlign: 'center' }}>
                          Keine Aktivitäten gefunden
                        </div>
                      ) : (
                        filteredActivities.map(activity => {
                          const isSelected = formData.activity_id === activity.id.toString();
                          const variant = activity.type === 'gottesdienst' ? 'gottesdienst' : 'gemeinde';

                          return (
                            <div
                              key={activity.id}
                              className={`app-list-item app-list-item--${variant}${isSelected ? ' app-list-item--selected' : ''}`}
                              onClick={() => {
                                setFormData(prev => ({ ...prev, activity_id: activity.id.toString() }));
                                if (accordionGroupRef.current) {
                                  accordionGroupRef.current.value = undefined;
                                }
                              }}
                              style={{ cursor: 'pointer', position: 'relative' }}
                            >
                              {/* Punkte Eselsohr oben rechts */}
                              <div className="app-corner-badges">
                                <div className={`app-corner-badge app-corner-badge--${variant}`} style={{ whiteSpace: 'nowrap' }}>
                                  +{activity.points}P
                                </div>
                              </div>

                              <div className="app-list-item__row">
                                <div className="app-list-item__main">
                                  {/* Icon — gottesdienst=info(blau), gemeinde=activities(gruen) */}
                                  <div className={`app-icon-circle app-icon-circle--${activity.type === 'gottesdienst' ? 'info' : 'activities'}`}>
                                    <IonIcon icon={activity.type === 'gottesdienst' ? homeOutline : peopleOutline} />
                                  </div>

                                  {/* Content */}
                                  <div className="app-list-item__content">
                                    <div className="app-list-item__title" style={{ paddingRight: '50px' }}>
                                      {activity.name}
                                    </div>
                                    {activity.category_names && (
                                      <div className="app-list-item__meta">
                                        <span className="app-list-item__meta-item">
                                          <IonIcon icon={pricetag} className="app-icon-color--category" />
                                          {activity.category_names}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </IonAccordion>
              </IonAccordionGroup>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Datum Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--requests">
              <IonIcon icon={calendarOutline} />
            </div>
            <IonLabel>Datum wählen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '12px' }}>
              <IonItem lines="none" style={{ '--background': 'transparent' }}>
                <IonDatetimeButton datetime="date-picker" />
                <IonModal keepContentsMounted={true}>
                  <IonDatetime
                    id="date-picker"
                    value={formData.requested_date}
                    onIonChange={(e) => setFormData(prev => ({ ...prev, requested_date: e.detail.value as string }))}
                    presentation="date"
                    max={new Date().toISOString().split('T')[0]}
                    firstDayOfWeek={1}
                  />
                </IonModal>
              </IonItem>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Anmerkungen Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--requests">
              <IonIcon icon={textOutline} />
            </div>
            <IonLabel>Anmerkungen (optional)</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '12px' }}>
              <IonItem lines="none" style={{ '--background': 'transparent' }}>
                <IonTextarea
                  value={formData.description}
                  onIonInput={(e) => setFormData(prev => ({ ...prev, description: e.detail.value! }))}
                  placeholder="Anmerkungen... (optional)"
                  autoGrow={true}
                  rows={2}
                />
              </IonItem>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Foto Sektion - iOS26 Pattern */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--requests">
              <IonIcon icon={imageOutline} />
            </div>
            <IonLabel>Foto als Nachweis (optional)</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '12px' }}>
              <div
                onClick={handlePhotoSelect}
                style={{
                  padding: '16px',
                  backgroundColor: photoPreview ? 'rgba(var(--app-color-gemeinde-rgb), 0.08)' : 'transparent',
                  borderRadius: '10px',
                  border: photoPreview ? '1px solid rgba(var(--app-color-gemeinde-rgb), 0.2)' : '1px dashed #c7c7cc',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {photoPreview ? (
                  <div className="app-settings-item" style={{ justifyContent: 'space-between' }}>
                    <div className="app-settings-item" style={{ gap: '8px' }}>
                      <IonIcon
                        icon={checkmarkCircle}
                        className="app-icon-color--gemeinde"
                        style={{ fontSize: '1.2rem' }}
                      />
                      <span style={{ fontWeight: '600', color: 'var(--app-color-gemeinde)' }}>
                        Foto ausgewählt
                      </span>
                    </div>
                    <IonButton
                      fill="clear"
                      color="danger"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePhoto();
                      }}
                    >
                      <IonIcon icon={trash} />
                    </IonButton>
                  </div>
                ) : (
                  <div className="app-settings-item" style={{ justifyContent: 'center' }}>
                    <IonIcon
                      icon={camera}
                      className="app-icon-color--gemeinde"
                      style={{ fontSize: '1.2rem' }}
                    />
                    <span style={{ fontWeight: '500', color: '#666' }}>
                      Foto hinzufügen
                    </span>
                  </div>
                )}
              </div>
            </IonCardContent>
          </IonCard>
        </IonList>

      </IonContent>
    </IonPage>
  );
};

export default ActivityRequestModal;
