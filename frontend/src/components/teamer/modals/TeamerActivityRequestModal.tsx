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
  IonList,
  IonListHeader,
  IonAccordion,
  IonAccordionGroup,
  useIonAlert
} from '@ionic/react';
import {
  ICON_AKTENTASCHE,
  ICON_AUFKLAPPEN,
  ICON_BILD,
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
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import { writeQueue, QueueBody } from '../../../services/writeQueue';
import { warteschlangenDateiSichern } from '../../../services/warteschlangenDatei';
import { AktivitaetMelden } from '../../../types/request';
import { networkMonitor } from '../../../services/networkMonitor';
import { safeUUID } from '../../../utils/uuid';
import { fuerUploadVorbereiten, DateiZuGrossFehler, UPLOAD_GRENZE } from '../../../services/mediaCompression';
import { dateiAuswaehlen } from '../../../services/systemDialoge';
import SendeAnzeige from '../../shared/SendeAnzeige';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { tastaturKlick } from '../../../utils/tastatur';
import { track } from '../../../services/analytics';
import { sendenOderEinreihen, istVerbindungsabbruch } from '../../../utils/sendenOderEinreihen';

interface Activity {
  id: number;
  name: string;
  description?: string;
  // Teamer-Aktivitäten haben KEINE Punkte und KEINEN Typ: points ist 0,
  // type ist in der Datenbank NULL. Die Deklaration als non-nullable war
  // schlicht falsch — genau dieses Muster (null dort annehmen, wo ein Wert
  // versprochen wird) hat schon zweimal zum Absturz geführt.
  points?: number | null;
  type?: 'gottesdienst' | 'gemeinde' | null;
  category_names?: string;
}

interface TeamerActivityRequestModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const TeamerActivityRequestModal: React.FC<TeamerActivityRequestModalProps> = ({
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
    'teamer:activities:' + user?.organization_id,
    () => api.get('/teamer/activities').then(r => r.data),
    { ttl: CACHE_TTL.STAMMDATEN }
  );
  const activities = activitiesData || [];

  // Über die Hülle (services/systemDialoge): Sie meldet den Ausflug der
  // App-Sperre an — ohne ihn sperrte die Fotoauswahl bei „Sofort" die App
  // 
  const handlePhotoSelect = async () => {
    const auswahl = await dateiAuswaehlen({ accept: 'image/*' });
    if (auswahl) await fotoUebernehmen(auswahl[0]);
  };

  const fotoUebernehmen = async (file: File) => {
    try {
      // Derselbe Weg wie in Chat und Challenges: erst
      // verkleinern (1920 px, JPEG), DANN gegen die Grenze des Servers prüfen
      // — Live-Kamerafotos haben 8-16 MB und passen erst danach. Zu groß
      // meldet derselbe Satz wie überall: "Datei ist zu groß (max. 5 MB)."
      const { file: prepared, bildVorschau } = await fuerUploadVorbereiten(file, UPLOAD_GRENZE.nachweisfoto);
      // Das Formular zeigt keine Bildvorschau, nur "Foto ausgewählt".
      if (bildVorschau) URL.revokeObjectURL(bildVorschau);
      setFormData(prev => ({ ...prev, photo_file: prepared }));

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(prepared);
    } catch (err) {
      setError(err instanceof DateiZuGrossFehler ? err.message : 'Foto konnte nicht verarbeitet werden');
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
      // Netz abgerissen: unverpackt weiterreichen, damit der Vorgang in die
      // Warteschlange faellt (sendenOderEinreihen erkennt nur den Netzfehler).
      if (istVerbindungsabbruch(error)) throw error;
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
        message: 'Aktivitäten benötigen normalerweise ein Foto als Nachweis. Möchtest du trotzdem fortfahren?',
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

      // In die Warteschlange: derselbe Vorgang mit derselben client_id, das
      // Foto lokal gesichert (die Warteschlange laedt es beim Senden hoch).
      let fotoNichtGesichert = false;
      const einreihen = async () => {
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
            queueBody._localPhotoPath = await warteschlangenDateiSichern(fileName, base64);
            queueBody._photoFileName = formData.photo_file.name;
          } catch (fehler) {
            fotoNichtGesichert = true;
            throw fehler;
          }
        }

        await writeQueue.enqueue({
          method: 'POST',
          url: '/teamer/requests',
          body: queueBody,
          maxRetries: 5,
          hasFileUpload,
          metadata: {
            type: 'request',
            clientId,
            label: 'Aktivität melden',
          },
        });
      };

      try {
        // Offline -- oder online, aber das Netz reisst ab: in die
        // Warteschlange statt in eine Fehlermeldung.
        // Ein zweiter Eingang ist
        // harmlos: Der Server erkennt ihn an der client_id.
        const { weg } = await sendenOderEinreihen({
          online: networkMonitor.isOnline,
          methode: 'POST',
          idempotent: true,
          senden: async () => {
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

            await api.post('/teamer/requests', requestData);
            // Anonyme Messung: Wie oft werden Aktivitäten
            // eingereicht, und mit Nachweisfoto? Erst nach der erfolgreichen
            // Antwort; kein Name, keine Aktivität, keine Kennung.
            track('aktivitaet-eingereicht', { mit_foto: !!photoFilename });
          },
          einreihen,
        });

        setSuccess(weg === 'eingereiht'
          ? 'Aktivität wird gesendet sobald du wieder online bist'
          : 'Aktivität erfolgreich eingereicht!');
        onSuccess();
      } catch (error) {
        setError(fotoNichtGesichert
          ? 'Foto konnte nicht lokal gespeichert werden'
          : fehlerTextOderMessage(error, 'Fehler beim Einreichen der Aktivität'));
      } finally {
        setUploadProgress(0);
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
            <IonButton aria-label="Aktivität absenden" className="app-modal-submit-btn app-modal-submit-btn--teamer" onClick={handleSubmit} disabled={isSubmitting || loading}>
              <IonIcon icon={ICON_HAKEN_GEFUELLT} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
        {/* Dieselbe Anzeige wie beim Einreichen eines Challenge-Beitrags:
            Prozent und Balken, bei 100 % "Wird verarbeitet…" —
            der Server verschlüsselt das Foto dann noch. Vorher ein Balken
            ohne Zahl. */}
        {isSubmitting && (
          <SendeAnzeige prozent={uploadProgress} was="Foto" farbe="var(--app-text-requests)" />
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
                  <IonItem slot="header" lines="none" style={{ '--padding-start': 'var(--app-abstand-basis)', '--inner-padding-end': 'var(--app-abstand-mittel)' }}>
                    {selectedActivity ? (
                      // Gewaehlt: schlichte Header-Zeile (Icon + Name + Kategorie)
                      // — keine Card-im-Header-Optik (sah gequetscht aus).
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--app-abstand-mittel)', width: '100%', pointerEvents: 'none' }}>
                        <div className="app-icon-circle app-icon-circle--teamer" style={{ flexShrink: 0 }}>
                          <IonIcon icon={ICON_AKTENTASCHE} />
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
                      </div>
                    ) : (
                      <IonLabel>
                        <h3 className="app-list-item__subtitle" style={{ margin: '0' }}>
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
                          return (
                            <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-pressed={isSelected}
                              key={activity.id}
                              className={`app-list-item app-list-item--teamer${isSelected ? ' app-list-item--selected' : ''}`}
                              onClick={() => {
                                setFormData(prev => ({ ...prev, activity_id: activity.id.toString() }));
                                if (accordionGroupRef.current) {
                                  accordionGroupRef.current.value = undefined;
                                }
                              }}
                              style={{ cursor: 'pointer', position: 'relative' }}
                            >
                              <div className="app-list-item__row">
                                <div className="app-list-item__main">
                                  <div className="app-icon-circle app-icon-circle--teamer">
                                    <IonIcon icon={ICON_AKTENTASCHE} />
                                  </div>
                                  <div className="app-list-item__content">
                                    <div className="app-list-item__title">{activity.name}</div>
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
                <IonModal aria-label="Datum wählen" keepContentsMounted={true}>
                  <IonDatetime aria-label="Datum wählen"
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
                <IonTextarea aria-label="Anmerkungen (optional)"
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
              <div role="presentation"
                onClick={handlePhotoSelect}
                style={{
                  padding: 'var(--app-abstand-basis)',
                  backgroundColor: photoPreview ? 'rgba(var(--app-color-teamer-rgb), 0.08)' : 'transparent',
                  borderRadius: 'var(--app-radius-knopf)',
                  border: photoPreview ? '1px solid rgba(var(--app-color-teamer-rgb), 0.2)' : '1px dashed var(--app-border-strong)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {photoPreview ? (
                  <div className="app-settings-item" style={{ justifyContent: 'space-between' }}>
                    <div role="button" tabIndex={0} onKeyDown={tastaturKlick} aria-label="Anderes Foto wählen" className="app-settings-item" style={{ gap: 'var(--app-abstand-eng)' }}>
                      <IonIcon
                        icon={ICON_ZUSAGE_GEFUELLT}
                        className="app-icon-color--teamer"
                        style={{ fontSize: 'var(--app-text-untertitel)' }}
                      />
                      <span style={{ fontWeight: 'var(--app-schrift-halbfett)', color: 'var(--app-text-teamer)' }}>
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
                  <div role="button" tabIndex={0} onKeyDown={tastaturKlick} className="app-settings-item" style={{ justifyContent: 'center' }}>
                    <IonIcon
                      icon={ICON_KAMERA_GEFUELLT}
                      className="app-icon-color--teamer"
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

export default TeamerActivityRequestModal;
