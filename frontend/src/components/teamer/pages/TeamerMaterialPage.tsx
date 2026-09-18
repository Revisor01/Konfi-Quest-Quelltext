import {
  ICON_ANHANG,
  ICON_BEARBEITEN_GEFUELLT,
  ICON_BILD,
  ICON_DATEI,
  ICON_DATEI_GEFUELLT,
  ICON_EXTERN_OEFFNEN,
  ICON_FILTER,
  ICON_GRUPPE_GEFUELLT,
  ICON_INFO_GEFUELLT,
  ICON_LINK,
  ICON_MUSIK,
  ICON_PERSON_GEFUELLT,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN,
  ICON_TERMIN_GEFUELLT,
  ICON_TEXT,
  ICON_VIDEO,
  ICON_WELT,
  ICON_ZURUECK,
} from '../../shared/icons';
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
import { openFileNatively } from '../../../utils/nativeFileViewer';
import { useLocation } from 'react-router-dom';
import { useApp } from '../../../contexts/AppContext';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api, { DATEI_TIMEOUT_MS } from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import { SectionHeader } from '../../shared';
import EmptyState from '../../shared/EmptyState';
import LoadingSpinner from '../../common/LoadingSpinner';
import FileViewerModal from '../../shared/FileViewerModal';
import { haptik, triggerPullHaptic, ImpactStyle } from '../../../utils/haptics';
import { useModalPage } from '../../../contexts/ModalContext';
import { istWebLink, hostAus, materialLinks } from '../../../utils/linkDisplay';
import { materialStats } from '../../../utils/materialStats';

interface Material {
  id: number;
  title: string;
  description?: string;
  events?: { id: number; name: string }[];
  event_count?: number;
  // Die Jahrgangs-Zuordnung liefert GET /material als Array (material.js:177).
  jahrgaenge?: { id: number; name: string }[];
  jahrgang_name?: string;
  file_count?: number;
  link_url?: string | null;
  ist_global?: boolean;
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
  link_url?: string | null;
  links?: { id: number; url: string }[];
  ist_global?: boolean;
  created_at: string;
}

