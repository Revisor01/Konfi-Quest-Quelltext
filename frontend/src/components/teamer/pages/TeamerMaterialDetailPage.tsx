import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonLabel,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonRefresher,
  IonRefresherContent
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
import AppKopfzeile from '../../shared/AppKopfzeile';
import { useApp } from '../../../contexts/AppContext';
import { useDateiOeffnen } from '../../../hooks/useDateiOeffnen';
import { materialDetailLaden } from '../../../services/materialDetail';
import LoadingSpinner from '../../common/LoadingSpinner';
import EmptyState from '../../shared/EmptyState';
import LadeStandZeile from '../../shared/LadeStandZeile';
import { SectionHeader } from '../../shared';
import { haptik, triggerPullHaptic, ImpactStyle } from '../../../utils/haptics';
import { istWebLink, hostAus, materialLinks } from '../../../utils/linkDisplay';
import { tastaturKlick } from '../../../utils/tastatur';
import { datumKurz } from '../../../utils/dateUtils';
import { materialInhalt, trackHandlung } from '../../../services/analytics';
import { linkOeffnen } from '../../../services/systemDialoge';

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

  // Anonyme Messung „Material angesehen": EINMAL je
  // Oeffnen. Die Seite wird als Modal jedes Mal neu montiert; Aktualisieren
  // und Wiederverbinden laden erneut und duerfen nicht noch einmal zaehlen.
  const angesehenGemeldet = useRef(false);

  const [material, setMaterial] = useState<MaterialDetail | null>(null);
  const [loading, setLoading] = useState(!!materialId);
  const laden = useCallback(async (): Promise<MaterialDetail | null> => {
    try {
      const { daten, ausSpeicher } = await materialDetailLaden<MaterialDetail>(materialId);
      // Nur nach einer Antwort des Servers — ein Stand nur vom Gerät
      // (offline) zaehlt nicht. Nur die Art des Inhalts, kein Titel, keine
      // Kennung.
      if (!ausSpeicher && !angesehenGemeldet.current) {
        angesehenGemeldet.current = true;
        trackHandlung('material-angesehen', {
          inhalt: materialInhalt((daten?.files?.length ?? 0) > 0, materialLinks(daten ?? {}).length > 0)
        });
      }
      return daten;
    } catch {
      return null;
    }
  }, [materialId]);

  useEffect(() => {
    if (!materialId) return;
    let aktiv = true;
    void laden().then((daten) => {
      if (!aktiv) return;
      setMaterial(daten);
      setLoading(false);
    });
    return () => { aktiv = false; };
  }, [materialId, laden]);

  const refresh = async () => {
    setMaterial(await laden());
  };

  const { dateiOeffnen, ladendeDatei } = useDateiOeffnen({
    quelle: 'material',
    kontext: () => (material?.files || []).map((f) => ({ pfad: f.stored_name, name: f.original_name, typ: f.mime_type })),
    fehlerOrt: 'material-teamer-detail',
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
    return datumKurz(dateString);
  };

  // Der Typ kommt vom Server (mime_type): Beim Treffer im Cache gibt es keine
  // Antwort, deren Kopf ihn nennen könnte.
  const openFile = async (file: MaterialFile) => {
    // Anonyme Messung NACH dem erfolgreichen Laden (auch aus dem Cache): eine
    // Datei ist abgerufen. Kein Dateiname, kein Dateityp.
    if (await dateiOeffnen(file.stored_name, file.original_name, file.mime_type)) {
      trackHandlung('material-abgerufen', { inhalt: 'datei' });
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
    linkOeffnen(url);
    // Anonyme Messung: ein Link ist abgerufen — ohne seine Adresse.
    trackHandlung('material-abgerufen', { inhalt: 'link' });
  };

  return (
    <IonPage ref={pageRef}>
      {/* Diese Seite wird als Modal praesentiert (useIonModal in
          TeamerEventsPage und admin/views/EventDetailView). Deshalb OHNE
          Glocke und Gemeinde-Umschalter: Das Postfach ist selbst ein Modal
          und wuerde ueber diesem liegen, ein Gemeinde-Wechsel baute den Router
          unter dem offenen Modal um. Der Schliessen-Knopf bleibt links. */}
      <AppKopfzeile
        titel={material?.title || 'Material'}
        glocke={false}
        gemeindeUmschalter={false}
        links={(
          <IonButton className="app-modal-close-btn" onClick={onClose} aria-label="Schließen">
            <IonIcon icon={ICON_SCHLIESSEN} slot="icon-only" />
          </IonButton>
        )}
      />

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
                      <IonIcon icon={ICON_WELT} className="app-info-row__icon" style={{ color: 'var(--app-text-material)' }} />
                      <div>
                        <div className="app-info-row__label">Sichtbar für</div>
                        <div className="app-info-row__value">Das ganze Team der Gemeinde</div>
                      </div>
                    </div>
                  )}
                  {material.events && material.events.length > 0 && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_TERMIN_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-text-events)' }} />
                      <div>
                        <div className="app-info-row__label">{material.events.length === 1 ? 'Event' : 'Events'}</div>
                        <div className="app-info-row__value">{material.events.map(e => e.name).join(', ')}</div>
                      </div>
                    </div>
                  )}
                  {material.jahrgaenge && material.jahrgaenge.length > 0 && (
                    <div className="app-info-row">
                      <IonIcon icon={ICON_GRUPPE_GEFUELLT} className="app-info-row__icon" style={{ color: 'var(--app-text-konfis)' }} />
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
                        <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
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
                                    <IonIcon icon={ICON_EXTERN_OEFFNEN} style={{ color: 'var(--app-text-material)' }} />
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
                      <div role="button" tabIndex={0} onKeyDown={tastaturKlick}
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
                              <LadeStandZeile
                                laedt={ladendeDatei?.pfad === file.stored_name}
                                prozent={ladendeDatei?.prozent ?? null}
                                sonst={formatFileSize(file.file_size)}
                                farbe="var(--app-text-material)"
                              />
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
