import React, { useCallback, useEffect, useState } from 'react';
import { IonButton, IonCard, IonCardContent, IonIcon, IonList, IonListHeader, IonLabel } from '@ionic/react';
import api from '../../services/api';
import { useApp } from '../../contexts/AppContext';
import { fehlerText } from '../../utils/fehler';
import { rollenName } from '../../utils/rollenNamen';
import { ICON_GEMEINDE_GEFUELLT, ICON_ZUSAGE_GEFUELLT, ICON_ABSAGE } from './icons';

/**
 * Offene Einladungen in eine weitere Gemeinde.
 *
 * Steht im Profil ALLER drei Rollen: Eingeladen werden kann jede Person mit
 * Konto, und sie soll die Einladung dort finden, wo sie ohnehin nachsieht --
 * unabhaengig davon, welche Rolle sie in ihrer eigenen Gemeinde hat.
 *
 * Blendet sich selbst aus, wenn nichts offen ist: eine leere Karte waere ein
 * Platzhalter fuer etwas, das es meistens nicht gibt.
 */

export interface OffeneEinladung {
  id: number;
  organization_display_name: string;
  organization_name: string;
  role_display_name: string;
  role_name: string;
  eingeladen_von_name: string | null;
  expires_at: string;
}

interface Props {
  /** Farbvariante der Rolle, wie bei den anderen Profil-Bausteinen. */
  variante: 'users' | 'teamer' | 'purple';
}

const EinladungenKarte: React.FC<Props> = ({ variante }) => {
  const { setError, setSuccess, isOnline } = useApp();
  const [einladungen, setEinladungen] = useState<OffeneEinladung[]>([]);
  const [laeuft, setLaeuft] = useState<number | null>(null);

  const laden = useCallback(async () => {
    try {
      const res = await api.get('/einladungen/meine');
      setEinladungen(Array.isArray(res.data) ? res.data : []);
    } catch {
      // Still: Eine fehlende Einladungsliste darf das Profil nicht stoeren.
      setEinladungen([]);
    }
  }, []);

  useEffect(() => { void laden(); }, [laden]);

  const antworten = async (id: number, weg: 'annehmen' | 'ablehnen') => {
    setLaeuft(id);
    try {
      const res = await api.post(`/einladungen/${id}/${weg}`);
      if (weg === 'annehmen') {
        const name = res.data?.organization?.display_name || 'die Gemeinde';
        // Die Zugehoerigkeit haengt am Anmeldetoken -- ohne Neuladen zeigt der
        // Umschalter die neue Gemeinde erst nach dem naechsten Start.
        setSuccess(`Du arbeitest jetzt auch in ${name}. Die App lädt neu.`);
        setTimeout(() => window.location.reload(), 1200);
        return;
      }
      setSuccess('Einladung abgelehnt.');
      await laden();
    } catch (err) {
      setError(fehlerText(err, 'Die Einladung konnte nicht beantwortet werden'));
    } finally {
      setLaeuft(null);
    }
  };

  if (einladungen.length === 0) return null;

  return (
    <IonList inset={true} className="app-segment-wrapper">
      <IonListHeader>
        <div className={`app-section-icon app-section-icon--${variante}`}>
          <IonIcon icon={ICON_GEMEINDE_GEFUELLT} />
        </div>
        <IonLabel>{einladungen.length === 1 ? 'Einladung' : 'Einladungen'}</IonLabel>
      </IonListHeader>
      <IonCard className="app-card">
        <IonCardContent>
          {einladungen.map((e) => (
            <div key={e.id} className={`app-list-item app-list-item--${variante}`} style={{ width: '100%' }}>
              <div className="app-list-item__row">
                <div className="app-list-item__main">
                  <div className={`app-icon-circle app-icon-circle--${variante}`}>
                    <IonIcon icon={ICON_GEMEINDE_GEFUELLT} />
                  </div>
                  <div className="app-list-item__content">
                    <div className="app-list-item__title">{e.organization_display_name}</div>
                    <div className="app-list-item__meta">
                      <span className="app-list-item__meta-item">
                        als {rollenName(e.role_name, e.role_display_name)}
                        {e.eingeladen_von_name ? ` · von ${e.eingeladen_von_name}` : ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--app-abstand-eng)', marginTop: 'var(--app-abstand-mittel)' }}>
                <IonButton
                  size="small"
                  expand="block"
                  style={{ flex: 1 }}
                  disabled={laeuft === e.id || !isOnline}
                  onClick={() => antworten(e.id, 'annehmen')}
                >
                  <IonIcon icon={ICON_ZUSAGE_GEFUELLT} slot="start" />
                  Annehmen
                </IonButton>
                <IonButton
                  size="small"
                  fill="outline"
                  expand="block"
                  style={{ flex: 1 }}
                  disabled={laeuft === e.id || !isOnline}
                  onClick={() => antworten(e.id, 'ablehnen')}
                >
                  <IonIcon icon={ICON_ABSAGE} slot="start" />
                  Ablehnen
                </IonButton>
              </div>
            </div>
          ))}
        </IonCardContent>
      </IonCard>
    </IonList>
  );
};

export default EinladungenKarte;