const TeamerMaterialPage: React.FC = () => {
  const { user, setError } = useApp();
  useModalPage('teamer-material');

  const pfad = useLocation().pathname;
  const istEigenerTab = pfad.startsWith('/teamer/profile/material');

  const [search, setSearch] = useState('');
  const [activeJahrgangId, setActiveJahrgangId] = useState<number | undefined>();
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Offline-Query: Jahrgänge
  const { data: jahrgaengeData, refresh: refreshJahrgaenge } = useOfflineQuery<{ id: number; name: string }[]>(
    'teamer:jahrgaenge:' + user?.organization_id,
    async () => { const res = await api.get('/admin/jahrgaenge'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );
  const jahrgaenge = jahrgaengeData || [];

  // Offline-Query: Material (alle Materialien, clientseitig gefiltert)
  const { data: allMaterials, loading, refresh: refreshMaterial, refreshLive: refreshMaterialLive } = useOfflineQuery<Material[]>(
    'teamer:material:' + user?.organization_id,
    async () => { const res = await api.get('/material'); return res.data; },
    { ttl: CACHE_TTL.PROFILE }
  );

  // Material-Liste live halten: neue oder geloeschte Materialien erschienen
  // vorher erst beim nächsten Oeffnen.
  useLiveRefresh('materials', refreshMaterialLive);

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
      // Die Zuordnung kommt als Array `jahrgaenge` an jedem Eintrag
      // (material.js:177). Frueher stand hier `m.jahrgang_id` -- ein Feld,
      // das GET /material gar nicht liefert (Legacy-Spalte, seit Migration
      // 064 durch material_jahrgaenge ersetzt). Der Filter fand deshalb
      // IMMER nichts.
      filtered = filtered.filter(m => m.jahrgaenge?.some(j => j.id === activeJahrgangId));
    }
    return filtered;
  }, [allMaterials, search, activeJahrgangId]);

  // Bekommt einen eigenen Abschnitt ganz oben, damit erkennbar ist, was
  // absichtlich fuer das ganze Team gedacht ist. Gecachte Eintraege von vor
  // der Umstellung liefern das Feld nicht -- die landen im unteren
  // Abschnitt, nie in einem Fehler.
  const globaleMaterials = useMemo(
    () => materials.filter(m => m.ist_global === true),
    [materials]
  );
  const uebrigeMaterials = useMemo(
    () => materials.filter(m => m.ist_global !== true),
    [materials]
  );

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


  const formatDateLong = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  };

  // File-Handling Funktionen
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

  const openFile = async (file: MaterialFile) => {
    try {
      await haptik(ImpactStyle.Medium);
      const response = await api.get(`/material/files/${file.stored_name}`, { responseType: 'blob', timeout: DATEI_TIMEOUT_MS });
      const blob = response.data;
      const contentType = response.headers?.['content-type'];
      const mime: string = typeof contentType === 'string' ? contentType : file.mime_type;

      const openedNatively = await openFileNatively(blob, file.original_name, mime);
      if (openedNatively) return;

      // Web-Fallback: In-App Viewer
      openInAppViewer(blob, file.original_name, mime);
    } catch (err) {
      setError('Fehler beim Öffnen der Datei', { ort: 'material-teamer-liste', fehler: err });
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
    await haptik(ImpactStyle.Medium);
    window.open(url, '_blank');
  };

  // === INLINE DETAIL VIEW ===
  // Detail-Ansicht als render-Funktion (statt früher early-return), damit sie
  // im iPad-Split-View NEBEN der Liste gerendert werden kann.
  const renderDetail = (hideBackButton?: boolean) => {
    if (!selectedMaterial) return null;
    return (
      <IonPage>
        <IonHeader translucent={true}>
          <IonToolbar>
            {!hideBackButton && (
              <IonButtons slot="start">
                <IonButton onClick={() => setSelectedMaterial(null)} aria-label="Zurück zur Material-Liste">
                  <IonIcon icon={ICON_ZURUECK} slot="icon-only" />
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
            icon={ICON_DATEI_GEFUELLT}
            colors={{ primary: 'var(--app-color-material)', secondary: 'var(--app-color-material-dunkel)' }}
            stats={[{ value: selectedMaterial.files?.length || 0, label: 'Dateien' }]}
          />

          {/* Beschreibung */}
          {selectedMaterial.description && (
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--material">
                  <IonIcon icon={ICON_TEXT} />
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
                <IonIcon icon={ICON_INFO_GEFUELLT} />
              </div>
              <IonLabel>Details</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent className="app-card-content">
                {selectedMaterial.ist_global && (
                  <div className="app-info-row">
                    <IonIcon icon={ICON_WELT} className="app-info-row__icon" style={{ color: 'var(--app-color-material)' }} />
                    <div>
                      <div className="app-info-row__label">Sichtbar für</div>
                      <div className="app-info-row__value">Das ganze Team der Gemeinde</div>
                    </div>
                  </div>
                )}
                {selectedMaterial.events && selectedMaterial.events.length > 0 && (
                  <div className="app-info-row">
                    <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-color-events)' }} />
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
                    <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-color-konfis)' }} />
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
                  <IonIcon icon={ICON_BEARBEITEN_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-color-neutral)' }} />
                  <div>
                    <div className="app-info-row__label">Erstellt am</div>
                    <div className="app-info-row__value">{formatDateLong(selectedMaterial.created_at)}</div>
                  </div>
                </div>
                {selectedMaterial.admin_name && (
                  <div className="app-info-row">
                    <IonIcon icon={ICON_PERSON_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-color-neutral)' }} />
                    <div>
                      <div className="app-info-row__label">Erstellt von</div>
                      <div className="app-info-row__value">{selectedMaterial.admin_name}</div>
                    </div>
                  </div>
                )}
              </IonCardContent>
            </IonCard>
          </IonList>

          {materialLinks(selectedMaterial).length > 0 && (
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--material">
                  <IonIcon icon={ICON_LINK} />
                </div>
                <IonLabel>{materialLinks(selectedMaterial).length === 1 ? 'Link' : 'Links'}</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--app-abstand-eng)' }}>
                    {materialLinks(selectedMaterial).map((url) => (
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
              <IonLabel>Dateien ({selectedMaterial.files?.length || 0})</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent>
                {(!selectedMaterial.files || selectedMaterial.files.length === 0) ? (
                  <EmptyState
                    icon={ICON_DATEI}
                    title="Keine Dateien"
                    message="Dieses Material hat keine angehängten Dateien."
                    iconColor="var(--app-color-material)"
                  />
                ) : (
                  selectedMaterial.files.map((file, index) => (
                    <div
                      key={file.id}
                      className="app-list-item"
                      style={{
                        borderLeftColor: 'var(--app-color-material)',
                        cursor: 'pointer',
                        marginBottom: index < (selectedMaterial.files?.length || 0) - 1 ? 'var(--app-abstand-eng)' : '0'
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
  // Ein Listeneintrag. Steht seit der Aufteilung in "Für alle" und die
  // uebrigen Materialien an einer Stelle, damit beide
  // Abschnitte gleich aussehen.
  const renderEintrag = (mat: Material, index: number, anzahl: number) => (
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
        marginBottom: index < anzahl - 1 ? 'var(--app-abstand-eng)' : '0'
      }}
    >
      <div
        className="app-list-item"
        style={{
          width: '100%',
          borderLeftColor: 'var(--app-color-material)'
        }}
      >
        <div className="app-list-item__row">
          <div className="app-list-item__main">
            <div className="app-icon-circle" style={{ backgroundColor: 'var(--app-color-material)' }}>
              <IonIcon icon={mat.link_url ? ICON_LINK : ICON_DATEI_GEFUELLT} />
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
                {mat.ist_global && (
                  <span className="app-list-item__meta-item">
                    <IonIcon icon={ICON_WELT} style={{ color: 'var(--app-color-material)' }} />
                    Für alle
                  </span>
                )}
                {mat.link_url && (
                  <span className="app-list-item__meta-item">
                    <IonIcon icon={ICON_LINK} style={{ color: 'var(--app-color-material)' }} />
                    Link
                  </span>
                )}
                {mat.file_count !== undefined && mat.file_count > 0 && (
                  <span className="app-list-item__meta-item">
                    <IonIcon icon={ICON_ANHANG} style={{ color: 'var(--app-color-material)' }} />
                    {mat.file_count} {mat.file_count === 1 ? 'Datei' : 'Dateien'}
                  </span>
                )}
                {(mat.event_count || 0) > 0 && (
                  <span className="app-list-item__meta-item">
                    <IonIcon icon={ICON_TERMIN_GEFUELLT} style={{ color: 'var(--app-color-events)' }} />
                    {mat.event_count} {mat.event_count === 1 ? 'Event' : 'Events'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </IonItem>
  );

  const renderList = () => (
    <IonPage>
      <IonHeader translucent={true}>
        <IonToolbar>
          {!istEigenerTab && (
            <IonButtons slot="start">
              <IonButton onClick={() => window.history.back()} aria-label="Zurück">
                <IonIcon icon={ICON_ZURUECK} slot="icon-only" />
              </IonButton>
            </IonButtons>
          )}
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
              icon={ICON_DATEI_GEFUELLT}
              colors={{ primary: 'var(--app-color-material)', secondary: 'var(--app-color-material-dunkel)' }}
              stats={(() => {
                const s = materialStats(materials);
                return [
                  { value: s.material, label: 'Material' },
                  { value: s.dateien, label: 'Dateien' },
                  { value: s.links, label: 'Links' }
                ];
              })()}
            />

            {/* Suche & Filter */}
            <IonList inset={true} style={{ margin: 'var(--app-abstand-basis)' }}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--material">
                  <IonIcon icon={ICON_FILTER} />
                </div>
                <IonLabel>Suche & Filter</IonLabel>
              </IonListHeader>
              <IonItemGroup>
                <IonItem>
                  <IonIcon icon={ICON_SUCHE_GEFUELLT} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
                  <IonInput
                    value={search}
                    onIonInput={(e) => setSearch(e.detail.value || '')}
                    placeholder="Material durchsuchen..."
                    debounce={300}
                  />
                </IonItem>
                {jahrgaenge.length > 0 && (
                  <IonItem>
                    <IonIcon icon={ICON_TERMIN} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
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

            {materials.length === 0 ? (
              <EmptyState
                icon={ICON_DATEI}
                title="Keine Materialien"
                message="Noch keine Materialien vorhanden."
                iconColor="var(--app-color-material)"
              />
            ) : (
              <>
                {globaleMaterials.length > 0 && (
                  <IonList inset={true} className="app-segment-wrapper">
                    <IonListHeader>
                      <div className="app-section-icon app-section-icon--material">
                        <IonIcon icon={ICON_WELT} />
                      </div>
                      <IonLabel>Für alle ({globaleMaterials.length})</IonLabel>
                    </IonListHeader>
                    <IonCard className="app-card">
                      <IonCardContent>
                        {globaleMaterials.map((mat, index) => renderEintrag(mat, index, globaleMaterials.length))}
                      </IonCardContent>
                    </IonCard>
                  </IonList>
                )}

                {uebrigeMaterials.length > 0 && (
                  <IonList inset={true} className="app-segment-wrapper">
                    <IonListHeader>
                      <div className="app-section-icon app-section-icon--material">
                        <IonIcon icon={ICON_DATEI_GEFUELLT} />
                      </div>
                      <IonLabel>Materialien ({uebrigeMaterials.length})</IonLabel>
                    </IonListHeader>
                    <IonCard className="app-card">
                      <IonCardContent>
                        {uebrigeMaterials.map((mat, index) => renderEintrag(mat, index, uebrigeMaterials.length))}
                      </IonCardContent>
                    </IonCard>
                  </IonList>
                )}
              </>
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
