import React, { useState, useMemo, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonIcon,
  IonLabel,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonItem,
  IonItemGroup,
  IonButtons,
  IonButton,
  IonInput,
  IonSelect,
  IonSelectOption,
  useIonModal
} from '@ionic/react';
import {
  document as documentIcon,
  documentOutline,
  imageOutline,
  videocamOutline,
  musicalNotesOutline,
  attachOutline,
  calendar,
  calendarOutline,
  filterOutline,
  search as searchIcon,
  arrowBack,
  people,
  person,
  time,
  informationCircle,
  textOutline,
  create
} from 'ionicons/icons';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { openFileNatively } from '../../../utils/nativeFileViewer';
import { useApp } from '../../../contexts/AppContext';
import { useModalPage } from '../../../contexts/ModalContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { SectionHeader } from '../../shared';
import EmptyState from '../../shared/EmptyState';
import LoadingSpinner from '../../common/LoadingSpinner';
import FileViewerModal from '../../shared/FileViewerModal';
import { triggerPullHaptic } from '../../../utils/haptics';

interface Material {
  id: number;
  title: string;
  description?: string;
  events?: { id: number; name: string }[];
  event_count?: number;
  jahrgang_id?: number;
  jahrgang_name?: string;
  file_count?: number;
  created_at: string;
}

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

