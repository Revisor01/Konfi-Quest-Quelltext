import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonIcon,
  IonButton,
  IonButtons,
  IonSpinner,
  IonCard,
  IonCardContent,
  IonList,
  IonListHeader,
  IonLabel,
  IonItem,
  IonInput,
  IonTextarea,
  IonSegment,
  IonSegmentButton,
  IonText,
  useIonToast
} from '@ionic/react';
import {
  closeOutline,
  checkmarkOutline,
  checkmark,
  bookOutline,
  createOutline,
  cloudOfflineOutline
} from 'ionicons/icons';
import { useApp } from '../../../contexts/AppContext';
import { useActionGuard } from '../../../hooks/useActionGuard';
import api from '../../../services/api';

type Translation = 'luther2017' | 'bigs' | 'gute_nachricht' | 'elberfelder';

const TRANSLATION_LABELS: Record<Translation, string> = {
  luther2017: 'Luther 2017',
  bigs: 'Bibel in gerechter Sprache',
  gute_nachricht: 'Gute Nachricht',
  elberfelder: 'Elberfelder'
};

const TRANSLATION_KEYS: Translation[] = ['luther2017', 'bigs', 'gute_nachricht', 'elberfelder'];

interface Konfspruch {
  id: number;
  reference: string;
  book: string;
  chapter: number;
  verse: number;
  uebersetzungen: Record<Translation, string>;
}

interface CurrentKonfspruch {
  source: 'liste' | 'freitext';
  id?: number;
  reference?: string;
  text?: string;
  translation?: string;
}

interface KonfispruchSelectModalProps {
  onClose: () => void;
  onSuccess: () => void;
  current?: CurrentKonfspruch | null;
  /** API-Prefix: '/konfi' (Default) oder '/teamer' — beide Seiten haben
   *  eigene, gleichförmige Endpunkte (GET .../konfsprueche, PATCH .../profile). */
  apiBasePath?: '/konfi' | '/teamer';
  /** Farbvariante des Speichern-Knopfs (Default: konfi). */
  variant?: 'konfi' | 'teamer';
}

const isTranslation = (value?: string): value is Translation =>
  value === 'luther2017' || value === 'bigs' || value === 'gute_nachricht' || value === 'elberfelder';

