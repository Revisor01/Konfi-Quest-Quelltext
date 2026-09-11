import {
  ICON_ANHANG,
  ICON_DATEI,
  ICON_DATEI_GEFUELLT,
  ICON_FILTER,
  ICON_HINZUFUEGEN_GEFUELLT,
  ICON_LINK,
  ICON_LOESCHEN_GEFUELLT,
  ICON_SUCHE_GEFUELLT,
  ICON_TERMIN,
  ICON_TERMIN_GEFUELLT,
  ICON_WELT,
  ICON_ZURUECK,
} from '../../shared/icons';
import { fehlerText } from '../../../utils/fehler';
import React, { useState, useEffect, useRef } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonInput,
  IonLabel,
  IonIcon,
  IonSelect,
  IonSelectOption,
  IonList,
  IonListHeader,
  IonCard,
  IonCardContent,
  IonItem,
  IonItemSliding,
  IonItemOptions,
  IonItemOption,
  IonItemGroup,
  IonRefresher,
  IonRefresherContent,
  useIonAlert,
  useIonModal
} from '@ionic/react';
import { useApp } from '../../../contexts/AppContext';
import { offlineBlockiert } from '../../../utils/offlineAktion';
import { useLiveRefresh } from '../../../contexts/LiveUpdateContext';
import api from '../../../services/api';
import { useOfflineQuery } from '../../../hooks/useOfflineQuery';
import { CACHE_TTL } from '../../../services/offlineCache';
import EmptyState from '../../shared/EmptyState';
import LoadingSpinner from '../../common/LoadingSpinner';
import { SectionHeader } from '../../shared';
import MaterialFormModal from '../modals/MaterialFormModal';
import { triggerPullHaptic } from '../../../utils/haptics';
import { closeOpenSlidingItems } from '../../../utils/slidingItems';
import { darfMaterialBearbeiten } from '../../../utils/materialRechte';
import { materialStats } from '../../../utils/materialStats';


interface Material {
  id: number;
  title: string;
  description?: string;
  events?: { id: number; name: string }[];
  event_count?: number;
  jahrgang_id?: number;
  jahrgang_name?: string;
  file_count?: number;
  link_url?: string | null;
  link_count?: number;
  ist_global?: boolean;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at: string;
}

