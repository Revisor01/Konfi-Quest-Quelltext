import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonItem,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonLabel,
  IonInput,
  IonTextarea,
  IonIcon,
  IonSpinner,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonAccordion,
  IonAccordionGroup,
  useIonAlert,
  useIonModal
} from '@ionic/react';
import {
  checkmarkOutline,
  closeOutline,
  trash,
  attachOutline,
  cloudUploadOutline,
  document as documentIcon,
  imageOutline,
  videocamOutline,
  musicalNotesOutline,
  chevronDownOutline
} from 'ionicons/icons';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileViewer } from '@capacitor/file-viewer';
import { FileOpener } from '@capacitor-community/file-opener';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';
import { writeQueue } from '../../../services/writeQueue';
import { networkMonitor } from '../../../services/networkMonitor';
import FileViewerModal from '../../shared/FileViewerModal';
import { safeUUID } from '../../../utils/uuid';

interface MaterialFile {
  id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

interface EventOption {
  id: number;
  name: string;
  event_date?: string;
}

interface JahrgangOption {
  id: number;
  name: string;
}

interface Material {
  id: number;
  title: string;
  description?: string;
  event_id?: number;
  event_name?: string;
  events?: { id: number; name: string }[];
  jahrgang_id?: number;
  jahrgang_name?: string;
  jahrgaenge?: { id: number; name: string }[];
  files?: MaterialFile[];
  created_at: string;
}

interface MaterialFormModalProps {
  material?: Material | null;
  onClose: () => void;
  onSuccess: () => void;
  dismiss?: () => void;
}

const MaterialFormModal: React.FC<MaterialFormModalProps> = ({ material, onClose, onSuccess }) => {
  const { setError, setSuccess, isOnline } = useApp();
  const [presentAlert] = useIonAlert();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLElement>(null);

  const [title, setTitle] = useState(material?.title || '');
  const [description, setDescription] = useState(material?.description || '');
  const [eventIds, setEventIds] = useState<number[]>(
    material?.events?.map(e => e.id) || (material?.event_id ? [material.event_id] : [])
  );
  const [jahrgangIds, setJahrgangIds] = useState<number[]>(
    material?.jahrgaenge?.map(j => j.id) || (material?.jahrgang_id ? [material.jahrgang_id] : [])
  );
  const [existingFiles, setExistingFiles] = useState<MaterialFile[]>(material?.files || []);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const { isSubmitting, guard } = useActionGuard();

  const [events, setEvents] = useState<EventOption[]>([]);
  const [jahrgaenge, setJahrgaenge] = useState<JahrgangOption[]>([]);

  // FileViewer Modal (In-App Dateivorschau)
  const viewerDataRef = useRef({ blobUrl: '', fileName: '', mimeType: '' });
  const [presentFileViewer, dismissFileViewer] = useIonModal(FileViewerModal, {
    get blobUrl() { return viewerDataRef.current.blobUrl; },
    get fileName() { return viewerDataRef.current.fileName; },
    get mimeType() { return viewerDataRef.current.mimeType; },
    onClose: () => {
      dismissFileViewer();
      if (viewerDataRef.current.blobUrl) {
        URL.revokeObjectURL(viewerDataRef.current.blobUrl);
        viewerDataRef.current = { blobUrl: '', fileName: '', mimeType: '' };
      }
    }
  });

  const openInAppViewer = useCallback((blob: Blob, fileName: string, mimeType: string) => {
    const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
    viewerDataRef.current = { blobUrl: url, fileName, mimeType };
    presentFileViewer();
  }, [presentFileViewer]);

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      const [eventsRes, jahrgaengeRes] = await Promise.all([
        api.get('/events'),
        api.get('/admin/jahrgaenge')
      ]);
      setEvents(eventsRes.data);
      setJahrgaenge(jahrgaengeRes.data);
    } catch {
      // Optionen laden fehlgeschlagen
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return imageOutline;
    if (mimeType.startsWith('video/')) return videocamOutline;
    if (mimeType.startsWith('audio/')) return musicalNotesOutline;
    return documentIcon;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const openFile = async (file: MaterialFile) => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
      const response = await api.get(`/material/files/${file.stored_name}`, {
        responseType: 'blob'
      });
      const blob = response.data;
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(blob);
      });

      const ext = file.original_name.split('.').pop() || '';
      const tempPath = `temp/material_${file.id}.${ext}`;

      try {
        await Filesystem.mkdir({ path: 'temp', directory: Directory.Documents, recursive: true });
      } catch { /* existiert bereits */ }

      await Filesystem.writeFile({
        path: tempPath,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true
      });

      const fileUri = await Filesystem.getUri({ directory: Directory.Documents, path: tempPath });

      if (file.mime_type.startsWith('image/')) {
        await FileOpener.open({ filePath: fileUri.uri, contentType: file.mime_type });
      } else {
        await FileViewer.openDocumentFromLocalPath({ path: fileUri.uri });
      }
    } catch (err) {
      console.warn('Native file viewer failed, using in-app fallback:', err);
      try {
        const response = await api.get(`/material/files/${file.stored_name}`, { responseType: 'blob' });
        openInAppViewer(response.data, file.original_name, file.mime_type);
      } catch {
        setError('Fehler beim Öffnen der Datei');
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setNewFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
    // Input zurücksetzen
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeNewFile = (index: number) => {
    setNewFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDeleteExistingFile = (file: MaterialFile) => {
    presentAlert({
      header: 'Datei löschen',
      message: `"${file.original_name}" wirklich löschen?`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/material/files/${file.id}`);
              setExistingFiles(prev => prev.filter(f => f.id !== file.id));
            } catch {
              setError('Fehler beim Löschen der Datei');
            }
          }
        }
      ]
    });
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Bitte einen Titel eingeben');
      return;
    }

    await guard(async () => {
      try {
        const payload: any = {
          title: title.trim(),
          description: description.trim() || null,
          event_ids: eventIds,
          jahrgang_ids: jahrgangIds
        };

        if (networkMonitor.isOnline) {
          // Online-Pfad: direkt senden
          let materialId = material?.id;

          if (material) {
            await api.put(`/material/${material.id}`, payload);
          } else {
            const res = await api.post('/material', payload);
            materialId = res.data.id;
          }

          // Neue Dateien hochladen
          if (newFiles.length > 0 && materialId) {
            const formData = new FormData();
            newFiles.forEach(file => {
              formData.append('files', file);
            });
            await api.post(`/material/${materialId}/files`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
          }

        } else {
          // Offline-Pfad: Nur Metadaten queuen (Dateien nur online)
          await writeQueue.enqueue({
            method: material ? 'PUT' : 'POST',
            url: material ? `/material/${material.id}` : '/material',
            body: payload,
            maxRetries: 5,
            hasFileUpload: false,
            metadata: { type: 'admin', clientId: safeUUID(), label: material ? 'Material bearbeiten' : 'Material erstellen' },
          });

          if (newFiles.length > 0) {
            setSuccess('Material-Metadaten werden offline gespeichert. Dateien kannst du hochladen sobald du wieder online bist');
          } else {
            setSuccess('Material wird gespeichert sobald du wieder online bist');
          }
        }

        onSuccess();
      } catch (err: any) {
        setError(err.response?.data?.error || 'Fehler beim Speichern');
      }
    });
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose}>
              <IonIcon icon={closeOutline} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>{material ? 'Material bearbeiten' : 'Neues Material'}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting ? <IonSpinner name="crescent" /> : <IonIcon icon={checkmarkOutline} slot="icon-only" />}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Titel & Beschreibung */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--material">
              <IonIcon icon={documentIcon} />
            </div>
            <IonLabel>Grunddaten</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              <IonItem lines="full" style={{ '--background': 'transparent' }}>
                <IonInput
                  label="Titel"
                  labelPlacement="stacked"
                  value={title}
                  onIonInput={(e) => setTitle(e.detail.value || '')}
                  placeholder="Material-Titel"
                  required
                />
              </IonItem>
              <IonItem lines="none" style={{ '--background': 'transparent' }}>
                <IonTextarea
                  label="Beschreibung"
                  labelPlacement="stacked"
                  value={description}
                  onIonInput={(e) => setDescription(e.detail.value || '')}
                  placeholder="Optionale Beschreibung..."
                  autoGrow={true}
                  rows={3}
                />
              </IonItem>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Events zuordnen */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--material">
              <IonIcon icon={documentIcon} />
            </div>
            <IonLabel>Zuordnung</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent style={{ padding: '0' }}>
              <IonAccordionGroup>
                <IonAccordion value="events" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                  <IonItem slot="header" lines="none" style={{ '--padding-start': '16px' }}>
                    <IonLabel>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151', margin: '0 0 2px 0' }}>
                        Events
                      </h3>
                      <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0', fontWeight: '400' }}>
                        {eventIds.length > 0
                          ? `${eventIds.length} ${eventIds.length === 1 ? 'Event' : 'Events'} ausgewählt`
                          : 'Keine Events zugeordnet'}
                      </p>
                    </IonLabel>
                  </IonItem>
                  <div slot="content" style={{ padding: '4px 16px 12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {events
                        .filter(ev => new Date(ev.event_date || '') >= new Date(new Date().toDateString()) || eventIds.includes(ev.id))
                        .map(ev => {
                          const isSelected = eventIds.includes(ev.id);
                          return (
                            <div
                              key={ev.id}
                              className="app-list-item"
                              onClick={() => {
                                if (isSelected) {
                                  setEventIds(eventIds.filter(id => id !== ev.id));
                                } else {
                                  setEventIds([...eventIds, ev.id]);
                                }
                              }}
                              style={{
                                cursor: 'pointer',
                                marginBottom: '0',
                                borderLeftColor: isSelected ? '#d97706' : '#e5e7eb',
                                backgroundColor: isSelected ? 'rgba(217, 119, 6, 0.08)' : undefined
                              }}
                            >
                              <div className="app-list-item__row">
                                <div className="app-list-item__main">
                                  <div className="app-list-item__content">
                                    <div className="app-list-item__title">{ev.name}</div>
                                    {ev.event_date && (
                                      <div className="app-list-item__subtitle">
                                        {new Date(ev.event_date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </IonAccordion>

                <IonAccordion value="jahrgaenge" toggleIcon={chevronDownOutline} toggleIconSlot="end">
                  <IonItem slot="header" lines="none" style={{ '--padding-start': '16px' }}>
                    <IonLabel>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#374151', margin: '0 0 2px 0' }}>
                        Jahrgänge
                      </h3>
                      <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0', fontWeight: '400' }}>
                        {jahrgangIds.length > 0
                          ? `${jahrgangIds.length} ${jahrgangIds.length === 1 ? 'Jahrgang' : 'Jahrgänge'} ausgewählt`
                          : 'Keine Jahrgänge zugeordnet'}
                      </p>
                    </IonLabel>
                  </IonItem>
                  <div slot="content" style={{ padding: '4px 16px 12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {jahrgaenge.map(jg => {
                        const isSelected = jahrgangIds.includes(jg.id);
                        return (
                          <div
                            key={jg.id}
                            className="app-list-item"
                            onClick={() => {
                              if (isSelected) {
                                setJahrgangIds(jahrgangIds.filter(id => id !== jg.id));
                              } else {
                                setJahrgangIds([...jahrgangIds, jg.id]);
                              }
                            }}
                            style={{
                              cursor: 'pointer',
                              marginBottom: '0',
                              borderLeftColor: isSelected ? '#d97706' : '#e5e7eb',
                              backgroundColor: isSelected ? 'rgba(217, 119, 6, 0.08)' : undefined
                            }}
                          >
                            <div className="app-list-item__row">
                              <div className="app-list-item__main">
                                <div className="app-list-item__content">
                                  <div className="app-list-item__title">{jg.name}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </IonAccordion>
              </IonAccordionGroup>
            </IonCardContent>
          </IonCard>
        </IonList>

        {/* Bestehende Dateien */}
        {existingFiles.length > 0 && (
          <IonList inset={true} className="app-segment-wrapper">
            <IonListHeader>
              <div className="app-section-icon app-section-icon--material">
                <IonIcon icon={attachOutline} />
              </div>
              <IonLabel>Vorhandene Dateien</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {existingFiles.map((file, index) => (
                    <IonItemSliding key={file.id} style={{ marginBottom: index < existingFiles.length - 1 ? '8px' : '0' }}>
                      <IonItem
                        button
                        detail={false}
                        lines="none"
                        className="app-item-transparent"
                        onClick={() => openFile(file)}
                      >
                        <div className="app-list-item" style={{ borderLeftColor: '#d97706' }}>
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle" style={{ backgroundColor: '#d97706' }}>
                                <IonIcon icon={getFileIcon(file.mime_type)} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">{file.original_name}</div>
                                <div className="app-list-item__meta">
                                  <span className="app-list-item__meta-item">
                                    {formatFileSize(file.file_size)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </IonItem>
                      <IonItemOptions className="app-swipe-actions" side="end">
                        <IonItemOption
                          className="app-swipe-action"
                          onClick={() => handleDeleteExistingFile(file)}
                        >
                          <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                            <IonIcon icon={trash} />
                          </div>
                        </IonItemOption>
                      </IonItemOptions>
                    </IonItemSliding>
                  ))}
                </div>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}

        {/* Neue Dateien */}
        <IonList inset={true} className="app-segment-wrapper">
          <IonListHeader>
            <div className="app-section-icon app-section-icon--material">
              <IonIcon icon={cloudUploadOutline} />
            </div>
            <IonLabel>Dateien hinzufügen</IonLabel>
          </IonListHeader>
          <IonCard className="app-card">
            <IonCardContent>
              {newFiles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '12px' }}>
                  {newFiles.map((file, index) => (
                    <IonItemSliding key={index} style={{ marginBottom: index < newFiles.length - 1 ? '8px' : '0' }}>
                      <IonItem
                        button
                        detail={false}
                        lines="none"
                        className="app-item-transparent"
                        onClick={() => {
                          openInAppViewer(file, file.name, file.type);
                        }}
                      >
                        <div className="app-list-item" style={{ borderLeftColor: '#d97706' }}>
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle" style={{ backgroundColor: '#d97706' }}>
                                <IonIcon icon={attachOutline} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">{file.name}</div>
                                <div className="app-list-item__meta">
                                  <span className="app-list-item__meta-item">
                                    {formatFileSize(file.size)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </IonItem>
                      <IonItemOptions className="app-swipe-actions" side="end">
                        <IonItemOption
                          className="app-swipe-action"
                          onClick={() => removeNewFile(index)}
                        >
                          <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                            <IonIcon icon={trash} />
                          </div>
                        </IonItemOption>
                      </IonItemOptions>
                    </IonItemSliding>
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf,video/*,audio/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              <IonButton
                expand="block"
                fill="solid"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  '--background': 'var(--ion-color-primary)',
                  marginTop: '16px',
                  padding: '0 16px'
                }}
              >
                <IonIcon icon={cloudUploadOutline} slot="start" />
                Datei auswählen
              </IonButton>
            </IonCardContent>
          </IonCard>
        </IonList>

        <div className="ion-padding-bottom" />
      </IonContent>
    </IonPage>
  );
};

export default MaterialFormModal;