const KonfispruchSelectModal: React.FC<KonfispruchSelectModalProps> = ({ onClose, onSuccess, current, apiBasePath = '/konfi', variant = 'konfi' }) => {
  const { isOnline } = useApp();
  const { isSubmitting, guard } = useActionGuard();
  const [presentToast] = useIonToast();

  const [mode, setMode] = useState<'liste' | 'freitext'>(
    current?.source === 'freitext' ? 'freitext' : 'liste'
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sprueche, setSprueche] = useState<Konfspruch[]>([]);
  const [translation, setTranslation] = useState<Translation>(
    isTranslation(current?.translation) ? current!.translation as Translation : 'luther2017'
  );
  const [selectedSpruchId, setSelectedSpruchId] = useState<number | null>(
    current?.source === 'liste' && current?.id ? current.id : null
  );
  const [freitext, setFreitext] = useState<string>(
    current?.source === 'freitext' ? (current.text || '') : ''
  );
  const [freitextReferenz, setFreitextReferenz] = useState<string>(
    current?.source === 'freitext' ? (current.reference || '') : ''
  );

  useEffect(() => {
    const loadSprueche = async () => {
      try {
        const response = await api.get(`${apiBasePath}/konfsprueche`);
        const liste = Array.isArray(response.data) ? response.data : [];
        setSprueche(liste);
        setLoadError(false);
        setSelectedSpruchId((prev) =>
          prev != null && liste.some((s: Konfspruch) => s.id === prev) ? prev : null
        );
      } catch (err) {
        console.error('Fehler beim Laden der Konfsprueche:', err);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    loadSprueche();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showError = (message: string) => {
    presentToast({ message, duration: 3000, color: 'danger', position: 'top' });
  };

  const handleSave = async () => {
    if (mode === 'liste') {
      if (!selectedSpruchId) {
        showError('Bitte wähle einen Spruch aus der Liste aus');
        return;
      }
      await guard(async () => {
        try {
          await api.patch(`${apiBasePath}/profile`, {
            konfspruch_id: selectedSpruchId,
            translation
          });
          presentToast({ message: 'Dein Konfispruch wurde gespeichert', duration: 2000, color: 'success', position: 'top' });
          onSuccess();
        } catch (err: any) {
          if (err.response?.status === 404) {
            setSelectedSpruchId(null);
            showError('Der gewählte Spruch ist nicht mehr verfügbar. Bitte wähle einen anderen.');
          } else {
            showError(err.response?.data?.error || 'Der Konfispruch konnte nicht gespeichert werden');
          }
        }
      });
    } else {
      const referenz = freitextReferenz.trim();
      const text = freitext.trim();
      if (!text) {
        showError('Bitte gib deinen Spruchtext ein');
        return;
      }
      if (!referenz) {
        showError('Bitte gib die Stellenangabe an');
        return;
      }
      await guard(async () => {
        try {
          await api.patch(`${apiBasePath}/profile`, {
            konfspruch_freitext: text,
            konfspruch_freitext_referenz: referenz
          });
          presentToast({ message: 'Dein Konfispruch wurde gespeichert', duration: 2000, color: 'success', position: 'top' });
          onSuccess();
        } catch (err: any) {
          showError(err.response?.data?.error || 'Der Konfispruch konnte nicht gespeichert werden');
        }
      });
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Dein Konfispruch</IonTitle>
          <IonButtons slot="start">
            <IonButton aria-label="Schließen" className="app-modal-close-btn" onClick={onClose} disabled={isSubmitting}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
          <IonButtons slot="end">
            <IonButton aria-label="Konfispruch speichern"
              className={`app-modal-submit-btn app-modal-submit-btn--${variant}`}
              onClick={handleSave}
              disabled={isSubmitting || !isOnline}
            >
              {!isOnline ? (
                <><IonIcon icon={cloudOfflineOutline} /> Du bist offline</>
              ) : isSubmitting ? (
                <IonSpinner name="crescent" />
              ) : (
                <IonIcon icon={checkmarkOutline} />
              )}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="app-gradient-background">
        {/* Modus-Umschaltung: Aus Liste / Eigener Spruch (ohne Icons -> einzeilig) */}
        <div className="app-segment-wrapper">
          <IonSegment value={mode} onIonChange={(e) => setMode(e.detail.value as 'liste' | 'freitext')}>
            <IonSegmentButton value="liste">
              <IonLabel>Aus Liste</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="freitext">
              <IonLabel>Eigener Spruch</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </div>

        {mode === 'liste' ? (
          <>
            {/* Uebersetzungs-Tabs (nur im Listen-Modus) */}
            <div className="app-segment-wrapper">
              <IonSegment
                value={translation}
                onIonChange={(e) => setTranslation(e.detail.value as Translation)}
                scrollable={true}
              >
                {TRANSLATION_KEYS.map((key) => (
                  <IonSegmentButton key={key} value={key}>
                    <IonLabel>{TRANSLATION_LABELS[key]}</IonLabel>
                  </IonSegmentButton>
                ))}
              </IonSegment>
            </div>

            {/* Spruchliste — gleiches Muster wie die Bibelübersetzungs-Liste:
                Auswahl = lila Strich links + matt-lila Hintergrund + Häkchen-Corner-Badge,
                kein Icon pro Listenelement, kein Inline-Häkchen. */}
            <IonList inset={true} style={{ margin: '16px' }}>
              <IonListHeader>
                <div className="app-section-icon app-section-icon--purple">
                  <IonIcon icon={bookOutline} />
                </div>
                <IonLabel>Spruch wählen</IonLabel>
              </IonListHeader>
              <IonCard className="app-card">
                <IonCardContent style={{ padding: loading || loadError || sprueche.length === 0 ? '16px' : '12px' }}>
                  {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
                      <IonSpinner name="crescent" />
                    </div>
                  ) : loadError ? (
                    <div className="app-info-box app-info-box--neutral" style={{ textAlign: 'center' }}>
                      <IonText color="danger">
                        Die Spruchliste konnte nicht geladen werden. Bitte versuche es später erneut.
                      </IonText>
                    </div>
                  ) : sprueche.length === 0 ? (
                    <div className="app-info-box app-info-box--neutral" style={{ textAlign: 'center' }}>
                      Es sind noch keine Sprüche hinterlegt
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {sprueche.map((spruch) => {
                        const text = spruch.uebersetzungen?.[translation] || '';
                        const isSelected = selectedSpruchId === spruch.id;
                        return (
                          <div
                            key={spruch.id}
                            className={`app-list-item app-list-item--purple ${isSelected ? 'app-list-item--selected' : ''}`}
                            onClick={() => setSelectedSpruchId(spruch.id)}
                            style={{
                              cursor: 'pointer',
                              position: 'relative',
                              overflow: 'hidden',
                              background: isSelected ? 'rgba(91, 33, 182, 0.08)' : undefined
                            }}
                          >
                            {isSelected && (
                              <div className="app-corner-badges">
                                <div
                                  className="app-corner-badge"
                                  style={{ backgroundColor: '#5b21b6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
                                  title="Ausgewählt"
                                >
                                  <IonIcon icon={checkmark} style={{ color: '#fff', fontSize: '0.85rem' }} />
                                </div>
                              </div>
                            )}
                            <div className="app-list-item__row">
                              <div className="app-list-item__main">
                                <div className="app-list-item__content">
                                  <div className="app-list-item__title" style={{ paddingRight: isSelected ? '40px' : '0' }}>{spruch.reference}</div>
                                  <div className="app-list-item__subtitle" style={{ whiteSpace: 'normal', lineHeight: '1.4' }}>
                                    {text
                                      ? text
                                      : <IonText color="medium"><em>Text wird noch ergänzt</em></IonText>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </IonCardContent>
              </IonCard>
            </IonList>
          </>
        ) : (
          <IonList inset={true} style={{ margin: '16px' }}>
            <IonListHeader>
              <div className="app-section-icon app-section-icon--purple">
                <IonIcon icon={createOutline} />
              </div>
              <IonLabel>Eigener Spruch</IonLabel>
            </IonListHeader>
            <IonCard className="app-card">
              <IonCardContent className="app-info-box">
                <IonList style={{ background: 'transparent' }}>
                  <IonItem lines="none" style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Spruchtext</IonLabel>
                    <IonTextarea
                      value={freitext}
                      onIonInput={(e) => setFreitext(e.detail.value || '')}
                      placeholder="Gib deinen Konfirmationsspruch ein"
                      autoGrow={true}
                      rows={3}
                      disabled={isSubmitting}
                    />
                  </IonItem>
                  <IonItem lines="none" style={{ '--background': 'transparent' }}>
                    <IonLabel position="stacked">Stelle (z.B. Joh 3,16)</IonLabel>
                    <IonInput
                      value={freitextReferenz}
                      onIonInput={(e) => setFreitextReferenz(e.detail.value || '')}
                      placeholder="Stellenangabe (Pflicht)"
                      disabled={isSubmitting}
                      clearInput={true}
                    />
                  </IonItem>
                </IonList>
              </IonCardContent>
            </IonCard>
            <IonCard className="app-card app-info-box--purple">
              <IonCardContent className="app-info-box">
                <p style={{ margin: 0 }}>
                  Bei einem eigenen Spruch ist die Stellenangabe verpflichtend.
                </p>
              </IonCardContent>
            </IonCard>
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
};

export default KonfispruchSelectModal;