const TeamerMaterialPage: React.FC = () => {
  const { user, setError } = useApp();
  const { presentingElement } = useModalPage('teamer-material');

  const [search, setSearch] = useState('');
  const [activeJahrgangId, setActiveJahrgangId] = useState<number | undefined>();
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Offline-Query: Jahrgaenge
  const { data: jahrgaengeData, refresh: refreshJahrgaenge } = useOfflineQuery<{ id: number; name: string }[]>(
    'teamer:jahrgaenge:' + user?.organization_id,
    async () => { const res = await api.get('/admin/jahrgaenge'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );
  const jahrgaenge = jahrgaengeData || [];

  // Offline-Query: Material (alle Materialien, clientseitig gefiltert)
  const { data: allMaterials, loading, refresh: refreshMaterial } = useOfflineQuery<Material[]>(
    'teamer:material:' + user?.organization_id,
    async () => { const res = await api.get('/material'); return res.data; },
    { ttl: CACHE_TTL.PROFILE }
  );

  // Clientseitiges Filtern nach Suche und Jahrgang
  const materials = useMemo(() => {
    let filtered = allMaterials || [];
    if (search) {
      const lower = search.toLowerCase();
      filtered = filtered.filter(m =>
        m.title.toLowerCase().includes(lower) ||
        (m.description && m.description.toLowerCase().includes(lower))
      );
    }
    if (activeJahrgangId) {
      filtered = filtered.filter(m => m.jahrgang_id === activeJahrgangId);
    }
    return filtered;
  }, [allMaterials, search, activeJahrgangId]);

  // FileViewer Modal (In-App Dateivorschau mit Backdrop)
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

  const openInAppViewer = (blob: Blob, fileName: string, mimeType: string) => {
    const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
    viewerDataRef.current = { blobUrl: url, fileName, mimeType };
    presentFileViewer();
  };

  // Detail öffnen - API laden und inline anzeigen
  const openDetail = async (matId: number) => {
    try {
      setDetailLoading(true);
      const res = await api.get(`/material/${matId}`);
      setSelectedMaterial(res.data);
    } catch {
      setError('Fehler beim Laden des Materials');
    } finally {
      setDetailLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatDateLong = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  };

  // File-Handling Funktionen
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

  const openFile = async (file: MaterialFile) => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
      const response = await api.get(`/material/files/${file.stored_name}`, { responseType: 'blob' });
      const blob = response.data;
      const contentType = response.headers?.['content-type'];
      const mime: string = typeof contentType === 'string' ? contentType : file.mime_type;

      const openedNatively = await openFileNatively(blob, file.original_name, mime);
      if (openedNatively) return;

      // Web-Fallback: In-App Viewer
      openInAppViewer(blob, file.original_name, mime);
    } catch {
      setError('Fehler beim Öffnen der Datei');
    }
  };

  // === INLINE DETAIL VIEW ===
  // Detail-Ansicht als render-Funktion (statt frueher early-return), damit sie
  // im iPad-Split-View NEBEN der Liste gerendert werden kann.
  const renderDetail = (hideBackButton?: boolean) => {
    if (!selectedMaterial) return null;
    return (
      <IonPage>
        <IonHeader translucent={true}>
          <IonToolbar>
            {!hideBackButton && (
              <IonButtons slot="start">
                <IonButton onClick={() => setSelectedMaterial(null)}>
                  <IonIcon icon={arrowBack} slot="icon-only" />
                </IonButton>
              </IonButtons>
            )}
            <IonTitle>{selectedMaterial.title}</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonContent className="app-gradient-background" fullscreen>
          <IonHeader collapse="condense">
            <IonToolbar className="app-condense-toolbar">
              <IonTitle size="large">{selectedMaterial.title}</IonTitle>
            </IonToolbar>
          </IonHeader>

          <IonRefresher slot="fixed" onIonRefresh={async (e) => {
            try {
              const res = await api.get(`/material/${selectedMaterial.id}`);
              setSelectedMaterial(res.data);
            } catch { /* ignore */ }
            e.detail.complete();
          }} onIonPull={triggerPullHaptic}>
            <IonRefresherContent />
          </IonRefresher>

          {/* SectionHeader */}
          <SectionHeader
            title={selectedMaterial.title}
            subtitle="Material"
            icon={documentIcon}
            colors={{ primary: '#d97706', secondary: '#b45309' }}
            stats={[{ value: selectedMaterial.files?.length || 0, label: 'Dateien' }]}
          />

          {/* Beschreibung */}
          {selectedMaterial.description && (
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--material">
                  <IonIcon icon={textOutline} />
                </div>
                <IonLabel>Beschreibung</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <p className="app-description-text" style={{ whiteSpace: 'pre-wrap' }}>
                    {selectedMaterial.description}
                  </p>
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
              <IonCardContent className="app-card-content">
                {selectedMaterial.events && selectedMaterial.events.length > 0 && (
                  <div className="app-info-row">
                    <IonIcon icon={calendar} className="app-info-row__icon" style={{ color: 'var(--app-color-events)' }} />
                    <div>
                      <div className="app-info-row__label">
                        {selectedMaterial.events.length === 1 ? 'Event' : 'Events'}
                      </div>
                      <div className="app-info-row__value">
                        {selectedMaterial.events.map(e => e.name).join(', ')}
                      </div>
                    </div>
                  </div>
                )}
                {selectedMaterial.jahrgaenge && selectedMaterial.jahrgaenge.length > 0 && (
                  <div className="app-info-row">
                    <IonIcon icon={people} className="app-info-row__icon" style={{ color: 'var(--app-color-konfis)' }} />
                    <div>
                      <div className="app-info-row__label">
                        {selectedMaterial.jahrgaenge.length === 1 ? 'Jahrgang' : 'Jahrgänge'}
                      </div>
                      <div className="app-info-row__value">
                        {selectedMaterial.jahrgaenge.map(j => j.name).join(', ')}
                      </div>
                    </div>
                  </div>
                )}
                <div className="app-info-row">
                  <IonIcon icon={create} className="app-info-row__icon" style={{ color: '#6c757d' }} />
                  <div>
                    <div className="app-info-row__label">Erstellt am</div>
                    <div className="app-info-row__value">{formatDateLong(selectedMaterial.created_at)}</div>
                  </div>
                </div>
                {selectedMaterial.admin_name && (
                  <div className="app-info-row">
                    <IonIcon icon={person} className="app-info-row__icon" style={{ color: '#6c757d' }} />
                    <div>
                      <div className="app-info-row__label">Erstellt von</div>
                      <div className="app-info-row__value">{selectedMaterial.admin_name}</div>
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
              <IonLabel>Dateien ({selectedMaterial.files?.length || 0})</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                {(!selectedMaterial.files || selectedMaterial.files.length === 0) ? (
                  <EmptyState
                    icon={documentOutline}
                    title="Keine Dateien"
                    message="Dieses Material hat keine angehängten Dateien."
                    iconColor="#d97706"
                  />
                ) : (
                  selectedMaterial.files.map((file, index) => (
                    <div
                      key={file.id}
                      className="app-list-item"
                      style={{
                        borderLeftColor: '#d97706',
                        cursor: 'pointer',
                        marginBottom: index < (selectedMaterial.files?.length || 0) - 1 ? '8px' : '0'
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
                  ))
                )}
              </IonCardContent>
            </IonCard>
          </IonList>

          <div className="ion-padding-bottom" />
        </IonContent>
      </IonPage>
    );
  };

  // === MATERIAL LIST VIEW ===
  const renderList = () => (
    <IonPage>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => window.history.back()}>
              <IonIcon icon={arrowBack} slot="icon-only" />
            </IonButton>
          </IonButtons>
          <IonTitle>Material</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Material</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await Promise.all([refreshMaterial(), refreshJahrgaenge()]);
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        {loading || detailLoading ? (
          <LoadingSpinner message={detailLoading ? 'Material wird geladen...' : 'Materialien werden geladen...'} />
        ) : (
          <>
            <SectionHeader
              title="Material"
              subtitle="Dokumente und Dateien"
              icon={documentIcon}
              colors={{ primary: '#d97706', secondary: '#b45309' }}
              stats={[
                { value: materials.length, label: 'Material' },
                { value: materials.reduce((sum, m) => sum + (m.file_count || 0), 0), label: 'Dateien' }
              ]}
            />

            {/* Suche & Filter */}
            <IonList inset={true} style={{ margin: '16px' }}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--material">
                  <IonIcon icon={filterOutline} />
                </div>
                <IonLabel>Suche & Filter</IonLabel>
              </IonListHeader>
              <IonItemGroup>
                <IonItem>
                  <IonIcon icon={searchIcon} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
                  <IonInput
                    value={search}
                    onIonInput={(e) => setSearch(e.detail.value || '')}
                    placeholder="Material durchsuchen..."
                    debounce={300}
                  />
                </IonItem>
                {jahrgaenge.length > 0 && (
                  <IonItem>
                    <IonIcon icon={calendarOutline} slot="start" style={{ color: '#8e8e93', fontSize: '1rem' }} />
                    <IonSelect
                      value={activeJahrgangId ?? 'alle'}
                      onIonChange={(e) => setActiveJahrgangId(e.detail.value === 'alle' ? undefined : e.detail.value)}
                      interface="popover"
                      placeholder="Jahrgang"
                      style={{ width: '100%' }}
                    >
                      <IonSelectOption value="alle">Alle Jahrgänge</IonSelectOption>
                      {jahrgaenge.map(jg => (
                        <IonSelectOption key={jg.id} value={jg.id}>{jg.name}</IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>
                )}
              </IonItemGroup>
            </IonList>

            {/* Material-Liste */}
            {materials.length === 0 ? (
              <EmptyState
                icon={documentOutline}
                title="Keine Materialien"
                message="Noch keine Materialien vorhanden."
                iconColor="#d97706"
              />
            ) : (
              <IonList inset={true} className="app-segment-wrapper">
                <IonListHeader>
                  <div className="app-section-icon app-section-icon--material">
                    <IonIcon icon={documentIcon} />
                  </div>
                  <IonLabel>Materialien ({materials.length})</IonLabel>
                </IonListHeader>
                <IonCard className="app-card">
                  <IonCardContent>
                    {materials.map((mat, index) => (
                      <IonItem
                        key={mat.id}
                        button
                        onClick={() => openDetail(mat.id)}
                        detail={false}
                        lines="none"
                        style={{
                          '--background': 'transparent',
                          '--padding-start': '0',
                          '--padding-end': '0',
                          '--inner-padding-end': '0',
                          '--inner-border-width': '0',
                          '--border-style': 'none',
                          '--min-height': 'auto',
                          marginBottom: index < materials.length - 1 ? '8px' : '0'
                        }}
                      >
                        <div
                          className="app-list-item"
                          style={{
                            width: '100%',
                            borderLeftColor: '#d97706'
                          }}
                        >
                          <div className="app-list-item__row">
                            <div className="app-list-item__main">
                              <div className="app-icon-circle" style={{ backgroundColor: '#d97706' }}>
                                <IonIcon icon={documentIcon} />
                              </div>
                              <div className="app-list-item__content">
                                <div className="app-list-item__title">
                                  {mat.title}
                                </div>
                                {mat.description && (
                                  <div className="app-list-item__subtitle" style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical'
                                  }}>
                                    {mat.description}
                                  </div>
                                )}
                                <div className="app-list-item__meta">
                                  {mat.file_count !== undefined && mat.file_count > 0 && (
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={attachOutline} style={{ color: '#d97706' }} />
                                      {mat.file_count} {mat.file_count === 1 ? 'Datei' : 'Dateien'}
                                    </span>
                                  )}
                                  {(mat.event_count || 0) > 0 && (
                                    <span className="app-list-item__meta-item">
                                      <IonIcon icon={calendar} style={{ color: 'var(--app-color-events)' }} />
                                      {mat.event_count} {mat.event_count === 1 ? 'Event' : 'Events'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </IonItem>
                    ))}
                  </IonCardContent>
                </IonCard>
              </IonList>
            )}
          </>
        )}
      </IonContent>
    </IonPage>
  );

  // Detail ersetzt die Liste (selectedMaterial-State steuert die Ansicht).
  return selectedMaterial ? renderDetail() : renderList();
};

export default TeamerMaterialPage;