const AdminMaterialPage: React.FC = () => {
  const pageRef = useRef<HTMLElement>(null);
  const [presentingElement, setPresentingElement] = useState<HTMLElement | null>(null);
  const { user, setError, isOnline } = useApp();
  const [presentAlert] = useIonAlert();

  const [search, setSearch] = useState('');
  // Der Jahrgangs-Filter kennt drei Zustaende: alle, ein Jahrgang, oder
  // "nur globales Material". Letzteres filtert die Oberflaeche selbst --
  // die Route kennt dafuer keinen Parameter.
  const [activeJahrgangId, setActiveJahrgangId] = useState<number | undefined>();
  const [nurGlobal, setNurGlobal] = useState(false);
  const [editMaterial, setEditMaterial] = useState<Material | null>(null);
  const [ohneJahrgang, setOhneJahrgang] = useState(false);

  useEffect(() => {
    setPresentingElement(pageRef.current);
  }, []);

  // Offline-Query: Jahrgänge
  const { data: jahrgaenge } = useOfflineQuery<{ id: number; name: string }[]>(
    'admin:jahrgaenge:' + user?.organization_id,
    async () => { const res = await api.get('/admin/jahrgaenge'); return res.data; },
    { ttl: CACHE_TTL.STAMMDATEN }
  );

  // Offline-Query: Material (cache-key enthält search + jahrgang filter)
  const { data: materials, loading, refresh: refreshMaterial, refreshLive: refreshMaterialLive } = useOfflineQuery<Material[]>(
    `admin:material:${user?.organization_id}:${search}:${activeJahrgangId || ''}:${nurGlobal ? 'global' : ''}`,
    async () => {
      const res = await api.get('/material', {
        params: {
          ...(search ? { search } : {}),
          ...(activeJahrgangId ? { jahrgang_id: activeJahrgangId } : {})
        }
      });
      setOhneJahrgang(res.headers?.['x-kein-jahrgang-zugewiesen'] === 'true');
      return res.data;
    },
    { ttl: CACHE_TTL.PROFILE }
  );

  // Material-Liste live halten: neue oder geloeschte Materialien erschienen
  // vorher erst beim nächsten Oeffnen.
  useLiveRefresh('materials', refreshMaterialLive);

  // "Nur globales Material" filtert die Oberflaeche. Ein gecachter Eintrag
  // ohne das Feld gilt als nicht global.
  const filteredMaterials = nurGlobal
    ? (materials || []).filter(m => m.ist_global === true)
    : (materials || []);

  const handleDelete = (material: Material) => {
    if (offlineBlockiert(isOnline, setError)) return;
    presentAlert({
      header: 'Material löschen',
      message: `"${material.title}" wirklich löschen? Alle zugehörigen Dateien werden ebenfalls gelöscht.`,
      buttons: [
        { text: 'Abbrechen', role: 'cancel' },
        {
          text: 'Löschen',
          role: 'destructive',
          handler: async () => {
            try {
              await api.delete(`/material/${material.id}`);
              refreshMaterial();
            } catch (err) {
              setError(fehlerText(err, 'Fehler beim Löschen'));
            }
          }
        }
      ]
    });
  };

  const [presentFormModal, dismissFormModal] = useIonModal(MaterialFormModal, {
    material: editMaterial,
    nurLesen: editMaterial ? !darfMaterialBearbeiten(user, editMaterial) : false,
    onClose: () => {
      setEditMaterial(null);
      dismissFormModal();
    },
    onSuccess: () => {
      setEditMaterial(null);
      dismissFormModal();
      refreshMaterial();
    }
  });

  const openCreateModal = () => {
    setEditMaterial(null);
    presentFormModal({ presentingElement: presentingElement || undefined });
  };

  const openEditModal = async (material: Material) => {
    try {
      const res = await api.get(`/material/${material.id}`);
      setEditMaterial(res.data);
      presentFormModal({ presentingElement: presentingElement || undefined });
    } catch {
      setError('Fehler beim Laden des Materials');
    }
  };


  return (
    <IonPage ref={pageRef}>
      <IonHeader translucent={true}>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton aria-label="Zurück" onClick={() => window.history.back()}>
              <IonIcon icon={ICON_ZURUECK} />
            </IonButton>
          </IonButtons>
          <IonTitle>Material verwalten</IonTitle>
          <IonButtons slot="end">
            <IonButton aria-label="Neues Material anlegen" onClick={openCreateModal}>
              <IonIcon icon={ICON_HINZUFUEGEN_GEFUELLT} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background" fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar className="app-condense-toolbar">
            <IonTitle size="large">Material verwalten</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonRefresher slot="fixed" onIonRefresh={async (e) => {
          await refreshMaterial();
          e.detail.complete();
        }} onIonPull={triggerPullHaptic}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <LoadingSpinner message="Materialien werden geladen..." />
        ) : (
          <>
            <SectionHeader
              title="Material"
              subtitle="Dokumente und Dateien"
              icon={ICON_DATEI_GEFUELLT}
              colors={{ primary: 'var(--app-color-material)', secondary: 'var(--app-color-material-dunkel)' }}
              stats={(() => {
                const s = materialStats(materials || []);
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
                {(jahrgaenge || []).length > 0 && (
                  <IonItem>
                    <IonIcon icon={ICON_TERMIN} slot="start" style={{ color: 'var(--app-text-system)', fontSize: 'var(--app-text-standard)' }} />
                    <IonSelect
                      value={nurGlobal ? 'global' : (activeJahrgangId ?? 'alle')}
                      onIonChange={(e) => {
                        const wert = e.detail.value;
                        setNurGlobal(wert === 'global');
                        setActiveJahrgangId(wert === 'alle' || wert === 'global' ? undefined : wert);
                      }}
                      interface="popover"
                      placeholder="Jahrgang"
                      style={{ width: '100%' }}
                    >
                      <IonSelectOption value="alle">Alle Jahrgänge</IonSelectOption>
                      <IonSelectOption value="global">Nur globales Material</IonSelectOption>
                      {(jahrgaenge || []).map(jg => (
                        <IonSelectOption key={jg.id} value={jg.id}>{jg.name}</IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>
                )}
              </IonItemGroup>
            </IonList>

            {/* Material-Liste */}
            <IonList inset={true} className="app-segment-wrapper">
              <IonListHeader>
                <div className="app-section-icon app-section-icon--material">
                  <IonIcon icon={ICON_DATEI_GEFUELLT} />
                </div>
                <IonLabel>Materialien ({filteredMaterials.length})</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent>
                  {filteredMaterials.length === 0 ? (
                    <EmptyState
                      icon={ICON_DATEI}
                      title={ohneJahrgang && !search && !nurGlobal ? 'Kein Jahrgang zugewiesen' : 'Keine Materialien'}
                      message={
                        ohneJahrgang && !search && !nurGlobal
                          ? 'Dir ist noch kein Jahrgang zugewiesen — du siehst nur Material, das für alle freigegeben ist. Die Leitung deiner Gemeinde kann das in den Einstellungen ändern.'
                          : 'Erstelle dein erstes Material mit dem + Button'
                      }
                      iconColor="var(--app-color-material)"
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {filteredMaterials.map((mat, index) => (
                        <IonItemSliding key={mat.id} style={{ marginBottom: index < filteredMaterials.length - 1 ? 'var(--app-abstand-eng)' : '0' }}>
                          <IonItem
                            button
                            onClick={() => openEditModal(mat)}
                            detail={false}
                            lines="none"
                            className="app-item-transparent"
                          >
                            <div
                              className="app-list-item"
                              style={{ borderLeftColor: 'var(--app-color-material)' }}
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
                                      {((mat.link_count ?? (mat.link_url ? 1 : 0)) > 0) && (
                                        <span className="app-list-item__meta-item">
                                          <IonIcon icon={ICON_LINK} style={{ color: 'var(--app-color-material)' }} />
                                          {(mat.link_count ?? 1) === 1 ? 'Link' : `${mat.link_count} Links`}
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
                          {darfMaterialBearbeiten(user, mat) && (
                            <IonItemOptions className="app-swipe-actions" side="end">
                              <IonItemOption
                                className="app-swipe-action"
                                onClick={() => { closeOpenSlidingItems(); handleDelete(mat); }}
                                aria-label="Material löschen"
                              >
                                <div className="app-icon-circle app-icon-circle--lg app-icon-circle--danger">
                                  <IonIcon icon={ICON_LOESCHEN_GEFUELLT} />
                                </div>
                              </IonItemOption>
                            </IonItemOptions>
                          )}
                        </IonItemSliding>
                      ))}
                    </div>
                  )}
                </IonCardContent>
              </IonCard>
            </IonList>

          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default AdminMaterialPage;
