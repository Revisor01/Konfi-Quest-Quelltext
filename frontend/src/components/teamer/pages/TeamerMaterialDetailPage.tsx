import React, { useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonLabel,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonRefresher,
  IonRefresherContent,
  useIonModal
} from '@ionic/react';
import {
  document as documentIcon,
  imageOutline,
  videocamOutline,
  musicalNotesOutline,
  documentOutline,
  calendar,
  people,
  person,
  time,
  closeOutline,
  informationCircle,
  textOutline,
  create
} from 'ionicons/icons';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
// Native FileViewer ueber openFileNatively, FileViewerModal als Web-Fallback
import { openFileNatively } from '../../../utils/nativeFileViewer';
import { useApp } from '../../../contexts/AppContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import LoadingSpinner from '../../common/LoadingSpinner';
import EmptyState from '../../shared/EmptyState';
import { SectionHeader } from '../../shared';
import FileViewerModal, { FileItem } from '../../shared/FileViewerModal';
import { triggerPullHaptic } from '../../../utils/haptics';

interface MaterialFile {
  id: number;
  original_name: string;
  stored_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

interface MaterialDetail {
  id: number;
  title: string;
  description?: string;
  events?: { id: number; name: string }[];
  jahrgaenge?: { id: number; name: string }[];
  jahrgang_name?: string;
  admin_name?: string;
  files?: MaterialFile[];
  created_at: string;
}

interface TeamerMaterialDetailProps {
  materialId: number;
  onClose: () => void;
}

const TeamerMaterialDetailPage: React.FC<TeamerMaterialDetailProps> = ({ materialId, onClose }) => {
  const { setError } = useApp();
  const pageRef = useRef<HTMLElement>(null);

  // Offline-Query: Material-Detail (Metadaten, keine Dateien)
  const { data: material, loading, refresh } = useOfflineQuery<MaterialDetail>(
    'teamer:material-detail:' + materialId,
    async () => { const res = await api.get(`/material/${materialId}`); return res.data; },
    { ttl: CACHE_TTL.PROFILE, enabled: !!materialId }
  );

  // FileViewer Modal (universeller Datei-Viewer mit Swipe)
  const viewerRef = useRef<{ files: FileItem[]; initialIndex: number }>({ files: [], initialIndex: 0 });
  const [presentFileViewer, dismissFileViewer] = useIonModal(FileViewerModal, {
    get files() { return viewerRef.current.files; },
    get initialIndex() { return viewerRef.current.initialIndex; },
    onClose: () => {
      dismissFileViewer();
      viewerRef.current.files.forEach(f => {
        if (f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
      });
      viewerRef.current = { files: [], initialIndex: 0 };
    }
  });

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return imageOutline;
    if (mimeType.startsWith('video/')) return videocamOutline;
    if (mimeType.startsWith('audio/')) return musicalNotesOutline;
    return documentOutline;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  };

  const openFile = async (file: MaterialFile) => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
      const response = await api.get(`/material/files/${file.stored_name}`, { responseType: 'blob' });
      const blob = response.data;
      const contentType = response.headers?.['content-type'];
      const mime: string = typeof contentType === 'string' ? contentType : file.mime_type;

      const openedNatively = await openFileNatively(blob, file.original_name, mime);
      if (openedNatively) return;

      // Web-Fallback: FileViewerModal mit Swipe-Kontext
      const blobUrl = URL.createObjectURL(new Blob([blob], { type: mime }));
      const files: FileItem[] = (material?.files || []).map(f => ({
        url: `/api/material/files/${f.stored_name}`,
        fileName: f.original_name,
        mimeType: f.mime_type
      }));
      const clickedIdx = (material?.files || []).findIndex(f => f.id === file.id);
      if (clickedIdx >= 0) {
        files[clickedIdx] = { url: blobUrl, fileName: file.original_name, mimeType: mime };
      }
      viewerRef.current = { files, initialIndex: Math.max(0, clickedIdx) };
      presentFileViewer({ cssClass: 'file-viewer-modal' });
    } catch {
      setError('Fehler beim Öffnen der Datei');
    }
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={onClose}>
              <IonIcon icon={closeOutline} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>{material?.title || 'Material'}</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await refresh();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <LoadingSpinner message="Material wird geladen..." />
        ) : !material ? (
          <EmptyState
            icon={documentIcon}
            title="Nicht gefunden"
            message="Das Material konnte nicht geladen werden."
          />
        ) : (
          <>
            {/* SectionHeader oben */}
            <SectionHeader
              title={material.title}
              subtitle="Material"
              icon={documentIcon}
              colors={{ primary: '#d97706', secondary: '#b45309' }}
              stats={[{ value: material.files?.length || 0, label: 'Dateien' }]}
            />

            {/* Beschreibung */}
            {material.description && (
              <IonList inset={true} className="app-segment-wrapper">
                <IonListHeader>
                  <div className="app-section-icon app-section-icon--material">
                    <IonIcon icon={textOutline} />
                  </div>
                  <IonLabel>Beschreibung</IonLabel>
                </IonListHeader>
                <IonCard className="app-card">
                  <IonCardContent>
                    <div className="app-description-text">
                      {material.description}
                    </div>
                  </IonCardContent>
                </IonCard>
              </IonList>
            )}

            {/* Details */}
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--material">
                  <IonIcon icon={informationCircle} />
                </div>
                <IonLabel>Details</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  {material.events && material.events.length > 0 && (
                    <div className="app-info-row">
                      <IonIcon icon={calendar} className="app-info-row__icon" style={{ color: 'var(--app-color-events)' }} />
                      <div>
                        <div className="app-info-row__label">{material.events.length === 1 ? 'Event' : 'Events'}</div>
                        <div className="app-info-row__value">{material.events.map(e => e.name).join(', ')}</div>
                      </div>
                    </div>
                  )}
                  {material.jahrgaenge && material.jahrgaenge.length > 0 && (
                    <div className="app-info-row">
                      <IonIcon icon={people} className="app-info-row__icon" style={{ color: 'var(--app-color-konfis)' }} />
                      <div>
                        <div className="app-info-row__label">{material.jahrgaenge.length === 1 ? 'Jahrgang' : 'Jahrgänge'}</div>
                        <div className="app-info-row__value">{material.jahrgaenge.map(j => j.name).join(', ')}</div>
                      </div>
                    </div>
                  )}
                  <div className="app-info-row">
                    <IonIcon icon={create} className="app-info-row__icon" style={{ color: '#6c757d' }} />
                    <div>
                      <div className="app-info-row__label">Erstellt</div>
                      <div className="app-info-row__value">{formatDate(material.created_at)}</div>
                    </div>
                  </div>
                  {material.admin_name && (
                    <div className="app-info-row">
                      <IonIcon icon={person} className="app-info-row__icon" style={{ color: '#6c757d' }} />
                      <div>
                        <div className="app-info-row__label">Erstellt von</div>
                        <div className="app-info-row__value">{material.admin_name}</div>
                      </div>
                    </div>
                  )}
                </IonCardContent>
              </IonCard>
            </IonList>

            {/* Dateien */}
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--material">
                  <IonIcon icon={documentIcon} />
                </div>
                <IonLabel>Dateien ({material.files?.length || 0})</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent style={{ padding: (!material.files || material.files.length === 0) ? '16px' : '12px' }}>
                  {(!material.files || material.files.length === 0) ? (
                    <EmptyState
                      icon={documentOutline}
                      title="Keine Dateien"
                      message="Dieses Material hat keine angehängten Dateien."
                      iconColor="#d97706"
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {material.files.map((file, index) => (
                      <div
                        key={file.id}
                        className="app-list-item"
                        style={{
                          borderLeftColor: '#d97706',
                          cursor: 'pointer'
                        }}
                        onClick={() => openFile(file)}
                      >
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
                    ))}
                    </div>
                  )}
                </IonCardContent>
              </IonCard>
            </IonList>

            <div className="ion-padding-bottom" />
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default TeamerMaterialDetailPage;
