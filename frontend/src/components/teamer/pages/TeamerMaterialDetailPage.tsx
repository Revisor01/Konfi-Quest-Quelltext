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
  ICON_BEARBEITEN_GEFUELLT,
  ICON_BILD,
  ICON_DATEI,
  ICON_DATEI_GEFUELLT,
  ICON_EXTERN_OEFFNEN,
  ICON_GRUPPE_GEFUELLT,
  ICON_INFO_GEFUELLT,
  ICON_LINK,
  ICON_MUSIK,
  ICON_PERSON_GEFUELLT,
  ICON_SCHLIESSEN,
  ICON_TERMIN_GEFUELLT,
  ICON_TEXT,
  ICON_VIDEO,
  ICON_WELT,
} from '../../shared/icons';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
// Native FileViewer über openFileNatively, FileViewerModal als Web-Fallback
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
import { istWebLink, hostAus, materialLinks } from '../../../utils/linkDisplay';

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
  link_url?: string | null;
  links?: { id: number; url: string }[];
  ist_global?: boolean;
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
    if (mimeType.startsWith('image/')) return ICON_BILD;
    if (mimeType.startsWith('video/')) return ICON_VIDEO;
    if (mimeType.startsWith('audio/')) return ICON_MUSIK;
    return ICON_DATEI;
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

  // Links oeffnen extern im Browser — derselbe Weg wie bei Kartenlinks und
  // Links in Chatnachrichten (window.open mit _blank). istWebLink haelt alles
  // ab, was kein http/https ist; der Server laesst zwar ohnehin nichts anderes
  // durch, aber der Waechter steht dort, wo das href entsteht.
  const openLink = async (url: string) => {
    if (!istWebLink(url)) {
      setError('Der Link konnte nicht geöffnet werden');
      return;
    }
    await Haptics.impact({ style: ImpactStyle.Medium });
    window.open(url, '_blank');
  };

  return (
    <IonPage ref={pageRef}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton className="app-modal-close-btn" onClick={onClose} aria-label="Schließen">
              <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
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
            icon={ICON_DATEI_GEFUELLT}
            title="Nicht gefunden"
            message="Das Material konnte nicht geladen werden."
          />
        ) : (
          <>
            {/* SectionHeader oben */}
            <SectionHeader
              title={material.title}
              subtitle="Material"
              icon={ICON_DATEI_GEFUELLT}
              colors={{ primary: 'var(--app-color-material)', secondary: 'var(--app-color-material-dunkel)' }}
              stats={[{ value: material.files?.length || 0, label: 'Dateien' }]}
            />

            {/* Beschreibung */}
            {material.description && (
              <IonList inset={true} className="app-segment-wrapper">
                <IonListHeader>
                  <div className="app-section-icon app-section-icon--material">
                    <IonIcon icon={ICON_TEXT} />
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
                  <IonIcon icon={ICON_INFO_GEFUELLT} />
                </div>
                <IonLabel>Details</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  {material.ist_global && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_WELT} className="app-info-row__icon" style={{ color: 'var(--app-color-material)' }} />
                      <div>
                        <div className="app-info-row__label">Sichtbar für</div>
                        <div className="app-info-row__value">Das ganze Team der Gemeinde</div>
                      </div>
                    </div>
                  )}
                  {material.events && material.events.length > 0 && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-color-events)' }} />
                      <div>
                        <div className="app-info-row__label">{material.events.length === 1 ? 'Event' : 'Events'}</div>
                        <div className="app-info-row__value">{material.events.map(e => e.name).join(', ')}</div>
                      </div>
                    </div>
                  )}
                  {material.jahrgaenge && material.jahrgaenge.length > 0 && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-color-konfis)' }} />
                      <div>
                        <div className="app-info-row__label">{material.jahrgaenge.length === 1 ? 'Jahrgang' : 'Jahrgänge'}</div>
                        <div className="app-info-row__value">{material.jahrgaenge.map(j => j.name).join(', ')}</div>
                      </div>
                    </div>
                  )}
                  <div className="app-info-row">
                    <IonIcon icon={ICON_BEARBEITEN_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-color-neutral)' }} />
                    <div>
                      <div className="app-info-row__label">Erstellt</div>
                      <div className="app-info-row__value">{formatDate(material.created_at)}</div>
                    </div>
                  </div>
                  {material.admin_name && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_PERSON_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-color-neutral)' }} />
                      <div>
                        <div className="app-info-row__label">Erstellt von</div>
                        <div className="app-info-row__value">{material.admin_name}</div>
                      </div>
                    </div>
                  )}
                </IonCardContent>
              </IonCard>
            </IonList>

            {materialLinks(material).length > 0 && (
              <IonList inset={true} className="app-segment-wrapper">
                <IonListHeader>
                  <div className="app-section-icon app-section-icon--material">
                    <IonIcon icon={ICON_LINK} />
                  </div>
                  <IonLabel>{materialLinks(material).length === 1 ? 'Link' : 'Links'}</IonLabel>
                </IonListHeader>
                <IonCard className="app-card">
                  <IonCardContent>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                      {materialLinks(material).map((url) => (
                        <div
                          key={url}
                          className="app-list-item"
                          style={{ borderLeftColor: 'var(--app-color-material)', cursor: 'pointer' }}
                          onClick={() => openLink(url)}
                        >
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-material)' }}>
                                <IonIcon icon={ICON_LINK} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">{hostAus(url)}</div>
                                <div className="app-list-item__meta">
                                  <span className="app-list-item__meta-item">
                                    <IonIcon icon={ICON_EXTERN_OEFFNEN} style={{ color: 'var(--app-color-material)' }} />
                                    Im Browser öffnen
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </IonCardContent>
                </IonCard>
              </IonList>
            )}

            {/* Dateien */}
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--material">
                  <IonIcon icon={ICON_DATEI_GEFUELLT} />
                </div>
                <IonLabel>Dateien ({material.files?.length || 0})</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent style={{ padding: (!material.files || material.files.length === 0) ? 'var(--app-abstand-basis)' : 'var(--app-abstand-mittel)' }}>
                  {(!material.files || material.files.length === 0) ? (
                    <EmptyState
                      icon={ICON_DATEI}
                      title="Keine Dateien"
                      message="Dieses Material hat keine angehängten Dateien."
                      iconColor="var(--app-color-material)"
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {material.files.map((file) => (
                      <div
                        key={file.id}
                        className="app-list-item"
                        style={{
                          borderLeftColor: 'var(--app-color-material)',
                          cursor: 'pointer'
                        }}
                        onClick={() => openFile(file)}
                      >
                        <div className="app-list-item__row">
                          <div className="app-list-item__main">
                            <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-material)' }}>
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
