import { fehlerText, fehlerTextOderMessage } from '../../../utils/fehler';
import React, { useState, useRef } from 'react';
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
  ICON_AUFKLAPPEN,
  ICON_BILD,
  ICON_GEMEINDE,
  ICON_GOTTESDIENST,
  ICON_HAKEN_GEFUELLT,
  ICON_KAMERA_GEFUELLT,
  ICON_KATEGORIE_GEFUELLT,
  ICON_LOESCHEN_GEFUELLT,
  ICON_SCHLIESSEN_GEFUELLT,
  ICON_STERN,
  ICON_TERMIN,
  ICON_TEXT,
  ICON_ZUSAGE_GEFUELLT,
} from '../../shared/icons';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import { writeQueue, QueueBody } from '../../../services/writeQueue';
import { AktivitaetMelden } from '../../../types/request';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';
import { compressForUpload } from '../../../services/mediaCompression';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';

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
  const { setSuccess, setError, user } = useApp();
  const [presentAlert] = useIonAlert();

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

  // Aktivitaeten aus dem Cache statt per Direkt-Abruf: Der VERSAND einer
  // Meldung ist laengst queue-faehig, aber die Auswahlliste lud per
  // api.get — offline blieb sie leer und das Formular damit nutzlos
  // Aktivitaeten sind Stammdaten und aendern
  // sich selten, daher STAMMDATEN-TTL.
  const { data: activitiesData, loading } = useOfflineQuery<Activity[]>(
    'konfi:activities:' + user?.organization_id,
    () => api.get('/konfi/activities').then(r => r.data),
    { ttl: CACHE_TTL.STAMMDATEN }
  );
  const activities = activitiesData || [];

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
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Foto konnte nicht verarbeitet werden');
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
    } catch (error) {
      throw new Error(fehlerText(error, 'Fehler beim Hochladen des Fotos'), { cause: error });
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
        message: 'Normalerweise gehört ein Foto dazu, damit dein Team sieht, dass du dabei warst. Trotzdem abschicken?',
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

          const requestData: AktivitaetMelden = {
            activity_id: parseInt(formData.activity_id),
            description: formData.description.trim(),
            requested_date: formData.requested_date,
            photo_filename: photoFilename,
            client_id: clientId,
          };

          await api.post('/konfi/requests', requestData);

          setSuccess('Aktivität erfolgreich eingereicht!');
          onSuccess();
        } catch (error) {
          setError(fehlerTextOderMessage(error, 'Fehler beim Einreichen der Aktivität'));
        } finally {
          setUploadProgress(0);
        }
      } else {
        // Offline-Pfad: Queue-Fallback
        let hasFileUpload = false;
        const queueBody: QueueBody & AktivitaetMelden = {
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
          } catch {
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
            label: 'Aktivität melden',
          },
        });

        setSuccess('Aktivität wird gesendet sobald du wieder online bist');
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
          <IonTitle>Neue Aktivität</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose} disabled={isSubmitting}>
              <IonIcon icon={ICON_SCHLIESSEN_GEFUELLT} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Aktivität absenden" className="app-modal-submit-btn app-modal-submit-btn--konfi" onClick={handleSubmit} disabled={isSubmitting || loading}>
              <IonIcon icon={ICON_HAKEN_GEFUELLT} />
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
              <IonIcon icon={ICON_STERN} />
            </div>
            <IonLabel>Aktivität wählen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '0' }}>
              <IonAccordionGroup ref={accordionGroupRef}>
                <IonAccordion value="activity-picker" toggleIcon={ICON_AUFKLAPPEN} toggleIconSlot="end">
                  <IonItem slot="header" lines="none" style={{ '--padding-start': '16px', '--inner-padding-end': '12px' }}>
                    {selectedActivity ? (
                      // Gewaehlt: schlichte Header-Zeile (Icon + Name + Kategorie,
                      // Punkte dezent als Chip) — KEINE Card-im-Header-Optik, die
                      // sah gequetscht aus (Eselsohr kollidierte mit dem Chevron).
                      (() => {
                        const isGodi = selectedActivity.type === 'gottesdienst';
                        const accent = isGodi ? 'var(--app-color-gottesdienst)' : 'var(--app-color-gemeinde)';
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)', width: '100%', pointerEvents: 'none' }}>
                            <div
                              className={`app-icon-circle app-icon-circle--${isGodi ? 'info' : 'activities'}`}
                              style={{ flexShrink: 0 }}
                            >
                              <IonIcon icon={isGodi ? ICON_GOTTESDIENST : ICON_GEMEINDE} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 'var(--app-text-standard)', fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-emphasis)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {selectedActivity.name}
                              </div>
                              {selectedActivity.category_names && (
                                <div style={{ fontSize: 'var(--app-text-hinweis)', color: 'var(--app-text-system)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {selectedActivity.category_names}
                                </div>
                              )}
                            </div>
                            <span style={{
                              flexShrink: 0, fontSize: 'var(--app-text-hinweis)', fontWeight: 'var(--app-schrift-fett)', color: accent,
                              background: isGodi ? 'rgba(var(--app-color-gottesdienst-rgb), 0.12)' : 'rgba(var(--app-color-activities-rgb), 0.12)',
                              padding: 'var(--app-abstand-mini) var(--app-abstand-schmal)', borderRadius: 'var(--app-radius-knopf)', whiteSpace: 'nowrap'
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
                  <div slot="content" style={{ padding: '0 var(--app-abstand-mittel) var(--app-abstand-mittel)' }}>
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
                                  <div className={`app-icon-circle app-icon-circle--${activity.type === 'gottesdienst' ? 'gottesdienst' : 'activities'}`}>
                                    <IonIcon icon={activity.type === 'gottesdienst' ? ICON_GOTTESDIENST : ICON_GEMEINDE} />
                                  </div>

                                  {/* Content */}
                                  <div className="app-list-item__content">
                                    <div className="app-list-item__title" style={{ paddingRight: 'var(--app-freiraum-aktion-s)' }}>
                                      {activity.name}
                                    </div>
                                    {activity.category_names && (
                                      <div className="app-list-item__meta">
                                        <span className="app-list-item__meta-item">
                                          <IonIcon icon={ICON_KATEGORIE_GEFUELLT} className="app-icon-color--category" />
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
              <IonIcon icon={ICON_TERMIN} />
            </div>
            <IonLabel>Datum wählen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
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
              <IonIcon icon={ICON_TEXT} />
            </div>
            <IonLabel>Anmerkungen (optional)</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
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
              <IonIcon icon={ICON_BILD} />
            </div>
            <IonLabel>Foto als Nachweis (optional)</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: 'var(--app-abstand-mittel)' }}>
              <div
                onClick={handlePhotoSelect}
                style={{
                  padding: 'var(--app-abstand-basis)',
                  backgroundColor: photoPreview ? 'rgba(var(--app-color-gemeinde-rgb), 0.08)' : 'transparent',
                  borderRadius: 'var(--app-radius-knopf)',
                  border: photoPreview ? '1px solid rgba(var(--app-color-gemeinde-rgb), 0.2)' : '1px dashed var(--app-border-strong)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {photoPreview ? (
                  <div className="app-settings-item" style={{ justifyContent: 'space-between' }}>
                    <div className="app-settings-item" style={{ gap: 'var(--app-abstand-eng)' }}>
                      <IonIcon
                        icon={ICON_ZUSAGE_GEFUELLT}
                        className="app-icon-color--gemeinde"
                        style={{ fontSize: 'var(--app-text-untertitel)' }}
                      />
                      <span style={{ fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-color-gemeinde)' }}>
                        Foto ausgewählt
                      </span>
                    </div>
                    <IonButton aria-label="Foto entfernen"
                      fill="clear"
                      color="danger"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePhoto();
                      }}
                    >
                      <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                    </IonButton>
                  </div>
                ) : (
                  <div className="app-settings-item" style={{ justifyContent: 'center' }}>
                    <IonIcon
                      icon={ICON_KAMERA_GEFUELLT}
                      className="app-icon-color--gemeinde"
                      style={{ fontSize: 'var(--app-text-untertitel)' }}
                    />
                    <span style={{ fontWeight: 'var(--app-schrift-mittel)', color: 'var(--app-text-secondary)' }}>
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
